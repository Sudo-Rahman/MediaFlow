import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMediaFlowApiMock = vi.hoisted(() => vi.fn());
const fetchMediaFlowBillableApiMock = vi.hoisted(() => vi.fn());
const getMediaFlowAccessTokenMock = vi.hoisted(() => vi.fn());
const getMediaFlowBaseUrlMock = vi.hoisted(() => vi.fn());
const refreshMediaFlowSessionMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const addLogMock = vi.hoisted(() => vi.fn());
const scheduleUsageRefreshMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/services/mediaflow-auth', () => ({
  fetchMediaFlowApi: fetchMediaFlowApiMock,
  getMediaFlowAccessToken: getMediaFlowAccessTokenMock,
  getMediaFlowBaseUrl: getMediaFlowBaseUrlMock,
  refreshMediaFlowSession: refreshMediaFlowSessionMock,
}));

vi.mock('$lib/services/mediaflow-billing', () => ({
  fetchMediaFlowBillableApi: fetchMediaFlowBillableApiMock,
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
    fetchMediaFlowApiMock.mockReset();
    fetchMediaFlowBillableApiMock.mockReset();
    getMediaFlowAccessTokenMock.mockReset().mockResolvedValue('access-token');
    getMediaFlowBaseUrlMock.mockReset().mockReturnValue('http://localhost:5173');
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
    fetchMediaFlowBillableApiMock.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }), { status: 200 }));

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
    expect(fetchMediaFlowBillableApiMock).toHaveBeenCalledWith('/api/v1/chat/completions', expect.objectContaining({
      method: 'POST',
    }));
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
      url: expect.stringContaining('/api/v1/audio/transcriptions'),
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
