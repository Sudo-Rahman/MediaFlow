import { invoke } from '@tauri-apps/api/core';
import type {
  LLMProvider,
  SubtitleFile,
  TranslationResult,
  LanguageCode
} from '$lib/types';
import type {
  Cue,
  TranslationRequest,
  TranslationCue,
  TranslationResponse,
  TranslatedCue
} from '$lib/types/subtitle';
import { SUPPORTED_LANGUAGES } from '$lib/types';
import { settingsStore } from '$lib/stores';
import { log } from '$lib/utils/log-toast';
import { parseSubtitle, detectFormat } from './subtitle-parser';
import { reconstructSubtitle, validateTranslation } from './subtitle-reconstructor';
import { callLlm } from './llm-client';
import type { LlmUsage } from './llm-client';
import { withSleepInhibit } from './sleep-inhibit';
import type { TranslationMemoryEntry } from './translation-memory';
import {
  getThemeMemoryEntries,
  getTranslationMemoryScopeKey,
  touchThemeMemoryEntries,
  upsertThemeMemoryEntries
} from './translation-memory';

function getMissingCredentialMessage(provider: LLMProvider): string {
  return provider === 'mediaflow'
    ? 'Sign in to MediaFlow before running AI translation.'
    : `No API key configured for ${provider}. Please add it in Settings.`;
}

// ============================================================================
// SYSTEM PROMPT (for JSON-based translation)
// ============================================================================

export const TRANSLATION_SYSTEM_PROMPT = `You are an expert professional subtitle translator with extensive experience in audiovisual localization. You specialize in creating translations that feel natural and authentic while preserving timing and formatting constraints.

## CRITICAL RULES (MANDATORY)
1. Return ONLY a valid JSON object with the translated cues
2. NEVER add, remove, or reorder cues - translate exactly what you receive
3. PRESERVE ALL PLACEHOLDERS EXACTLY (⟦TAG_0⟧, ⟦BR_0⟧, ~p0:, ~p1:, etc.) - they represent formatting that must not be changed
4. Do NOT merge or split cues
5. Do NOT add explanations, markdown, or any text outside the JSON

## SUBTITLE CONSTRAINTS (CRITICAL)
- Maximum 2 lines per cue (preserve ⟦BR_0⟧ line breaks exactly)
- Maximum 42 characters per line for readability
- Reading speed: ~21 characters/second maximum
- Synchronize reading speed with dialogue pace - fast speech = shorter lines
- Maintain temporal context - adjacent cues should feel continuous

## TRANSLATION QUALITY PRINCIPLES

### 1. Natural Language & Flow
- Prioritize idiomatic, natural-sounding expressions over literal translation
- Adapt dialogue to sound like authentic native conversation
- Consider register (formal/informal) and match the source tone
- Avoid "translationese" - language that sounds translated rather than spoken

### 2. Context & Continuity  
- Maintain consistency with surrounding cues in the same scene
- Preserve character voice, personality, and speaking patterns
- Consider narrative context - who is speaking, their relationship, the situation
- Keep technical terms, proper names, and jargon consistent throughout

### 3. Cultural Adaptation
- Adapt cultural references idiomatically (slang, humor, idioms)
- Maintain meaning even if literal words change
- Handle taboo language appropriately for the target culture
- Keep measurements, currencies, or date formats natural for target audience

### 4. Emotional & Stylistic Preservation
- Preserve emotional tone (sarcasm, anger, excitement, fear)
- Maintain character-specific speech patterns (dialect, formality level)
- Keep speaker intent and subtext intact
- Honor stylistic elements (poetry, technical speech, mumbled dialogue)

### 5. Subtitle-Specific Optimization
- Split long sentences naturally at logical phrase boundaries
- Ensure each line is self-contained when possible (no orphaned words)
- Balance line length within each cue (avoid one long line + one short)
- Prioritize readability over completeness - shorten if necessary
- Consider "subtitle flash" - very short cues must be scannable instantly

## EXAMPLES (for guidance)

Good translation:
Source: "I'm not gonna lie to you, this is going to be tough."
Target: "Je ne vais pas vous mentir, ça va être difficile." (natural, idiomatic)
NOT: "Je ne vais pas te mentir, cela va être dur." (too literal)

Good cultural adaptation:
Source: "It's raining cats and dogs."
Target: "Il pleut des cordes." (French idiom)
NOT: "Il pleut des chats et des chiens." (literal, nonsensical)

Good subtitle brevity:
Source: "You know what I mean, right? It's just that I've been thinking about this for a really long time."
Target: "Tu vois ce que je veux dire ?\nJ'y pense depuis très longtemps." (concise, natural)

## SELF-CHECK (MANDATORY)
Before responding, verify:
□ All cue IDs are preserved unchanged?
□ All placeholders (⟦TAG_0⟧, ⟦BR_0⟧, ~p0:, ~p1:, etc.) are identical and in correct positions?
□ Each translation sounds natural when read aloud?
□ Line lengths respect subtitle constraints (~42 chars/line)?
□ No cue exceeds reasonable reading speed (~21 chars/second)?
□ Character voice and tone are consistent?
□ The JSON is valid and properly formatted?

## OUTPUT FORMAT
{
  "cues": [
    { "id": "original_id", "translatedText": "translated text with ⟦placeholders⟧ preserved" }
  ]
}`;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getLanguageName(code: LanguageCode): string {
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code);
  return lang?.name || code;
}

const NON_TRANSLATABLE_ASS_STYLES = new Set(['mask', 'masktop']);
const THEME_STYLE_KEYWORDS = ['opening', 'ending', 'song', 'karaoke', 'lyrics', 'romaji', 'credit'] as const;
const SHORT_SONG_STYLE_ALIASES = new Set(['op', 'ed']);
const THEME_LAYER_KEYWORDS = ['layer0', 'layer1'] as const;
const NON_DIALOGUE_VISUAL_STYLE_KEYWORDS = ['logo', 'credit', 'credits', 'title', 'titles', 'typeset', 'typesetting', 'karaoke', 'lyrics', 'romaji'] as const;
const NON_DIALOGUE_VISUAL_STYLE_ALIASES = new Set(['op', 'ed', 'ts', 'fx']);
const DIALOGUE_STYLE_ALIASES = new Set(['main', 'default', 'dialogue', 'dialog', 'sub', 'subs', 'subtitle', 'sign', 'signs', 'alt', 'overlap']);
const ANIMATED_NON_DIALOGUE_EFFECTS = new Set(['banner', 'scroll up', 'scroll down']);
const ASS_DRAWING_PATTERN = /^(?:[mnlbspc](?:\s+-?\d+(?:\.\d+)?)+\s*)+$/i;
const KARAOKE_TAG_PATTERN = /\\(?:k|K|kf|ko)\d+/;
const CANONICAL_PLACEHOLDER_PREFIX = '~p';
const CANONICAL_PLACEHOLDER_SUFFIX = ':';

type CueRole = 'passthroughNonText' | 'themeCandidate' | 'visualTextCandidate' | 'mainTranslatable';

interface AssCueRoleBreakdown {
  eventType: string;
  style: string;
  effect: string;
  role: CueRole;
  count: number;
}

interface TranslationCueStats {
  totalCues: number;
  passthroughCues: number;
  themeCandidateCues: number;
  visualTextCandidateCues: number;
  plainVisualTextCandidateCues: number;
  mainTranslatableCues: number;
  skippedMaskCount: number;
  skippedAssSongFxCount: number;
  skippedAssAnimatedEffectCount: number;
  translatedAssKaraokeCommentCount: number;
  protectedAssDrawingSpanCount: number;
  retainedUnknownAssStyleCount: number;
  assRoleBreakdown: AssCueRoleBreakdown[];
  totalChars: number;
  retainedChars: number;
  estimatedReductionPct: number;
}

interface ThemeCueOccurrence {
  cue: Cue;
  signature: string;
  canonicalSkeleton: string;
  placeholderOrder: string[];
}

interface ThemeSignatureGroup {
  signature: string;
  canonicalSkeleton: string;
  occurrences: ThemeCueOccurrence[];
}

type VisualCueMode = 'canonicalSkeleton' | 'plainText';

interface VisualCueOccurrence {
  cue: Cue;
  mode: VisualCueMode;
  signature: string;
  promptText: string;
  canonicalSkeleton: string;
  placeholderOrder: string[];
  readableText?: string;
}

interface VisualSignatureGroup {
  mode: VisualCueMode;
  signature: string;
  promptText: string;
  canonicalSkeleton: string;
  occurrences: VisualCueOccurrence[];
}

interface TranslationCuePlan {
  passthroughCues: TranslatedCue[];
  themeCueOccurrences: ThemeCueOccurrence[];
  visualCueOccurrences: VisualCueOccurrence[];
  mainTranslatableCues: Cue[];
  stats: TranslationCueStats;
}

