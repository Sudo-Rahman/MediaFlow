import { settingsStore } from '$lib/stores';
import { LLM_PROVIDERS } from '$lib/types';
import type { LLMProvider, OcrSubtitle } from '$lib/types';
import { normalizeOcrSubtitles } from '$lib/utils/ocr-subtitle-adapter';
import {
  runAiCueRetries,
  type AiCueRetryContextCue,
  type AiCueRetryRequest,
  type AiCueRetryAttemptResult,
  type AiCueReplacement,
} from './ai-cue-retry';
import { callLlm } from './llm-client';
import type { LlmUsage } from './llm-client';
import { withSleepInhibit } from './sleep-inhibit';

const DEFAULT_BATCH_SIZE = 1000;

const OCR_CLEANUP_SYSTEM_PROMPT = `You are an expert subtitle post-editor specializing in OCR correction.

CRITICAL RULES:
1. Return ONLY valid JSON.
2. Keep EXACTLY the same cue IDs as input.
3. Do NOT add, merge, split, or reorder cue IDs in the JSON array.
4. Correct OCR mistakes only (spacing, missing letters, misread characters, punctuation).
5. REMOVE NOISE: If a cue is clearly an OCR artifact, random disconnected letters, symbols, or watermarks (e.g., "M", "a", "品 JLE", "4") and NOT part of actual dialogue, set its "correctedText" to an empty string "".
6. Preserve the original language.
7. Keep each cue concise and natural as a subtitle.
8. Do not output explanations.

OUTPUT FORMAT:
{
  "cues": [
    { "id": "cue_id", "correctedText": "corrected subtitle text" }
  ]
}`;

interface OcrCleanupCue {
  id: string;
  text: string;
}

interface OcrCleanupParsedResponse {
  cues: Array<{
    id: string;
    correctedText: string;
  }>;
}

interface OcrCleanupCorrection extends AiCueReplacement {
  id: string;
  correctedText: string;
}

type OcrCleanupRetryContextCue = AiCueRetryContextCue;

interface CollectCorrectionsResult {
  corrections: OcrCleanupCorrection[];
  unresolvedIds: Set<string>;
}

export interface OcrAiCleanupOptions {
  provider: LLMProvider;
  model: string;
  maxGapMs: number;
  batchSize?: number;
  signal?: AbortSignal;
}

