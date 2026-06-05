import { invoke } from '@tauri-apps/api/core';

import type { ProviderModel } from '$lib/types';

export type MediaFlowPublicModelType = 'chat' | 'transcription';
export type MediaFlowPublicModelCapability = 'text' | 'image' | 'audio';

export interface MediaFlowPublicModel {
  id: string;
  label: string;
  type: MediaFlowPublicModelType;
  capabilities: MediaFlowPublicModelCapability[];
}

export interface MediaFlowModelCatalog {
  object: 'list';
  provider: 'MediaFlow';
  data: MediaFlowPublicModel[];
}

export interface MediaFlowHttpResponse {
  status: number;
  body: string;
}

export interface SplitMediaFlowModelCatalog {
  chatModels: ProviderModel[];
  transcriptionModels: ProviderModel[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredPublicString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error(`Invalid MediaFlow model ${field}`);
  }
  return value;
}

function parseModelType(value: unknown): MediaFlowPublicModelType {
  if (value === 'chat' || value === 'transcription') {
    return value;
  }
  throw new Error('Invalid MediaFlow model type');
}

function parseCapability(value: unknown): MediaFlowPublicModelCapability {
  if (value === 'text' || value === 'image' || value === 'audio') {
    return value;
  }
  throw new Error('Invalid MediaFlow model capability');
}

function parseCatalogEntry(value: unknown): MediaFlowPublicModel {
  if (!isRecord(value)) {
    throw new Error('Invalid MediaFlow model catalog entry');
  }

  const capabilities = value.capabilities;
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    throw new Error('Invalid MediaFlow model capabilities');
  }

  return {
    id: requiredPublicString(value.id, 'id'),
    label: requiredPublicString(value.label, 'label'),
    type: parseModelType(value.type),
    capabilities: [...new Set(capabilities.map(parseCapability))],
  };
}

export function parseMediaFlowModelCatalogResponse(response: MediaFlowHttpResponse): MediaFlowModelCatalog {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`MediaFlow model catalog request failed (${response.status})`);
  }

  let rawCatalog: unknown;
  try {
    rawCatalog = JSON.parse(response.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse MediaFlow model catalog: ${message}`);
  }

  if (!isRecord(rawCatalog) || rawCatalog.object !== 'list' || rawCatalog.provider !== 'MediaFlow') {
    throw new Error('Invalid MediaFlow model catalog');
  }

  if (!Array.isArray(rawCatalog.data)) {
    throw new Error('Invalid MediaFlow model catalog data');
  }

  return {
    object: 'list',
    provider: 'MediaFlow',
    data: rawCatalog.data.map(parseCatalogEntry),
  };
}

export function splitMediaFlowModelCatalog(catalog: MediaFlowModelCatalog): SplitMediaFlowModelCatalog {
  return {
    chatModels: catalog.data
      .filter((model) => model.type === 'chat')
      .map((model) => ({ id: model.id, name: model.label })),
    transcriptionModels: catalog.data
      .filter((model) => model.type === 'transcription')
      .map((model) => ({ id: model.id, name: model.label })),
  };
}

export async function fetchMediaFlowModelCatalog(): Promise<MediaFlowModelCatalog> {
  return parseMediaFlowModelCatalogResponse(
    await invoke<MediaFlowHttpResponse>('fetch_mediaflow_model_catalog')
  );
}