interface ThemePromptPlan {
  promptCues: TranslationCue[];
  groupByPromptId: Map<string, ThemeSignatureGroup>;
}

interface VisualPromptPlan {
  promptCues: TranslationCue[];
  groupByPromptId: Map<string, VisualSignatureGroup>;
}

interface BatchedTranslationResult {
  cues: TranslatedCue[];
  usage?: LlmUsage;
  error?: string;
  truncated?: boolean;
  cancelled?: boolean;
  failedIds: Set<string>;
  totalBatches: number;
}

interface TranslationResponseParseResult {
  success: boolean;
  cues: TranslatedCue[];
  error?: string;
  preview?: string;
  warnings: string[];
}

function getCanonicalPlaceholderToken(index: number): string {
  return `${CANONICAL_PLACEHOLDER_PREFIX}${index.toString(36)}${CANONICAL_PLACEHOLDER_SUFFIX}`;
}

function getPlaceholderType(placeholder: Cue['placeholders'][number]): string {
  const match = placeholder.token.match(/^⟦([A-Z]+)_\d+⟧$/);
  return match?.[1] ?? '';
}

function isTagOrDrawingPlaceholder(placeholder: Cue['placeholders'][number]): boolean {
  const type = getPlaceholderType(placeholder);
  return type === 'TAG' || type === 'DRAW';
}

function getReadablePlaceholderReplacement(placeholder: Cue['placeholders'][number]): string {
  switch (getPlaceholderType(placeholder)) {
    case 'BR':
    case 'SBR':
      return '\n';
    case 'HSP':
      return ' ';
    default:
      return '';
  }
}

