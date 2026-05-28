import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubtitleOcrCue } from '$lib/types';

const callLlmMock = vi.hoisted(() => vi.fn());
const withSleepInhibitMock = vi.hoisted(() => vi.fn(async (_reason: string, fn: () => Promise<unknown>) => fn()));
const settingsStoreMock = vi.hoisted(() => ({
  isLoaded: true,
  load: vi.fn(async () => undefined),
  getLLMApiKey: vi.fn(() => 'test-api-key'),
}));

vi.mock('$lib/stores', () => ({
  settingsStore: settingsStoreMock,
}));

vi.mock('./llm-client', () => ({
  callLlm: callLlmMock,
}));

vi.mock('./sleep-inhibit', () => ({
  withSleepInhibit: withSleepInhibitMock,
}));

function cue(overrides: Partial<SubtitleOcrCue> = {}): SubtitleOcrCue {
  return {
    id: 'cue-1',
    sourceCueIds: ['raw-1'],
    startTimeMs: 1000,
    endTimeMs: 2400,
    text: 'HeIIo wor1d',
    confidence: 0.72,
    ...overrides,
  };
}

describe('subtitle OCR AI cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsStoreMock.isLoaded = true;
    settingsStoreMock.getLLMApiKey.mockReturnValue('test-api-key');
  });

  it('builds a prompt that forbids translation and allows duplicate cue merging', async () => {
    const { buildSubtitleOcrCleanupPrompt } = await import('./subtitle-ocr-ai-cleanup');

    const prompt = buildSubtitleOcrCleanupPrompt([cue()]);

    expect(prompt).toContain('Do not translate');
    expect(prompt).toContain('merge consecutive duplicate cues');
  });

  it('parses cleaned cues and preserves merged source cue IDs', async () => {
    const { parseSubtitleOcrCleanupResponse } = await import('./subtitle-ocr-ai-cleanup');

    const result = parseSubtitleOcrCleanupResponse(JSON.stringify({
      cues: [
        {
          id: 'clean-1',
          sourceCueIds: ['cue-1', 'cue-2'],
          startTimeMs: 1000,
          endTimeMs: 3600,
          text: 'Hello world.',
          confidence: 0.91,
        },
      ],
    }));

    expect(result).toEqual({
      success: true,
      cues: [
        {
          id: 'clean-1',
          sourceCueIds: ['cue-1', 'cue-2'],
          startTimeMs: 1000,
          endTimeMs: 3600,
          text: 'Hello world.',
          confidence: 0.91,
        },
      ],
    });
  });

  it('rejects invalid cleanup responses', async () => {
    const { parseSubtitleOcrCleanupResponse } = await import('./subtitle-ocr-ai-cleanup');

    const result = parseSubtitleOcrCleanupResponse(JSON.stringify({
      cues: [
        {
          id: 'bad-cue',
          sourceCueIds: ['cue-1'],
          startTimeMs: 2000,
          endTimeMs: 1000,
          text: 'Invalid timing',
          confidence: 0.5,
        },
      ],
    }));

    expect(result.success).toBe(false);
    expect(result.cues).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it.each([
    ['negative start time', { startTimeMs: -1, endTimeMs: 1000, confidence: 0.5 }],
    ['negative confidence', { startTimeMs: 0, endTimeMs: 1000, confidence: -0.1 }],
    ['confidence above one', { startTimeMs: 0, endTimeMs: 1000, confidence: 1.1 }],
  ])('rejects cleanup cues with %s', async (_caseName, numericFields) => {
    const { parseSubtitleOcrCleanupResponse } = await import('./subtitle-ocr-ai-cleanup');

    const result = parseSubtitleOcrCleanupResponse(JSON.stringify({
      cues: [
        {
          id: 'bad-cue',
          sourceCueIds: ['cue-1'],
          text: 'Invalid numbers',
          ...numericFields,
        },
      ],
    }));

    expect(result.success).toBe(false);
    expect(result.cues).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('calls the LLM in JSON mode and returns cleaned cues on success', async () => {
    const originalCues = [
      cue({ id: 'cue-1', sourceCueIds: ['raw-1'], startTimeMs: 1000, endTimeMs: 2400, text: 'HeIIo wor1d' }),
      cue({ id: 'cue-2', sourceCueIds: ['raw-2'], startTimeMs: 2400, endTimeMs: 3600, text: 'HeIIo wor1d' }),
    ];
    const cleanedCues = [
      cue({
        id: 'clean-1',
        sourceCueIds: ['raw-1', 'raw-2'],
        startTimeMs: 1000,
        endTimeMs: 3600,
        text: 'Hello world.',
        confidence: 0.95,
      }),
    ];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ cues: cleanedCues }),
      usage: { promptTokens: 10, completionTokens: 6, totalTokens: 16 },
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(withSleepInhibitMock).toHaveBeenCalledWith('MediaFlow: Subtitle OCR cleanup', expect.any(Function));
    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      apiKey: 'test-api-key',
      model: 'gpt-4o-mini',
      temperature: 0.2,
      responseMode: 'json',
      logSource: 'system',
    }));
    expect(result).toEqual({
      success: true,
      cues: cleanedCues,
      usage: { promptTokens: 10, completionTokens: 6, totalTokens: 16 },
    });
  });

  it('returns original cues when AI returns no cues for non-empty input', async () => {
    const originalCues = [cue()];
    const usage = { promptTokens: 8, completionTokens: 2, totalTokens: 10 };
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ cues: [] }),
      usage,
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
    expect(result.cues).toEqual(originalCues);
    expect(result.error).toContain('returned no cues');
    expect(result.usage).toEqual(usage);
  });

  it('returns original cues when AI invents a source cue ID', async () => {
    const originalCues = [cue({ id: 'cue-1', sourceCueIds: ['raw-1'] })];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        cues: [
          cue({
            id: 'clean-1',
            sourceCueIds: ['invented-raw-1'],
            text: 'Hello world.',
          }),
        ],
      }),
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
    expect(result.cues).toEqual(originalCues);
    expect(result.error).toContain('unknown source cue ID');
  });

  it('returns original cues when AI omits source cue IDs on an output cue', async () => {
    const originalCues = [cue({ id: 'cue-1', sourceCueIds: ['raw-1'] })];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        cues: [
          cue({
            id: 'clean-1',
            sourceCueIds: [],
            text: 'Hello world.',
          }),
        ],
      }),
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
    expect(result.cues).toEqual(originalCues);
    expect(result.error).toContain('no source cue IDs');
  });

  it('returns original cues when AI reuses a source cue across output cues', async () => {
    const originalCues = [
      cue({ id: 'cue-1', sourceCueIds: ['raw-1'] }),
      cue({ id: 'cue-2', sourceCueIds: ['raw-2'], startTimeMs: 2400, endTimeMs: 3600 }),
    ];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        cues: [
          cue({ id: 'clean-1', sourceCueIds: ['raw-1'], text: 'Hello world.' }),
          cue({
            id: 'clean-2',
            sourceCueIds: ['raw-1'],
            startTimeMs: 2400,
            endTimeMs: 3600,
            text: 'Hello again.',
          }),
        ],
      }),
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
    expect(result.cues).toEqual(originalCues);
    expect(result.error).toContain('more than one output cue');
  });

  it('accepts a valid merged source cue mapping', async () => {
    const originalCues = [
      cue({ id: 'cue-1', sourceCueIds: ['raw-1'], startTimeMs: 1000, endTimeMs: 2400 }),
      cue({ id: 'cue-2', sourceCueIds: ['raw-2'], startTimeMs: 2400, endTimeMs: 3600 }),
    ];
    const mergedCue = cue({
      id: 'clean-1',
      sourceCueIds: ['cue-1', 'raw-2'],
      startTimeMs: 1000,
      endTimeMs: 3600,
      text: 'Hello world.',
      confidence: 0.95,
    });
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ cues: [mergedCue] }),
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result).toEqual({
      success: true,
      cues: [mergedCue],
      usage: undefined,
    });
  });

  it('does not require an API key for the MediaFlow provider', async () => {
    settingsStoreMock.getLLMApiKey.mockReturnValue('');
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ cues: [cue({ text: 'Hello world.' })] }),
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi([cue()], {
      provider: 'mediaflow',
      model: 'mediaflow-subtitle-cleanup',
    });

    expect(callLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'mediaflow',
      apiKey: '',
      responseMode: 'json',
    }));
    expect(result.success).toBe(true);
  });

  it('returns original cues when a non-MediaFlow provider has no API key', async () => {
    settingsStoreMock.getLLMApiKey.mockReturnValue('');
    const originalCues = [cue()];
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(callLlmMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.cues).toEqual(originalCues);
    expect(result.error).toBe('No API key configured for OpenAI');
  });

  it('loads settings before reading the provider API key', async () => {
    settingsStoreMock.isLoaded = false;
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ cues: [cue({ text: 'Hello world.' })] }),
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    await cleanupSubtitleOcrCuesWithAi([cue()], {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(settingsStoreMock.load).toHaveBeenCalledOnce();
    expect(settingsStoreMock.getLLMApiKey).toHaveBeenCalledWith('openai');
  });

  it.each([
    ['provider error', { content: '', error: 'Provider unavailable' }, 'Provider unavailable'],
    ['truncated response', { content: '{"cues":[]}', truncated: true }, 'AI cleanup response was truncated'],
    ['invalid response', { content: '{"cues":[{"id":"bad"}]}' }, 'Invalid AI cleanup response'],
  ])('returns original cues on %s', async (_caseName, response, expectedError) => {
    const originalCues = [cue()];
    callLlmMock.mockResolvedValue(response);
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
    expect(result.cues).toEqual(originalCues);
    expect(result.error).toContain(expectedError);
  });

  it('returns original cues when cleanup is cancelled', async () => {
    const originalCues = [cue()];
    callLlmMock.mockResolvedValue({ content: '', cancelled: true });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result).toEqual({
      success: false,
      cues: originalCues,
      cancelled: true,
      error: 'AI cleanup cancelled',
    });
  });
});
