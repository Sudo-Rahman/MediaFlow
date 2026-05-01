import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMediaFlowAccessTokenMock = vi.hoisted(() => vi.fn());
const refreshMediaFlowSessionMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const addLogMock = vi.hoisted(() => vi.fn());
const scheduleUsageRefreshMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/services/mediaflow-auth', () => ({
  getMediaFlowAccessToken: getMediaFlowAccessTokenMock,
  refreshMediaFlowSession: refreshMediaFlowSessionMock,
}));

vi.mock('$lib/stores/logs.svelte', () => ({
  logStore: {
    addLog: addLogMock,
  },
}));

vi.mock('$lib/stores/mediaflow-usage.svelte', () => ({
  mediaflowUsageStore: {
    scheduleRefresh: scheduleUsageRefreshMock,
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

describe('MediaFlow provider adapters', () => {
  beforeEach(() => {
    getMediaFlowAccessTokenMock.mockReset().mockResolvedValue('access-token');
    refreshMediaFlowSessionMock.mockReset().mockResolvedValue('refreshed-token');
    invokeMock.mockReset().mockImplementation((command: string) => {
      if (command === 'acquire_sleep_inhibit') {
        return Promise.resolve(1);
      }
      return Promise.resolve(null);
    });
    addLogMock.mockReset();
    scheduleUsageRefreshMock.mockReset();
  });

  it('maps a MediaFlow chat completion response to the internal LLM shape', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'llm_complete') {
        return Promise.resolve({
          content: '{"ok":true}',
          finishReason: 'stop',
          truncated: false,
          usage: {
            promptTokens: 11,
            completionTokens: 7,
            totalTokens: 18,
          },
        });
      }
      if (command === 'acquire_sleep_inhibit') {
        return Promise.resolve(1);
      }
      return Promise.resolve(null);
    });

    const { callLlm } = await import('../src/lib/services/llm-client');
    const result = await callLlm({
      provider: 'mediaflow',
      apiKey: '',
      model: 'Lite',
      systemPrompt: 'Return JSON.',
      userPrompt: 'Ping',
      responseMode: 'json',
    });

    expect(result).toEqual({
      content: '{"ok":true}',
      finishReason: 'stop',
      truncated: false,
      usage: {
        promptTokens: 11,
        completionTokens: 7,
        totalTokens: 18,
      },
    });
    expect(invokeMock).toHaveBeenCalledWith('llm_complete', {
      requestId: expect.stringMatching(/^llm-mediaflow-/),
      request: expect.objectContaining({
        provider: 'mediaflow',
        model: 'Lite',
        mediaflowAccessToken: 'access-token',
      }),
    });
    expect(scheduleUsageRefreshMock).toHaveBeenCalled();
  });

  it('refreshes MediaFlow session once when Rust LLM call returns 401', async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === 'llm_complete') {
        const request = (args as { request?: { mediaflowAccessToken?: string } }).request;
        if (request?.mediaflowAccessToken === 'access-token') {
          return Promise.resolve({
            content: '',
            error: 'MediaFlow: Invalid API key or authentication failed',
            retryable: false,
            status: 401,
          });
        }

        return Promise.resolve({
          content: '{"ok":true}',
          finishReason: 'stop',
          truncated: false,
        });
      }
      return Promise.resolve(null);
    });

    const { callLlm } = await import('../src/lib/services/llm-client');
    const result = await callLlm({
      provider: 'mediaflow',
      apiKey: '',
      model: 'Lite',
      systemPrompt: 'Return JSON.',
      userPrompt: 'Ping',
      responseMode: 'json',
    });

    expect(result.content).toBe('{"ok":true}');
    expect(refreshMediaFlowSessionMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith('llm_complete', expect.objectContaining({
      request: expect.objectContaining({ mediaflowAccessToken: 'refreshed-token' }),
    }));
    expect(scheduleUsageRefreshMock).toHaveBeenCalled();
  });

  it('maps a MediaFlow transcription response to the internal transcription result', async () => {
    const config = {
      model: 'nova-3' as const,
      language: 'multi',
      punctuate: true,
      paragraphs: true,
      smartFormat: true,
      utterances: true,
      uttSplit: 0.8,
      diarize: false,
    };

    invokeMock.mockImplementation((command: string) => {
      if (command === 'acquire_sleep_inhibit') {
        return Promise.resolve(1);
      }
      if (command === 'transcribe_mediaflow_audio_file') {
        return Promise.resolve({
          status: 200,
          body: JSON.stringify({
            transcript: 'hello world',
            words: [
              { word: 'hello', punctuated_word: 'hello', start: 0, end: 0.4, confidence: 0.99 },
              { word: 'world', punctuated_word: 'world', start: 0.5, end: 0.9, confidence: 0.98 },
            ],
            metadata: { request_id: 'dg_1', duration: 1.2 },
          }),
        });
      }
      return Promise.resolve(null);
    });

    const { transcribeWithMediaFlow } = await import('../src/lib/services/mediaflow-transcription');
    const result = await transcribeWithMediaFlow({
      audioPath: '/tmp/audio.opus',
      config,
    });

    expect(result.success).toBe(true);
    expect(result.result?.transcript).toBe('hello world');
    expect(invokeMock).toHaveBeenCalledWith('transcribe_mediaflow_audio_file', expect.objectContaining({
      audioPath: '/tmp/audio.opus',
      config,
      accessToken: 'access-token',
    }));
    expect(scheduleUsageRefreshMock).toHaveBeenCalled();
  });

  it('rejects empty MediaFlow transcription responses instead of creating blank versions', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'acquire_sleep_inhibit') {
        return Promise.resolve(1);
      }
      if (command === 'transcribe_mediaflow_audio_file') {
        return Promise.resolve({
          status: 200,
          body: JSON.stringify({
            transcript: '',
            words: [],
            metadata: { request_id: 'dg_empty', duration: 840 },
          }),
        });
      }
      return Promise.resolve(null);
    });

    const { transcribeWithMediaFlow } = await import('../src/lib/services/mediaflow-transcription');
    const result = await transcribeWithMediaFlow({
      audioPath: '/tmp/audio.opus',
      config: {
        model: 'nova-3',
        language: 'multi',
        punctuate: true,
        paragraphs: true,
        smartFormat: true,
        utterances: true,
        uttSplit: 0.8,
        diarize: false,
      },
    });

    expect(result).toEqual({
      success: false,
      error: 'MediaFlow returned an empty transcription. Check server Deepgram response logs.',
    });
    expect(addLogMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      source: 'mediaflow',
      title: 'MediaFlow transcription returned no text',
    }));
  });
});
