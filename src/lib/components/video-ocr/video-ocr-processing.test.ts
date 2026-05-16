import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OcrVideoFile, OcrVersion } from '$lib/types';
import { DEFAULT_OCR_CONFIG } from '$lib/types';
import { videoOcrStore } from '$lib/stores';
import { processVideoOcrFile, summarizeOcrFiles } from './video-ocr-processing';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('svelte-sonner', () => ({
  toast: {
    info: vi.fn(),
  },
}));

vi.mock('$lib/services/ocr-ai-cleanup', () => ({
  cleanupOcrSubtitlesWithAi: vi.fn(),
}));

function videoFile(overrides: Partial<OcrVideoFile>): OcrVideoFile {
  return {
    id: 'video-1',
    path: '/Users/sr-71/Movies/sample.mp4',
    name: 'sample.mp4',
    size: 0,
    status: 'pending',
    ocrRegionMode: 'global',
    ocrVersions: [],
    ...overrides,
  };
}

function ocrVersion(): OcrVersion {
  return {
    id: 'version-1',
    name: 'Version 1',
    createdAt: '2026-05-08T00:00:00.000Z',
    mode: 'full_pipeline',
    configSnapshot: {} as OcrVersion['configSnapshot'],
    rawOcr: [],
    finalSubtitles: [],
  };
}

describe('video OCR file summary', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    videoOcrStore.reset();
  });

  it('starts ready files even when preview is unavailable', () => {
    const summary = summarizeOcrFiles([
      videoFile({ id: 'without-preview', status: 'ready' }),
      videoFile({ id: 'with-preview', status: 'ready', previewPath: '/tmp/preview.mp4' }),
    ]);

    expect(summary.startTargets.map((file) => file.id)).toEqual(['without-preview', 'with-preview']);
  });

  it('retries files with versions even when preview is unavailable', () => {
    const summary = summarizeOcrFiles([
      videoFile({ id: 'without-preview', status: 'completed', ocrVersions: [ocrVersion()] }),
      videoFile({
        id: 'with-preview',
        status: 'completed',
        previewPath: '/tmp/preview.mp4',
        ocrVersions: [ocrVersion()],
      }),
    ]);

    expect(summary.retryTargets.map((file) => file.id)).toEqual(['without-preview', 'with-preview']);
  });

  it('counts scanning and transcoding files', () => {
    const summary = summarizeOcrFiles([
      videoFile({ id: 'scanning', status: 'scanning' }),
      videoFile({ id: 'transcoding', status: 'transcoding' }),
    ]);

    expect(summary.scanningCount).toBe(1);
    expect(summary.transcodingCount).toBe(1);
  });

  it('does not retry restored versions while a file is still scanning', () => {
    const summary = summarizeOcrFiles([
      videoFile({
        id: 'scanning-with-version',
        status: 'scanning',
        ocrVersions: [ocrVersion()],
      }),
    ]);

    expect(summary.retryTargets).toEqual([]);
    expect(summary.retryAllMissingRawCount).toBe(0);
  });

  it('runs OCR pipeline on the original source path instead of the generated preview path', async () => {
    invokeMock.mockResolvedValueOnce({
      rawOcr: [],
      subtitles: [],
      frameCount: 0,
      timings: {
        extractMs: 1,
        ocrMs: 1,
        subtitleMs: 1,
        totalMs: 3,
      },
    });

    const [addedFile] = videoOcrStore.addFilesFromPaths(['/Volumes/NAS/source.mkv']);
    videoOcrStore.updateFile(addedFile.id, {
      status: 'ready',
      previewPath: '/tmp/mediaflow_preview/source.mp4',
    });

    const file = videoOcrStore.videoFiles[0];
    await processVideoOcrFile({
      file,
      versionName: 'Version 1',
      mode: 'full_pipeline',
      config: { ...DEFAULT_OCR_CONFIG, aiCleanupEnabled: false },
      aiCleanupControllers: new Map(),
      getFreshFile: (fileId) => videoOcrStore.videoFiles.find((entry) => entry.id === fileId),
      persistFileData: async () => true,
      markPersistedVersions: () => {},
    });

    expect(invokeMock).toHaveBeenCalledWith(
      'run_ocr_pipeline',
      expect.objectContaining({
        videoPath: '/Volumes/NAS/source.mkv',
      }),
    );
  });
});