function normalizeReadablePromptText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[^\S\r\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeReadableSignature(value: string): string {
  return normalizeReadablePromptText(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function getReadableTextFromSkeleton(textSkeleton: string, placeholders: Cue['placeholders']): string {
  let readableText = textSkeleton;

  for (const placeholder of placeholders) {
    readableText = readableText
      .split(placeholder.token)
      .join(getReadablePlaceholderReplacement(placeholder));
  }

  return normalizeReadablePromptText(readableText);
}

function getCueReadableText(cue: Cue): string {
  return getReadableTextFromSkeleton(cue.textSkeleton, cue.placeholders);
}

function getCueVisibleText(cue: Cue): string {
  return normalizeReadableSignature(getCueReadableText(cue));
}

function hasVisibleCueText(cue: Cue): boolean {
  return getCueVisibleText(cue).length > 0;
}

function isAssLikeCue(cue: Cue): boolean {
  return cue.format === 'ass' || cue.format === 'ssa';
}

function isAssDrawingCue(cue: Cue): boolean {
  if (!isAssLikeCue(cue)) {
    return false;
  }

  const stripped = cue.textOriginal.replace(/\{[^}]*\}/g, ' ').trim();
  if (!stripped) {
    return false;
  }

  return ASS_DRAWING_PATTERN.test(stripped);
}

function normalizeAssValue(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

function hasThemeStyleKeyword(normalizedStyle: string): boolean {
  return THEME_STYLE_KEYWORDS.some(keyword => normalizedStyle.includes(keyword));
}

function getAssStyleTokens(normalizedStyle: string): string[] {
  return normalizedStyle.match(/[a-z0-9]+/g) ?? [];
}

function hasShortSongStyleAlias(normalizedStyle: string): boolean {
  const styleTokens = normalizedStyle.match(/[a-z0-9]+/g) ?? [];
  return styleTokens.some(token => SHORT_SONG_STYLE_ALIASES.has(token));
}

function isAssSongFxCue(cue: Cue): boolean {
  if (!isAssLikeCue(cue)) {
    return false;
  }

  if (normalizeAssValue(cue.effect) !== 'fx') {
    return false;
  }

  const normalizedStyle = normalizeAssValue(cue.style);
  return hasThemeStyleKeyword(normalizedStyle) || hasShortSongStyleAlias(normalizedStyle);
}

function isAssKaraokeCommentCue(cue: Cue): boolean {
  const normalizedEffect = normalizeAssValue(cue.effect);
  return isAssLikeCue(cue)
    && cue.assEventType === 'Comment'
    && (
      normalizedEffect === 'karaoke'
      || (normalizedEffect === '' && KARAOKE_TAG_PATTERN.test(cue.textOriginal))
    );
}

function hasNonDialogueVisualStyle(normalizedStyle: string): boolean {
  const styleTokens = getAssStyleTokens(normalizedStyle);
  return NON_DIALOGUE_VISUAL_STYLE_KEYWORDS.some(keyword => normalizedStyle.includes(keyword))
    || styleTokens.some(token => NON_DIALOGUE_VISUAL_STYLE_ALIASES.has(token));
}

function hasSignStyleToken(normalizedStyle: string): boolean {
  return getAssStyleTokens(normalizedStyle).some(token => token === 'sign' || token === 'signs');
}

function hasVisualFormattingPlaceholder(cue: Cue): boolean {
  return cue.placeholders.some(isTagOrDrawingPlaceholder);
}

function hasSignVisualStyle(cue: Cue, normalizedStyle: string): boolean {
  return hasSignStyleToken(normalizedStyle) && hasVisualFormattingPlaceholder(cue);
}

function hasTypesettingStyleSuffix(style: string | undefined): boolean {
  const rawStyle = style?.trim() ?? '';
  if (!rawStyle) {
    return false;
  }

  const tokens = rawStyle.match(/[A-Za-z0-9]+/g) ?? [];
  return tokens.some(token =>
    token.toLowerCase() === 'ts'
    || (token.length > 2 && token.endsWith('TS'))
  );
}

function isAssAnimatedNonDialogueEffectCue(cue: Cue): boolean {
  if (!isAssLikeCue(cue)) {
    return false;
  }

  const normalizedEffect = normalizeAssValue(cue.effect);
  if (!ANIMATED_NON_DIALOGUE_EFFECTS.has(normalizedEffect)) {
    return false;
  }

  return hasNonDialogueVisualStyle(normalizeAssValue(cue.style));
}

function isKnownAssStyleForStats(cue: Cue): boolean {
  const normalizedStyle = normalizeAssValue(cue.style);
  if (!normalizedStyle) {
    return true;
  }

  const styleTokens = getAssStyleTokens(normalizedStyle);
  return NON_TRANSLATABLE_ASS_STYLES.has(normalizedStyle)
    || hasThemeStyleKeyword(normalizedStyle)
    || hasShortSongStyleAlias(normalizedStyle)
    || hasNonDialogueVisualStyle(normalizedStyle)
    || THEME_LAYER_KEYWORDS.some(keyword => normalizedStyle.includes(keyword))
    || styleTokens.some(token => DIALOGUE_STYLE_ALIASES.has(token));
}

function isAssVisualTextCue(cue: Cue): boolean {
  if (!isAssLikeCue(cue)) {
    return false;
  }

  const normalizedStyle = normalizeAssValue(cue.style);
  if (!normalizedStyle) {
    return false;
  }

  return hasNonDialogueVisualStyle(normalizedStyle)
    || hasTypesettingStyleSuffix(cue.style)
    || hasSignVisualStyle(cue, normalizedStyle);
}

function shouldUsePlainVisualMode(cue: Cue): boolean {
  const readableText = getCueReadableText(cue);
  const visibleCharacterCount = Array.from(normalizeReadableSignature(readableText)).length;
  if (visibleCharacterCount === 0) {
    return false;
  }

  const tagOrDrawingPlaceholders = cue.placeholders.filter(isTagOrDrawingPlaceholder);
  const originalTagOrDrawingChars = tagOrDrawingPlaceholders
    .reduce((sum, placeholder) => sum + placeholder.original.length, 0);
  const originalTagOrDrawingRatio = cue.textOriginal.length > 0
    ? originalTagOrDrawingChars / cue.textOriginal.length
    : 0;

  return tagOrDrawingPlaceholders.length >= 16
    || originalTagOrDrawingRatio >= 0.55
    || (visibleCharacterCount >= 20 && tagOrDrawingPlaceholders.length / visibleCharacterCount >= 0.35);
}

function countAssDrawingSpanPlaceholders(cue: Cue): number {
  return cue.placeholders.filter(placeholder => placeholder.token.startsWith('⟦DRAW_')).length;
}

function isThemeCue(cue: Cue): boolean {
  if (!isAssLikeCue(cue)) {
    return false;
  }

  if (isAssKaraokeCommentCue(cue)) {
    return true;
  }

  const normalizedStyle = normalizeAssValue(cue.style);
  const hasThemeKeyword = hasThemeStyleKeyword(normalizedStyle);
  const hasLayerKeyword = THEME_LAYER_KEYWORDS.some(keyword => normalizedStyle.includes(keyword));
  const hasLayerThemeKeyword = hasLayerKeyword
    && ['opening', 'ending', 'romaji', 'song'].some(keyword => normalizedStyle.includes(keyword));

  return hasThemeKeyword || hasLayerThemeKeyword || KARAOKE_TAG_PATTERN.test(cue.textOriginal);
}

function classifyCueRole(cue: Cue): CueRole {
  const normalizedStyle = normalizeAssValue(cue.style);
  const isAssLike = isAssLikeCue(cue);
  const isMaskStyle = isAssLike && !!normalizedStyle && NON_TRANSLATABLE_ASS_STYLES.has(normalizedStyle);

  if (isMaskStyle || isAssDrawingCue(cue) || !hasVisibleCueText(cue)) {
    return 'passthroughNonText';
  }

  if (isAssSongFxCue(cue)) {
    return 'passthroughNonText';
  }

  if (isAssAnimatedNonDialogueEffectCue(cue)) {
    return 'passthroughNonText';
  }

  if (isThemeCue(cue)) {
    return 'themeCandidate';
  }

  if (isAssVisualTextCue(cue)) {
    return 'visualTextCandidate';
  }

  return 'mainTranslatable';
}

function recordAssCueRoleBreakdown(
  breakdownByKey: Map<string, AssCueRoleBreakdown>,
  cue: Cue,
  role: CueRole
): void {
  if (!isAssLikeCue(cue)) {
    return;
  }

  const eventType = cue.assEventType ?? 'Dialogue';
  const style = cue.style?.trim() || '(none)';
  const effect = cue.effect?.trim() || '(none)';
  const key = `${eventType}\t${style}\t${effect}\t${role}`;
  const existing = breakdownByKey.get(key);

  if (existing) {
    existing.count += 1;
    return;
  }

  breakdownByKey.set(key, {
    eventType,
    style,
    effect,
    role,
    count: 1
  });
}

function normalizeThemeSignature(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/[^\S\r\n]+/g, ' ');
}

function buildCanonicalThemeTemplate(cue: Cue): ThemeCueOccurrence {
  const placeholderOrder = cue.placeholders.map(placeholder => placeholder.token);
  let canonicalSkeleton = cue.textSkeleton;

  placeholderOrder.forEach((token, index) => {
    canonicalSkeleton = canonicalSkeleton.split(token).join(getCanonicalPlaceholderToken(index));
  });

  return {
    cue,
    signature: normalizeThemeSignature(canonicalSkeleton),
    canonicalSkeleton,
    placeholderOrder
  };
}

function buildCanonicalVisualTemplate(cue: Cue): VisualCueOccurrence {
  const placeholderOrder = cue.placeholders.map(placeholder => placeholder.token);
  let canonicalSkeleton = cue.textSkeleton;

  placeholderOrder.forEach((token, index) => {
    canonicalSkeleton = canonicalSkeleton.split(token).join(getCanonicalPlaceholderToken(index));
  });

  return {
    cue,
    mode: 'canonicalSkeleton',
    signature: `canonical:${normalizeThemeSignature(canonicalSkeleton)}`,
    promptText: canonicalSkeleton,
    canonicalSkeleton,
    placeholderOrder
  };
}

function buildPlainVisualTemplate(cue: Cue): VisualCueOccurrence {
  const placeholderOrder = cue.placeholders.map(placeholder => placeholder.token);
  const readableText = getCueReadableText(cue);

  return {
    cue,
    mode: 'plainText',
    signature: `plain:${normalizeReadableSignature(readableText)}`,
    promptText: readableText,
    canonicalSkeleton: cue.textSkeleton,
    placeholderOrder,
    readableText
  };
}

function buildVisualTemplate(cue: Cue): VisualCueOccurrence {
  return shouldUsePlainVisualMode(cue)
    ? buildPlainVisualTemplate(cue)
    : buildCanonicalVisualTemplate(cue);
}

function applyCanonicalTranslation(
  translatedCanonicalSkeleton: string,
  placeholderOrder: string[]
): string {
  let translatedSkeleton = translatedCanonicalSkeleton;

  placeholderOrder.forEach((token, index) => {
    translatedSkeleton = translatedSkeleton
      .split(getCanonicalPlaceholderToken(index))
      .join(token);
  });

  return translatedSkeleton;
}

function buildTranslationCuePlan(cues: Cue[]): TranslationCuePlan {
  const passthroughCues: TranslatedCue[] = [];
  const themeCueOccurrences: ThemeCueOccurrence[] = [];
  const visualCueOccurrences: VisualCueOccurrence[] = [];
  const mainTranslatableCues: Cue[] = [];
  const assRoleBreakdownByKey = new Map<string, AssCueRoleBreakdown>();

  let skippedMaskCount = 0;
  let skippedAssSongFxCount = 0;
  let skippedAssAnimatedEffectCount = 0;
  let plainVisualTextCandidateCues = 0;
  let translatedAssKaraokeCommentCount = 0;
  let protectedAssDrawingSpanCount = 0;
  let retainedUnknownAssStyleCount = 0;
  let totalChars = 0;
  let retainedChars = 0;

  for (const cue of cues) {
    totalChars += cue.textSkeleton.length;
    protectedAssDrawingSpanCount += countAssDrawingSpanPlaceholders(cue);
    const role = classifyCueRole(cue);
    recordAssCueRoleBreakdown(assRoleBreakdownByKey, cue, role);

    if (role === 'passthroughNonText') {
      const normalizedStyle = normalizeAssValue(cue.style);
      if (normalizedStyle && NON_TRANSLATABLE_ASS_STYLES.has(normalizedStyle)) {
        skippedMaskCount += 1;
      }

      if (isAssSongFxCue(cue) && hasVisibleCueText(cue) && !isAssDrawingCue(cue)) {
        skippedAssSongFxCount += 1;
      }

      if (isAssAnimatedNonDialogueEffectCue(cue) && hasVisibleCueText(cue) && !isAssDrawingCue(cue)) {
        skippedAssAnimatedEffectCount += 1;
      }

      passthroughCues.push({
        id: cue.id,
        translatedText: cue.textSkeleton
      });
      continue;
    }

    if (role === 'visualTextCandidate') {
      const visualOccurrence = buildVisualTemplate(cue);
      if (visualOccurrence.mode === 'plainText') {
        plainVisualTextCandidateCues += 1;
      }

      retainedChars += visualOccurrence.promptText.length;
      visualCueOccurrences.push(visualOccurrence);
      continue;
    }

    retainedChars += cue.textSkeleton.length;

    if (isAssKaraokeCommentCue(cue)) {
      translatedAssKaraokeCommentCount += 1;
    }

    if (isAssLikeCue(cue) && !isKnownAssStyleForStats(cue)) {
      retainedUnknownAssStyleCount += 1;
    }

    if (role === 'themeCandidate') {
      themeCueOccurrences.push(buildCanonicalThemeTemplate(cue));
      continue;
    }

    mainTranslatableCues.push(cue);
  }

  const passthroughCount = cues.length - (themeCueOccurrences.length + visualCueOccurrences.length + mainTranslatableCues.length);
  const estimatedReductionPct = totalChars > 0
    ? Math.round(((totalChars - retainedChars) * 10000) / totalChars) / 100
    : 0;

  return {
    passthroughCues,
    themeCueOccurrences,
    visualCueOccurrences,
    mainTranslatableCues,
    stats: {
      totalCues: cues.length,
      passthroughCues: passthroughCount,
      themeCandidateCues: themeCueOccurrences.length,
      visualTextCandidateCues: visualCueOccurrences.length,
      plainVisualTextCandidateCues,
      mainTranslatableCues: mainTranslatableCues.length,
      skippedMaskCount,
      skippedAssSongFxCount,
      skippedAssAnimatedEffectCount,
      translatedAssKaraokeCommentCount,
      protectedAssDrawingSpanCount,
      retainedUnknownAssStyleCount,
      assRoleBreakdown: Array.from(assRoleBreakdownByKey.values())
        .sort((a, b) => b.count - a.count),
      totalChars,
      retainedChars,
      estimatedReductionPct
    }
  };
}

function groupThemeCueOccurrencesBySignature(occurrences: ThemeCueOccurrence[]): ThemeSignatureGroup[] {
  const groups = new Map<string, ThemeSignatureGroup>();

  for (const occurrence of occurrences) {
    const existing = groups.get(occurrence.signature);
    if (existing) {
      existing.occurrences.push(occurrence);
      continue;
    }

    groups.set(occurrence.signature, {
      signature: occurrence.signature,
      canonicalSkeleton: occurrence.canonicalSkeleton,
      occurrences: [occurrence]
    });
  }

  return Array.from(groups.values());
}

function groupVisualCueOccurrencesBySignature(occurrences: VisualCueOccurrence[]): VisualSignatureGroup[] {
  const groups = new Map<string, VisualSignatureGroup>();

  for (const occurrence of occurrences) {
    const existing = groups.get(occurrence.signature);
    if (existing) {
      existing.occurrences.push(occurrence);
      continue;
    }

    groups.set(occurrence.signature, {
      mode: occurrence.mode,
      signature: occurrence.signature,
      promptText: occurrence.promptText,
      canonicalSkeleton: occurrence.canonicalSkeleton,
      occurrences: [occurrence]
    });
  }

  return Array.from(groups.values());
}

function formatAssRoleBreakdownForLog(breakdown: AssCueRoleBreakdown[]): string {
  if (breakdown.length === 0) {
    return 'none';
  }

  const visibleBreakdown = breakdown.slice(0, 12).map(entry =>
    `${entry.eventType}/${entry.style}/${entry.effect}/${entry.role}: ${entry.count}`
  );

  if (breakdown.length > visibleBreakdown.length) {
    visibleBreakdown.push(`+${breakdown.length - visibleBreakdown.length} more`);
  }

  return visibleBreakdown.join('; ');
}

function buildThemeMemoryKey(
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  provider: LLMProvider,
  model: string,
  signature: string
): string {
  return `${sourceLang}:${targetLang}:${provider}:${model}:${signature}`;
}

function expandThemeGroupTranslation(
  group: ThemeSignatureGroup,
  translatedCanonicalSkeleton: string
): TranslatedCue[] {
  return group.occurrences.map(occurrence => ({
    id: occurrence.cue.id,
    translatedText: applyCanonicalTranslation(
      translatedCanonicalSkeleton,
      occurrence.placeholderOrder
    )
  }));
}

interface VisualExpansionResult {
  cues: TranslatedCue[];
  unresolvedCues: Cue[];
  fallbackCount: number;
}

function getCanonicalPlaceholderTokens(value: string): string[] {
  return value.match(/~p[0-9a-z]+:/g) ?? [];
}

function hasExpectedCanonicalPlaceholders(
  translatedCanonicalSkeleton: string,
  expectedCanonicalSkeleton: string
): boolean {
  const expectedTokens = getCanonicalPlaceholderTokens(expectedCanonicalSkeleton);
  const translatedTokens = getCanonicalPlaceholderTokens(translatedCanonicalSkeleton);

  return expectedTokens.length === translatedTokens.length
    && expectedTokens.every((token, index) => translatedTokens[index] === token);
}

function splitSkeletonSegments(textSkeleton: string): Array<{ kind: 'text' | 'placeholder'; value: string }> {
  const segments: Array<{ kind: 'text' | 'placeholder'; value: string }> = [];
  const placeholderPattern = /⟦[A-Z]+_\d+⟧/g;
  let cursor = 0;

  for (const match of textSkeleton.matchAll(placeholderPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: 'text', value: textSkeleton.slice(cursor, index) });
    }

    segments.push({ kind: 'placeholder', value: match[0] });
    cursor = index + match[0].length;
  }

  if (cursor < textSkeleton.length) {
    segments.push({ kind: 'text', value: textSkeleton.slice(cursor) });
  }

  return segments;
}

