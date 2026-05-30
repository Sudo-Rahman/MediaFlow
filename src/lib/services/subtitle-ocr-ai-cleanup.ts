import { settingsStore } from '$lib/stores';
import { LLM_PROVIDERS } from '$lib/types';
import type { LLMProvider, SubtitleOcrCue } from '$lib/types';
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

interface SubtitleOcrCleanupCorrection {
  id: string;
  correctedText: string;
}

interface SubtitleOcrCleanupParseResult {
  success: boolean;
  corrections: SubtitleOcrCleanupCorrection[];
  error?: string;
}

interface SubtitleOcrCleanupApplyResult {
  success: boolean;
  cues: SubtitleOcrCue[];
  error?: string;
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
  return cues.map((cue, index) => ({
    id: String(index),
    text: cue.text,
  }));
}

function buildCueMap(cues: SubtitleOcrCue[]): Map<string, SubtitleOcrCue> {
  return new Map(cues.map((cue, index) => [String(index), cue]));
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

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeForMerge(text: string): string {
  return collapseWhitespace(text)
    .replace(/^[\s.,!?;:'"()[\]{}-]+|[\s.,!?;:'"()[\]{}-]+$/g, '')
    .toLowerCase();
}

function mergeConsecutiveDuplicateCues(cues: SubtitleOcrCue[]): SubtitleOcrCue[] {
  const merged: SubtitleOcrCue[] = [];

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
  }

  return merged;
}

function applyCleanupCorrections(
  originalCues: SubtitleOcrCue[],
  corrections: SubtitleOcrCleanupCorrection[]
): SubtitleOcrCleanupApplyResult {
  const cueMap = buildCueMap(originalCues);
  const correctionById = new Map<string, string>();

  for (const correction of corrections) {
    if (!cueMap.has(correction.id)) {
      return {
        success: false,
        cues: [],
        error: `AI cleanup returned unknown cue ID "${correction.id}"`,
      };
    }

    if (correctionById.has(correction.id)) {
      return {
        success: false,
        cues: [],
        error: `AI cleanup returned duplicate cue ID "${correction.id}"`,
      };
    }

    correctionById.set(correction.id, correction.correctedText);
  }

  const missingIds = [...cueMap.keys()].filter((id) => !correctionById.has(id));
  if (missingIds.length > 0) {
    return {
      success: false,
      cues: [],
      error: `AI cleanup response is missing corrected cues: ${missingIds.slice(0, 5).join(', ')}`,
    };
  }

  const correctedCues = originalCues.map((cue, index) => ({
    ...cloneCue(cue),
    text: correctionById.get(String(index))?.trim() ?? cue.text,
  }));

  const cleanedCues = mergeConsecutiveDuplicateCues(correctedCues);
  if (originalCues.length > 0 && cleanedCues.length === 0) {
    return {
      success: false,
      cues: [],
      error: 'AI cleanup returned no cues for non-empty input',
    };
  }

  return {
    success: true,
    cues: cleanedCues,
  };
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

      if (response.error) {
        return failureResult(originalCues, `AI cleanup failed: ${response.error}`, {
          usage: response.usage,
        });
      }

      if (response.truncated) {
        return failureResult(originalCues, 'AI cleanup response was truncated', {
          usage: response.usage,
        });
      }

      const parsed = parseSubtitleOcrCleanupResponse(response.content);
      if (!parsed.success) {
        return failureResult(originalCues, parsed.error ?? 'Invalid AI cleanup response', {
          usage: response.usage,
        });
      }

      const applied = applyCleanupCorrections(originalCues, parsed.corrections);
      if (!applied.success) {
        return failureResult(originalCues, applied.error ?? 'Invalid AI cleanup response', {
          usage: response.usage,
        });
      }

      return {
        success: true,
        cues: cloneCues(applied.cues),
        usage: response.usage,
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
