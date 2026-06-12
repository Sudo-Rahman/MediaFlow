import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OcrSubtitle } from '$lib/types';

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

function subtitle(overrides: Partial<OcrSubtitle> = {}): OcrSubtitle {
  return {
    id: 'sub-1',
    text: 'original text',
    startTime: 1000,
    endTime: 2000,
    confidence: 0.8,
    ...overrides,
  };
}

function responseCue(id: string, correctedText: string): Record<string, string> {
  return { id, correctedText };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePromptPayload(prompt: string): PromptPayload {
  const startIndex = prompt.indexOf('{');
  const endIndex = prompt.lastIndexOf('}');
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error('Expected prompt to contain JSON payload');
  }

  const parsed: unknown = JSON.parse(prompt.slice(startIndex, endIndex + 1));
  if (!isPromptPayload(parsed)) {
    throw new Error('Expected prompt payload with cues');
  }

  return parsed;
}

describe('video OCR AI cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsStoreMock.isLoaded = true;
    settingsStoreMock.getLLMApiKey.mockReturnValue('test-api-key');
  });

  it('keeps valid initial corrections and retries only missing OCR subtitles', async () => {
    const originalSubtitles = [
      subtitle({ id: 'sub-1', text: 'HeIIo', startTime: 1000, endTime: 2000 }),
      subtitle({ id: 'sub-2', text: 'wor1d', startTime: 2200, endTime: 3200 }),
      subtitle({ id: 'sub-3', text: 'aga1n', startTime: 3400, endTime: 4400 }),
    ];
    callLlmMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          cues: [
            responseCue('sub-1', 'Hello'),
            responseCue('sub-3', 'again'),
          ],
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          cues: [responseCue('sub-2', 'world')],
        }),
        usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
      });
    const { cleanupOcrSubtitlesWithAi } = await import('./ocr-ai-cleanup');

    const result = await cleanupOcrSubtitlesWithAi(originalSubtitles, {
      provider: 'openai',
      model: 'gpt-4o-mini',
      maxGapMs: 250,
    });

    expect(result.success).toBe(true);
    expect(result.subtitles.map((cue) => cue.text)).toEqual(['Hello', 'world', 'again']);
    expect(result.usage).toEqual({ promptTokens: 17, completionTokens: 8, totalTokens: 25 });
    expect(callLlmMock).toHaveBeenCalledTimes(2);

    const secondPrompt = parsePromptPayload(callLlmMock.mock.calls[1][0].userPrompt);
    expect(secondPrompt.cues.map((cue) => cue.id)).toEqual(['sub-2']);
    expect(secondPrompt.contextCues?.map((cue) => cue.id)).not.toContain('sub-2');
    expect(secondPrompt.contextCues?.some((cue) => 'correctedText' in cue)).toBe(false);
  });

  it('keeps original OCR text for cues still unresolved after retries', async () => {
    const originalSubtitles = [
      subtitle({ id: 'sub-1', text: 'HeIIo', startTime: 1000, endTime: 2000 }),
      subtitle({ id: 'sub-2', text: 'original sub-2 text', startTime: 2200, endTime: 3200 }),
    ];
    callLlmMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          cues: [responseCue('sub-1', 'Hello')],
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ cues: [] }),
        usage: { promptTokens: 7, completionTokens: 1, totalTokens: 8 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ cues: [] }),
        usage: { promptTokens: 6, completionTokens: 1, totalTokens: 7 },
      });
    const { cleanupOcrSubtitlesWithAi } = await import('./ocr-ai-cleanup');

    const result = await cleanupOcrSubtitlesWithAi(originalSubtitles, {
      provider: 'openai',
      model: 'gpt-4o-mini',
      maxGapMs: 250,
    });

    expect(result.success).toBe(true);
    expect(result.subtitles.map((cue) => cue.text)).toEqual(['Hello', 'original sub-2 text']);
    expect(result.error).toContain('1 cue(s) remained unchanged');
    expect(callLlmMock).toHaveBeenCalledTimes(3);
  });
});
