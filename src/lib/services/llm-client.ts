import type { LogSource } from '$lib/stores/logs.svelte';
import type { LLMProvider } from '$lib/types';
import {
  APP_PUBLIC_BASE_URL,
  OPENROUTER_APP_TITLE,
  PROVIDER_API_URLS,
  googleGenerateContentUrl,
} from '$lib/config/api';
import { log } from '$lib/utils/log-toast';
import { fetchMediaFlowBillableApi } from './mediaflow-billing';

// API request timeout in milliseconds (10 minutes)
const API_REQUEST_TIMEOUT = 600_000;

export type LlmResponseMode = 'json' | 'text';

export interface LlmTextContentPart {
  type: 'text';
  text: string;
}

export interface LlmImageContentPart {
  type: 'image';
  mimeType: string;
  data: string;
}

export type LlmContentPart = LlmTextContentPart | LlmImageContentPart;

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmResponse {
  content: string;
  error?: string;
  truncated?: boolean;
  finishReason?: string;
  cancelled?: boolean;
  usage?: LlmUsage;
  retryable?: boolean;
  retryAfter?: number;
}

export interface LlmRequest {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  userContentParts?: LlmContentPart[];
  temperature?: number;
  responseMode?: LlmResponseMode;
  signal?: AbortSignal;
  logSource?: LogSource;
}

type APIErrorCategory =
  | 'rate_limit'
  | 'quota_exceeded'
  | 'auth_error'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'server_error'
  | 'timeout'
  | 'network_error'
  | 'unknown';

interface ParsedAPIError {
  category: APIErrorCategory;
  message: string;
  retryable: boolean;
  retryAfter?: number;
}

interface ProviderCallParams {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  userContentParts: LlmContentPart[];
  temperature: number;
  responseMode: LlmResponseMode;
  signal?: AbortSignal;
  logSource?: LogSource;
}

function ensureContentParts(params: ProviderCallParams): LlmContentPart[] {
  if (params.userContentParts.length > 0) {
    return params.userContentParts;
  }

  return [{ type: 'text', text: params.userPrompt }];
}

function buildOpenAiContent(parts: LlmContentPart[]): Array<Record<string, unknown>> {
  return parts.map((part) => {
    if (part.type === 'text') {
      return {
        type: 'text',
        text: part.text,
      };
    }

    return {
      type: 'image_url',
      image_url: {
        url: `data:${part.mimeType};base64,${part.data}`,
      },
    };
  });
}

function buildAnthropicContent(parts: LlmContentPart[]): Array<Record<string, unknown>> {
  return parts.map((part) => {
    if (part.type === 'text') {
      return {
        type: 'text',
        text: part.text,
      };
    }

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: part.mimeType,
        data: part.data,
      },
    };
  });
}

function buildGoogleParts(parts: LlmContentPart[]): Array<Record<string, unknown>> {
  return parts.map((part) => {
    if (part.type === 'text') {
      return { text: part.text };
    }

    return {
      inlineData: {
        mimeType: part.mimeType,
        data: part.data,
      },
    };
  });
}

function extractAnthropicText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((part): part is { type?: string; text?: string } => Boolean(part) && typeof part === 'object')
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function extractGoogleText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .filter((part): part is { text?: string } => Boolean(part) && typeof part === 'object')
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join('\n');
}

