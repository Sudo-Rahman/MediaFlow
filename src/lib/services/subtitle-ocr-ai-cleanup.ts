import { settingsStore } from '$lib/stores';
import { LLM_PROVIDERS } from '$lib/types';
import type { LLMProvider, SubtitleOcrCue } from '$lib/types';
import {
  runAiCueRetries,
  type AiCueRetryContextCue,
  type AiCueRetryRequest,
  type AiCueRetryAttemptResult,
  type AiCueRetryCue,
  type AiCueReplacement,
} from './ai-cue-retry';
import { callLlm } from './llm-client';
import type { LlmUsage } from './llm-client';
import { withSleepInhibit } from './sleep-inhibit';

const SUBTITLE_OCR_CLEANUP_SYSTEM_PROMPT = `You are an expert subtitle OCR post-editor.
Return JSON only. Do not include markdown, explanations, or commentary.`;

const LOCAL_DUPLICATE_MERGE_MAX_GAP_MS = 250;

export interface SubtitleOcrAiCleanupOptions {
  provider: LLMProvider;
  model: string;
  signal?: AbortSignal;
}

export interface SubtitleOcrAiCleanupResult {
  success: boolean;
  cues: SubtitleOcrCue[];
  error?: string;
  cancelled?: boolean;
  usage?: LlmUsage;
}

interface SubtitleOcrCleanupPromptCue {
  id: string;
  text: string;
}

interface SubtitleOcrRetryPromptCue extends AiCueRetryCue {
  originalIndex: number;
}

interface SubtitleOcrCleanupCorrection extends AiCueReplacement {
  id: string;
  correctedText: string;
}

interface SubtitleOcrRetryContextCue extends AiCueRetryContextCue {
  correctedText?: string;
}

interface SubtitleOcrCleanupParseResult {
  success: boolean;
  corrections: SubtitleOcrCleanupCorrection[];
  error?: string;
}

interface SubtitleOcrCollectCorrectionsResult {
  corrections: SubtitleOcrCleanupCorrection[];
  unresolvedIds: Set<string>;
  warnings: string[];
}

function cloneCue(cue: SubtitleOcrCue): SubtitleOcrCue {
  return {
    ...cue,
    sourceCueIds: [...cue.sourceCueIds],
  };
}

function cloneCues(cues: SubtitleOcrCue[]): SubtitleOcrCue[] {
  return cues.map(cloneCue);
}

function failureResult(
  cues: SubtitleOcrCue[],
  error: string,
  options: Pick<SubtitleOcrAiCleanupResult, 'cancelled' | 'usage'> = {}
): SubtitleOcrAiCleanupResult {
  return {
    success: false,
    cues: cloneCues(cues),
    error,
    ...options,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractJsonObject(content: string): unknown | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const startIndex = trimmed.indexOf('{');
    const endIndex = trimmed.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(startIndex, endIndex + 1));
    } catch {
      return null;
    }
  }
}

function providerDisplayName(provider: LLMProvider): string {
  return LLM_PROVIDERS[provider]?.name || provider;
}

function buildPromptCues(cues: SubtitleOcrCue[]): SubtitleOcrCleanupPromptCue[] {
  return buildRetryPromptCues(cues).map((cue) => ({
    id: cue.id,
    text: cue.text,
  }));
}

function buildRetryPromptCues(cues: SubtitleOcrCue[]): SubtitleOcrRetryPromptCue[] {
  return cues.map((cue, index) => ({
    id: String(index),
    text: cue.text,
    originalIndex: index,
  }));
}

function toCleanupPromptCue(cue: AiCueRetryCue): SubtitleOcrCleanupPromptCue {
  return {
    id: cue.id,
    text: cue.text,
  };
}

function parseCleanupCorrection(value: unknown): SubtitleOcrCleanupCorrection | null {
  if (!isRecord(value)) return null;

  const { id, correctedText } = value;
  if (typeof id !== 'string' || !id.trim()) return null;
  if (typeof correctedText !== 'string') return null;

  return {
    id,
    correctedText,
  };
}

