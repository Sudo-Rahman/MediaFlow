import { describe, expect, it } from 'vitest';

import {
  getSelectableLLMProviders,
  normalizeLLMSelection,
} from './translation';

describe('LLM provider availability', () => {
  it('keeps external providers available in development builds', () => {
    expect(getSelectableLLMProviders(true)).toEqual([
      'mediaflow',
      'google',
      'anthropic',
      'openai',
      'openrouter',
    ]);

    expect(normalizeLLMSelection('google', 'gemini-3.5-flash', true)).toEqual({
      provider: 'google',
      model: 'gemini-3.5-flash',
    });
  });

  it('hides MediaFlow in development builds when no chat models are loaded', () => {
    expect(getSelectableLLMProviders(true, false)).toEqual([
      'google',
      'anthropic',
      'openai',
      'openrouter',
    ]);
  });

  it('restricts release builds to MediaFlow models', () => {
    expect(getSelectableLLMProviders(false)).toEqual(['mediaflow']);

    expect(normalizeLLMSelection('google', 'gemini-3.5-flash', false, [{ id: 'Lite', name: 'Lite' }])).toEqual({
      provider: 'mediaflow',
      model: 'Lite',
    });
  });

  it('hides all release AI providers when MediaFlow chat models are unavailable', () => {
    expect(getSelectableLLMProviders(false, false)).toEqual([]);
  });
});