function projectPlainTranslationIntoSkeleton(occurrence: VisualCueOccurrence, translatedPlainText: string): string {
  if (normalizeReadableSignature(translatedPlainText) === normalizeReadableSignature(occurrence.readableText ?? '')) {
    return occurrence.cue.textSkeleton;
  }

  const segments = splitSkeletonSegments(occurrence.cue.textSkeleton);
  const textSegmentIndexes = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.kind === 'text' && segment.value.trim().length > 0);

  if (textSegmentIndexes.length === 0) {
    return occurrence.cue.textSkeleton;
  }

  const readableTranslation = normalizeReadablePromptText(translatedPlainText);

  textSegmentIndexes.forEach(({ segment, index }, replacementIndex) => {
    segments[index] = {
      kind: 'text',
      value: replacementIndex === 0
        ? `${segment.value.match(/^\s*/)?.[0] ?? ''}${readableTranslation}${segment.value.match(/\s*$/)?.[0] ?? ''}`
        : ''
    };
  });

  return segments.map(segment => segment.value).join('');
}

function buildPlainVisualTranslatedCue(
  occurrence: VisualCueOccurrence,
  translatedPlainText: string
): { cue: TranslatedCue | null; usedFallback: boolean } {
  const translatedText = projectPlainTranslationIntoSkeleton(occurrence, translatedPlainText);
  const translatedCue = {
    id: occurrence.cue.id,
    translatedText
  };
  const validation = validateTranslation([occurrence.cue], [translatedCue]);
  const projectedReadableText = getReadableTextFromSkeleton(translatedText, occurrence.cue.placeholders);
  const expectedReadableText = normalizeReadableSignature(translatedPlainText);

  if (
    validation.valid
    && expectedReadableText.length > 0
    && normalizeReadableSignature(projectedReadableText) === expectedReadableText
  ) {
    return { cue: translatedCue, usedFallback: false };
  }

  return { cue: null, usedFallback: true };
}

function expandVisualGroupTranslation(
  group: VisualSignatureGroup,
  translatedPromptText: string
): VisualExpansionResult {
  if (group.mode === 'canonicalSkeleton') {
    if (!hasExpectedCanonicalPlaceholders(translatedPromptText, group.canonicalSkeleton)) {
      return {
        cues: [],
        unresolvedCues: group.occurrences.map(occurrence => occurrence.cue),
        fallbackCount: group.occurrences.length
      };
    }

    return {
      cues: group.occurrences.map(occurrence => ({
        id: occurrence.cue.id,
        translatedText: applyCanonicalTranslation(
          translatedPromptText,
          occurrence.placeholderOrder
        )
      })),
      unresolvedCues: [],
      fallbackCount: 0
    };
  }

  let fallbackCount = 0;
  const cues: TranslatedCue[] = [];
  const unresolvedCues: Cue[] = [];

  for (const occurrence of group.occurrences) {
    const translatedCue = buildPlainVisualTranslatedCue(occurrence, translatedPromptText);
    if (translatedCue.usedFallback) {
      fallbackCount += 1;
      unresolvedCues.push(occurrence.cue);
      continue;
    }

    if (translatedCue.cue) {
      cues.push(translatedCue.cue);
    }
  }

  return { cues, unresolvedCues, fallbackCount };
}

/**
 * Split array into N equal batches
 * @param array - The array to split
 * @param batchCount - Number of batches to create (1 = no splitting)
 */
function splitIntoNBatches<T>(array: T[], batchCount: number): T[][] {
  if (batchCount <= 1 || array.length === 0) return [array];

  const batches: T[][] = [];
  const itemsPerBatch = Math.ceil(array.length / batchCount);

  for (let i = 0; i < array.length; i += itemsPerBatch) {
    batches.push(array.slice(i, i + itemsPerBatch));
  }

  return batches;
}

/**
 * Build translation request from parsed subtitle
 */
function buildTranslationRequest(
  cues: TranslationCue[],
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): TranslationRequest {
  return {
    sourceLang: sourceLang === 'auto' ? 'auto-detect' : getLanguageName(sourceLang),
    targetLang: getLanguageName(targetLang),
    rules: {
      placeholders: 'MUST_PRESERVE_EXACTLY',
      noReordering: true,
      noMerging: true,
      noSplitting: true
    },
    cues
  };
}

function buildPromptCuesFromParsedCues(cues: Cue[]): TranslationCue[] {
  return cues.map(cue => ({
    id: cue.id,
    text: cue.textSkeleton
  }));
}

function buildThemePromptPlan(groups: ThemeSignatureGroup[]): ThemePromptPlan {
  const promptCues: TranslationCue[] = [];
  const groupByPromptId = new Map<string, ThemeSignatureGroup>();

  groups.forEach((group, index) => {
    const promptId = `THEME_${index.toString(36)}`;
    promptCues.push({
      id: promptId,
      text: group.canonicalSkeleton
    });
    groupByPromptId.set(promptId, group);
  });

  return { promptCues, groupByPromptId };
}

function buildVisualPromptPlan(groups: VisualSignatureGroup[]): VisualPromptPlan {
  const promptCues: TranslationCue[] = [];
  const groupByPromptId = new Map<string, VisualSignatureGroup>();

  groups.forEach((group, index) => {
    const promptId = `VISUAL_${index.toString(36)}`;
    promptCues.push({
      id: promptId,
      text: group.promptText
    });
    groupByPromptId.set(promptId, group);
  });

  return { promptCues, groupByPromptId };
}