export function parseSubtitleOcrCleanupResponse(content: string): SubtitleOcrCleanupParseResult {
  const parsed = extractJsonObject(content);
  if (!isRecord(parsed) || !Array.isArray(parsed.cues)) {
    return {
      success: false,
      corrections: [],
      error: 'Invalid AI cleanup response',
    };
  }

  const corrections: SubtitleOcrCleanupCorrection[] = [];
  for (const cue of parsed.cues) {
    const correction = parseCleanupCorrection(cue);
    if (!correction) {
      return {
        success: false,
        corrections: [],
        error: 'Invalid AI cleanup response',
      };
    }

    corrections.push(correction);
  }

  return {
    success: true,
    corrections,
  };
}

export function buildSubtitleOcrCleanupPrompt(cues: SubtitleOcrCue[]): string {
  return `Clean OCR output from bitmap subtitles.

Rules:
- Do not translate.
- Do not invent text.
- Preserve the original language, meaning, speaker dashes, and intentional line breaks.
- Correct OCR mistakes, spelling, punctuation, and grammar.
- Do not merge, split, or reorder cues.
- Return exactly one corrected cue for every input cue.
- Keep exactly the same short cue IDs as input.
- If a cue is clearly OCR noise and not part of the subtitle text, set correctedText to an empty string.

Return JSON only with this exact shape:
{
  "cues": [
    { "id": "0", "correctedText": "cleaned subtitle text" }
  ]
}

Input cues:
${JSON.stringify({ cues: buildPromptCues(cues) })}`;
}

function buildSubtitleOcrCleanupRetryPrompt(
  requestedCues: readonly SubtitleOcrRetryPromptCue[],
  contextCues: readonly SubtitleOcrRetryContextCue[],
  attempt: number
): string {
  return `Retry OCR cleanup for unresolved bitmap subtitle cues (attempt ${attempt}).

Return JSON only. Correct only the cues listed in "cues". Use "contextCues" only for continuity. Do not return, modify, or include contextCues in the response.

Return JSON only with this exact shape:
{
  "cues": [
    { "id": "0", "correctedText": "cleaned subtitle text" }
  ]
}

${JSON.stringify({
  cues: requestedCues.map(toCleanupPromptCue),
  contextCues,
})}`;
}

function addUsage(current: LlmUsage | undefined, next: LlmUsage | undefined): LlmUsage | undefined {
  if (!next) {
    return current;
  }

  if (!current) {
    return { ...next };
  }

  return {
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
    totalTokens: current.totalTokens + next.totalTokens,
  };
}

