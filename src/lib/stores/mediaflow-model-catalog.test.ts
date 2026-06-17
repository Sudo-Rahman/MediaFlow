import { describe, expect, it, vi } from 'vitest';

import { mediaflowModelCatalogStore } from './mediaflow-model-catalog.svelte';

const fetchMediaFlowModelCatalogMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/services/mediaflow-model-catalog', () => ({
  fetchMediaFlowModelCatalog: fetchMediaFlowModelCatalogMock,
  splitMediaFlowModelCatalog: (catalog: {
    data: Array<{ id: string; label: string; type: string; capabilities: string[] }>;
  }) => ({
    chatModels: catalog.data
      .filter((model) => model.type === 'chat' && model.capabilities.includes('text'))
      .map((model) => ({ id: model.id, name: model.label })),
    imageChatModels: catalog.data
      .filter((model) => (
        model.type === 'chat' &&
        model.capabilities.includes('text') &&
        model.capabilities.includes('image')
      ))
      .map((model) => ({ id: model.id, name: model.label })),
    transcriptionModels: catalog.data
      .filter((model) => model.type === 'transcription' && model.capabilities.includes('audio'))
      .map((model) => ({ id: model.id, name: model.label })),
  }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function catalog(id: string) {
  return {
    object: 'list' as const,
    provider: 'MediaFlow' as const,
    data: [
      { id, label: id, type: 'chat' as const, capabilities: ['text' as const] },
    ],
  };
}

describe('mediaflowModelCatalogStore', () => {
  it('runs a queued reload after the current load finishes', async () => {
    const first = deferred<ReturnType<typeof catalog>>();
    const second = deferred<ReturnType<typeof catalog>>();
    fetchMediaFlowModelCatalogMock
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const initialLoad = mediaflowModelCatalogStore.loadOnce();
    expect(fetchMediaFlowModelCatalogMock).toHaveBeenCalledTimes(1);

    const reload = mediaflowModelCatalogStore.reload();
    first.resolve(catalog('Lite'));
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMediaFlowModelCatalogMock).toHaveBeenCalledTimes(2);

    second.resolve(catalog('Medium'));
    await Promise.all([initialLoad, reload]);

    expect(mediaflowModelCatalogStore.chatModels).toEqual([{ id: 'Medium', name: 'Medium' }]);
  });
});