/**
 * Build user prompt with translation request
 */
function buildUserPrompt(request: TranslationRequest): string {
  return `Translate the following subtitle cues from ${request.sourceLang} to ${request.targetLang}.

${JSON.stringify(request)}`;
}

/**
 * Build the full prompt (system + user) for token counting
 * This represents the actual text that will be sent to the LLM
 */
export function buildFullPromptForTokenCount(
  content: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): string {
  const parsed = parseSubtitle(content);
  if (!parsed) {
    // Fallback: return raw content if parsing fails
    return TRANSLATION_SYSTEM_PROMPT + '\n\n' + content;
  }

  const cuePlan = buildTranslationCuePlan(parsed.cues);
  const promptParts: string[] = [];

  const themeGroups = groupThemeCueOccurrencesBySignature(cuePlan.themeCueOccurrences);
  const visualGroups = groupVisualCueOccurrencesBySignature(cuePlan.visualCueOccurrences);
  if (themeGroups.length > 0) {
    const themeRequest = buildTranslationRequest(
      buildThemePromptPlan(themeGroups).promptCues,
      sourceLang,
      targetLang
    );
    promptParts.push(`${TRANSLATION_SYSTEM_PROMPT}\n\n${buildUserPrompt(themeRequest)}`);
  }

  if (visualGroups.length > 0) {
    const visualRequest = buildTranslationRequest(
      buildVisualPromptPlan(visualGroups).promptCues,
      sourceLang,
      targetLang
    );
    promptParts.push(`${TRANSLATION_SYSTEM_PROMPT}\n\n${buildUserPrompt(visualRequest)}`);
  }

  if (cuePlan.mainTranslatableCues.length > 0) {
    const mainRequest = buildTranslationRequest(
      buildPromptCuesFromParsedCues(cuePlan.mainTranslatableCues),
      sourceLang,
      targetLang
    );
    promptParts.push(`${TRANSLATION_SYSTEM_PROMPT}\n\n${buildUserPrompt(mainRequest)}`);
  }

  if (promptParts.length === 0) {
    return TRANSLATION_SYSTEM_PROMPT;
  }

  return promptParts.join('\n\n');
}

/**
 * Parse LLM response to extract translated cues
 * @param responseText - Raw response text from the LLM
 * @param provider - Name of the LLM provider for logging context
 */
async function parseTranslationResponse(responseText: string, provider: string = 'unknown'): Promise<TranslationResponse | null> {
  try {
    const result = await invoke<TranslationResponseParseResult>('parse_translation_response', { responseText });

    if (!result.success) {
      switch (result.error) {
        case 'Empty AI response':
          log('error', 'translation', 'Empty AI response',
            'The AI provider returned an empty response. This may indicate a rate limit, content filter, or API issue.',
            { provider }
          );
          break;
        case 'Invalid JSON format':
          log('error', 'translation', 'Invalid JSON format',
            `Could not find a valid JSON object in the AI response. The AI may have returned plain text instead of JSON.\n\nResponse preview:\n${result.preview ?? ''}`,
            { provider }
          );
          break;
        case 'Invalid JSON structure':
          log('error', 'translation', 'Invalid JSON structure',
            `The AI response JSON is missing the required "cues" array. The AI may have returned a different format.\n\nJSON preview:\n${result.preview ?? ''}`,
            { provider }
          );
          break;
        case 'Empty cues array':
          log('warning', 'translation', 'Empty cues array',
            'The AI returned a valid JSON but with an empty "cues" array. No translations were provided.',
            { provider }
          );
          break;
        default:
          log('error', 'translation', result.error?.startsWith('JSON parse error') ? 'JSON parse error' : 'Unexpected parsing error',
            `${result.error ?? 'Unknown parsing error'}\n\nJSON preview:\n${result.preview ?? ''}`,
            { provider, apiError: result.error ?? 'unknown' }
          );
          break;
      }
      return null;
    }

    for (const warning of result.warnings) {
      log('warning', 'translation', 'Incomplete cue data', warning, { provider });
    }

    return { cues: result.cues };
  } catch (error) {
    const preview = responseText.length > 300 ? responseText.slice(0, 300) + '...' : responseText;
    log('error', 'translation', 'Unexpected parsing error',
      `An unexpected error occurred while parsing the AI response.\n\nError: ${error}\n\nResponse preview:\n${preview}`,
      { provider, apiError: String(error) }
    );
    console.error('Failed to parse translation response:', error);
    console.error('Response text:', responseText);
    return null;
  }
}

// ============================================================================
// BATCH PROGRESS CALLBACK TYPE
// ============================================================================

export interface BatchProgressInfo {
  progress: number;
  currentBatch: number;
  totalBatches: number;
}

const DEFAULT_BATCH_CONCURRENCY = 2;

export interface TranslateSubtitleOptions {
  onProgress?: (info: BatchProgressInfo | number) => void;
  batchCount?: number;
  signal?: AbortSignal;
  runId?: string;
  batchConcurrency?: number;
  logContext?: Record<string, string>;
}

export interface TranslateSubtitleMultiModelEntry {
  modelJobId: string;
  provider: LLMProvider;
  model: string;
}

export interface TranslateSubtitleMultiModelOptions {
  batchCount?: number;
  onModelProgress?: (modelJobId: string, info: BatchProgressInfo | number) => void;
  onModelComplete?: (modelJobId: string, result: TranslationResult) => void | Promise<void>;
  onModelError?: (modelJobId: string, error: Error) => void;
  signalByModelJobId?: Map<string, AbortSignal>;
  runId?: string;
  batchConcurrency?: number;
}

function isCancelledError(error: string | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes('cancel');
}

function buildCancelledResult(file: SubtitleFile): TranslationResult {
  return {
    originalFile: file,
    translatedContent: '',
    success: false,
    error: 'Translation cancelled',
  };
}

interface TranslatePromptCueBatchesOptions {
  promptCues: TranslationCue[];
  provider: LLMProvider;
  apiKey: string;
  model: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  batchCount: number;
  batchConcurrency: number;
  signal?: AbortSignal;
  logContext: Record<string, string>;
  reportProgress: (info: BatchProgressInfo) => void;
  progressStart: number;
  progressEnd: number;
  phaseLabel: string;
  allowPartial: boolean;
}

