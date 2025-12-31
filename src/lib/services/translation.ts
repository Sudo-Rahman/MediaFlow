import type {
  LLMProvider,
  SubtitleFile,
  TranslationResult,
  LanguageCode
} from '$lib/types';
import type {
  Cue,
  ParsedSubtitle,
  TranslationRequest,
  TranslationCue,
  TranslationResponse,
  TranslatedCue,
  ValidationResult
} from '$lib/types/subtitle';
import { SUPPORTED_LANGUAGES } from '$lib/types';
import { settingsStore } from '$lib/stores';
import { parseSubtitle, detectFormat } from './subtitle-parser';
import { reconstructSubtitle, validateTranslation } from './subtitle-reconstructor';

// ============================================================================
// SYSTEM PROMPT (for JSON-based translation)
// ============================================================================

const TRANSLATION_SYSTEM_PROMPT = `You are an expert subtitle translator. You will receive a JSON object containing subtitle cues to translate.

CRITICAL RULES:
1. Return ONLY a valid JSON object with the translated cues
2. NEVER add, remove, or reorder cues - translate exactly what you receive
3. PRESERVE ALL PLACEHOLDERS EXACTLY (⟦TAG_0⟧, ⟦BR_0⟧, etc.) - they represent formatting that must not be changed
4. Do NOT merge or split cues
5. Do NOT add explanations, markdown, or any text outside the JSON

TRANSLATION QUALITY:
- Prioritize natural, idiomatic expressions over literal translation
- Adapt dialogue to sound like authentic conversation
- Preserve emotional tone and character speaking styles
- Respect subtitle reading constraints (~40 chars/line, ~21 chars/second)

SELF-CHECK before responding:
- Are all cue IDs preserved?
- Are all placeholders identical and in the right positions?
- Is the JSON valid?

OUTPUT FORMAT:
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
 * Parse LLM response to extract translated cues
 */
function parseTranslationResponse(responseText: string): TranslationResponse | null {
  try {
    // Try to extract JSON from response (in case LLM adds extra text)
    let jsonStr = responseText.trim();

    // Find JSON object boundaries
    const startIndex = jsonStr.indexOf('{');
    const endIndex = jsonStr.lastIndexOf('}');

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      jsonStr = jsonStr.substring(startIndex, endIndex + 1);
    }

    const parsed = JSON.parse(jsonStr);

    // Validate structure
    if (!parsed.cues || !Array.isArray(parsed.cues)) {
      console.error('Invalid response structure: missing cues array');
      return null;
    }

    // Normalize the response
    const cues: TranslatedCue[] = parsed.cues.map((cue: any) => ({
      id: cue.id || cue.ID || '',
      translatedText: cue.translatedText || cue.translated_text || cue.text || ''
    }));

    return { cues };
  } catch (error) {
    console.error('Failed to parse translation response:', error);
    console.error('Response text:', responseText);
    return null;
  }
}

// ============================================================================
// LLM API CALLS
// ============================================================================

interface LLMResponse {
  content: string;
  error?: string;
}

async function callOpenAI(apiKey: string, model: string, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      }),
      signal
    });

    if (!response.ok) {
      const error = await response.text();
      return { content: '', error: `OpenAI API error: ${response.status} - ${error}` };
    }

    const data = await response.json();
    return { content: data.choices[0]?.message?.content || '' };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { content: '', error: 'Request cancelled' };
    }
    return { content: '', error: `OpenAI request failed: ${error}` };
  }
}

async function callAnthropic(apiKey: string, model: string, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ]
      }),
      signal
    });

    if (!response.ok) {
      const error = await response.text();
      return { content: '', error: `Anthropic API error: ${response.status} - ${error}` };
    }

    const data = await response.json();
    return { content: data.content[0]?.text || '' };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { content: '', error: 'Request cancelled' };
    }
    return { content: '', error: `Anthropic request failed: ${error}` };
  }
}

async function callGoogle(apiKey: string, model: string, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse> {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json'
        }
      }),
      signal
    });

    if (!response.ok) {
      const error = await response.text();
      return { content: '', error: `Google AI API error: ${response.status} - ${error}` };
    }

    const data = await response.json();
    return { content: data.candidates[0]?.content?.parts[0]?.text || '' };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { content: '', error: 'Request cancelled' };
    }
    return { content: '', error: `Google AI request failed: ${error}` };
  }
}

async function callOpenRouter(apiKey: string, model: string, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://rsextractor.app',
        'X-Title': 'RsExtractor'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
      }),
      signal
    });

    if (!response.ok) {
      const error = await response.text();
      return { content: '', error: `OpenRouter API error: ${response.status} - ${error}` };
    }

    const data = await response.json();
    return { content: data.choices[0]?.message?.content || '' };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { content: '', error: 'Request cancelled' };
    }
    return { content: '', error: `OpenRouter request failed: ${error}` };
  }
}

/**
 * Call the appropriate LLM API
 */
async function callLLM(
  provider: LLMProvider,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal
): Promise<LLMResponse> {
  switch (provider) {
    case 'openai':
      return callOpenAI(apiKey, model, systemPrompt, userPrompt, signal);
    case 'anthropic':
      return callAnthropic(apiKey, model, systemPrompt, userPrompt, signal);
    case 'google':
      return callGoogle(apiKey, model, systemPrompt, userPrompt, signal);
    case 'openrouter':
      return callOpenRouter(apiKey, model, systemPrompt, userPrompt, signal);
    default:
      return { content: '', error: `Unknown provider: ${provider}` };
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
    const llmResponse = await callLLM(
      provider,
      apiKey,
      model,
      TRANSLATION_SYSTEM_PROMPT,
      userPrompt,
      signal
    );

    if (signal?.aborted) {
      return { batchIndex, cues: [], error: 'Translation cancelled' };
    }

    if (llmResponse.error) {
      return { batchIndex, cues: [], error: `Batch ${batchIndex + 1}/${totalBatches} failed: ${llmResponse.error}` };
    }

    // Parse LLM response
    const translationResponse = parseTranslationResponse(llmResponse.content);

    if (!translationResponse) {
      return { batchIndex, cues: [], error: `Batch ${batchIndex + 1}/${totalBatches}: Failed to parse translation response` };
    }

    return { batchIndex, cues: translationResponse.cues };
  };

  // Launch all batch translations in parallel
  const batchPromises = batches.map((batch, index) => translateBatch(batch, index));

  // Track progress as batches complete
  let completedBatches = 0;
  const batchResults: BatchResult[] = [];

  // Use Promise.allSettled to handle all batches, even if some fail
  const results = await Promise.allSettled(
    batchPromises.map(async (promise, index) => {
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
  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.error) {
        return {
          originalFile: file,
          translatedContent: '',
          success: false,
          error: result.value.error
        };
      }
      batchResults.push(result.value);
    } else {
      return {
        originalFile: file,
        translatedContent: '',
        success: false,
        error: `Batch translation failed: ${result.reason}`
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
    error: validation.valid ? undefined : `Warning: ${validation.errors.length} validation issue(s) detected`
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


