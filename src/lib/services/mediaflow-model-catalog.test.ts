import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchMediaFlowModelCatalog,
  parseMediaFlowModelCatalogResponse,
  splitMediaFlowModelCatalog,
} from './mediaflow-model-catalog';

const invokeMock = vi.hoisted(() => vi.fn());
const getMediaFlowAccessTokenMock = vi.hoisted(() => vi.fn());
const refreshMediaFlowSessionMock = vi.hoisted(() => vi.fn());
const settingsStoreMock = vi.hoisted(() => ({
  settings: {
    mediaflowUser: null as { email: string } | null,
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('./mediaflow-auth', () => ({
  getMediaFlowAccessToken: getMediaFlowAccessTokenMock,
  refreshMediaFlowSession: refreshMediaFlowSessionMock,
}));

vi.mock('$lib/stores/settings.svelte', () => ({
  settingsStore: settingsStoreMock,
}));

const validCatalog = {
  object: 'list',
  provider: 'MediaFlow',
  data: [
    { id: 'Lite', label: 'Lite', type: 'chat', capabilities: ['text', 'image'] },
    { id: 'Medium', label: 'Medium', type: 'chat', capabilities: ['text', 'image'] },
    { id: 'High', label: 'High', type: 'chat', capabilities: ['text', 'image'] },
    { id: 'nova-3', label: 'Nova 3', type: 'transcription', capabilities: ['audio'] },
  ],
};

describe('MediaFlow model catalog parsing', () => {
  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue({
      status: 200,
      body: JSON.stringify(validCatalog),
    });
    getMediaFlowAccessTokenMock.mockReset().mockResolvedValue('access-token');
    refreshMediaFlowSessionMock.mockReset().mockResolvedValue('refreshed-token');
    settingsStoreMock.settings.mediaflowUser = null;
  });

  it('accepts the public MediaFlow model catalog shape', () => {
    const parsed = parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify(validCatalog),
    });

    expect(parsed).toEqual(validCatalog);
  });

  it('splits chat and transcription models for UI selectors', () => {
    const parsed = parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify(validCatalog),
    });

    expect(splitMediaFlowModelCatalog(parsed)).toEqual({
      chatModels: [
        { id: 'Lite', name: 'Lite' },
        { id: 'Medium', name: 'Medium' },
        { id: 'High', name: 'High' },
      ],
      imageChatModels: [
        { id: 'Lite', name: 'Lite' },
        { id: 'Medium', name: 'Medium' },
        { id: 'High', name: 'High' },
      ],
      transcriptionModels: [
        { id: 'nova-3', name: 'Nova 3' },
      ],
    });
  });

  it('omits models that do not expose capabilities required by their UI surface', () => {
    const parsed = parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify({
        object: 'list',
        provider: 'MediaFlow',
        data: [
          { id: 'chat-text', label: 'Chat Text', type: 'chat', capabilities: ['text'] },
          { id: 'chat-image', label: 'Chat Image', type: 'chat', capabilities: ['text', 'image'] },
          { id: 'chat-image-only', label: 'Chat Image Only', type: 'chat', capabilities: ['image'] },
          { id: 'chat-video', label: 'Chat Video', type: 'chat', capabilities: ['text', 'video'] },
          { id: 'transcribe-audio', label: 'Transcribe Audio', type: 'transcription', capabilities: ['audio'] },
          { id: 'transcribe-text-only', label: 'Transcribe Text Only', type: 'transcription', capabilities: ['text'] },
        ],
      }),
    });

    expect(splitMediaFlowModelCatalog(parsed)).toEqual({
      chatModels: [
        { id: 'chat-text', name: 'Chat Text' },
        { id: 'chat-image', name: 'Chat Image' },
        { id: 'chat-video', name: 'Chat Video' },
      ],
      imageChatModels: [
        { id: 'chat-image', name: 'Chat Image' },
      ],
      transcriptionModels: [
        { id: 'transcribe-audio', name: 'Transcribe Audio' },
      ],
    });
  });

  it('rejects non-success HTTP responses', () => {
    expect(() => parseMediaFlowModelCatalogResponse({
      status: 503,
      body: JSON.stringify({ error: { message: 'Service unavailable.' } }),
    })).toThrow('MediaFlow model catalog request failed');
  });

  it('rejects catalogs from an unexpected provider', () => {
    expect(() => parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify({ ...validCatalog, provider: 'Other' }),
    })).toThrow('Invalid MediaFlow model catalog');
  });

  it('rejects entries without a public model id', () => {
    expect(() => parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify({
        ...validCatalog,
        data: [{ label: 'Lite', type: 'chat', capabilities: ['text'] }],
      }),
    })).toThrow('Invalid MediaFlow model id');
  });

  it('rejects entries with an unknown model type', () => {
    expect(() => parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify({
        ...validCatalog,
        data: [{ id: 'Lite', label: 'Lite', type: 'embedding', capabilities: ['text'] }],
      }),
    })).toThrow('Invalid MediaFlow model type');
  });

  it('accepts video capabilities for future catalog entries', () => {
    const parsed = parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify({
        ...validCatalog,
        data: [{ id: 'Video', label: 'Video', type: 'chat', capabilities: ['text', 'video'] }],
      }),
    });

    expect(parsed.data[0]?.capabilities).toEqual(['text', 'video']);
  });

  it('rejects entries with unknown capabilities', () => {
    expect(() => parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify({
        ...validCatalog,
        data: [{ id: 'Lite', label: 'Lite', type: 'chat', capabilities: ['realtime'] }],
      }),
    })).toThrow('Invalid MediaFlow model capability');
  });

  it('fetches the v1.1 catalog without a bearer token when no MediaFlow session exists', async () => {
    await expect(fetchMediaFlowModelCatalog()).resolves.toEqual(validCatalog);

    expect(getMediaFlowAccessTokenMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith('fetch_mediaflow_model_catalog', { accessToken: null });
  });

  it('fetches the v1.1 catalog with a bearer token when a MediaFlow session exists', async () => {
    settingsStoreMock.settings.mediaflowUser = { email: 'starter@example.com' };

    await expect(fetchMediaFlowModelCatalog()).resolves.toEqual(validCatalog);

    expect(getMediaFlowAccessTokenMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith('fetch_mediaflow_model_catalog', { accessToken: 'access-token' });
  });

  it('refreshes the MediaFlow session once when an authenticated catalog request returns 401', async () => {
    settingsStoreMock.settings.mediaflowUser = { email: 'starter@example.com' };
    invokeMock
      .mockResolvedValueOnce({
        status: 401,
        body: JSON.stringify({ error: { code: 'invalid_token', message: 'Invalid or expired token.' } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify(validCatalog),
      });

    await expect(fetchMediaFlowModelCatalog()).resolves.toEqual(validCatalog);

    expect(refreshMediaFlowSessionMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fetch_mediaflow_model_catalog', { accessToken: 'access-token' });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fetch_mediaflow_model_catalog', { accessToken: 'refreshed-token' });
  });

  it('falls back to the unauthenticated catalog when session refresh fails after a 401', async () => {
    settingsStoreMock.settings.mediaflowUser = { email: 'starter@example.com' };
    refreshMediaFlowSessionMock.mockRejectedValueOnce(new Error('No MediaFlow refresh token is available.'));
    invokeMock
      .mockResolvedValueOnce({
        status: 401,
        body: JSON.stringify({ error: { code: 'invalid_token', message: 'Invalid or expired token.' } }),
      })
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify(validCatalog),
      });

    await expect(fetchMediaFlowModelCatalog()).resolves.toEqual(validCatalog);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'fetch_mediaflow_model_catalog', { accessToken: 'access-token' });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'fetch_mediaflow_model_catalog', { accessToken: null });
  });

  it('accepts the Starter-filtered catalog without the High chat model', () => {
    const parsed = parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify({
        ...validCatalog,
        data: validCatalog.data.filter((model) => model.id !== 'High'),
      }),
    });

    expect(splitMediaFlowModelCatalog(parsed).chatModels).toEqual([
      { id: 'Lite', name: 'Lite' },
      { id: 'Medium', name: 'Medium' },
    ]);
  });
});