async function translatePromptCueBatches(
  options: TranslatePromptCueBatchesOptions
): Promise<BatchedTranslationResult> {
  const {
    promptCues,
    provider,
    apiKey,
    model,
    sourceLang,
    targetLang,
    batchCount,
    batchConcurrency,
    signal,
    logContext,
    reportProgress,
    progressStart,
    progressEnd,
    phaseLabel,
    allowPartial
  } = options;

  if (promptCues.length === 0) {
    return {
      cues: [],
      failedIds: new Set<string>(),
      totalBatches: 0
    };
  }

  const batches = splitIntoNBatches(promptCues, batchCount);
  const totalBatches = batches.length;

  interface BatchResult {
    batchIndex: number;
    cues: TranslatedCue[];
    failedIds: Set<string>;
    error?: string;
    truncated?: boolean;
    usage?: LlmUsage;
    cancelled?: boolean;
  }

  const translateBatch = async (
    batch: TranslationCue[],
    batchIndex: number
  ): Promise<BatchResult> => {
    if (signal?.aborted) {
      return {
        batchIndex,
        cues: [],
        failedIds: new Set(batch.map(cue => cue.id)),
        error: 'Translation cancelled',
        cancelled: true
      };
    }

    const translationRequest = buildTranslationRequest(batch, sourceLang, targetLang);
    const userPrompt = buildUserPrompt(translationRequest);

    const llmResponse = await callLlm({
      provider,
      apiKey,
      model,
      systemPrompt: TRANSLATION_SYSTEM_PROMPT,
      userPrompt,
      signal,
      responseMode: 'json',
      temperature: 0.3,
      logSource: 'translation',
    });

    if (signal?.aborted) {
      return {
        batchIndex,
        cues: [],
        failedIds: new Set(batch.map(cue => cue.id)),
        error: 'Translation cancelled',
        cancelled: true
      };
    }

    if (llmResponse.cancelled || isCancelledError(llmResponse.error)) {
      return {
        batchIndex,
        cues: [],
        failedIds: new Set(batch.map(cue => cue.id)),
        error: 'Translation cancelled',
        cancelled: true
      };
    }

    if (llmResponse.error) {
      return {
        batchIndex,
        cues: [],
        failedIds: new Set(batch.map(cue => cue.id)),
        error: `${phaseLabel} batch ${batchIndex + 1}/${totalBatches} failed: ${llmResponse.error}`
      };
    }

    if (llmResponse.truncated) {
      const error = `${phaseLabel} batch ${batchIndex + 1}/${totalBatches}: Response truncated (increase batch count)`;
      log(
        'warning',
        'translation',
        `${phaseLabel} response truncated`,
        `The API response was truncated (finish_reason: ${llmResponse.finishReason}). Try increasing the number of batches.`,
        { ...logContext, batchIndex: String(batchIndex + 1) }
      );

      return {
        batchIndex,
        cues: [],
        failedIds: new Set(batch.map(cue => cue.id)),
        error,
        truncated: true,
        usage: llmResponse.usage
      };
    }

    if (!llmResponse.content || !llmResponse.content.trim()) {
      const error = `${phaseLabel} batch ${batchIndex + 1}/${totalBatches}: ${provider} returned empty content`;
      log(
        'error',
        'translation',
        `Empty response during ${phaseLabel}`,
        `The translation request succeeded but ${provider} returned no content. This may be caused by rate limits, content filtering, or API issues.`,
        { ...logContext, batchIndex: String(batchIndex + 1) }
      );

      return {
        batchIndex,
        cues: [],
        failedIds: new Set(batch.map(cue => cue.id)),
        error,
        usage: llmResponse.usage
      };
    }

    const translationResponse = await parseTranslationResponse(llmResponse.content, provider);
    if (!translationResponse) {
      return {
        batchIndex,
        cues: [],
        failedIds: new Set(batch.map(cue => cue.id)),
        error: `${phaseLabel} batch ${batchIndex + 1}/${totalBatches}: Failed to parse ${provider} response (check Logs for details)`,
        usage: llmResponse.usage
      };
    }

    const batchIdSet = new Set(batch.map(cue => cue.id));
    const sanitizedCues = translationResponse.cues.filter(cue => batchIdSet.has(cue.id));
    const ignoredCueCount = translationResponse.cues.length - sanitizedCues.length;

    if (ignoredCueCount > 0) {
      const ignoredIds = translationResponse.cues
        .filter(cue => !batchIdSet.has(cue.id))
        .map(cue => cue.id)
        .filter(Boolean);

      log(
        'warning',
        'translation',
        'Ignored unexpected cue IDs from LLM response',
        `${phaseLabel} batch ${batchIndex + 1}/${totalBatches}: ignored ${ignoredCueCount} cue(s) with IDs outside the requested batch. IDs: ${ignoredIds.slice(0, 5).join(', ') || '(none)'}`,
        {
          ...logContext,
          batchIndex: String(batchIndex + 1)
        }
      );
    }

    const translatedIds = new Set(sanitizedCues.map(cue => cue.id));
    const failedIds = new Set(
      batch
        .map(cue => cue.id)
        .filter(id => !translatedIds.has(id))
    );

    if (failedIds.size > 0) {
      log(
        'warning',
        'translation',
        'Missing cue IDs from LLM response',
        `${phaseLabel} batch ${batchIndex + 1}/${totalBatches}: ${failedIds.size} requested cue(s) were not returned by the model.`,
        {
          ...logContext,
          batchIndex: String(batchIndex + 1)
        }
      );
    }

    return {
      batchIndex,
      cues: sanitizedCues,
      failedIds,
      usage: llmResponse.usage
    };
  };

  let completedBatches = 0;
  const batchResults: BatchResult[] = [];
  let nextBatchIndex = 0;
  let stopScheduling = false;
  const workerCount = Math.min(batchConcurrency, totalBatches);

  reportProgress({ progress: progressStart, currentBatch: 0, totalBatches });

  const workers = Array.from({ length: workerCount }, async () => {
    while (!stopScheduling) {
      if (signal?.aborted) {
        stopScheduling = true;
        return;
      }

      const batchIndex = nextBatchIndex;
      if (batchIndex >= totalBatches) {
        return;
      }

      nextBatchIndex += 1;
      const result = await translateBatch(batches[batchIndex], batchIndex);
      batchResults.push(result);

      completedBatches += 1;
      const phaseProgress = progressStart
        + ((completedBatches / totalBatches) * (progressEnd - progressStart));

      reportProgress({
        progress: Math.round(phaseProgress),
        currentBatch: completedBatches,
        totalBatches
      });

      if (signal?.aborted || result.cancelled) {
        stopScheduling = true;
      }
    }
  });

  const workerResults = await Promise.allSettled(workers);
  for (const workerResult of workerResults) {
    if (workerResult.status === 'rejected') {
      return {
        cues: [],
        failedIds: new Set(promptCues.map(cue => cue.id)),
        totalBatches,
        error: `${phaseLabel} worker failed: ${String(workerResult.reason)}`
      };
    }
  }

  if (signal?.aborted || batchResults.some(result => result.cancelled)) {
    return {
      cues: [],
      failedIds: new Set(promptCues.map(cue => cue.id)),
      totalBatches,
      cancelled: true
    };
  }

  if (batchResults.length !== totalBatches) {
    return {
      cues: [],
      failedIds: new Set(promptCues.map(cue => cue.id)),
      totalBatches,
      error: `${phaseLabel} incomplete: ${batchResults.length}/${totalBatches} batches finished`
    };
  }

  batchResults.sort((a, b) => a.batchIndex - b.batchIndex);

  let totalUsage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const failedIds = new Set<string>();
  const translatedCues: TranslatedCue[] = [];
  let firstError: string | undefined;
  let truncated = false;

  for (const result of batchResults) {
    if (result.usage) {
      totalUsage.promptTokens += result.usage.promptTokens;
      totalUsage.completionTokens += result.usage.completionTokens;
      totalUsage.totalTokens += result.usage.totalTokens;
    }

    result.failedIds.forEach(id => failedIds.add(id));
    translatedCues.push(...result.cues);

    if (result.truncated) {
      truncated = true;
    }

    if (result.error && !firstError) {
      firstError = result.error;
    }
  }

  if (!allowPartial && firstError) {
    return {
      cues: translatedCues,
      usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
      error: firstError,
      truncated,
      failedIds,
      totalBatches
    };
  }

  return {
    cues: translatedCues,
    usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
    error: allowPartial ? firstError : undefined,
    truncated,
    failedIds,
    totalBatches
  };
}

// ============================================================================
// MAIN TRANSLATION FUNCTION WITH BATCHING
// ============================================================================

/**
 * Translate subtitle file using the robust parsing/reconstruction pipeline
 * Supports batching for large files and cancellation via AbortSignal
 * @param batchCount - Number of batches to split the file into (1 = no splitting)
 */
