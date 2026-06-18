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

  it('normalizes MediaFlow LLM API errors for users and logs structured context', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'llm_complete') {
        return Promise.resolve({
          content: '',
          error: 'MediaFlow: Rate limit exceeded. (rate_limit_exceeded)',
          errorCode: 'rate_limit_exceeded',
          errorMessage: 'Rate limit exceeded.',
          requestId: 'req_rate',
          technicalError: JSON.stringify({
            error: {
              code: 'rate_limit_exceeded',
              message: 'Rate limit exceeded.',
              request_id: 'req_rate',
            },
          }),
          retryable: true,
          retryAfter: 60_000,
          status: 429,
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
      logSource: 'translation',
    });

    expect(result.error).toBe('MediaFlow rate limit reached. Wait a moment, then retry.');
    expect(result.errorCode).toBe('rate_limit_exceeded');
    expect(result.requestId).toBe('req_rate');
    expect(result.technicalError).toContain('rate_limit_exceeded');
    expect(addLogMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning',
      source: 'translation',
      title: 'MediaFlow rate limit reached',
      details: expect.stringContaining('What to do: Wait a moment, then retry.'),
      context: expect.objectContaining({
        provider: 'mediaflow',
        apiStatus: '429',
        apiCode: 'rate_limit_exceeded',
        requestId: 'req_rate',
        retryAfter: '60000',
        userAction: 'Wait a moment, then retry.',
        technicalDetails: 'Rate limit exceeded.',
      }),
    }));
    expect(scheduleUsageRefreshMock).not.toHaveBeenCalled();
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

  it('normalizes MediaFlow transcription API errors', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'acquire_sleep_inhibit') {
        return Promise.resolve(1);
      }
      if (command === 'transcribe_mediaflow_audio_file') {
        return Promise.resolve({
          status: 429,
          body: JSON.stringify({
            error: {
              code: 'free_daily_limit_exceeded',
              message: 'Free daily usage limit exceeded.',
              request_id: 'req_daily',
            },
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
      error: 'Free daily MediaFlow usage is exhausted. Try again after the daily reset or upgrade.',
    });
    expect(addLogMock).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      source: 'mediaflow',
      title: 'Free daily usage exhausted',
      details: expect.stringContaining('What to do: Try again after the daily reset or upgrade.'),
      context: expect.objectContaining({
        filePath: '/tmp/audio.opus',
        provider: 'mediaflow',
        apiStatus: '429',
        apiCode: 'free_daily_limit_exceeded',
        requestId: 'req_daily',
        userAction: 'Try again after the daily reset or upgrade.',
        technicalDetails: 'Free daily usage limit exceeded.',
      }),
    }));
  });
});
