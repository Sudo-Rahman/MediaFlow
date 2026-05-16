import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OcrPreviewSourceIdentity, VideoOcrPersistenceData } from '$lib/types';
import {
  OCR_PREVIEW_CACHE_VERSION,
  getReusableOcrPreview,
  invalidateOcrPreview,
  prepareOcrPreview,
} from './ocr-preview';

const existsMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: existsMock,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

function identity(overrides: Partial<OcrPreviewSourceIdentity> = {}): OcrPreviewSourceIdentity {
  return {
    path: '/Volumes/NAS/source.mkv',
    size: 1024,
    modifiedMs: 1_778_000_000_000,
    ...overrides,
  };
}

function persistedPreview(
  sourceIdentity: OcrPreviewSourceIdentity | null = identity(),
): VideoOcrPersistenceData {
  return {
    version: 1,
    videoPath: '/Volumes/NAS/source.mkv',
    previewPath: '/tmp/mediaflow_preview/source.mp4',
    previewSourceIdentity: sourceIdentity ?? undefined,
    previewVersion: OCR_PREVIEW_CACHE_VERSION,
    ocrVersions: [],
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
  };
}

function backendPreview(path = '/tmp/mediaflow_preview/source.mp4') {
  return {
    path,
    sourceIdentity: identity(),
    previewVersion: OCR_PREVIEW_CACHE_VERSION,
  };
}

describe('OCR preview cache reuse', () => {
  beforeEach(() => {
    existsMock.mockReset();
    invokeMock.mockReset();
    existsMock.mockResolvedValue(true);
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_ocr_preview_cache_entry') {
        return Promise.resolve(backendPreview());
      }

      return Promise.resolve(undefined);
    });
  });

  it('reuses cached preview only when path, size, and modified time match', async () => {
    const reusable = await getReusableOcrPreview('/Volumes/NAS/source.mkv', persistedPreview());

    expect(reusable).toEqual({
      path: '/tmp/mediaflow_preview/source.mp4',
      sourceIdentity: identity(),
      previewVersion: OCR_PREVIEW_CACHE_VERSION,
    });
  });

  it('rejects cached preview when source identity changed or is missing', async () => {
    await expect(
      getReusableOcrPreview('/Volumes/NAS/source.mkv', persistedPreview(identity({ size: 2048 }))),
    ).resolves.toBeNull();

    await expect(
      getReusableOcrPreview('/Volumes/NAS/source.mkv', persistedPreview(identity({ modifiedMs: 1_778_000_000_001 }))),
    ).resolves.toBeNull();

    await expect(
      getReusableOcrPreview('/Volumes/NAS/source.mkv', persistedPreview(null)),
    ).resolves.toBeNull();
  });

  it('never reuses the original source path as a preview path', async () => {
    const persisted = persistedPreview();
    persisted.previewPath = persisted.videoPath;

    await expect(getReusableOcrPreview('/Volumes/NAS/source.mkv', persisted)).resolves.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rejects cached preview paths that no longer exist', async () => {
    existsMock.mockResolvedValue(false);

    await expect(getReusableOcrPreview('/Volumes/NAS/source.mkv', persistedPreview())).resolves.toBeNull();
  });

  it('rejects cached previews from an older preview pipeline version', async () => {
    const missingVersion = persistedPreview();
    delete missingVersion.previewVersion;

    await expect(getReusableOcrPreview('/Volumes/NAS/source.mkv', missingVersion)).resolves.toBeNull();

    const oldVersion = persistedPreview();
    oldVersion.previewVersion = 'ocr-preview-v1-always-transcode';

    await expect(getReusableOcrPreview('/Volumes/NAS/source.mkv', oldVersion)).resolves.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rejects cached preview paths that differ from the backend cache path', async () => {
    const persisted = persistedPreview();
    persisted.previewPath = '/Users/sr-71/Movies/not-managed.mp4';

    await expect(getReusableOcrPreview('/Volumes/NAS/source.mkv', persisted)).resolves.toBeNull();
    expect(existsMock).not.toHaveBeenCalled();
  });

  it('invalidates backend preview cache for a source path', async () => {
    invokeMock.mockResolvedValue(undefined);

    await invalidateOcrPreview('/Volumes/NAS/source.mkv');

    expect(invokeMock).toHaveBeenCalledWith('invalidate_ocr_preview', {
      inputPath: '/Volumes/NAS/source.mkv',
    });
  });

  it('passes forced full transcode preference to the backend preview command', async () => {
    invokeMock.mockResolvedValue(backendPreview());

    await prepareOcrPreview('/Volumes/NAS/source.mkv', 'file-1', {
      forceFullTranscode: true,
    });

    expect(invokeMock).toHaveBeenCalledWith('transcode_for_preview', {
      inputPath: '/Volumes/NAS/source.mkv',
      fileId: 'file-1',
      forceFullTranscode: true,
    });
  });
});