function parseAPIError(
  status: number,
  errorBody: string,
  providerLabel: string,
  retryAfterHeader?: string | null
): ParsedAPIError {
  let retryAfter: number | undefined;
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(seconds)) {
      retryAfter = seconds * 1000;
    }
  }

  const lowerBody = errorBody.toLowerCase();
  const isQuotaError =
    lowerBody.includes('quota')
    || lowerBody.includes('billing')
    || lowerBody.includes('insufficient_quota')
    || lowerBody.includes('credit');

  switch (status) {
    case 400:
      return {
        category: 'bad_request',
        message: `${providerLabel}: Bad request - ${errorBody}`,
        retryable: false,
      };

    case 401:
      return {
        category: 'auth_error',
        message: `${providerLabel}: Invalid API key or authentication failed`,
        retryable: false,
      };

    case 402:
      return {
        category: 'quota_exceeded',
        message: `${providerLabel}: Payment required - Check your billing/quota`,
        retryable: false,
      };

    case 403:
      return {
        category: 'forbidden',
        message: `${providerLabel}: Access forbidden - Check API key permissions`,
        retryable: false,
      };

    case 404:
      return {
        category: 'not_found',
        message: `${providerLabel}: Model or endpoint not found - Check model name`,
        retryable: false,
      };

    case 429:
      if (isQuotaError) {
        return {
          category: 'quota_exceeded',
          message: `${providerLabel}: Quota exceeded - Check your billing/usage limits`,
          retryable: false,
        };
      }
      return {
        category: 'rate_limit',
        message: `${providerLabel}: Rate limit exceeded - Please wait before retrying`,
        retryable: true,
        retryAfter: retryAfter || 60_000,
      };

    case 500:
    case 502:
    case 503:
    case 504:
      return {
        category: 'server_error',
        message: `${providerLabel}: Server error (${status}) - Try again later`,
        retryable: true,
        retryAfter: retryAfter || 30_000,
      };

    default:
      return {
        category: 'unknown',
        message: `${providerLabel}: API error ${status} - ${errorBody}`,
        retryable: status >= 500,
      };
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = API_REQUEST_TIMEOUT
): Promise<Response> {
  const originalSignal = options.signal;
  if (originalSignal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  const timeoutSignal = typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : (() => {
        const timeoutController = new AbortController();
        setTimeout(() => timeoutController.abort(), timeoutMs);
        return timeoutController.signal;
      })();

  const mergedSignal = originalSignal
    ? (typeof AbortSignal.any === 'function'
        ? AbortSignal.any([originalSignal, timeoutSignal])
        : (() => {
            const fallbackController = new AbortController();
            const onAbort = () => fallbackController.abort();
            originalSignal.addEventListener('abort', onAbort, { once: true });
            timeoutSignal.addEventListener('abort', onAbort, { once: true });
            if (originalSignal.aborted || timeoutSignal.aborted) {
              fallbackController.abort();
            }
            return fallbackController.signal;
          })())
    : timeoutSignal;

  return await fetch(url, {
    ...options,
    signal: mergedSignal,
  });
}

function maybeLog(
  source: LogSource | undefined,
  level: 'error' | 'warning' | 'info' | 'success',
  title: string,
  details: string,
  context?: Record<string, string>
): void {
  if (!source) return;
  log(level, source, title, details, context);
}

function normalizeOpenAiUsage(usage: any): LlmUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
  };
}

function mediaFlowApiErrorMessage(status: number, errorBody: string): string {
  try {
    const parsed = JSON.parse(errorBody) as { error?: { code?: string; message?: string } };
    const message = parsed.error?.message;
    const code = parsed.error?.code;
    if (message && code) return `${message} (${code})`;
    if (message) return message;
  } catch {
    // Fall through to the raw response body.
  }

  return errorBody;
}

function isNetworkError(error: unknown): boolean {
  const message = String(error ?? '');
  return message.includes('fetch')
    || message.includes('network')
    || message.includes('ECONNREFUSED')
    || message.includes('ENOTFOUND');
}

function buildAbortErrorResponse(
  providerLabel: string,
  reason: 'cancelled' | 'timeout'
): LlmResponse {
  if (reason === 'cancelled') {
    return { content: '', error: 'Request cancelled', retryable: false, cancelled: true };
  }

  return {
    content: '',
    error: `${providerLabel}: Request timeout (>${API_REQUEST_TIMEOUT / 1000}s)`,
    cancelled: false,
    retryable: true,
    retryAfter: 5000,
  };
}

async function callOpenAi(params: ProviderCallParams): Promise<LlmResponse> {
  const providerLabel = 'OpenAI';
  const contentParts = ensureContentParts(params);

  try {
    const response = await fetchWithTimeout(
      PROVIDER_API_URLS.openAiChatCompletions,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: buildOpenAiContent(contentParts) },
          ],
          temperature: params.temperature,
          ...(params.responseMode === 'json' ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: params.signal,
      },
      API_REQUEST_TIMEOUT
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const parsedError = parseAPIError(
        response.status,
        errorBody,
        providerLabel,
        response.headers.get('Retry-After')
      );

      maybeLog(params.logSource, 'error', `${providerLabel} API error`, parsedError.message, {
        provider: 'openai',
        apiError: errorBody,
      });

      return {
        content: '',
        error: parsedError.message,
        retryable: parsedError.retryable,
        retryAfter: parsedError.retryAfter,
      };
    }

    const data = await response.json();
    const finishReason = data.choices?.[0]?.finish_reason;

    return {
      content: data.choices?.[0]?.message?.content || '',
      finishReason,
      truncated: finishReason === 'length',
      usage: normalizeOpenAiUsage(data.usage),
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      const reason: 'cancelled' | 'timeout' = params.signal?.aborted ? 'cancelled' : 'timeout';
      return buildAbortErrorResponse(providerLabel, reason);
    }

    const networkError = isNetworkError(error);
    const errorMessage = networkError
      ? `${providerLabel}: Network error - Check your internet connection`
      : `${providerLabel}: ${error.message || error}`;

    maybeLog(params.logSource, 'error', `${providerLabel} request failed`, errorMessage, {
      provider: 'openai',
      apiError: String(error),
    });

    return {
      content: '',
      error: errorMessage,
      retryable: networkError,
      retryAfter: networkError ? 5000 : undefined,
    };
  }
}

