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

interface PromptCue {
  id: string;
  text: string;
}

interface PromptContextCue extends PromptCue {
  correctedText?: string;
  position: 'before' | 'after';
  spanIndex: number;
}

interface PromptPayload {
  cues: PromptCue[];
  contextCues?: PromptContextCue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPromptCue(value: unknown): value is PromptCue {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.text === 'string';
}

function isPromptContextCue(value: unknown): value is PromptContextCue {
  return isRecord(value)
    && isPromptCue(value)
    && (value.position === 'before' || value.position === 'after')
    && typeof value.spanIndex === 'number';
}

function isPromptPayload(value: unknown): value is PromptPayload {
  if (!isRecord(value) || !Array.isArray(value.cues) || !value.cues.every(isPromptCue)) {
    return false;
  }

  return value.contextCues === undefined
    || (Array.isArray(value.contextCues) && value.contextCues.every(isPromptContextCue));
}

function parsePromptPayload(prompt: string): PromptPayload {
  const startIndex = prompt.lastIndexOf('\n{');
  const endIndex = prompt.lastIndexOf('}');
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex + 1) {
    throw new Error('Expected prompt to contain JSON payload');
  }

  const parsed: unknown = JSON.parse(prompt.slice(startIndex + 1, endIndex + 1));
  if (!isPromptPayload(parsed)) {
    throw new Error('Expected prompt payload with cues');
  }

  return parsed;
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

