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
import { log } from '$lib/utils/log-toast';

// ============================================================================
// SYSTEM PROMPT (for JSON-based translation)
// ============================================================================

export const TRANSLATION_SYSTEM_PROMPT = `You are an expert subtitle translator. You will receive a JSON object containing subtitle cues to translate.

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
// LLM API CALLS
// ============================================================================

interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface LLMResponse {
  content: string;
  error?: string;
  truncated?: boolean;
  finishReason?: string;
  usage?: LLMUsage;
  /** Whether the request can be retried (e.g., rate limit, temporary error) */
  retryable?: boolean;
  /** Suggested retry delay in milliseconds (from Retry-After header) */
  retryAfter?: number;
}

// API request timeout in milliseconds ( 10 minutes )
const API_REQUEST_TIMEOUT = 600_000;

/**
 * Error categories for API responses
 */
type APIErrorCategory = 
  | 'rate_limit'      // 429 - Too many requests
  | 'quota_exceeded'  // 402/429 with quota message
  | 'auth_error'      // 401 - Invalid API key
  | 'forbidden'       // 403 - Permission denied
  | 'not_found'       // 404 - Invalid endpoint/model
  | 'bad_request'     // 400 - Malformed request
  | 'server_error'    // 5xx - Server issues
  | 'timeout'         // Request timeout
  | 'network_error'   // Network connectivity issues
  | 'unknown';        // Unknown error

interface ParsedAPIError {
  category: APIErrorCategory;
  message: string;
  retryable: boolean;
  retryAfter?: number;
}

/**
 * Parse HTTP error response into structured error info
 */
function parseAPIError(
  status: number, 
  errorBody: string, 
  provider: string,
  retryAfterHeader?: string | null
): ParsedAPIError {
  // Parse retry-after header (can be seconds or date)
  let retryAfter: number | undefined;
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(seconds)) {
      retryAfter = seconds * 1000; // Convert to milliseconds
    }
  }

  // Check for quota-related messages in error body
  const lowerBody = errorBody.toLowerCase();
  const isQuotaError = lowerBody.includes('quota') || 
                       lowerBody.includes('billing') ||
                       lowerBody.includes('insufficient_quota') ||
                       lowerBody.includes('credit');

  switch (status) {
    case 400:
      return {
        category: 'bad_request',
        message: `${provider}: Bad request - ${errorBody}`,
        retryable: false
      };
    
    case 401:
      return {
        category: 'auth_error',
        message: `${provider}: Invalid API key or authentication failed`,
        retryable: false
      };
    
    case 402:
      return {
        category: 'quota_exceeded',
        message: `${provider}: Payment required - Check your billing/quota`,
        retryable: false
      };
    
    case 403:
      return {
        category: 'forbidden',
        message: `${provider}: Access forbidden - Check API key permissions`,
        retryable: false
      };
    
    case 404:
      return {
        category: 'not_found',
        message: `${provider}: Model or endpoint not found - Check model name`,
        retryable: false
      };
    
    case 429:
      if (isQuotaError) {
        return {
          category: 'quota_exceeded',
          message: `${provider}: Quota exceeded - Check your billing/usage limits`,
          retryable: false
        };
      }
      return {
        category: 'rate_limit',
        message: `${provider}: Rate limit exceeded - Please wait before retrying`,
        retryable: true,
        retryAfter: retryAfter || 60_000 // Default to 1 minute
      };
    
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        category: 'server_error',
        message: `${provider}: Server error (${status}) - Try again later`,
        retryable: true,
        retryAfter: retryAfter || 30_000 // Default to 30 seconds
      };
    
    default:
      return {
        category: 'unknown',
        message: `${provider}: API error ${status} - ${errorBody}`,
        retryable: status >= 500 // Retry on 5xx errors
      };
  }
}

/**
 * Wrap fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = API_REQUEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  // Merge signals if one was provided
  const originalSignal = options.signal;
  if (originalSignal) {
    originalSignal.addEventListener('abort', () => controller.abort());
  }
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenAI(apiKey: string, model: string, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse> {
  const provider = 'OpenAI';
  
  try {
    const response = await fetchWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      {
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
      },
      API_REQUEST_TIMEOUT
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const retryAfterHeader = response.headers.get('Retry-After');
      const parsedError = parseAPIError(response.status, errorBody, provider, retryAfterHeader);
      
      log('error', 'translation', `${provider} API error`, parsedError.message, {
        provider: 'openai',
        apiError: errorBody
      });
      
      return { 
        content: '', 
        error: parsedError.message,
        retryable: parsedError.retryable,
        retryAfter: parsedError.retryAfter
      };
    }

    const data = await response.json();
    
    // Extract finish_reason and usage
    const finishReason = data.choices[0]?.finish_reason;
    const truncated = finishReason === 'length';
    const usage: LLMUsage | undefined = data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0
    } : undefined;
    
    return { 
      content: data.choices[0]?.message?.content || '',
      finishReason,
      truncated,
      usage
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // Check if it was a timeout or user cancellation
      if (signal?.aborted) {
        return { content: '', error: 'Request cancelled', retryable: false };
      }
      return { 
        content: '', 
        error: `${provider}: Request timeout (>${API_REQUEST_TIMEOUT / 1000}s)`,
        retryable: true,
        retryAfter: 5000
      };
    }
    
    // Network errors
    const isNetworkError = error.message?.includes('fetch') || 
                           error.message?.includes('network') ||
                           error.message?.includes('ECONNREFUSED') ||
                           error.message?.includes('ENOTFOUND');
    
    const errorMsg = isNetworkError 
      ? `${provider}: Network error - Check your internet connection`
      : `${provider}: ${error.message || error}`;
    
    log('error', 'translation', `${provider} request failed`, errorMsg, {
      provider: 'openai',
      apiError: String(error)
    });
    
    return { 
      content: '', 
      error: errorMsg,
      retryable: isNetworkError,
      retryAfter: isNetworkError ? 5000 : undefined
    };
  }
}

async function callAnthropic(apiKey: string, model: string, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse> {
  const provider = 'Anthropic';
  
  try {
    const response = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
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
      },
      API_REQUEST_TIMEOUT
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const retryAfterHeader = response.headers.get('Retry-After');
      const parsedError = parseAPIError(response.status, errorBody, provider, retryAfterHeader);
      
      log('error', 'translation', `${provider} API error`, parsedError.message, {
        provider: 'anthropic',
        apiError: errorBody
      });
      
      return { 
        content: '', 
        error: parsedError.message,
        retryable: parsedError.retryable,
        retryAfter: parsedError.retryAfter
      };
    }

    const data = await response.json();
    
    // Extract stop_reason and usage (Anthropic uses different names)
    const finishReason = data.stop_reason;
    const truncated = finishReason === 'max_tokens';
    const usage: LLMUsage | undefined = data.usage ? {
      promptTokens: data.usage.input_tokens || 0,
      completionTokens: data.usage.output_tokens || 0,
      totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
    } : undefined;
    
    return { 
      content: data.content[0]?.text || '',
      finishReason,
      truncated,
      usage
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // Check if it was a timeout or user cancellation
      if (signal?.aborted) {
        return { content: '', error: 'Request cancelled', retryable: false };
      }
      return { 
        content: '', 
        error: `${provider}: Request timeout (>${API_REQUEST_TIMEOUT / 1000}s)`,
        retryable: true,
        retryAfter: 5000
      };
    }
    
    // Network errors
    const isNetworkError = error.message?.includes('fetch') || 
                           error.message?.includes('network') ||
                           error.message?.includes('ECONNREFUSED') ||
                           error.message?.includes('ENOTFOUND');
    
    const errorMsg = isNetworkError 
      ? `${provider}: Network error - Check your internet connection`
      : `${provider}: ${error.message || error}`;
    
    log('error', 'translation', `${provider} request failed`, errorMsg, {
      provider: 'anthropic',
      apiError: String(error)
    });
    
    return { 
      content: '', 
      error: errorMsg,
      retryable: isNetworkError,
      retryAfter: isNetworkError ? 5000 : undefined
    };
  }
}

async function callGoogle(apiKey: string, model: string, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse> {
  const provider = 'Google AI';
  
  try {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
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
      },
      API_REQUEST_TIMEOUT
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const retryAfterHeader = response.headers.get('Retry-After');
      const parsedError = parseAPIError(response.status, errorBody, provider, retryAfterHeader);
      
      log('error', 'translation', `${provider} API error`, parsedError.message, {
        provider: 'google',
        apiError: errorBody
      });
      
      return { 
        content: '', 
        error: parsedError.message,
        retryable: parsedError.retryable,
        retryAfter: parsedError.retryAfter
      };
    }

    const data = await response.json();
    
    // Extract finishReason and usage (Google uses different structure)
    const finishReason = data.candidates?.[0]?.finishReason;
    const truncated = finishReason === 'MAX_TOKENS';
    const usage: LLMUsage | undefined = data.usageMetadata ? {
      promptTokens: data.usageMetadata.promptTokenCount || 0,
      completionTokens: data.usageMetadata.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata.totalTokenCount || 0
    } : undefined;
    
    return { 
      content: data.candidates[0]?.content?.parts[0]?.text || '',
      finishReason,
      truncated,
      usage
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // Check if it was a timeout or user cancellation
      if (signal?.aborted) {
        return { content: '', error: 'Request cancelled', retryable: false };
      }
      return { 
        content: '', 
        error: `${provider}: Request timeout (>${API_REQUEST_TIMEOUT / 1000}s)`,
        retryable: true,
        retryAfter: 5000
      };
    }
    
    // Network errors
    const isNetworkError = error.message?.includes('fetch') || 
                           error.message?.includes('network') ||
                           error.message?.includes('ECONNREFUSED') ||
                           error.message?.includes('ENOTFOUND');
    
    const errorMsg = isNetworkError 
      ? `${provider}: Network error - Check your internet connection`
      : `${provider}: ${error.message || error}`;
    
    log('error', 'translation', `${provider} request failed`, errorMsg, {
      provider: 'google',
      apiError: String(error)
    });
    
    return { 
      content: '', 
      error: errorMsg,
      retryable: isNetworkError,
      retryAfter: isNetworkError ? 5000 : undefined
    };
  }
}

async function callOpenRouter(apiKey: string, model: string, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<LLMResponse> {
  const provider = 'OpenRouter';
  
  try {
    const response = await fetchWithTimeout(
      'https://openrouter.ai/api/v1/chat/completions',
      {
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
      },
      API_REQUEST_TIMEOUT
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const retryAfterHeader = response.headers.get('Retry-After');
      const parsedError = parseAPIError(response.status, errorBody, provider, retryAfterHeader);
      
      log('error', 'translation', `${provider} API error`, parsedError.message, {
        provider: 'openrouter',
        apiError: errorBody
      });
      
      return { 
        content: '', 
        error: parsedError.message,
        retryable: parsedError.retryable,
        retryAfter: parsedError.retryAfter
      };
    }

    const data = await response.json();
    
    // Extract finish_reason and usage (OpenRouter uses OpenAI format)
    const finishReason = data.choices[0]?.finish_reason;
    const truncated = finishReason === 'length';
    const usage: LLMUsage | undefined = data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0
    } : undefined;
    
    return { 
      content: data.choices[0]?.message?.content || '',
      finishReason,
      truncated,
      usage
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // Check if it was a timeout or user cancellation
      if (signal?.aborted) {
        return { content: '', error: 'Request cancelled', retryable: false };
      }
      return { 
        content: '', 
        error: `${provider}: Request timeout (>${API_REQUEST_TIMEOUT / 1000}s)`,
        retryable: true,
        retryAfter: 5000
      };
    }
    
    // Network errors
    const isNetworkError = error.message?.includes('fetch') || 
                           error.message?.includes('network') ||
                           error.message?.includes('ECONNREFUSED') ||
                           error.message?.includes('ENOTFOUND');
    
    const errorMsg = isNetworkError 
      ? `${provider}: Network error - Check your internet connection`
      : `${provider}: ${error.message || error}`;
    
    log('error', 'translation', `${provider} request failed`, errorMsg, {
      provider: 'openrouter',
      apiError: String(error)
    });
    
    return { 
      content: '', 
      error: errorMsg,
      retryable: isNetworkError,
      retryAfter: isNetworkError ? 5000 : undefined
    };
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
    truncated?: boolean;
    usage?: LLMUsage;
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
  let totalUsage: LLMUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let hasTruncation = false;
  
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
        if (result.value.truncated) {
          hasTruncation = true;
        }
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