async function callAnthropic(params: ProviderCallParams): Promise<LlmResponse> {
  const providerLabel = 'Anthropic';
  const contentParts = ensureContentParts(params);

  try {
    const response = await fetchWithTimeout(
      PROVIDER_API_URLS.anthropicMessages,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': params.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: params.model,
          system: params.systemPrompt,
          messages: [{ role: 'user', content: buildAnthropicContent(contentParts) }],
        }),
        signal: params.signal,
      },
      API_REQUEST_TIMEOUT
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const parsedError = parseAPIError(
        response.status,
        errorBody,
        providerLabel,
        response.headers.get('Retry-After')
      );

      maybeLog(params.logSource, 'error', `${providerLabel} API error`, parsedError.message, {
        provider: 'anthropic',
        apiError: errorBody,
      });

      return {
        content: '',
        error: parsedError.message,
        retryable: parsedError.retryable,
        retryAfter: parsedError.retryAfter,
      };
    }

    const data = await response.json();
    const finishReason = data.stop_reason;
    const usage: LlmUsage | undefined = data.usage
      ? {
          promptTokens: data.usage.input_tokens || 0,
          completionTokens: data.usage.output_tokens || 0,
          totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        }
      : undefined;

    return {
      content: extractAnthropicText(data.content),
      finishReason,
      truncated: finishReason === 'max_tokens',
      usage,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      const reason: 'cancelled' | 'timeout' = params.signal?.aborted ? 'cancelled' : 'timeout';
      return buildAbortErrorResponse(providerLabel, reason);
    }

    const networkError = isNetworkError(error);
    const errorMessage = networkError
      ? `${providerLabel}: Network error - Check your internet connection`
      : `${providerLabel}: ${error.message || error}`;

    maybeLog(params.logSource, 'error', `${providerLabel} request failed`, errorMessage, {
      provider: 'anthropic',
      apiError: String(error),
    });

    return {
      content: '',
      error: errorMessage,
      retryable: networkError,
      retryAfter: networkError ? 5000 : undefined,
    };
  }
}

async function callGoogle(params: ProviderCallParams): Promise<LlmResponse> {
  const providerLabel = 'Google AI';
  const contentParts = ensureContentParts(params);

  try {
    const response = await fetchWithTimeout(
      googleGenerateContentUrl(params.model, params.apiKey),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: params.systemPrompt }],
          },
          contents: [
            {
              parts: buildGoogleParts(contentParts),
            },
          ],
          generationConfig: {
            temperature: params.temperature,
            thinkingConfig: {
              thinkingLevel: "medium"
            },
            ...(params.responseMode === 'json' ? { responseMimeType: 'application/json' } : {}),
          },
        }),
        signal: params.signal,
      },
      API_REQUEST_TIMEOUT
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const parsedError = parseAPIError(
        response.status,
        errorBody,
        providerLabel,
        response.headers.get('Retry-After')
      );

      maybeLog(params.logSource, 'error', `${providerLabel} API error`, parsedError.message, {
        provider: 'google',
        apiError: errorBody,
      });

      return {
        content: '',
        error: parsedError.message,
        retryable: parsedError.retryable,
        retryAfter: parsedError.retryAfter,
      };
    }

    const data = await response.json();
    const finishReason = data.candidates?.[0]?.finishReason;
    const usage: LlmUsage | undefined = data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount || 0,
          completionTokens: data.usageMetadata.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    return {
      content: extractGoogleText(data.candidates?.[0]?.content?.parts),
      finishReason,
      truncated: finishReason === 'MAX_TOKENS',
      usage,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      const reason: 'cancelled' | 'timeout' = params.signal?.aborted ? 'cancelled' : 'timeout';
      return buildAbortErrorResponse(providerLabel, reason);
    }

    const networkError = isNetworkError(error);
    const errorMessage = networkError
      ? `${providerLabel}: Network error - Check your internet connection`
      : `${providerLabel}: ${error.message || error}`;

    maybeLog(params.logSource, 'error', `${providerLabel} request failed`, errorMessage, {
      provider: 'google',
      apiError: String(error),
    });

    return {
      content: '',
      error: errorMessage,
      retryable: networkError,
      retryAfter: networkError ? 5000 : undefined,
    };
  }
}

