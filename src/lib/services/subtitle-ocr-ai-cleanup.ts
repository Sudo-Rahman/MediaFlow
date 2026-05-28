import { settingsStore } from '$lib/stores';
import { LLM_PROVIDERS } from '$lib/types';
import type { LLMProvider, SubtitleOcrCue } from '$lib/types';
import { callLlm } from './llm-client';
import type { LlmUsage } from './llm-client';
import { withSleepInhibit } from './sleep-inhibit';

const SUBTITLE_OCR_CLEANUP_SYSTEM_PROMPT = `You are an expert subtitle OCR post-editor.
Return JSON only. Do not include markdown, explanations, or commentary.`;

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

function parseCleanupCue(value: unknown): SubtitleOcrCue | null {
  if (!isRecord(value)) return null;

  const {
    id,
    sourceCueIds,
    startTimeMs,
    endTimeMs,
    text,
    confidence,
  } = value;

  if (typeof id !== 'string' || !id.trim()) return null;
  if (!Array.isArray(sourceCueIds) || sourceCueIds.some((sourceCueId) => typeof sourceCueId !== 'string')) {
    return null;
  }
  if (!isFiniteNumber(startTimeMs) || startTimeMs < 0) {
    return null;
  }
  if (typeof text !== 'string' || !text.trim()) return null;
  if (!isFiniteNumber(endTimeMs) || endTimeMs <= startTimeMs) return null;
  if (!isFiniteNumber(confidence) || confidence < 0 || confidence > 1) return null;

  return {
    id,
    sourceCueIds: [...sourceCueIds],
    startTimeMs,
    endTimeMs,
    text,
    confidence,
  };
}

function providerDisplayName(provider: LLMProvider): string {
  return LLM_PROVIDERS[provider]?.name || provider;
}

function buildAllowedSourceCueMap(cues: SubtitleOcrCue[]): Map<string, string> {
  const sourceCueIdToOriginalCueId = new Map<string, string>();

  for (const cue of cues) {
    sourceCueIdToOriginalCueId.set(cue.id, cue.id);
    for (const sourceCueId of cue.sourceCueIds) {
      sourceCueIdToOriginalCueId.set(sourceCueId, cue.id);
    }
  }

  return sourceCueIdToOriginalCueId;
}

function validateCleanedCueSourceMapping(
  originalCues: SubtitleOcrCue[],
  cleanedCues: SubtitleOcrCue[]
): string | null {
  if (originalCues.length > 0 && cleanedCues.length === 0) {
    return 'AI cleanup returned no cues for non-empty input';
  }

  const allowedSourceCueIds = buildAllowedSourceCueMap(originalCues);
  const outputIndexByOriginalCueId = new Map<string, number>();

  for (let outputIndex = 0; outputIndex < cleanedCues.length; outputIndex += 1) {
    const cue = cleanedCues[outputIndex];

    if (cue.sourceCueIds.length === 0) {
      return `AI cleanup cue "${cue.id}" has no source cue IDs`;
    }

    const sourceCueIdsInOutput = new Set<string>();
    const originalCueIdsInOutput = new Set<string>();

    for (const sourceCueId of cue.sourceCueIds) {
      if (sourceCueIdsInOutput.has(sourceCueId)) {
        return `AI cleanup cue "${cue.id}" references source cue ID "${sourceCueId}" more than once`;
      }

      const originalCueId = allowedSourceCueIds.get(sourceCueId);
      if (!originalCueId) {
        return `AI cleanup referenced unknown source cue ID "${sourceCueId}"`;
      }

      sourceCueIdsInOutput.add(sourceCueId);
      originalCueIdsInOutput.add(originalCueId);
    }

    for (const originalCueId of originalCueIdsInOutput) {
      if (outputIndexByOriginalCueId.has(originalCueId)) {
        return `AI cleanup referenced original cue "${originalCueId}" in more than one output cue`;
      }

      outputIndexByOriginalCueId.set(originalCueId, outputIndex);
    }
  }

  return null;
}

export function buildSubtitleOcrCleanupPrompt(cues: SubtitleOcrCue[]): string {
  return `Clean OCR output from bitmap subtitles.

Rules:
- Do not translate.
- Do not invent text.
- Preserve the original language, meaning, speaker dashes, and intentional line breaks.
- Correct OCR mistakes, spelling, punctuation, and grammar.
- You may merge consecutive duplicate cues when they represent the same subtitle.
- When you merge consecutive duplicate cues, combine their sourceCueIds and use the earliest startTimeMs and latest endTimeMs.
- Preserve useful timing and confidence information.

Return JSON only with this exact shape:
{
  "cues": [
    {
      "id": "cue_id",
      "sourceCueIds": ["source_cue_id"],
      "startTimeMs": 0,
      "endTimeMs": 1000,
      "text": "cleaned subtitle text",
      "confidence": 0.95
    }
  ]
}

Input cues:
${JSON.stringify({ cues: cloneCues(cues) }, null, 2)}`;
}

export function parseSubtitleOcrCleanupResponse(content: string): SubtitleOcrAiCleanupResult {
  const parsed = extractJsonObject(content);
  if (!isRecord(parsed) || !Array.isArray(parsed.cues)) {
    return {
      success: false,
      cues: [],
      error: 'Invalid AI cleanup response',
    };
  }

  const cues: SubtitleOcrCue[] = [];
  for (const cue of parsed.cues) {
    const parsedCue = parseCleanupCue(cue);
    if (!parsedCue) {
      return {
        success: false,
        cues: [],
        error: 'Invalid AI cleanup response',
      };
    }

    cues.push(parsedCue);
  }

  return {
    success: true,
    cues: cloneCues(cues),
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

      const sourceMappingError = validateCleanedCueSourceMapping(originalCues, parsed.cues);
      if (sourceMappingError) {
        return failureResult(originalCues, sourceMappingError, {
          usage: response.usage,
        });
      }

      return {
        success: true,
        cues: cloneCues(parsed.cues),
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
