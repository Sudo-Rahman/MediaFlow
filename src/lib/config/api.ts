export const API_CONFIG = __MEDIAFLOW_API_CONFIG__;

export const IS_DEBUG_BUILD = API_CONFIG.build.isDebugBuild;
export const DEFAULT_MEDIAFLOW_BASE_URL = normalizeBaseUrl(API_CONFIG.mediaflow.baseUrl);
export const IS_MEDIAFLOW_BASE_URL_OVERRIDE_ALLOWED = API_CONFIG.mediaflow.allowBaseUrlOverride;
export const APP_PUBLIC_BASE_URL = normalizeBaseUrl(API_CONFIG.app.publicBaseUrl);
export const OPENROUTER_APP_TITLE = API_CONFIG.app.openRouterTitle;

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function joinApiUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`;
}

export function resolveMediaFlowBaseUrl(overrideBaseUrl: string | null | undefined): string {
  if (IS_MEDIAFLOW_BASE_URL_OVERRIDE_ALLOWED) {
    const normalizedOverride = normalizeBaseUrl(overrideBaseUrl ?? '');
    if (normalizedOverride) {
      return normalizedOverride;
    }
  }

  return DEFAULT_MEDIAFLOW_BASE_URL;
}

export function mediaFlowUrl(path: string, overrideBaseUrl?: string | null): string {
  return joinApiUrl(resolveMediaFlowBaseUrl(overrideBaseUrl), path);
}

export const PROVIDER_API_URLS = {
  deepgramListen: joinApiUrl(API_CONFIG.providers.deepgram.baseUrl, '/v1/listen'),
  openAiChatCompletions: joinApiUrl(API_CONFIG.providers.openai.baseUrl, '/v1/chat/completions'),
  anthropicMessages: joinApiUrl(API_CONFIG.providers.anthropic.baseUrl, '/v1/messages'),
  openRouterChatCompletions: joinApiUrl(API_CONFIG.providers.openrouter.baseUrl, '/api/v1/chat/completions'),
} as const;

export function googleGenerateContentUrl(model: string, apiKey: string): string {
  const query = new URLSearchParams({ key: apiKey });
  return `${joinApiUrl(API_CONFIG.providers.google.baseUrl, `/v1beta/models/${model}:generateContent`)}?${query}`;
}
