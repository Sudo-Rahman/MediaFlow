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

// ============================================================================
// SYSTEM PROMPT (for JSON-based translation)
// ============================================================================

export const TRANSLATION_SYSTEM_PROMPT = `You are an expert professional subtitle translator with extensive experience in audiovisual localization. You specialize in creating translations that feel natural and authentic while preserving timing and formatting constraints.

## CRITICAL RULES (MANDATORY)
1. Return ONLY a valid JSON object with the translated cues
2. NEVER add, remove, or reorder cues - translate exactly what you receive
3. PRESERVE ALL PLACEHOLDERS EXACTLY (⟦TAG_0⟧, ⟦BR_0⟧, etc.) - they represent formatting that must not be changed
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
□ All placeholders (⟦TAG_0⟧, ⟦BR_0⟧, etc.) are identical and in correct positions?
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

interface CuePartitionStats {
  totalCues: number;
  translatableCues: number;
  skippedCues: number;
  skippedMaskCount: number;
  totalChars: number;
  translatableChars: number;
  estimatedReductionPct: number;
}

interface CuePartitionResult {
  translatableCues: Cue[];
  passthroughCues: TranslatedCue[];
  translatableIdSet: Set<string>;
  stats: CuePartitionStats;
}

function partitionCuesForLlm(cues: Cue[]): CuePartitionResult {
  const translatableCues: Cue[] = [];
  const passthroughCues: TranslatedCue[] = [];
  const translatableIdSet = new Set<string>();

  let skippedMaskCount = 0;
  let totalChars = 0;
  let translatableChars = 0;

  for (const cue of cues) {
    totalChars += cue.textSkeleton.length;

    const normalizedStyle = cue.style?.trim().toLowerCase();
    const isAssLike = cue.format === 'ass' || cue.format === 'ssa';
    const isMaskStyle = isAssLike && !!normalizedStyle && NON_TRANSLATABLE_ASS_STYLES.has(normalizedStyle);

    if (isMaskStyle) {
      skippedMaskCount += 1;
      passthroughCues.push({
        id: cue.id,
        translatedText: cue.textSkeleton
      });
      continue;
    }

    translatableCues.push(cue);
    translatableIdSet.add(cue.id);
    translatableChars += cue.textSkeleton.length;
  }

  const skippedCues = cues.length - translatableCues.length;
  const estimatedReductionPct = totalChars > 0
    ? Math.round(((totalChars - translatableChars) * 10000) / totalChars) / 100
    : 0;

  return {
    translatableCues,
    passthroughCues,
    translatableIdSet,
    stats: {
      totalCues: cues.length,
      translatableCues: translatableCues.length,
      skippedCues,
      skippedMaskCount,
      totalChars,
      translatableChars,
      estimatedReductionPct
    }
  };
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
  cues: Cue[],
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): TranslationRequest {
  const translationCues: TranslationCue[] = cues.map(cue => ({
    id: cue.id,
    text: cue.textSkeleton
  }));

  return {
    sourceLang: sourceLang === 'auto' ? 'auto-detect' : getLanguageName(sourceLang),
    targetLang: getLanguageName(targetLang),
    rules: {
      placeholders: 'MUST_PRESERVE_EXACTLY',
      noReordering: true,
      noMerging: true,
      noSplitting: true
    },
    cues: translationCues
  };
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

  const { translatableCues } = partitionCuesForLlm(parsed.cues);
  const request = buildTranslationRequest(translatableCues, sourceLang, targetLang);
  const userPrompt = buildUserPrompt(request);

  return TRANSLATION_SYSTEM_PROMPT + '\n\n' + userPrompt;
}

/**
 * Parse LLM response to extract translated cues
 * @param responseText - Raw response text from the LLM
 * @param provider - Name of the LLM provider for logging context
 */
function parseTranslationResponse(responseText: string, provider: string = 'unknown'): TranslationResponse | null {
  // Check for empty or whitespace-only response
  if (!responseText || !responseText.trim()) {
    log('error', 'translation', 'Empty AI response', 
      'The AI provider returned an empty response. This may indicate a rate limit, content filter, or API issue.', 
      { provider }
    );
    return null;
  }

  try {
    // Try to extract JSON from response (in case LLM adds extra text)
    let jsonStr = responseText.trim();

    // Find JSON object boundaries
    const startIndex = jsonStr.indexOf('{');
    const endIndex = jsonStr.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
      // No valid JSON object found
      const preview = responseText.length > 300 ? responseText.slice(0, 300) + '...' : responseText;
      log('error', 'translation', 'Invalid JSON format', 
        `Could not find a valid JSON object in the AI response. The AI may have returned plain text instead of JSON.\n\nResponse preview:\n${preview}`,
        { provider }
      );
      return null;
    }

    jsonStr = jsonStr.substring(startIndex, endIndex + 1);

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      const preview = jsonStr.length > 300 ? jsonStr.slice(0, 300) + '...' : jsonStr;
      log('error', 'translation', 'JSON parse error', 
        `Failed to parse the AI response as JSON. The response may contain malformed JSON.\n\nError: ${parseError}\n\nJSON preview:\n${preview}`,
        { provider, apiError: String(parseError) }
      );
      return null;
    }

    // Validate structure
    if (!parsed.cues || !Array.isArray(parsed.cues)) {
      const preview = jsonStr.length > 300 ? jsonStr.slice(0, 300) + '...' : jsonStr;
      log('error', 'translation', 'Invalid JSON structure', 
        `The AI response JSON is missing the required "cues" array. The AI may have returned a different format.\n\nJSON preview:\n${preview}`,
        { provider }
      );
      return null;
    }

    // Check for empty cues array
    if (parsed.cues.length === 0) {
      log('warning', 'translation', 'Empty cues array', 
        'The AI returned a valid JSON but with an empty "cues" array. No translations were provided.',
        { provider }
      );
      return null;
    }

    // Normalize the response
    const cues: TranslatedCue[] = parsed.cues.map((cue: any) => ({
      id: cue.id || cue.ID || '',
      translatedText: cue.translatedText || cue.translated_text || cue.text || ''
    }));

    // Validate that cues have required fields
    const invalidCues = cues.filter(cue => !cue.id || !cue.translatedText);
    if (invalidCues.length > 0) {
      log('warning', 'translation', 'Incomplete cue data', 
        `${invalidCues.length} cue(s) are missing "id" or "translatedText" fields. Translation may be incomplete.`,
        { provider }
      );
    }

    return { cues };
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
      error: `No API key configured for ${provider}. Please add it in Settings.`
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

    reportProgress({ progress: 5, currentBatch: 0, totalBatches: 0 });

    // Step 1: Parse the subtitle file
    const parsed = parseSubtitle(file.content);

    if (!parsed) {
      return {
        originalFile: file,
        translatedContent: '',
        success: false,
        error: 'Could not parse subtitle file. Unsupported format.'
      };
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

    const { translatableCues, passthroughCues, translatableIdSet, stats } = partitionCuesForLlm(parsed.cues);

    log(
      'info',
      'translation',
      'Prepared cues for LLM',
      `Sending ${stats.translatableCues}/${stats.totalCues} cues to LLM. Skipped ${stats.skippedCues} cues (${stats.skippedMaskCount} mask cues). Estimated text reduction: ${stats.estimatedReductionPct}% (${stats.translatableChars}/${stats.totalChars} chars retained).`,
      logContext
    );

    if (translatableCues.length === 0) {
      reportProgress({ progress: 100, currentBatch: 0, totalBatches: 0 });
      return {
        originalFile: file,
        translatedContent: file.content,
        success: true,
      };
    }

    // Step 2: Split into N batches
    const batches = splitIntoNBatches(translatableCues, batchCount);
    const totalBatches = batches.length;

    if (signal?.aborted) {
      return buildCancelledResult(file);
    }

    reportProgress({ progress: 15, currentBatch: 0, totalBatches });

    // Step 3: Translate batches with a bounded worker pool
    interface BatchResult {
      batchIndex: number;
      cues: TranslatedCue[];
      error?: string;
      truncated?: boolean;
      usage?: LlmUsage;
      cancelled?: boolean;
    }

    const translateBatch = async (batch: Cue[], batchIndex: number): Promise<BatchResult> => {
      // Check for cancellation before starting
      if (signal?.aborted) {
        return { batchIndex, cues: [], error: 'Translation cancelled', cancelled: true };
      }

      // Build translation request for this batch
      const translationRequest = buildTranslationRequest(batch, sourceLang, targetLang);
      const userPrompt = buildUserPrompt(translationRequest);

      // Call LLM for translation
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
        return { batchIndex, cues: [], error: 'Translation cancelled', cancelled: true };
      }

      if (llmResponse.cancelled || isCancelledError(llmResponse.error)) {
        return { batchIndex, cues: [], error: 'Translation cancelled', cancelled: true };
      }

      if (llmResponse.error) {
        return { batchIndex, cues: [], error: `Batch ${batchIndex + 1}/${totalBatches} failed: ${llmResponse.error}` };
      }

      // Check for truncated response (finish_reason === "length")
      if (llmResponse.truncated) {
        const errorMsg = `Batch ${batchIndex + 1}/${totalBatches}: Response truncated (increase batch count)`;
        log('warning', 'translation', 'Response truncated',
          `The API response was truncated (finish_reason: ${llmResponse.finishReason}). Try increasing the number of batches.`,
          { ...logContext, batchIndex: String(batchIndex + 1) }
        );
        return {
          batchIndex,
          cues: [],
          error: errorMsg,
          truncated: true,
          usage: llmResponse.usage
        };
      }

      // Check for empty content before parsing
      if (!llmResponse.content || !llmResponse.content.trim()) {
        const errorMsg = `Batch ${batchIndex + 1}/${totalBatches}: ${provider} returned empty content`;
        log('error', 'translation', 'Empty response from AI',
          `The translation request succeeded but ${provider} returned no content. This may be caused by rate limits, content filtering, or API issues.`,
          { ...logContext, batchIndex: String(batchIndex + 1) }
        );
        return { batchIndex, cues: [], error: errorMsg, usage: llmResponse.usage };
      }

      // Parse LLM response with provider context for better error logging
      const translationResponse = parseTranslationResponse(llmResponse.content, provider);

      if (!translationResponse) {
        return {
          batchIndex,
          cues: [],
          error: `Batch ${batchIndex + 1}/${totalBatches}: Failed to parse ${provider} response (check Logs for details)`,
          usage: llmResponse.usage
        };
      }

      const sanitizedCues = translationResponse.cues.filter(cue => translatableIdSet.has(cue.id));
      const ignoredCueCount = translationResponse.cues.length - sanitizedCues.length;

      if (ignoredCueCount > 0) {
        const ignoredIds = translationResponse.cues
          .filter(cue => !translatableIdSet.has(cue.id))
          .map(cue => cue.id)
          .filter(Boolean);

        log(
          'warning',
          'translation',
          'Ignored unexpected cue IDs from LLM response',
          `Batch ${batchIndex + 1}/${totalBatches}: ignored ${ignoredCueCount} cue(s) with IDs outside the translatable set. IDs: ${ignoredIds.slice(0, 5).join(', ') || '(none)'}`,
          {
            ...logContext,
            batchIndex: String(batchIndex + 1),
          }
        );
      }

      return {
        batchIndex,
        cues: sanitizedCues,
        usage: llmResponse.usage
      };
    };

    // Track progress as batches complete
    let completedBatches = 0;
    const batchResults: BatchResult[] = [];
    let nextBatchIndex = 0;
    let stopScheduling = false;
    const workerCount = Math.min(batchConcurrency, totalBatches);

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

        completedBatches++;
        const batchProgress = 15 + ((completedBatches / totalBatches) * 70);
        reportProgress({
          progress: Math.round(batchProgress),
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
          originalFile: file,
          translatedContent: '',
          success: false,
          error: `Batch worker failed: ${String(workerResult.reason)}`,
        };
      }
    }

    if (signal?.aborted || batchResults.some(result => result.cancelled)) {
      return buildCancelledResult(file);
    }

    // Collect results and check for errors
    let totalUsage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    if (batchResults.length !== totalBatches) {
      return {
        originalFile: file,
        translatedContent: '',
        success: false,
        error: `Batch translation incomplete: ${batchResults.length}/${totalBatches} finished`,
      };
    }

    // Sort results by batch index to maintain order
    batchResults.sort((a, b) => a.batchIndex - b.batchIndex);

    for (const result of batchResults) {
      if (result.usage) {
        totalUsage.promptTokens += result.usage.promptTokens;
        totalUsage.completionTokens += result.usage.completionTokens;
        totalUsage.totalTokens += result.usage.totalTokens;
      }

      if (result.error) {
        return {
          originalFile: file,
          translatedContent: '',
          success: false,
          error: result.error,
          truncated: result.truncated,
          usage: totalUsage.totalTokens > 0 ? totalUsage : undefined
        };
      }
    }

    // Combine translated cues with passthrough cues to preserve filtered styles
    const translatedFromLlm: TranslatedCue[] = batchResults.flatMap(r => r.cues);
    const allTranslatedCues: TranslatedCue[] = [...translatedFromLlm, ...passthroughCues];

    if (signal?.aborted) {
      return buildCancelledResult(file);
    }

    reportProgress({ progress: 85, currentBatch: totalBatches, totalBatches });

    // Step 4: Validate all translations
    if (signal?.aborted) {
      return buildCancelledResult(file);
    }

    const validation = validateTranslation(parsed.cues, allTranslatedCues);

    if (!validation.valid) {
      console.warn('Translation validation errors:', validation.errors);
    }

    reportProgress({ progress: 90, currentBatch: totalBatches, totalBatches });

    if (signal?.aborted) {
      return buildCancelledResult(file);
    }

    // Step 5: Reconstruct subtitle file
    const { content: translatedContent } = reconstructSubtitle(
      parsed,
      allTranslatedCues,
      file.content
    );

    reportProgress({ progress: 100, currentBatch: totalBatches, totalBatches });

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
