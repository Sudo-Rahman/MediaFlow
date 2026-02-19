import { invoke } from '@tauri-apps/api/core';
import type { RsextData, TranscriptionData, TranslationPersistenceData, VideoOcrPersistenceData } from '$lib/types';
import { log } from '$lib/utils/log-toast';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLegacyTranscriptionData(value: unknown): value is TranscriptionData {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.audioPath === 'string'
    && Array.isArray(value.transcriptionVersions)
  );
}

function isLegacyVideoOcrData(value: unknown): value is VideoOcrPersistenceData {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.videoPath === 'string'
    && Array.isArray(value.ocrVersions)
  );
}

function isLegacyTranslationData(value: unknown): value is TranslationPersistenceData {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.filePath === 'string'
    && Array.isArray(value.translationVersions)
  );
}

function normalizeRsextData(value: unknown): RsextData | null {
  if (!isRecord(value)) {
    return null;
  }

  // New shared schema
  if ('audioToSubs' in value || 'videoOcr' in value || 'translation' in value) {
    return {
      version: 1,
      audioToSubs: value.audioToSubs as TranscriptionData | undefined,
      videoOcr: value.videoOcr as VideoOcrPersistenceData | undefined,
      translation: value.translation as TranslationPersistenceData | undefined,
    };
  }

  // Legacy audio-only schema
  if (isLegacyTranscriptionData(value)) {
    return {
      version: 1,
      audioToSubs: value,
    };
  }

  // Legacy OCR-only schema
  if (isLegacyVideoOcrData(value)) {
    return {
      version: 1,
      videoOcr: value,
    };
  }

  // Legacy translation-only schema
  if (isLegacyTranslationData(value)) {
    return {
      version: 1,
      translation: value,
    };
  }

  return null;
}

export async function loadRsextData(mediaPath: string): Promise<RsextData | null> {
  try {
    const jsonStr = await invoke<string | null>('load_rsext_data', { mediaPath });
    if (!jsonStr) {
      return null;
    }

    const parsed = JSON.parse(jsonStr) as unknown;
    return normalizeRsextData(parsed);
  } catch (error) {
    log('warning', 'system', 'Failed to load rsext data', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function saveRsextData(mediaPath: string, data: RsextData): Promise<boolean> {
  try {
    const payload: RsextData = {
      version: 1,
      audioToSubs: data.audioToSubs,
      videoOcr: data.videoOcr,
      translation: data.translation,
    };

    await invoke('save_rsext_data', {
      mediaPath,
      data: JSON.stringify(payload, null, 2),
    });
    return true;
  } catch (error) {
    console.error('Failed to save rsext data:', error);
    return false;
  }
}

export async function deleteRsextData(mediaPath: string): Promise<boolean> {
  try {
    await invoke('delete_rsext_data', { mediaPath });
    return true;
  } catch (error) {
    console.error('Failed to delete rsext data:', error);
    return false;
  }
}