  it('keeps top placement when merged duplicate sources have top majority', async () => {
    const originalCues = [
      cue({
        id: 'cue-1',
        sourceCueIds: ['raw-1'],
        startTimeMs: 1000,
        endTimeMs: 2000,
        text: 'HeIIo',
        confidence: 0.6,
        placement: 'top',
      }),
      cue({
        id: 'cue-2',
        sourceCueIds: ['raw-2'],
        startTimeMs: 2100,
        endTimeMs: 3000,
        text: 'Hello',
        confidence: 0.8,
        placement: 'bottom',
      }),
      cue({
        id: 'cue-3',
        sourceCueIds: ['raw-3'],
        startTimeMs: 3100,
        endTimeMs: 3600,
        text: 'Hello',
        confidence: 0.7,
        placement: 'top',
      }),
    ];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        cues: [
          responseCue('0', 'Hello'),
          responseCue('1', 'Hello'),
          responseCue('2', 'Hello'),
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
          sourceCueIds: ['raw-1', 'raw-2', 'raw-3'],
          startTimeMs: 1000,
          endTimeMs: 3600,
          text: 'Hello',
          confidence: 0.8,
          placement: 'top',
          placementSourceCount: 3,
          topPlacementSourceCount: 2,
        },
      ],
      usage: undefined,
    });
  });

  it('uses placement source counts when merging an already stabilized duplicate cue', async () => {
    const originalCues = [
      cue({
        id: 'cue-1',
        sourceCueIds: ['raw-1', 'raw-2'],
        startTimeMs: 1000,
        endTimeMs: 3000,
        text: 'Hello',
        confidence: 0.8,
        placement: 'bottom',
        placementSourceCount: 2,
        topPlacementSourceCount: 1,
      }),
      cue({
        id: 'cue-2',
        sourceCueIds: ['raw-3'],
        startTimeMs: 3100,
        endTimeMs: 3600,
        text: 'Hello',
        confidence: 0.7,
        placement: 'top',
        placementSourceCount: 1,
        topPlacementSourceCount: 1,
      }),
    ];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({
        cues: [
          responseCue('0', 'Hello'),
          responseCue('1', 'Hello'),
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
          sourceCueIds: ['raw-1', 'raw-2', 'raw-3'],
          startTimeMs: 1000,
          endTimeMs: 3600,
          text: 'Hello',
          confidence: 0.8,
          placement: 'top',
          placementSourceCount: 3,
          topPlacementSourceCount: 2,
        },
      ],
      usage: undefined,
    });
  });

  it('keeps valid initial corrections and retries only omitted short cue IDs', async () => {
    const originalCues = [
      cue({ id: 'cue-1', sourceCueIds: ['raw-1'], text: 'HeIIo' }),
      cue({ id: 'cue-2', sourceCueIds: ['raw-2'], text: 'wor1d' }),
      cue({ id: 'cue-3', sourceCueIds: ['raw-3'], text: 'aga1n' }),
    ];
    callLlmMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          cues: [
            responseCue('0', 'Hello'),
            responseCue('2', 'again'),
          ],
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          cues: [responseCue('1', 'world')],
        }),
        usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
      });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(true);
    expect(result.cues.map((resultCue) => resultCue.text)).toEqual(['Hello', 'world', 'again']);
    expect(result.usage).toEqual({ promptTokens: 17, completionTokens: 8, totalTokens: 25 });
    expect(callLlmMock).toHaveBeenCalledTimes(2);

    const retryPrompt = parsePromptPayload(callLlmMock.mock.calls[1][0].userPrompt);
    expect(retryPrompt.cues.map((promptCue) => promptCue.id)).toEqual(['1']);
    expect(retryPrompt.contextCues?.map((promptCue) => promptCue.id)).not.toContain('1');
    expect(retryPrompt.contextCues?.map((promptCue) => promptCue.id)).toEqual(['0', '2']);
    expect(retryPrompt.contextCues?.some((promptCue) => 'correctedText' in promptCue)).toBe(false);
  });

  it('keeps corrected cues and original text for cues still unresolved after retries', async () => {
    const originalCues = [cue({ id: 'cue-1' }), cue({ id: 'cue-2' })];
    callLlmMock
      .mockResolvedValueOnce({
        content: JSON.stringify({ cues: [responseCue('0', 'Hello world.')] }),
        usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ cues: [] }),
        usage: { promptTokens: 4, completionTokens: 1, totalTokens: 5 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ cues: [] }),
        usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
      });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(true);
    expect(result.cues.map((resultCue) => resultCue.text)).toEqual(['Hello world.', 'HeIIo wor1d']);
    expect(result.error).toContain('1 cue(s) remained unchanged');
    expect(result.usage).toEqual({ promptTokens: 15, completionTokens: 4, totalTokens: 19 });
    expect(callLlmMock).toHaveBeenCalledTimes(3);
  });

  it('keeps valid initial Subtitle OCR corrections when another cue is malformed', async () => {
    const originalCues = [
      cue({ id: 'cue-1', text: 'HeIIo' }),
      cue({ id: 'cue-2', text: 'wor1d' }),
    ];
    callLlmMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          cues: [
            responseCue('0', 'Hello'),
            { id: '1' },
          ],
        }),
        usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ cues: [responseCue('1', 'world')] }),
        usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
      });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(true);
    expect(result.cues.map((resultCue) => resultCue.text)).toEqual(['Hello', 'world']);
    expect(callLlmMock).toHaveBeenCalledTimes(2);

    const retryPrompt = parsePromptPayload(callLlmMock.mock.calls[1][0].userPrompt);
    expect(retryPrompt.cues.map((promptCue) => promptCue.id)).toEqual(['1']);
  });

  it('stops retrying Subtitle OCR cleanup cues after a truncated retry response', async () => {
    const originalCues = [cue({ id: 'cue-1', text: 'HeIIo' })];
    callLlmMock
      .mockResolvedValueOnce({
        content: JSON.stringify({ cues: [] }),
        usage: { promptTokens: 8, completionTokens: 1, totalTokens: 9 },
      })
      .mockResolvedValueOnce({
        content: '{"cues":[]}',
        truncated: true,
        usage: { promptTokens: 6, completionTokens: 2, totalTokens: 8 },
      });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
    expect(result.cues.map((resultCue) => resultCue.text)).toEqual(['HeIIo']);
    expect(result.error).toContain('response truncated');
    expect(callLlmMock).toHaveBeenCalledTimes(2);
  });

  it('keeps accepted Subtitle OCR cleanup corrections when a retry response is truncated', async () => {
    const originalCues = [
      cue({ id: 'cue-1', text: 'HeIIo' }),
      cue({ id: 'cue-2', text: 'wor1d' }),
    ];
    callLlmMock
      .mockResolvedValueOnce({
        content: JSON.stringify({ cues: [responseCue('0', 'Hello')] }),
        usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
      })
      .mockResolvedValueOnce({
        content: '{"cues":[]}',
        truncated: true,
        usage: { promptTokens: 6, completionTokens: 2, totalTokens: 8 },
      });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(true);
    expect(result.cues.map((resultCue) => resultCue.text)).toEqual(['Hello', 'wor1d']);
    expect(result.error).toContain('response truncated');
    expect(callLlmMock).toHaveBeenCalledTimes(2);
  });

  it('recovers an initial provider error with retry corrections', async () => {
    const originalCues = [
      cue({ id: 'cue-1', sourceCueIds: ['raw-1'], text: 'HeIIo' }),
      cue({ id: 'cue-2', sourceCueIds: ['raw-2'], text: 'wor1d' }),
    ];
    callLlmMock
      .mockResolvedValueOnce({
        content: '',
        error: 'Provider unavailable',
        usage: { promptTokens: 6, completionTokens: 0, totalTokens: 6 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          cues: [
            responseCue('0', 'Hello'),
            responseCue('1', 'world'),
          ],
        }),
        usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
      });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(true);
    expect(result.cues.map((resultCue) => resultCue.text)).toEqual(['Hello', 'world']);
    expect(result.error).toContain('Provider unavailable');
    expect(result.usage).toEqual({ promptTokens: 13, completionTokens: 3, totalTokens: 16 });
    expect(callLlmMock).toHaveBeenCalledTimes(2);

    const retryPrompt = parsePromptPayload(callLlmMock.mock.calls[1][0].userPrompt);
    expect(retryPrompt.cues.map((promptCue) => promptCue.id)).toEqual(['0', '1']);
  });

  it('recovers an initial invalid JSON response with retry corrections', async () => {
    const originalCues = [cue({ id: 'cue-1', text: 'HeIIo' })];
    callLlmMock
      .mockResolvedValueOnce({
        content: '{"cues":[{"id":"0","correctedText":"bad"}]',
        usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ cues: [responseCue('0', 'Hello')] }),
        usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
      });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(true);
    expect(result.cues.map((resultCue) => resultCue.text)).toEqual(['Hello']);
    expect(result.error).toContain('Invalid AI cleanup response');
    expect(result.usage).toEqual({ promptTokens: 9, completionTokens: 4, totalTokens: 13 });
    expect(callLlmMock).toHaveBeenCalledTimes(2);
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

  it('returns an empty successful result when AI deletes every cue from non-empty input', async () => {
    const originalCues = [cue()];
    callLlmMock.mockResolvedValue({
      content: JSON.stringify({ cues: [responseCue('0', '')] }),
    });
    const { cleanupSubtitleOcrCuesWithAi } = await import('./subtitle-ocr-ai-cleanup');

    const result = await cleanupSubtitleOcrCuesWithAi(originalCues, {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(true);
    expect(result.cues).toEqual([]);
    expect(result.error).toBeUndefined();
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