export async function translateSubtitle(
  file: SubtitleFile,
  provider: LLMProvider,
  model: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  options: TranslateSubtitleOptions = {}
): Promise<TranslationResult> {
  const onProgress = options.onProgress;
  const batchCount = Math.max(1, options.batchCount ?? 1);
  const batchConcurrency = Math.max(1, options.batchConcurrency ?? DEFAULT_BATCH_CONCURRENCY);
  const signal = options.signal;
  const runId = options.runId ?? 'n/a';
  const logContext = { provider, runId, ...(options.logContext ?? {}) };

  const apiKey = settingsStore.getLLMApiKey(provider);

  if (!apiKey) {
    return {
      originalFile: file,
      translatedContent: '',
      success: false,
      error: getMissingCredentialMessage(provider)
    };
  }

  if (!model) {
    return {
      originalFile: file,
      translatedContent: '',
      success: false,
      error: 'No model selected. Please select a model.'
    };
  }

  // Check for cancellation
  if (signal?.aborted) {
    return buildCancelledResult(file);
  }

  return withSleepInhibit('MediaFlow: AI translation', async () => {
    const reportProgress = (info: BatchProgressInfo) => {
      if (onProgress) {
        onProgress(info);
      }
    };

    const addUsage = (target: LlmUsage, usage?: LlmUsage) => {
      if (!usage) {
        return;
      }

      target.promptTokens += usage.promptTokens;
      target.completionTokens += usage.completionTokens;
      target.totalTokens += usage.totalTokens;
    };

    reportProgress({ progress: 5, currentBatch: 0, totalBatches: 0 });

    const parsed = parseSubtitle(file.content);
    if (!parsed) {
      return {
        originalFile: file,
        translatedContent: '',
        success: false,
        error: 'Could not parse subtitle file. Unsupported format.'
      };
    }

    if (parsed.parseWarnings && parsed.parseWarnings.length > 0) {
      log(
        'warning',
        'translation',
        'Subtitle parse warnings',
        parsed.parseWarnings.slice(0, 8).join('\n'),
        logContext
      );
    }

    if (parsed.cues.length === 0) {
      return {
        originalFile: file,
        translatedContent: '',
        success: false,
        error: 'No subtitle cues found in file.'
      };
    }

    if (signal?.aborted) {
      return buildCancelledResult(file);
    }

    reportProgress({ progress: 10, currentBatch: 0, totalBatches: 0 });

    const cuePlan = buildTranslationCuePlan(parsed.cues);
    const themeGroups = groupThemeCueOccurrencesBySignature(cuePlan.themeCueOccurrences);
    const visualGroups = groupVisualCueOccurrencesBySignature(cuePlan.visualCueOccurrences);

    log(
      'info',
      'translation',
      'Prepared cues for translation',
      `Retained ${cuePlan.stats.themeCandidateCues + cuePlan.stats.visualTextCandidateCues + cuePlan.stats.mainTranslatableCues}/${cuePlan.stats.totalCues} text cues. Theme candidates: ${cuePlan.stats.themeCandidateCues}. Visual text candidates: ${cuePlan.stats.visualTextCandidateCues} across ${visualGroups.length} unique prompt group(s), ${cuePlan.stats.plainVisualTextCandidateCues} plain readable occurrence(s). Main cues: ${cuePlan.stats.mainTranslatableCues}. Passthrough: ${cuePlan.stats.passthroughCues} (${cuePlan.stats.skippedMaskCount} mask cues, ${cuePlan.stats.skippedAssSongFxCount} ASS song FX cues, ${cuePlan.stats.skippedAssAnimatedEffectCount} animated effect cues). Hidden karaoke comments translated: ${cuePlan.stats.translatedAssKaraokeCommentCount}. Drawing spans protected: ${cuePlan.stats.protectedAssDrawingSpanCount}. Unknown ASS styles retained: ${cuePlan.stats.retainedUnknownAssStyleCount}. Estimated non-text reduction: ${cuePlan.stats.estimatedReductionPct}% (${cuePlan.stats.retainedChars}/${cuePlan.stats.totalChars} chars retained). ASS role breakdown: ${formatAssRoleBreakdownForLog(cuePlan.stats.assRoleBreakdown)}.`,
      logContext
    );

    if (cuePlan.passthroughCues.length === parsed.cues.length) {
      reportProgress({ progress: 100, currentBatch: 0, totalBatches: 0 });
      return {
        originalFile: file,
        translatedContent: file.content,
        success: true,
      };
    }

    const totalUsage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const translatedThemeCues: TranslatedCue[] = [];
    const translatedVisualCues: TranslatedCue[] = [];
    const unresolvedThemeCues: Cue[] = [];
    const unresolvedVisualCues: Cue[] = [];
    const scopeKey = getTranslationMemoryScopeKey(file.path);

    if (themeGroups.length > 0) {
      log(
        'info',
        'translation',
        'Theme preflight started',
        `Processing ${cuePlan.themeCueOccurrences.length} theme cue occurrence(s) across ${themeGroups.length} unique signature(s). Scope: ${scopeKey}`,
        logContext
      );

      const memoryKeyBySignature = new Map<string, string>();
      for (const group of themeGroups) {
        memoryKeyBySignature.set(
          group.signature,
          buildThemeMemoryKey(sourceLang, targetLang, provider, model, group.signature)
        );
      }

      let memoryEntries = new Map<string, TranslationMemoryEntry>();
      try {
        memoryEntries = await getThemeMemoryEntries(
          scopeKey,
          Array.from(memoryKeyBySignature.values())
        );
      } catch (error) {
        log(
          'warning',
          'translation',
          'Theme memory lookup failed',
          `Theme cache read failed for scope ${scopeKey}. Falling back to live translation for missing theme segments.\n\nError: ${String(error)}`,
          logContext
        );
      }

      const memoryHitKeys: string[] = [];
      const missingThemeGroups: ThemeSignatureGroup[] = [];

      for (const group of themeGroups) {
        const memoryKey = memoryKeyBySignature.get(group.signature);
        if (!memoryKey) {
          missingThemeGroups.push(group);
          continue;
        }

        const cachedEntry = memoryEntries.get(memoryKey);
        if (cachedEntry) {
          memoryHitKeys.push(memoryKey);
          translatedThemeCues.push(
            ...expandThemeGroupTranslation(group, cachedEntry.translatedCanonicalSkeleton)
          );
          continue;
        }

        missingThemeGroups.push(group);
      }

      if (memoryHitKeys.length > 0) {
        try {
          await touchThemeMemoryEntries(scopeKey, memoryHitKeys);
        } catch (error) {
          log(
            'warning',
            'translation',
            'Theme memory touch failed',
            `Theme cache hit counters could not be updated for scope ${scopeKey}.\n\nError: ${String(error)}`,
            logContext
          );
        }
      }

      log(
        'info',
        'translation',
        'Theme memory hits',
        `Resolved ${themeGroups.length - missingThemeGroups.length}/${themeGroups.length} unique theme signature(s) from cache for scope ${scopeKey}.`,
        logContext
      );

      if (signal?.aborted) {
        return buildCancelledResult(file);
      }

      if (missingThemeGroups.length > 0) {
        const themePromptPlan = buildThemePromptPlan(missingThemeGroups);
        const promptIdBySignature = new Map<string, string>();

        for (const [promptId, group] of themePromptPlan.groupByPromptId.entries()) {
          promptIdBySignature.set(group.signature, promptId);
        }

        log(
          'info',
          'translation',
          'Theme preflight LLM dispatch',
          `Sending ${missingThemeGroups.length} unique theme signature(s) to the LLM across up to ${Math.max(1, Math.min(batchCount, missingThemeGroups.length))} batch(es). Scope: ${scopeKey}`,
          logContext
        );

        const themeResult = await translatePromptCueBatches({
          promptCues: themePromptPlan.promptCues,
          provider,
          apiKey,
          model,
          sourceLang,
          targetLang,
          batchCount,
          batchConcurrency,
          signal,
          logContext,
          reportProgress,
          progressStart: 15,
          progressEnd: 30,
          phaseLabel: 'Theme preflight',
          allowPartial: true
        });

        if (themeResult.cancelled) {
          return buildCancelledResult(file);
        }

        addUsage(totalUsage, themeResult.usage);

        const groupsResolvedByLlm = new Set<string>();
        const memoryUpserts = new Map<
          string,
          {
            signature: string;
            sourceLanguage: string;
            targetLanguage: string;
            provider: string;
            model: string;
            translatedCanonicalSkeleton: string;
          }
        >();

        for (const translatedCue of themeResult.cues) {
          const group = themePromptPlan.groupByPromptId.get(translatedCue.id);
          if (!group) {
            continue;
          }

          groupsResolvedByLlm.add(group.signature);
          translatedThemeCues.push(
            ...expandThemeGroupTranslation(group, translatedCue.translatedText)
          );

          const memoryKey = memoryKeyBySignature.get(group.signature);
          if (memoryKey) {
            memoryUpserts.set(memoryKey, {
              signature: group.signature,
              sourceLanguage: sourceLang,
              targetLanguage: targetLang,
              provider,
              model,
              translatedCanonicalSkeleton: translatedCue.translatedText
            });
          }
        }

        if (memoryUpserts.size > 0) {
          try {
            await upsertThemeMemoryEntries(scopeKey, memoryUpserts);
            log(
              'info',
              'translation',
              'Theme memory updated',
              `Stored ${memoryUpserts.size} new theme translation signature(s) for scope ${scopeKey}.`,
              logContext
            );
          } catch (error) {
            log(
              'warning',
              'translation',
              'Theme memory update failed',
              `Theme translations were produced but could not be saved to cache for scope ${scopeKey}.\n\nError: ${String(error)}`,
              logContext
            );
          }
        }

        for (const group of missingThemeGroups) {
          const promptId = promptIdBySignature.get(group.signature);
          const promptFailed = promptId ? themeResult.failedIds.has(promptId) : true;

          if (promptFailed || !groupsResolvedByLlm.has(group.signature)) {
            unresolvedThemeCues.push(...group.occurrences.map(occurrence => occurrence.cue));
          }
        }

        if (themeResult.error) {
          log(
            'warning',
            'translation',
            'Theme preflight failed',
            `Theme preflight did not resolve every unique theme segment for scope ${scopeKey}. Unresolved theme cues will fall back to the main translation phase.\n\nError: ${themeResult.error}`,
            logContext
          );
        }
      } else {
        reportProgress({ progress: 30, currentBatch: 0, totalBatches: 0 });
      }
    } else {
      reportProgress({ progress: 30, currentBatch: 0, totalBatches: 0 });
    }

    if (signal?.aborted) {
      return buildCancelledResult(file);
    }

    if (visualGroups.length > 0) {
      log(
        'info',
        'translation',
        'Visual text preflight started',
        `Processing ${cuePlan.visualCueOccurrences.length} ASS visual text occurrence(s) across ${visualGroups.length} unique signature(s). Plain readable visual text occurrences: ${cuePlan.stats.plainVisualTextCandidateCues}. Scope: ${scopeKey}`,
        logContext
      );

      const visualPromptPlan = buildVisualPromptPlan(visualGroups);
      const visualResult = await translatePromptCueBatches({
        promptCues: visualPromptPlan.promptCues,
        provider,
        apiKey,
        model,
        sourceLang,
        targetLang,
        batchCount,
        batchConcurrency,
        signal,
        logContext,
        reportProgress,
        progressStart: 30,
        progressEnd: 40,
        phaseLabel: 'Visual text preflight',
        allowPartial: true
      });

      if (visualResult.cancelled) {
        return buildCancelledResult(file);
      }

      addUsage(totalUsage, visualResult.usage);

      const resolvedVisualPromptIds = new Set<string>();
      let invalidVisualCueCount = 0;
      let invalidVisualGroupCount = 0;
      for (const translatedCue of visualResult.cues) {
        const group = visualPromptPlan.groupByPromptId.get(translatedCue.id);
        if (!group) {
          continue;
        }

        resolvedVisualPromptIds.add(translatedCue.id);
        const expandedVisualGroup = expandVisualGroupTranslation(group, translatedCue.translatedText);
        invalidVisualCueCount += expandedVisualGroup.fallbackCount;
        if (expandedVisualGroup.unresolvedCues.length > 0) {
          invalidVisualGroupCount += 1;
        }

        translatedVisualCues.push(...expandedVisualGroup.cues);
        unresolvedVisualCues.push(...expandedVisualGroup.unresolvedCues);
      }

      const unresolvedVisualGroups: VisualSignatureGroup[] = [];
      for (const [promptId, group] of visualPromptPlan.groupByPromptId.entries()) {
        if (!resolvedVisualPromptIds.has(promptId)) {
          unresolvedVisualGroups.push(group);
          unresolvedVisualCues.push(...group.occurrences.map(occurrence => occurrence.cue));
        }
      }

      const unresolvedVisualGroupCount = unresolvedVisualGroups.length + invalidVisualGroupCount;
      if (unresolvedVisualGroupCount > 0 || visualResult.error) {
        log(
          'warning',
          'translation',
          'Visual text preflight incomplete',
          `Resolved ${visualGroups.length - unresolvedVisualGroupCount}/${visualGroups.length} ASS visual text signature(s). Unresolved or invalid visual text cues will retry in the main translation phase. Retry visual cues: ${unresolvedVisualCues.length}. Invalid visual cues: ${invalidVisualCueCount}.${visualResult.error ? `\n\nError: ${visualResult.error}` : ''}`,
          logContext
        );
      }
    } else {
      reportProgress({ progress: 40, currentBatch: 0, totalBatches: 0 });
    }

    if (signal?.aborted) {
      return buildCancelledResult(file);
    }

    const mainPhaseCues = [...cuePlan.mainTranslatableCues, ...unresolvedThemeCues, ...unresolvedVisualCues];
    let translatedMainCues: TranslatedCue[] = [];

    log(
      'info',
      'translation',
      'Main translation started',
      `Sending ${mainPhaseCues.length} cue(s) to the main translation phase. Theme cues resolved before main pass: ${translatedThemeCues.length}. Theme fallback cues: ${unresolvedThemeCues.length}. Visual retry cues: ${unresolvedVisualCues.length}. Scope: ${scopeKey}`,
      logContext
    );

    if (mainPhaseCues.length > 0) {
      const mainResult = await translatePromptCueBatches({
        promptCues: buildPromptCuesFromParsedCues(mainPhaseCues),
        provider,
        apiKey,
        model,
        sourceLang,
        targetLang,
        batchCount,
        batchConcurrency,
        signal,
        logContext,
        reportProgress,
        progressStart: 45,
        progressEnd: 85,
        phaseLabel: 'Main translation',
        allowPartial: false
      });

      if (mainResult.cancelled) {
        return buildCancelledResult(file);
      }

      addUsage(totalUsage, mainResult.usage);

      if (mainResult.error) {
        return {
          originalFile: file,
          translatedContent: '',
          success: false,
          error: mainResult.error,
          truncated: mainResult.truncated,
          usage: totalUsage.totalTokens > 0 ? totalUsage : undefined
        };
      }

      translatedMainCues = mainResult.cues;
    } else {
      reportProgress({ progress: 85, currentBatch: 0, totalBatches: 0 });
    }

    const allTranslatedCues: TranslatedCue[] = [
      ...translatedThemeCues,
      ...translatedVisualCues,
      ...translatedMainCues,
      ...cuePlan.passthroughCues
    ];

    if (signal?.aborted) {
      return buildCancelledResult(file);
    }

    const validation = validateTranslation(parsed.cues, allTranslatedCues);
    if (!validation.valid) {
      console.warn('Translation validation errors:', validation.errors);
    }

    reportProgress({ progress: 90, currentBatch: 0, totalBatches: 0 });

    if (signal?.aborted) {
      return buildCancelledResult(file);
    }

    const { content: translatedContent } = reconstructSubtitle(
      parsed,
      allTranslatedCues,
      file.content
    );

    reportProgress({ progress: 100, currentBatch: 0, totalBatches: 0 });

    return {
      originalFile: file,
      translatedContent,
      success: true,
      error: validation.valid ? undefined : `Warning: ${validation.errors.length} validation issue(s) detected`,
      usage: totalUsage.totalTokens > 0 ? totalUsage : undefined
    };
  });
}

