import { beforeEach, describe, expect, it } from 'vitest';

import { videoOcrStore } from './video-ocr.svelte';

describe('video OCR store', () => {
  beforeEach(() => {
    videoOcrStore.reset();
  });

  it('deduplicates paths within a single import batch', () => {
    const added = videoOcrStore.addFilesFromPaths([
      '/Users/sr-71/Movies/sample.mp4',
      '/Users/sr-71/Movies/sample.mp4',
    ]);

    expect(added).toHaveLength(1);
    expect(videoOcrStore.videoFiles).toHaveLength(1);
  });

  it('allows OCR-ready files even when preview generation failed', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.updateFile(file.id, {
      status: 'ready',
      previewPath: undefined,
      previewError: 'Preview transcode failed',
    });

    expect(videoOcrStore.readyFiles).toHaveLength(1);
    expect(videoOcrStore.canStartOcr).toBe(true);
  });

  it('keeps generated preview state separate from OCR readiness', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.finishTranscoding(
      file.id,
      '/tmp/mediaflow_preview/sample.mp4',
      {
        path: file.path,
        size: 123,
        modifiedMs: 456,
      },
      'ocr-preview-v3-480p-progress-timeout',
    );

    expect(videoOcrStore.videoFiles[0].previewPath).toBe('/tmp/mediaflow_preview/sample.mp4');
    expect(videoOcrStore.videoFiles[0].previewPath).not.toBe(file.path);
    expect(videoOcrStore.videoFiles[0].previewVersion).toBe('ocr-preview-v3-480p-progress-timeout');
    expect(videoOcrStore.readyFiles).toHaveLength(1);
    expect(videoOcrStore.canStartOcr).toBe(true);
  });

  it('cancels preview preparation without recording a preview error', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startTranscoding(file.id);
    videoOcrStore.cancelPreviewTranscoding(file.id);

    expect(videoOcrStore.videoFiles[0].status).toBe('ready');
    expect(videoOcrStore.videoFiles[0].previewError).toBeUndefined();
    expect(videoOcrStore.videoFiles[0].isTranscoding).toBe(false);
  });
});
