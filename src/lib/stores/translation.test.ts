import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderModel } from '$lib/types';

const mediaflowModelCatalogStoreMock = vi.hoisted(() => ({
  chatModels: [] as ProviderModel[],
}));

vi.mock('./mediaflow-model-catalog.svelte', () => ({
  mediaflowModelCatalogStore: mediaflowModelCatalogStoreMock,
}));

async function loadTranslationStore(chatModels: ProviderModel[]) {
  vi.resetModules();
  mediaflowModelCatalogStoreMock.chatModels = chatModels;
  const { translationStore } = await import('./translation.svelte');
  translationStore.reset();
  return translationStore;
}

describe('translationStore model reconciliation', () => {
  beforeEach(() => {
    mediaflowModelCatalogStoreMock.chatModels = [];
  });

  it('normalizes the primary MediaFlow model and prunes unavailable compare models', async () => {
    const translationStore = await loadTranslationStore([
      { id: 'Lite', name: 'Lite' },
      { id: 'High', name: 'High' },
    ]);

    translationStore.setProvider('mediaflow');
    translationStore.setModel('High');
    translationStore.setModels([
      { id: 'compare-lite', provider: 'mediaflow', model: 'Lite' },
      { id: 'compare-high', provider: 'mediaflow', model: 'High' },
    ]);

    mediaflowModelCatalogStoreMock.chatModels = [{ id: 'Lite', name: 'Lite' }];
    translationStore.reconcileAvailableModels();

    expect(translationStore.config.provider).toBe('mediaflow');
    expect(translationStore.config.model).toBe('Lite');
    expect(translationStore.config.models).toEqual([
      { id: 'compare-lite', provider: 'mediaflow', model: 'Lite' },
    ]);
  });
});
