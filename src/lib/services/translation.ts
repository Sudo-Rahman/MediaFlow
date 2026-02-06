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
    speaker: cue.speaker,
    style: cue.style,
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

${JSON.stringify(request, null, 2)}`;
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

  const request = buildTranslationRequest(parsed.cues, sourceLang, targetLang);
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
  onProgress?: (info: BatchProgressInfo | number) => void,
  batchCount: number = 1, // 1 = no splitting
  signal?: AbortSignal
): Promise<TranslationResult> {
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
    return {
      originalFile: file,
      translatedContent: '',
      success: false,
      error: 'Translation cancelled'
    };
  }

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

  reportProgress({ progress: 10, currentBatch: 0, totalBatches: 0 });

  // Step 2: Split into N batches
  const batches = splitIntoNBatches(parsed.cues, batchCount);
  const totalBatches = batches.length;

  reportProgress({ progress: 15, currentBatch: 0, totalBatches });

  // Step 3: Translate all batches in parallel
  interface BatchResult {
    batchIndex: number;
    cues: TranslatedCue[];
    error?: string;
    truncated?: boolean;
    usage?: LlmUsage;
  }

  const translateBatch = async (batch: Cue[], batchIndex: number): Promise<BatchResult> => {
    // Check for cancellation before starting
    if (signal?.aborted) {
      return { batchIndex, cues: [], error: 'Translation cancelled' };
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
      return { batchIndex, cues: [], error: 'Translation cancelled' };
    }

    if (llmResponse.error) {
      return { batchIndex, cues: [], error: `Batch ${batchIndex + 1}/${totalBatches} failed: ${llmResponse.error}` };
    }

    // Check for truncated response (finish_reason === "length")
    if (llmResponse.truncated) {
      const errorMsg = `Batch ${batchIndex + 1}/${totalBatches}: Response truncated (increase batch count)`;
      log('warning', 'translation', 'Response truncated', 
        `The API response was truncated (finish_reason: ${llmResponse.finishReason}). Try increasing the number of batches.`,
        { provider }
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
        { provider }
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

    return { 
      batchIndex, 
      cues: translationResponse.cues,
      usage: llmResponse.usage
    };
  };

  // Launch all batch translations in parallel
  const batchPromises = batches.map((batch, index) => translateBatch(batch, index));

  // Track progress as batches complete
  let completedBatches = 0;
  const batchResults: BatchResult[] = [];

  // Use Promise.allSettled to handle all batches, even if some fail
  const results = await Promise.allSettled(
    batchPromises.map(async (promise) => {
      const result = await promise;
      completedBatches++;
      const batchProgress = 15 + ((completedBatches / totalBatches) * 70);
      reportProgress({
        progress: Math.round(batchProgress),
        currentBatch: completedBatches,
        totalBatches
      });
      return result;
    })
  );

  // Collect results and check for errors
  let totalUsage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  
  for (const result of results) {
    if (result.status === 'fulfilled') {
      // Accumulate usage from this batch
      if (result.value.usage) {
        totalUsage.promptTokens += result.value.usage.promptTokens;
        totalUsage.completionTokens += result.value.usage.completionTokens;
        totalUsage.totalTokens += result.value.usage.totalTokens;
      }
      
      if (result.value.error) {
        // Check if this was a truncation error
        return {
          originalFile: file,
          translatedContent: '',
          success: false,
          error: result.value.error,
          truncated: result.value.truncated,
          usage: totalUsage.totalTokens > 0 ? totalUsage : undefined
        };
      }
      batchResults.push(result.value);
    } else {
      return {
        originalFile: file,
        translatedContent: '',
        success: false,
        error: `Batch translation failed: ${result.reason}`,
        usage: totalUsage.totalTokens > 0 ? totalUsage : undefined
      };
    }
  }

  // Sort results by batch index to maintain order
  batchResults.sort((a, b) => a.batchIndex - b.batchIndex);

  // Combine all translated cues in order
  const allTranslatedCues: TranslatedCue[] = batchResults.flatMap(r => r.cues);

  reportProgress({ progress: 85, currentBatch: totalBatches, totalBatches });

  // Step 4: Validate all translations
  const validation = validateTranslation(parsed.cues, allTranslatedCues);

  if (!validation.valid) {
    console.warn('Translation validation errors:', validation.errors);
  }

  reportProgress({ progress: 90, currentBatch: totalBatches, totalBatches });

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
