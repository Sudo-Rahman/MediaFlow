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

    expect(normalizeLLMSelection('google', 'gemini-3.1-pro-preview', true)).toEqual({
      provider: 'google',
      model: 'gemini-3.1-pro-preview',
    });
  });

  it('restricts release builds to MediaFlow models', () => {
    expect(getSelectableLLMProviders(false)).toEqual(['mediaflow']);

    expect(normalizeLLMSelection('google', 'gemini-3.1-pro-preview', false)).toEqual({
      provider: 'mediaflow',
      model: 'Lite',
    });
  });
});