async function callOpenRouter(params: ProviderCallParams): Promise<LlmResponse> {
  const providerLabel = 'OpenRouter';
  const contentParts = ensureContentParts(params);

  try {
    const response = await fetchWithTimeout(
      PROVIDER_API_URLS.openRouterChatCompletions,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
          'HTTP-Referer': APP_PUBLIC_BASE_URL,
          'X-Title': OPENROUTER_APP_TITLE,
        },
        body: JSON.stringify({
          model: params.model,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: buildOpenAiContent(contentParts) },
          ],
          temperature: params.temperature,
          ...(params.responseMode === 'json' ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: params.signal,
      },
      API_REQUEST_TIMEOUT
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const parsedError = parseAPIError(
        response.status,
        errorBody,
        providerLabel,
        response.headers.get('Retry-After')
      );

      maybeLog(params.logSource, 'error', `${providerLabel} API error`, parsedError.message, {
        provider: 'openrouter',
        apiError: errorBody,
      });

      return {
        content: '',
        error: parsedError.message,
        retryable: parsedError.retryable,
        retryAfter: parsedError.retryAfter,
      };
    }

    const data = await response.json();
    const finishReason = data.choices?.[0]?.finish_reason;

    return {
      content: data.choices?.[0]?.message?.content || '',
      finishReason,
      truncated: finishReason === 'length',
      usage: normalizeOpenAiUsage(data.usage),
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      const reason: 'cancelled' | 'timeout' = params.signal?.aborted ? 'cancelled' : 'timeout';
      return buildAbortErrorResponse(providerLabel, reason);
    }

    const networkError = isNetworkError(error);
    const errorMessage = networkError
      ? `${providerLabel}: Network error - Check your internet connection`
      : `${providerLabel}: ${error.message || error}`;

    maybeLog(params.logSource, 'error', `${providerLabel} request failed`, errorMessage, {
      provider: 'openrouter',
      apiError: String(error),
    });

    return {
      content: '',
      error: errorMessage,
      retryable: networkError,
      retryAfter: networkError ? 5000 : undefined,
    };
  }
}

async function callMediaFlow(params: ProviderCallParams): Promise<LlmResponse> {
  const providerLabel = 'MediaFlow';
  const contentParts = ensureContentParts(params);

  try {
    const response = await fetchMediaFlowBillableApi('/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: buildOpenAiContent(contentParts) },
        ],
        ...(params.responseMode === 'json' ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const parsedError = parseAPIError(
        response.status,
        mediaFlowApiErrorMessage(response.status, errorBody),
        providerLabel,
        response.headers.get('Retry-After')
      );

      maybeLog(params.logSource, 'error', `${providerLabel} API error`, parsedError.message, {
        provider: 'mediaflow',
        apiError: errorBody,
      });

      return {
        content: '',
        error: parsedError.message,
        retryable: parsedError.retryable,
        retryAfter: parsedError.retryAfter,
      };
    }

    const data = await response.json();
    const finishReason = data.choices?.[0]?.finish_reason;

    return {
      content: data.choices?.[0]?.message?.content || '',
      finishReason,
      truncated: finishReason === 'length',
      usage: normalizeOpenAiUsage(data.usage),
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      const reason: 'cancelled' | 'timeout' = params.signal?.aborted ? 'cancelled' : 'timeout';
      return buildAbortErrorResponse(providerLabel, reason);
    }

    const networkError = isNetworkError(error);
    const errorMessage = networkError
      ? `${providerLabel}: Network error - Check your backend connection`
      : `${providerLabel}: ${error.message || error}`;

    maybeLog(params.logSource, 'error', `${providerLabel} request failed`, errorMessage, {
      provider: 'mediaflow',
      apiError: String(error),
    });

    return {
      content: '',
      error: errorMessage,
      retryable: networkError,
      retryAfter: networkError ? 5000 : undefined,
    };
  }
}

export async function callLlm(request: LlmRequest): Promise<LlmResponse> {
  if (request.provider !== 'mediaflow' && !request.apiKey.trim()) {
    return {
      content: '',
      error: `No API key configured for ${request.provider}`,
      retryable: false,
    };
  }

  if (!request.model.trim()) {
    return {
      content: '',
      error: 'No model selected',
      retryable: false,
    };
  }

  const params: ProviderCallParams = {
    apiKey: request.apiKey,
    model: request.model,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    userContentParts: request.userContentParts ?? [],
    temperature: request.temperature ?? 0.3,
    responseMode: request.responseMode ?? 'json',
    signal: request.signal,
    logSource: request.logSource,
  };

  switch (request.provider) {
    case 'openai':
      return callOpenAi(params);
    case 'anthropic':
      return callAnthropic(params);
    case 'google':
      return callGoogle(params);
    case 'openrouter':
      return callOpenRouter(params);
    case 'mediaflow':
      return callMediaFlow(params);
    default:
      return { content: '', error: `Unknown provider: ${request.provider}` };
  }
}
