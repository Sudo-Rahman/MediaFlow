import { settingsStore } from '$lib/stores';
import { LLM_PROVIDERS } from '$lib/types';
import type { LLMProvider, OcrSubtitle } from '$lib/types';
import { normalizeOcrSubtitles } from '$lib/utils/ocr-subtitle-adapter';
import { callLlm } from './llm-client';
import type { LlmUsage } from './llm-client';

const DEFAULT_BATCH_SIZE = 120;

const OCR_CLEANUP_SYSTEM_PROMPT = `You are an expert subtitle post-editor specializing in OCR correction.

CRITICAL RULES:
1. Return ONLY valid JSON.
2. Keep EXACTLY the same cue IDs as input.
3. Do NOT add, remove, merge, split, or reorder cues.
4. Correct OCR mistakes only (spacing, missing letters, misread characters, punctuation).
5. Preserve the original language.
6. Keep each cue concise and natural as a subtitle.
7. Do not output explanations.

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
    const parsed = JSON.parse(jsonChunk);
    if (!parsed.cues || !Array.isArray(parsed.cues)) {
      return null;
    }

    const cues = parsed.cues.map((cue: any) => ({
      id: String(cue.id ?? cue.ID ?? ''),
      correctedText: String(cue.correctedText ?? cue.corrected_text ?? cue.text ?? '').trim(),
    }));

    if (cues.length === 0 || cues.some((cue: any) => !cue.id || !cue.correctedText)) {
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

function applyBatchCorrections(
  originals: OcrSubtitle[],
  parsed: OcrCleanupParsedResponse
): OcrSubtitle[] | null {
  const correctedById = new Map(parsed.cues.map((cue) => [cue.id, cue.correctedText]));

  const corrected: OcrSubtitle[] = [];
  for (const cue of originals) {
    const correctedText = correctedById.get(cue.id);
    if (!correctedText) {
      return null;
    }

    corrected.push({
      ...cue,
      text: collapseWhitespace(correctedText),
    });
  }

  return corrected;
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

  const batchSize = Math.max(20, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const batches = splitIntoBatches(normalizedInput, batchSize);

  const correctedSubtitles: OcrSubtitle[] = [];
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
      return {
        success: false,
        subtitles,
        error: `Batch ${batchIndex + 1}/${batches.length} failed: ${response.error}`,
        batchesProcessed: processed,
        totalBatches: batches.length,
        usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
      };
    }

    if (response.truncated) {
      return {
        success: false,
        subtitles,
        error: `Batch ${batchIndex + 1}/${batches.length}: response truncated`,
        batchesProcessed: processed,
        totalBatches: batches.length,
        usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
      };
    }

    const parsed = parseCleanupResponse(response.content);
    if (!parsed) {
      return {
        success: false,
        subtitles,
        error: `Batch ${batchIndex + 1}/${batches.length}: invalid JSON response`,
        batchesProcessed: processed,
        totalBatches: batches.length,
        usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
      };
    }

    const correctedBatch = applyBatchCorrections(batch, parsed);
    if (!correctedBatch) {
      return {
        success: false,
        subtitles,
        error: `Batch ${batchIndex + 1}/${batches.length}: missing corrected cues`,
        batchesProcessed: processed,
        totalBatches: batches.length,
        usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
      };
    }

    correctedSubtitles.push(...correctedBatch);
    processed += 1;

    if (response.usage) {
      totalUsage = {
        promptTokens: totalUsage.promptTokens + response.usage.promptTokens,
        completionTokens: totalUsage.completionTokens + response.usage.completionTokens,
        totalTokens: totalUsage.totalTokens + response.usage.totalTokens,
      };
    }
  }

  const merged = mergeConsecutiveDuplicates(correctedSubtitles, Math.max(0, options.maxGapMs));

  return {
    success: true,
    subtitles: merged,
    batchesProcessed: processed,
    totalBatches: batches.length,
    usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
  };
}