function warningMessage(warnings: readonly string[]): string | undefined {
  return warnings.length > 0 ? warnings.join(' ') : undefined;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeForMerge(text: string): string {
  return collapseWhitespace(text)
    .replace(/^[\s.,!?;:'"()[\]{}-]+|[\s.,!?;:'"()[\]{}-]+$/g, '')
    .toLowerCase();
}

interface PlacementMergeState {
  placedWeight: number;
  topWeight: number;
}

function createPlacementMergeState(cue: SubtitleOcrCue): PlacementMergeState {
  const state: PlacementMergeState = {
    placedWeight: 0,
    topWeight: 0,
  };
  addCuePlacementToMergeState(state, cue);
  return state;
}

function hasPlacementSourceCounts(cue: SubtitleOcrCue): boolean {
  return Number.isInteger(cue.placementSourceCount)
    && Number.isInteger(cue.topPlacementSourceCount)
    && (cue.placementSourceCount ?? -1) > 0
    && (cue.topPlacementSourceCount ?? -1) >= 0
    && (cue.topPlacementSourceCount ?? 0) <= (cue.placementSourceCount ?? 0);
}

function addCuePlacementToMergeState(state: PlacementMergeState, cue: SubtitleOcrCue): void {
  if (hasPlacementSourceCounts(cue)) {
    state.placedWeight += cue.placementSourceCount ?? 0;
    state.topWeight += cue.topPlacementSourceCount ?? 0;
    return;
  }

  const weight = Math.max(1, cue.sourceCueIds.length);
  if (cue.placement === 'top') {
    state.placedWeight += weight;
    state.topWeight += weight;
  } else if (cue.placement === 'bottom') {
    state.placedWeight += weight;
  }
}

function resolvePlacementMergeState(state: PlacementMergeState): SubtitleOcrCue['placement'] {
  if (state.placedWeight === 0) {
    return undefined;
  }

  return state.topWeight > state.placedWeight / 2 ? 'top' : 'bottom';
}

function applyPlacementMergeState(cue: SubtitleOcrCue, state: PlacementMergeState): void {
  cue.placement = resolvePlacementMergeState(state);
  if (state.placedWeight === 0) {
    delete cue.placementSourceCount;
    delete cue.topPlacementSourceCount;
    return;
  }

  cue.placementSourceCount = state.placedWeight;
  cue.topPlacementSourceCount = state.topWeight;
}

function mergeConsecutiveDuplicateCues(cues: SubtitleOcrCue[]): SubtitleOcrCue[] {
  const merged: SubtitleOcrCue[] = [];
  const placementStates: PlacementMergeState[] = [];

  for (const cue of cues) {
    if (!cue.text.trim()) {
      continue;
    }

    const previous = merged.at(-1);
    const currentNormalized = normalizeForMerge(cue.text);
    const previousNormalized = previous ? normalizeForMerge(previous.text) : '';
    const isAdjacent = previous
      ? cue.startTimeMs <= previous.endTimeMs + LOCAL_DUPLICATE_MERGE_MAX_GAP_MS
      : false;

    if (previous && currentNormalized && previousNormalized === currentNormalized && isAdjacent) {
      const placementState = placementStates.at(-1);
      if (!placementState) {
        merged.push(cloneCue(cue));
        placementStates.push(createPlacementMergeState(cue));
        continue;
      }

      addCuePlacementToMergeState(placementState, cue);
      applyPlacementMergeState(previous, placementState);
      previous.endTimeMs = Math.max(previous.endTimeMs, cue.endTimeMs);
      previous.sourceCueIds.push(...cue.sourceCueIds);
      if (
        cue.confidence > previous.confidence + 1e-9
        || (Math.abs(cue.confidence - previous.confidence) <= 1e-9 && cue.text.length > previous.text.length)
      ) {
        previous.text = cue.text;
      }
      previous.confidence = Math.max(previous.confidence, cue.confidence);
      continue;
    }

    merged.push(cloneCue(cue));
    placementStates.push(createPlacementMergeState(cue));
  }

  return merged;
}

function collectValidCleanupCorrections(
  requestedCues: readonly SubtitleOcrRetryPromptCue[],
  corrections: readonly SubtitleOcrCleanupCorrection[]
): SubtitleOcrCollectCorrectionsResult {
  const requestedIds = new Set(requestedCues.map((cue) => cue.id));
  const duplicateIds = new Set<string>();
  const correctionById = new Map<string, SubtitleOcrCleanupCorrection>();
  const warnings: string[] = [];

  for (const correction of corrections) {
    if (!requestedIds.has(correction.id)) {
      warnings.push(`AI cleanup returned unknown cue ID "${correction.id}".`);
      continue;
    }

    if (correctionById.has(correction.id)) {
      correctionById.delete(correction.id);
      duplicateIds.add(correction.id);
      warnings.push(`AI cleanup returned duplicate cue ID "${correction.id}".`);
      continue;
    }

    if (!duplicateIds.has(correction.id)) {
      correctionById.set(correction.id, correction);
    }
  }

  const acceptedCorrections: SubtitleOcrCleanupCorrection[] = [];
  const unresolvedIds = new Set<string>();

  for (const cue of requestedCues) {
    const correction = correctionById.get(cue.id);
    if (correction) {
      acceptedCorrections.push(correction);
    } else {
      unresolvedIds.add(cue.id);
    }
  }

  return {
    corrections: acceptedCorrections,
    unresolvedIds,
    warnings,
  };
}

function assembleCorrectedCues(
  originalCues: readonly SubtitleOcrCue[],
  promptCues: readonly SubtitleOcrRetryPromptCue[],
  corrections: readonly SubtitleOcrCleanupCorrection[]
): SubtitleOcrCue[] {
  const correctedById = new Map(corrections.map((correction) => [correction.id, correction.correctedText]));
  const assembled: SubtitleOcrCue[] = [];

  for (const promptCue of promptCues) {
    const originalCue = originalCues[promptCue.originalIndex];
    const correctedText = correctedById.get(promptCue.id);
    if (correctedText === '') {
      continue;
    }

    assembled.push({
      ...cloneCue(originalCue),
      text: correctedText === undefined ? originalCue.text : correctedText.trim(),
    });
  }

  return mergeConsecutiveDuplicateCues(assembled);
}

export async function cleanupSubtitleOcrCuesWithAi(
  cues: SubtitleOcrCue[],
  options: SubtitleOcrAiCleanupOptions
): Promise<SubtitleOcrAiCleanupResult> {
  const originalCues = cloneCues(cues);

  if (originalCues.length === 0) {
    return {
      success: true,
      cues: [],
    };
  }

  if (options.signal?.aborted) {
    return failureResult(originalCues, 'AI cleanup cancelled', { cancelled: true });
  }

  if (!settingsStore.isLoaded) {
    await settingsStore.load();
  }

  const apiKey = settingsStore.getLLMApiKey(options.provider);
  if (options.provider !== 'mediaflow' && !apiKey.trim()) {
    return failureResult(originalCues, `No API key configured for ${providerDisplayName(options.provider)}`);
  }

  if (!options.model.trim()) {
    return failureResult(originalCues, 'No AI model selected for subtitle OCR cleanup');
  }

  if (options.signal?.aborted) {
    return failureResult(originalCues, 'AI cleanup cancelled', { cancelled: true });
  }

  try {
    return await withSleepInhibit('MediaFlow: Subtitle OCR cleanup', async () => {
      const promptCues = buildRetryPromptCues(originalCues);
      const response = await callLlm({
        provider: options.provider,
        apiKey,
        model: options.model,
        systemPrompt: SUBTITLE_OCR_CLEANUP_SYSTEM_PROMPT,
        userPrompt: buildSubtitleOcrCleanupPrompt(originalCues),
        temperature: 0.2,
        responseMode: 'json',
        signal: options.signal,
        logSource: 'system',
      });

      if (options.signal?.aborted || response.cancelled || response.error === 'Request cancelled') {
        return failureResult(originalCues, 'AI cleanup cancelled', {
          cancelled: true,
          usage: response.usage,
        });
      }

      const warnings: string[] = [];
      let totalUsage = addUsage(undefined, response.usage);
      let collected: SubtitleOcrCollectCorrectionsResult;

      if (response.error) {
        warnings.push(`AI cleanup failed: ${response.error}`);
        collected = {
          corrections: [],
          unresolvedIds: new Set(promptCues.map((cue) => cue.id)),
          warnings: [],
        };
      } else if (response.truncated) {
        warnings.push('AI cleanup response was truncated');
        collected = {
          corrections: [],
          unresolvedIds: new Set(promptCues.map((cue) => cue.id)),
          warnings: [],
        };
      } else {
        const parsed = parseSubtitleOcrCleanupResponse(response.content);
        if (parsed.success) {
          collected = collectValidCleanupCorrections(promptCues, parsed.corrections);
          warnings.push(...collected.warnings);
        } else {
          warnings.push(parsed.error ?? 'Invalid AI cleanup response');
          collected = {
            corrections: [],
            unresolvedIds: new Set(promptCues.map((cue) => cue.id)),
            warnings: [],
          };
        }
      }

      const retryResult = await runAiCueRetries<
        SubtitleOcrRetryPromptCue,
        SubtitleOcrCleanupCorrection,
        SubtitleOcrRetryContextCue
      >({
        allCues: promptCues,
        initialReplacements: collected.corrections,
        initialUnresolvedIds: collected.unresolvedIds,
        buildContextCue: ({ cue, acceptedReplacement, position, spanIndex }) => ({
          id: cue.id,
          text: cue.text,
          correctedText: acceptedReplacement?.correctedText,
          position,
          spanIndex,
        }),
        runAttempt: async (
          request: AiCueRetryRequest<SubtitleOcrRetryPromptCue, SubtitleOcrRetryContextCue>
        ): Promise<AiCueRetryAttemptResult<SubtitleOcrCleanupCorrection>> => {
          const unresolvedIds = new Set(request.requestedCues.map((cue) => cue.id));
          if (options.signal?.aborted) {
            return {
              replacements: [],
              unresolvedIds,
              cancelled: true,
            };
          }

          const retryResponse = await callLlm({
            provider: options.provider,
            apiKey,
            model: options.model,
            systemPrompt: SUBTITLE_OCR_CLEANUP_SYSTEM_PROMPT,
            userPrompt: buildSubtitleOcrCleanupRetryPrompt(
              request.requestedCues,
              request.contextCues,
              request.attempt,
            ),
            temperature: 0.2,
            responseMode: 'json',
            signal: options.signal,
            logSource: 'system',
          });

          if (options.signal?.aborted || retryResponse.cancelled || retryResponse.error === 'Request cancelled') {
            return {
              replacements: [],
              unresolvedIds,
              usage: retryResponse.usage,
              cancelled: true,
            };
          }

          if (retryResponse.error) {
            return {
              replacements: [],
              unresolvedIds,
              usage: retryResponse.usage,
              warning: `Retry attempt ${request.attempt} failed: ${retryResponse.error}`,
            };
          }

          if (retryResponse.truncated) {
            return {
              replacements: [],
              unresolvedIds,
              usage: retryResponse.usage,
              warning: `Retry attempt ${request.attempt}: response truncated`,
            };
          }

          const retryParsed = parseSubtitleOcrCleanupResponse(retryResponse.content);
          if (!retryParsed.success) {
            return {
              replacements: [],
              unresolvedIds,
              usage: retryResponse.usage,
              warning: `Retry attempt ${request.attempt}: ${retryParsed.error ?? 'Invalid AI cleanup response'}`,
            };
          }

          const retryCollected = collectValidCleanupCorrections(request.requestedCues, retryParsed.corrections);
          return {
            replacements: retryCollected.corrections,
            unresolvedIds: retryCollected.unresolvedIds,
            usage: retryResponse.usage,
            warning: warningMessage(retryCollected.warnings),
          };
        },
      });

      totalUsage = addUsage(totalUsage, retryResult.usage);

      if (retryResult.cancelled || options.signal?.aborted) {
        return failureResult(originalCues, 'AI cleanup cancelled', {
          cancelled: true,
          usage: totalUsage,
        });
      }

      warnings.push(...retryResult.warnings);

      if (retryResult.replacements.length === 0) {
        return failureResult(
          originalCues,
          warningMessage(warnings) ?? 'AI cleanup produced no valid corrected cues',
          { usage: totalUsage },
        );
      }

      const cleanedCues = assembleCorrectedCues(originalCues, promptCues, retryResult.replacements);

      return {
        success: true,
        cues: cloneCues(cleanedCues),
        error: warningMessage(warnings),
        usage: totalUsage,
      };
    });
  } catch (error) {
    if (options.signal?.aborted) {
      return failureResult(originalCues, 'AI cleanup cancelled', { cancelled: true });
    }

    const message = error instanceof Error ? error.message : String(error);
    return failureResult(originalCues, `AI cleanup failed: ${message}`);
  }
}
