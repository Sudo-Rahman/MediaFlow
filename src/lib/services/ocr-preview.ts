import { invoke } from '@tauri-apps/api/core';
import { exists } from '@tauri-apps/plugin-fs';

import type {
  OcrPreviewSourceIdentity,
  OcrPreviewTranscodeResult,
  VideoOcrPersistenceData,
} from '$lib/types';

export const OCR_PREVIEW_CACHE_VERSION = 'ocr-preview-v3-480p-progress-timeout';

function previewSourceIdentityMatches(
  current: OcrPreviewSourceIdentity,
  cached: OcrPreviewSourceIdentity | undefined,
): boolean {
  return cached?.path === current.path
    && cached.size === current.size
    && cached.modifiedMs === current.modifiedMs;
}

export async function getReusableOcrPreview(
  sourcePath: string,
  persisted: VideoOcrPersistenceData | null,
): Promise<OcrPreviewTranscodeResult | null> {
  if (!persisted?.previewPath || persisted.previewPath === sourcePath) {
    return null;
  }

  if (persisted.previewVersion !== OCR_PREVIEW_CACHE_VERSION) {
    return null;
  }

  const currentPreview = await invoke<OcrPreviewTranscodeResult>('get_ocr_preview_cache_entry', {
    inputPath: sourcePath,
  });

  if (persisted.previewPath !== currentPreview.path) {
    return null;
  }

  if (!previewSourceIdentityMatches(currentPreview.sourceIdentity, persisted.previewSourceIdentity)) {
    return null;
  }

  if (!(await exists(currentPreview.path))) {
    return null;
  }

  return currentPreview;
}

export async function prepareOcrPreview(
  sourcePath: string,
  fileId: string,
  options: { forceFullTranscode?: boolean } = {},
): Promise<OcrPreviewTranscodeResult> {
  return invoke<OcrPreviewTranscodeResult>('transcode_for_preview', {
    inputPath: sourcePath,
    fileId,
    forceFullTranscode: options.forceFullTranscode ?? false,
  });
}

export async function invalidateOcrPreview(sourcePath: string): Promise<void> {
  await invoke('invalidate_ocr_preview', { inputPath: sourcePath });
}

export async function cancelOcrPreview(fileId: string): Promise<void> {
  await invoke('cancel_ocr_operation', { fileId });
}
