import { describe, expect, it } from 'vitest';

import { createMediaFlowApiConfig } from '../../../mediaflow-api.config.js';
import {
  DEFAULT_MEDIAFLOW_BASE_URL,
  IS_MEDIAFLOW_BASE_URL_OVERRIDE_ALLOWED,
  PROVIDER_API_URLS,
  googleGenerateContentUrl,
  joinApiUrl,
  resolveMediaFlowBaseUrl,
} from './api';

describe('API URL config', () => {
  it('uses a configurable local MediaFlow base URL in debug builds', () => {
    const config = createMediaFlowApiConfig({ isDebugBuild: true });

    expect(config.mediaflow.baseUrl).toBe('http://localhost:5173');
    expect(config.mediaflow.allowBaseUrlOverride).toBe(true);
  });

  it('locks MediaFlow to the public base URL in release builds', () => {
    const config = createMediaFlowApiConfig({ isDebugBuild: false });

    expect(config.mediaflow.baseUrl).toBe('https://mediaflow.app');
    expect(config.mediaflow.allowBaseUrlOverride).toBe(false);
  });

  it('joins base URLs and paths without duplicate slashes', () => {
    expect(joinApiUrl('https://api.example.com/', '/v1/items')).toBe('https://api.example.com/v1/items');
    expect(joinApiUrl('https://api.example.com', 'v1/items')).toBe('https://api.example.com/v1/items');
  });

  it('resolves MediaFlow overrides only when the build allows them', () => {
    const overrideUrl = 'http://localhost:9999/';
    const expectedUrl = IS_MEDIAFLOW_BASE_URL_OVERRIDE_ALLOWED
      ? 'http://localhost:9999'
      : DEFAULT_MEDIAFLOW_BASE_URL;

    expect(resolveMediaFlowBaseUrl(overrideUrl)).toBe(expectedUrl);
  });

  it('falls back to the compiled MediaFlow base URL when the override is empty', () => {
    expect(resolveMediaFlowBaseUrl('   ')).toBe(DEFAULT_MEDIAFLOW_BASE_URL);
    expect(resolveMediaFlowBaseUrl(null)).toBe(DEFAULT_MEDIAFLOW_BASE_URL);
  });

  it('builds provider endpoint URLs from centralized provider bases', () => {
    expect(PROVIDER_API_URLS.deepgramListen).toBe('https://api.deepgram.com/v1/listen');
    expect(PROVIDER_API_URLS.openAiChatCompletions).toBe('https://api.openai.com/v1/chat/completions');
    expect(PROVIDER_API_URLS.anthropicMessages).toBe('https://api.anthropic.com/v1/messages');
    expect(PROVIDER_API_URLS.openRouterChatCompletions).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('builds Google generateContent URLs with the API key query parameter', () => {
    expect(googleGenerateContentUrl('gemini-2.5-pro', 'test-key')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=test-key'
    );
  });
});
