import { invoke } from '@tauri-apps/api/core';
import type { MediaflowData } from '$lib/types';
import { log } from '$lib/utils/log-toast';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeMediaflowData(value: unknown): MediaflowData | null {
  if (!isRecord(value)) {
    return null;
  }

  if (!('audioToSubs' in value || 'videoOcr' in value || 'translation' in value || 'subtitleOcr' in value)) {
    return null;
  }

  const data: MediaflowData = { version: 1 };
  if (value.audioToSubs !== undefined) {
    data.audioToSubs = value.audioToSubs as MediaflowData['audioToSubs'];
  }
  if (value.videoOcr !== undefined) {
    data.videoOcr = value.videoOcr as MediaflowData['videoOcr'];
  }
  if (value.translation !== undefined) {
    data.translation = value.translation as MediaflowData['translation'];
  }
  if (value.subtitleOcr !== undefined) {
    data.subtitleOcr = value.subtitleOcr as MediaflowData['subtitleOcr'];
  }

  return data;
}

export async function loadMediaflowData(mediaPath: string): Promise<MediaflowData | null> {
  try {
    const jsonStr = await invoke<string | null>('load_mediaflow_data', { mediaPath });
    if (!jsonStr) {
      return null;
    }

    const parsed = JSON.parse(jsonStr) as unknown;
    return normalizeMediaflowData(parsed);
  } catch (error) {
    log('warning', 'system', 'Failed to load MediaFlow data', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function saveMediaflowData(mediaPath: string, data: MediaflowData): Promise<boolean> {
  try {
    const payload: MediaflowData = {
      version: 1,
      audioToSubs: data.audioToSubs,
      videoOcr: data.videoOcr,
      translation: data.translation,
      subtitleOcr: data.subtitleOcr,
    };

    await invoke('save_mediaflow_data', {
      mediaPath,
      data: JSON.stringify(payload, null, 2),
    });
    return true;
  } catch (error) {
    console.error('Failed to save MediaFlow data:', error);
    return false;
  }
}

export async function deleteMediaflowData(mediaPath: string): Promise<boolean> {
  try {
    await invoke('delete_mediaflow_data', { mediaPath });
    return true;
  } catch (error) {
    console.error('Failed to delete MediaFlow data:', error);
    return false;
  }
}