// ============================================================================
// MULTI-MODEL PARALLEL TRANSLATION
// ============================================================================

/**
 * Translate a subtitle file with multiple models in parallel.
 * Each model runs its own translateSubtitle() call concurrently.
 * Results are delivered incrementally via callbacks as each model completes.
 *
 * @param file - The subtitle file to translate
 * @param models - Array of provider/model pairs to translate with
 * @param sourceLang - Source language code
 * @param targetLang - Target language code
 * @param batchCount - Number of batches to split the file into
 * @param onModelProgress - Called with progress updates for each model
 * @param onModelComplete - Called when a model finishes successfully
 * @param onModelError - Called when a model fails
 * @param signals - Map of modelJobId to AbortSignal for per-model cancellation
 * @returns Map of modelJobId to TranslationResult for all settled models
 */
export async function translateSubtitleMultiModel(
  file: SubtitleFile,
  models: TranslateSubtitleMultiModelEntry[],
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  options: TranslateSubtitleMultiModelOptions = {}
): Promise<Map<string, TranslationResult>> {
  const results = new Map<string, TranslationResult>();

  const promises = models.map(async (entry) => {
    const signal = options.signalByModelJobId?.get(entry.modelJobId);

    try {
      const result = await translateSubtitle(
        file,
        entry.provider,
        entry.model,
        sourceLang,
        targetLang,
        {
          onProgress: (info: BatchProgressInfo | number) => {
            options.onModelProgress?.(entry.modelJobId, info);
          },
          batchCount: options.batchCount,
          signal,
          runId: options.runId,
          batchConcurrency: options.batchConcurrency,
          logContext: { modelJobId: entry.modelJobId },
        }
      );

      results.set(entry.modelJobId, result);

      if (result.success) {
        await options.onModelComplete?.(entry.modelJobId, result);
      } else {
        const isCancelled = isCancelledError(result.error);
        if (!isCancelled) {
          options.onModelError?.(entry.modelJobId, new Error(result.error || 'Translation failed'));
        }
      }

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const failResult: TranslationResult = {
        originalFile: file,
        translatedContent: '',
        success: false,
        error: err.message,
      };
      results.set(entry.modelJobId, failResult);
      if (!signal?.aborted) {
        options.onModelError?.(entry.modelJobId, err);
      }
      return failResult;
    }
  });

  await Promise.allSettled(promises);
  return results;
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export { detectFormat as detectSubtitleFormat };

export function getSubtitleExtension(format: 'srt' | 'ass' | 'vtt' | 'ssa'): string {
  const extensions: Record<string, string> = {
    srt: '.srt',
    ass: '.ass',
    ssa: '.ssa',
    vtt: '.vtt'
  };
  return extensions[format] || '.txt';
}

export async function validateApiKey(provider: LLMProvider, apiKey: string): Promise<{ valid: boolean; error?: string }> {
  if (!apiKey || apiKey.trim() === '') {
    return { valid: false, error: 'API key is empty' };
  }

  switch (provider) {
    case 'openai':
      if (!apiKey.startsWith('sk-')) {
        return { valid: false, error: 'OpenAI API keys should start with "sk-"' };
      }
      break;
    case 'anthropic':
      if (!apiKey.startsWith('sk-ant-')) {
        return { valid: false, error: 'Anthropic API keys should start with "sk-ant-"' };
      }
      break;
  }

  return { valid: true };
}
