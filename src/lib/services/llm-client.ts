import { invoke } from '@tauri-apps/api/core';
import type { LogSource } from '$lib/stores/logs.svelte';
import { mediaflowUsageStore } from '$lib/stores/mediaflow-usage.svelte';
import type { LLMProvider } from '$lib/types';
import { log } from '$lib/utils/log-toast';
import { getMediaFlowAccessToken, refreshMediaFlowSession } from './mediaflow-auth';

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
  status?: number;
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

interface LlmInvokeRequest {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  userContentParts: LlmContentPart[];
  temperature?: number;
  responseMode: LlmResponseMode;
  mediaflowAccessToken?: string;
}

function createLlmRequestId(provider: LLMProvider): string {
  return `llm-${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cancelledResponse(): LlmResponse {
  return {
    content: '',
    error: 'Request cancelled',
    cancelled: true,
    retryable: false,
  };
}

function providerLabel(provider: LLMProvider): string {
  switch (provider) {
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic';
    case 'google':
      return 'Google AI';
    case 'openrouter':
      return 'OpenRouter';
    case 'mediaflow':
      return 'MediaFlow';
    default:
      return provider;
  }
}

function logResponseError(request: LlmRequest, response: LlmResponse): void {
  if (!request.logSource || !response.error || response.cancelled) return;

  log(
    response.retryable ? 'warning' : 'error',
    request.logSource,
    `${providerLabel(request.provider)} API error`,
    response.error,
    {
      provider: request.provider,
      ...(response.status ? { apiStatus: String(response.status) } : {}),
    }
  );
}

function attachCancel(signal: AbortSignal | undefined, requestId: string): () => void {
  if (!signal) return () => {};

  const cancelRequest = () => {
    void invoke('cancel_llm_request', { requestId }).catch(() => {
      // Request may already have completed.
    });
  };

  signal.addEventListener('abort', cancelRequest, { once: true });
  return () => signal.removeEventListener('abort', cancelRequest);
}

async function invokeLlmComplete(requestId: string, request: LlmInvokeRequest): Promise<LlmResponse> {
  return invoke<LlmResponse>('llm_complete', { requestId, request });
}

function buildBaseInvokeRequest(request: LlmRequest): LlmInvokeRequest {
  return {
    provider: request.provider,
    apiKey: request.apiKey,
    model: request.model,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    userContentParts: request.userContentParts ?? [],
    temperature: request.temperature ?? 0.3,
    responseMode: request.responseMode ?? 'json',
  };
}

async function callLlmWithMediaFlowAuth(
  requestId: string,
  invokeRequest: LlmInvokeRequest,
  signal?: AbortSignal
): Promise<LlmResponse> {
  const callWithToken = (accessToken: string) =>
    invokeLlmComplete(requestId, {
      ...invokeRequest,
      mediaflowAccessToken: accessToken,
    });

  let response = await callWithToken(await getMediaFlowAccessToken());
  if (response.status === 401 && !signal?.aborted) {
    response = await callWithToken(await refreshMediaFlowSession());
  }

  if (!response.error && !response.cancelled) {
    mediaflowUsageStore.scheduleRefresh();
  }

  return response;
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

  if (request.signal?.aborted) {
    return cancelledResponse();
  }

  const requestId = createLlmRequestId(request.provider);
  const detachCancel = attachCancel(request.signal, requestId);
  const invokeRequest = buildBaseInvokeRequest(request);

  try {
    const response = request.provider === 'mediaflow'
      ? await callLlmWithMediaFlowAuth(requestId, invokeRequest, request.signal)
      : await invokeLlmComplete(requestId, invokeRequest);

    if (request.signal?.aborted || response.cancelled) {
      return cancelledResponse();
    }

    logResponseError(request, response);
    return response;
  } catch (error) {
    if (request.signal?.aborted) {
      return cancelledResponse();
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const response: LlmResponse = {
      content: '',
      error: `${providerLabel(request.provider)}: ${errorMessage}`,
      retryable: false,
    };
    logResponseError(request, response);
    return response;
  } finally {
    detachCancel();
  }
}
