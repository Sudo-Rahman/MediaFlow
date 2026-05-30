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

function responseCue(id: string, correctedText: unknown): Record<string, unknown> {
  return { id, correctedText };
}

function lastLlmUserPrompt(): string {
  const request = callLlmMock.mock.calls.at(-1)?.[0];
  if (!request || typeof request.userPrompt !== 'string') {
    throw new Error('Expected callLlm to receive a userPrompt');
  }

  return request.userPrompt;
}

describe('subtitle OCR AI cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsStoreMock.isLoaded = true;
    settingsStoreMock.getLLMApiKey.mockReturnValue('test-api-key');
  });

  it('builds a minimal prompt with short IDs and text only', async () => {
    const { buildSubtitleOcrCleanupPrompt } = await import('./subtitle-ocr-ai-cleanup');
    const longId = 'subtitle-ocr-vobsub-%2FUsers%2Fsr-71%2FDownloads%2FX.The.Movie.DVDivX-SChiZO.idx-cue-1';

    const prompt = buildSubtitleOcrCleanupPrompt([
      cue({
        id: longId,
        sourceCueIds: [`${longId}-raw`],
        text: 'Go to Tokyo, Kamul.',
      }),
    ]);

    expect(prompt).toContain('Do not translate');
    expect(prompt).toContain('Do not merge, split, or reorder cues');
    expect(prompt).toContain('"id":"0"');
    expect(prompt).toContain('"text":"Go to Tokyo, Kamul."');
    expect(prompt).not.toContain(longId);
    expect(prompt).not.toContain('sourceCueIds');
    expect(prompt).not.toContain('startTimeMs');
    expect(prompt).not.toContain('endTimeMs');
    expect(prompt).not.toContain('confidence');
  });

  it('keeps prompt size proportional to subtitle text instead of internal cue metadata', async () => {
    const { buildSubtitleOcrCleanupPrompt } = await import('./subtitle-ocr-ai-cleanup');
    const longPrefix = 'subtitle-ocr-vobsub-%2FUsers%2Fsr-71%2FDownloads%2FMovie.idx%3A%3A%2FUsers%2Fsr-71%2FDownloads%2FMovie.sub';
    const cues = Array.from({ length: 25 }, (_value, index) => cue({
      id: `${longPrefix}-cue-${index + 1}`,
      sourceCueIds: [`${longPrefix}-raw-${index + 1}`],
      startTimeMs: index * 1000,
      endTimeMs: (index + 1) * 1000,
      text: `Subtitle text ${index + 1}`,
      confidence: 0.9,
    }));

    const prompt = buildSubtitleOcrCleanupPrompt(cues);

    expect(prompt.length).toBeLessThan(5000);
    expect(prompt).not.toContain(longPrefix);
    expect(prompt).not.toContain('sourceCueIds');
    expect(prompt).not.toContain('startTimeMs');
  });

  it('calls the LLM with the minimal payload and reconstructs corrected cues locally', async () => {
    const originalCues = [
      cue({
        id: 'subtitle-ocr-vobsub-%2FUsers%2Fsr-71%2FDownloads%2FX.idx-cue-1',
        sourceCueIds: ['raw-1', 'raw-2'],
        startTimeMs: 1000,
        endTimeMs: 2400,
        text: 'HeIIo wor1d',
        confidence: 0.72,
      }),
      cue({
        id: 'subtitle-ocr-vobsub-%2FUsers%2Fsr-71%2FDownloads%2FX.idx-cue-2',
        sourceCueIds: ['raw-3'],
        startTimeMs: 2500,
        endTimeMs: 3600,
        text: 'Noise artifact',
        confidence: 0.41,
      }),
    ];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        cues: [
          responseCue('0', 'Hello world.'),
          responseCue('1', 'Noise artifact corrected'),
        ],
      }),
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
    expect(lastLlmUserPrompt()).toContain('"id":"0"');
    expect(lastLlmUserPrompt()).not.toContain(originalCues[0].id);
    expect(result).toEqual({
      success: true,
      cues: [
        { ...originalCues[0], sourceCueIds: ['raw-1', 'raw-2'], text: 'Hello world.' },
        { ...originalCues[1], sourceCueIds: ['raw-3'], text: 'Noise artifact corrected' },
      ],
      usage: { promptTokens: 10, completionTokens: 6, totalTokens: 16 },
    });
  });

  it('drops empty corrected cues and merges adjacent duplicates locally', async () => {
    const originalCues = [
      cue({
        id: 'cue-1',
        sourceCueIds: ['raw-1'],
        startTimeMs: 1000,
        endTimeMs: 2000,
        text: 'HeIIo',
        confidence: 0.6,
      }),
      cue({
        id: 'cue-2',
        sourceCueIds: ['raw-2'],
        startTimeMs: 2100,
        endTimeMs: 3000,
        text: 'Hello',
        confidence: 0.8,
      }),
      cue({
        id: 'cue-3',
        sourceCueIds: ['raw-3'],
        startTimeMs: 3100,
        endTimeMs: 3600,
        text: 'OCR noise',
        confidence: 0.3,
      }),
    ];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        cues: [
          responseCue('0', 'Hello'),
          responseCue('1', 'Hello'),
          responseCue('2', ''),
        ],
      }),
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result).toEqual({
      success: true,
      cues: [
        {
          id: 'cue-1',
          sourceCueIds: ['raw-1', 'raw-2'],
          startTimeMs: 1000,
          endTimeMs: 3000,
          text: 'Hello',
          confidence: 0.8,
        },
      ],
      usage: undefined,
    });
  });

  it('returns original cues when AI omits corrected cues', async () => {
    const originalCues = [cue({ id: 'cue-1' }), cue({ id: 'cue-2' })];
    const usage = { promptTokens: 8, completionTokens: 2, totalTokens: 10 };
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ cues: [responseCue('0', 'Hello world.')] }),
      usage,
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
    expect(result.cues).toEqual(originalCues);
    expect(result.error).toContain('missing corrected cues');
    expect(result.usage).toEqual(usage);
  });

  it('returns original cues when AI invents a short cue ID', async () => {
    const originalCues = [cue({ id: 'cue-1' })];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ cues: [responseCue('not-requested', 'Hello world.')] }),
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
    expect(result.cues).toEqual(originalCues);
    expect(result.error).toContain('unknown cue ID');
  });

  it('returns original cues when AI duplicates a short cue ID', async () => {
    const originalCues = [cue({ id: 'cue-1' })];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        cues: [
          responseCue('0', 'Hello world.'),
          responseCue('0', 'Hello again.'),
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
    expect(result.error).toContain('duplicate cue ID');
  });

  it('returns original cues when AI returns a non-string corrected text', async () => {
    const originalCues = [cue()];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ cues: [responseCue('0', 123)] }),
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
    expect(result.cues).toEqual(originalCues);
    expect(result.error).toContain('Invalid AI cleanup response');
  });

  it('returns original cues when AI deletes every cue from non-empty input', async () => {
    const originalCues = [cue()];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ cues: [responseCue('0', '')] }),
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
    expect(result.cues).toEqual(originalCues);
    expect(result.error).toContain('returned no cues');
  });

  it('does not require an API key for the MediaFlow provider', async () => {
    settingsStoreMock.getLLMApiKey.mockReturnValue('');
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ cues: [responseCue('0', 'Hello world.')] }),
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
      content: JSON.stringify({ cues: [responseCue('0', 'Hello world.')] }),
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
    ['invalid JSON response', { content: '{"cues":[{"id":"0","correctedText":"bad"}]' }, 'Invalid AI cleanup response'],
    ['invalid response shape', { content: '{"cues":[{"id":"0"}]}' }, 'Invalid AI cleanup response'],
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