export interface OcrAiCleanupResult {
  success: boolean;
  subtitles: OcrSubtitle[];
  error?: string;
  cancelled?: boolean;
  batchesProcessed: number;
  totalBatches: number;
  usage?: LlmUsage;
}

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  if (batchSize <= 0 || items.length === 0) return [items];

  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  return batches;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeForMerge(text: string): string {
  return collapseWhitespace(text)
    .replace(/^[\s.,!?;:'"()\[\]{}-]+|[\s.,!?;:'"()\[\]{}-]+$/g, '')
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  return null;
}

function parseCleanupResponse(responseText: string): OcrCleanupParsedResponse | null {
  if (!responseText || !responseText.trim()) {
    return null;
  }

  const raw = responseText.trim();
  const startIndex = raw.indexOf('{');
  const endIndex = raw.lastIndexOf('}');

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  const jsonChunk = raw.slice(startIndex, endIndex + 1);

  try {
    const parsed: unknown = JSON.parse(jsonChunk);
    if (!isRecord(parsed) || !Array.isArray(parsed.cues)) {
      return null;
    }

    const cues: OcrCleanupParsedResponse['cues'] = [];
    let malformedCueCount = 0;
    for (const cue of parsed.cues) {
      if (!isRecord(cue)) {
        malformedCueCount += 1;
        continue;
      }

      const id = stringField(cue, ['id', 'ID']);
      const correctedText = stringField(cue, ['correctedText', 'corrected_text', 'text']);
      if (!id?.trim() || correctedText === null) {
        malformedCueCount += 1;
        continue;
      }

      cues.push({
        id: id.trim(),
        correctedText: correctedText.trim(),
      });
    }

    if (cues.length === 0 && malformedCueCount > 0) {
      return null;
    }

    return { cues };
  } catch {
    return null;
  }
}

function buildUserPrompt(batch: OcrCleanupCue[], batchIndex: number, totalBatches: number): string {
  return `Correct OCR errors for this subtitle batch (${batchIndex + 1}/${totalBatches}).\n\n${JSON.stringify({ cues: batch }, null, 2)}`;
}

function buildRetryUserPrompt(
  request: AiCueRetryRequest<OcrCleanupCue, OcrCleanupRetryContextCue>
): string {
  return `Retry OCR cleanup for unresolved subtitles (attempt ${request.attempt}).

Return JSON only. Correct only the cues listed in "cues". Use "contextCues" only as surrounding context and do not return corrections for context-only cues.

${JSON.stringify({
  cues: request.requestedCues,
  contextCues: request.contextCues,
}, null, 2)}`;
}

function addUsage(current: LlmUsage, next: LlmUsage | undefined): LlmUsage {
  if (!next) {
    return current;
  }

  return {
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
    totalTokens: current.totalTokens + next.totalTokens,
  };
}

function collectValidCorrections(
  requestedCues: readonly OcrCleanupCue[],
  parsed: OcrCleanupParsedResponse
): CollectCorrectionsResult {
  const requestedIds = new Set(requestedCues.map((cue) => cue.id));
  const duplicateIds = new Set<string>();
  const correctionById = new Map<string, OcrCleanupCorrection>();

  for (const cue of parsed.cues) {
    if (!requestedIds.has(cue.id)) {
      continue;
    }

    if (correctionById.has(cue.id)) {
      correctionById.delete(cue.id);
      duplicateIds.add(cue.id);
      continue;
    }

    if (!duplicateIds.has(cue.id)) {
      correctionById.set(cue.id, {
        id: cue.id,
        correctedText: cue.correctedText,
      });
    }
  }

  const corrections: OcrCleanupCorrection[] = [];
  const unresolvedIds = new Set<string>();

  for (const cue of requestedCues) {
    const correction = correctionById.get(cue.id);
    if (correction) {
      corrections.push(correction);
    } else {
      unresolvedIds.add(cue.id);
    }
  }

  return {
    corrections,
    unresolvedIds,
  };
}

function assembleCorrectedSubtitles(
  originals: readonly OcrSubtitle[],
  corrections: readonly OcrCleanupCorrection[]
): OcrSubtitle[] {
  const correctedById = new Map(corrections.map((cue) => [cue.id, cue.correctedText]));
  const assembled: OcrSubtitle[] = [];

  for (const cue of originals) {
    const correctedText = correctedById.get(cue.id);
    if (correctedText === '') {
      continue;
    }

    assembled.push({
      ...cue,
      text: correctedText === undefined ? cue.text : collapseWhitespace(correctedText),
    });
  }

  return assembled;
}

function warningMessage(warnings: readonly string[]): string | undefined {
  return warnings.length > 0 ? warnings.join(' ') : undefined;
}

function mergeConsecutiveDuplicates(subtitles: OcrSubtitle[], maxGapMs: number): OcrSubtitle[] {
  if (subtitles.length <= 1) {
    return subtitles.map((cue, index) => ({ ...cue, id: `sub-${index + 1}` }));
  }

  const merged: OcrSubtitle[] = [];

  for (const cue of subtitles) {
    const currentNormalized = normalizeForMerge(cue.text);
    const previous = merged.at(-1);

    if (previous) {
      const previousNormalized = normalizeForMerge(previous.text);
      const gap = Math.max(0, cue.startTime - previous.endTime);

      if (currentNormalized && previousNormalized === currentNormalized && gap <= maxGapMs) {
        previous.endTime = Math.max(previous.endTime, cue.endTime);
        if (
          cue.confidence > previous.confidence + 1e-9
          || ((cue.confidence - previous.confidence) <= 1e-9 && cue.text.length > previous.text.length)
        ) {
          previous.text = cue.text;
        }
        previous.confidence = Math.max(previous.confidence, cue.confidence);
        continue;
      }
    }

    merged.push({ ...cue });
  }

  return merged.map((cue, index) => ({
    ...cue,
    id: `sub-${index + 1}`,
  }));
}

export async function cleanupOcrSubtitlesWithAi(
  subtitles: OcrSubtitle[],
  options: OcrAiCleanupOptions
): Promise<OcrAiCleanupResult> {
  const normalizedInput = normalizeOcrSubtitles(subtitles);

  if (subtitles.length > 0 && normalizedInput.length !== subtitles.length) {
    return {
      success: false,
      subtitles,
      error: 'Invalid subtitle timing data',
      batchesProcessed: 0,
      totalBatches: 0,
    };
  }

  if (normalizedInput.length === 0) {
    return {
      success: true,
      subtitles: [],
      batchesProcessed: 0,
      totalBatches: 0,
    };
  }

  if (!settingsStore.isLoaded) {
    await settingsStore.load();
  }

  const apiKey = settingsStore.getLLMApiKey(options.provider);
  if (!apiKey.trim()) {
    const providerName = LLM_PROVIDERS[options.provider]?.name || options.provider;
    return {
      success: false,
      subtitles,
      error: `No API key configured for ${providerName}`,
      batchesProcessed: 0,
      totalBatches: 0,
    };
  }

  if (!options.model.trim()) {
    return {
      success: false,
      subtitles,
      error: 'No AI model selected for OCR cleanup',
      batchesProcessed: 0,
      totalBatches: 0,
    };
  }

  if (options.signal?.aborted) {
    return {
      success: false,
      cancelled: true,
      subtitles,
      error: 'Cleanup cancelled',
      batchesProcessed: 0,
      totalBatches: 0,
    };
  }

  return withSleepInhibit('MediaFlow: OCR cleanup', async () => {
    const batchSize = Math.max(20, options.batchSize ?? DEFAULT_BATCH_SIZE);
    const batches = splitIntoBatches(normalizedInput, batchSize);

    const allPromptCues = normalizedInput.map((cue) => ({
      id: cue.id,
      text: cue.text,
    }));
    const corrections: OcrCleanupCorrection[] = [];
    const unresolvedIds = new Set<string>();
    const warnings: string[] = [];
    let processed = 0;
    let totalUsage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      if (options.signal?.aborted) {
        return {
          success: false,
          cancelled: true,
          subtitles,
          error: 'Cleanup cancelled',
          batchesProcessed: processed,
          totalBatches: batches.length,
        };
      }

      const batch = batches[batchIndex];
      const promptBatch: OcrCleanupCue[] = batch.map((cue) => ({
        id: cue.id,
        text: cue.text,
      }));

      const response = await callLlm({
        provider: options.provider,
        apiKey,
        model: options.model,
        systemPrompt: OCR_CLEANUP_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(promptBatch, batchIndex, batches.length),
        temperature: 0.2,
        responseMode: 'json',
        signal: options.signal,
      });

      totalUsage = addUsage(totalUsage, response.usage);

      if (options.signal?.aborted || response.error === 'Request cancelled') {
        return {
          success: false,
          cancelled: true,
          subtitles,
          error: 'Cleanup cancelled',
          batchesProcessed: processed,
          totalBatches: batches.length,
        };
      }

      if (response.error) {
        warnings.push(`Batch ${batchIndex + 1}/${batches.length} failed: ${response.error}`);
        for (const cue of batch) unresolvedIds.add(cue.id);
        processed += 1;
        continue;
      }

      if (response.truncated) {
        warnings.push(`Batch ${batchIndex + 1}/${batches.length}: response truncated`);
        for (const cue of batch) unresolvedIds.add(cue.id);
        processed += 1;
        continue;
      }

      const parsed = parseCleanupResponse(response.content);
      if (!parsed) {
        warnings.push(`Batch ${batchIndex + 1}/${batches.length}: invalid JSON response`);
        for (const cue of batch) unresolvedIds.add(cue.id);
        processed += 1;
        continue;
      }

      const collected = collectValidCorrections(promptBatch, parsed);
      corrections.push(...collected.corrections);
      for (const id of collected.unresolvedIds) unresolvedIds.add(id);
      processed += 1;
    }

    const retryResult = await runAiCueRetries<
      OcrCleanupCue,
      OcrCleanupCorrection,
      OcrCleanupRetryContextCue
    >({
      allCues: allPromptCues,
      initialReplacements: corrections,
      initialUnresolvedIds: unresolvedIds,
      buildContextCue: ({ cue, position, spanIndex }) => ({
        id: cue.id,
        text: cue.text,
        position,
        spanIndex,
      }),
      runAttempt: async (request): Promise<AiCueRetryAttemptResult<OcrCleanupCorrection>> => {
        if (options.signal?.aborted) {
          return {
            replacements: [],
            unresolvedIds: new Set(request.requestedCues.map((cue) => cue.id)),
            cancelled: true,
          };
        }

        const response = await callLlm({
          provider: options.provider,
          apiKey,
          model: options.model,
          systemPrompt: OCR_CLEANUP_SYSTEM_PROMPT,
          userPrompt: buildRetryUserPrompt(request),
          temperature: 0.2,
          responseMode: 'json',
          signal: options.signal,
        });

        if (options.signal?.aborted || response.error === 'Request cancelled') {
          return {
            replacements: [],
            unresolvedIds: new Set(request.requestedCues.map((cue) => cue.id)),
            usage: response.usage,
            cancelled: true,
          };
        }

        if (response.error) {
          return {
            replacements: [],
            unresolvedIds: new Set(request.requestedCues.map((cue) => cue.id)),
            usage: response.usage,
            warning: `Retry attempt ${request.attempt} failed: ${response.error}`,
          };
        }

        if (response.truncated) {
          return {
            replacements: [],
            unresolvedIds: new Set(request.requestedCues.map((cue) => cue.id)),
            usage: response.usage,
            warning: `Retry attempt ${request.attempt}: response truncated`,
            terminal: true,
          };
        }

        const parsed = parseCleanupResponse(response.content);
        if (!parsed) {
          return {
            replacements: [],
            unresolvedIds: new Set(request.requestedCues.map((cue) => cue.id)),
            usage: response.usage,
            warning: `Retry attempt ${request.attempt}: invalid JSON response`,
          };
        }

        const collected = collectValidCorrections(request.requestedCues, parsed);
        return {
          replacements: collected.corrections,
          unresolvedIds: collected.unresolvedIds,
          usage: response.usage,
        };
      },
    });

    totalUsage = addUsage(totalUsage, retryResult.usage);

    if (retryResult.cancelled || options.signal?.aborted) {
      return {
        success: false,
        cancelled: true,
        subtitles,
        error: 'Cleanup cancelled',
        batchesProcessed: processed,
        totalBatches: batches.length,
        usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
      };
    }

    if (retryResult.warnings.length > 0) {
      warnings.push(...retryResult.warnings);
    }

    if (retryResult.replacements.length === 0) {
      return {
        success: false,
        subtitles,
        error: warningMessage(warnings) ?? 'AI cleanup produced no valid corrected cues',
        batchesProcessed: processed,
        totalBatches: batches.length,
        usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
      };
    }

    const assembled = assembleCorrectedSubtitles(normalizedInput, retryResult.replacements);
    const merged = mergeConsecutiveDuplicates(assembled, Math.max(0, options.maxGapMs));

    return {
      success: true,
      subtitles: merged,
      error: retryResult.unresolvedIds.size > 0 ? warningMessage(warnings) : undefined,
      batchesProcessed: processed,
      totalBatches: batches.length,
      usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
    };
  });
}
