import {
  fetchMediaFlowModelCatalog,
  splitMediaFlowModelCatalog,
  type MediaFlowPublicModel,
} from '$lib/services/mediaflow-model-catalog';
import type { ProviderModel } from '$lib/types';

export type MediaFlowModelCatalogStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

let status = $state<MediaFlowModelCatalogStatus>('idle');
let error = $state<string | null>(null);
let models = $state.raw<MediaFlowPublicModel[]>([]);
let hasLoaded = false;
let loadPromise: Promise<void> | null = null;

function errorToMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function loadCatalog(force: boolean): Promise<void> {
  if (!force && hasLoaded) {
    return;
  }

  if (loadPromise) {
    return loadPromise;
  }

  status = 'loading';
  error = null;

  loadPromise = (async () => {
    try {
      const catalog = await fetchMediaFlowModelCatalog();
      models = catalog.data;
      status = catalog.data.length > 0 ? 'ready' : 'unavailable';
    } catch (loadError) {
      models = [];
      error = errorToMessage(loadError);
      status = 'unavailable';
    } finally {
      hasLoaded = true;
      loadPromise = null;
    }
  })();

  return loadPromise;
}

export const mediaflowModelCatalogStore = {
  get status(): MediaFlowModelCatalogStatus {
    return status;
  },

  get error(): string | null {
    return error;
  },

  get models(): readonly MediaFlowPublicModel[] {
    return models;
  },

  get chatModels(): readonly ProviderModel[] {
    return splitMediaFlowModelCatalog({ object: 'list', provider: 'MediaFlow', data: models }).chatModels;
  },

  get imageChatModels(): readonly ProviderModel[] {
    return splitMediaFlowModelCatalog({ object: 'list', provider: 'MediaFlow', data: models }).imageChatModels;
  },

  get transcriptionModels(): readonly ProviderModel[] {
    return splitMediaFlowModelCatalog({ object: 'list', provider: 'MediaFlow', data: models }).transcriptionModels;
  },

  get hasChatModels(): boolean {
    return this.chatModels.length > 0;
  },

  get hasTranscriptionModels(): boolean {
    return this.transcriptionModels.length > 0;
  },

  loadOnce(): Promise<void> {
    return loadCatalog(false);
  },

  reload(): Promise<void> {
    hasLoaded = false;
    return loadCatalog(true);
  },
};
