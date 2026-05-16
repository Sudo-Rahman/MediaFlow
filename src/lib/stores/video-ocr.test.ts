import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_OCR_WORKER_COUNT } from '$lib/types';

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

  it('keeps OCR worker count fixed when updating config', () => {
    videoOcrStore.updateConfig({
      frameRate: 5,
      threadCount: 12,
    });

    expect(videoOcrStore.config.frameRate).toBe(5);
    expect(videoOcrStore.config.threadCount).toBe(DEFAULT_OCR_WORKER_COUNT);
  });

  it('cancels preview preparation without recording a preview error', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startTranscoding(file.id);
    videoOcrStore.cancelPreviewTranscoding(file.id);

    expect(videoOcrStore.videoFiles[0].status).toBe('ready');
    expect(videoOcrStore.videoFiles[0].previewError).toBeUndefined();
    expect(videoOcrStore.videoFiles[0].isTranscoding).toBe(false);
  });

  it('cancels aborted file preparation states back to OCR-ready statuses', () => {
    const [scanningFile, transcodingFile] = videoOcrStore.addFilesFromPaths([
      '/Users/sr-71/Movies/scanning.mp4',
      '/Users/sr-71/Movies/transcoding.mp4',
    ]);

    videoOcrStore.setFileStatus(scanningFile.id, 'scanning');
    videoOcrStore.startTranscoding(transcodingFile.id);

    videoOcrStore.cancelFilePreparation(scanningFile.id);
    videoOcrStore.cancelFilePreparation(transcodingFile.id);

    expect(videoOcrStore.videoFiles[0].status).toBe('ready');
    expect(videoOcrStore.videoFiles[1].status).toBe('ready');
    expect(videoOcrStore.videoFiles[1].isTranscoding).toBe(false);
    expect(videoOcrStore.videoFiles[1].transcodingProgress).toBe(0);
    expect(videoOcrStore.videoFiles[1].transcodingCodec).toBeUndefined();
  });

  it('allows streamed OCR progress to overtake frame extraction progress', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.updateProgressForOperation(file.id, 'ocr-run-1', {
      phase: 'extracting',
      current: 3,
      total: 100,
      percentage: 3,
      message: 'Extracting frame 3...',
    });
    videoOcrStore.updateProgressForOperation(file.id, 'ocr-run-1', {
      phase: 'ocr',
      current: 35,
      total: 100,
      percentage: 35,
      message: 'Processing frame 35/100...',
    });

    expect(videoOcrStore.videoFiles[0].status).toBe('ocr_processing');
    expect(videoOcrStore.videoFiles[0].progress?.phase).toBe('ocr');
    expect(videoOcrStore.videoFiles[0].progress?.percentage).toBe(35);
    expect(videoOcrStore.videoFiles[0].progress?.overallPercentage).toBe(50);
  });

  it('ignores stale OCR progress after an operation is cancelled', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.updateProgressForOperation(file.id, 'ocr-run-1', {
      phase: 'extracting',
      current: 3,
      total: 100,
      percentage: 3,
      message: 'Extracting frame 3...',
    });
    videoOcrStore.cancelProcessing(file.id);
    videoOcrStore.updateProgressForOperation(file.id, 'ocr-run-1', {
      phase: 'ocr',
      current: 35,
      total: 100,
      percentage: 35,
      message: 'Processing frame 35/100...',
    });

    expect(videoOcrStore.videoFiles[0].status).toBe('ready');
    expect(videoOcrStore.videoFiles[0].progress).toBeUndefined();
  });

  it('ignores progress from an old OCR operation after a new run starts', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-2');
    videoOcrStore.updateProgressForOperation(file.id, 'ocr-run-1', {
      phase: 'ocr',
      current: 35,
      total: 100,
      percentage: 35,
      message: 'Processing frame 35/100...',
    });

    expect(videoOcrStore.videoFiles[0].progress).toBeUndefined();
  });

  it('tracks active OCR operations per file', () => {
    const [first, second] = videoOcrStore.addFilesFromPaths([
      '/Users/sr-71/Movies/first.mp4',
      '/Users/sr-71/Movies/second.mp4',
    ]);

    videoOcrStore.startProcessing(first.id, 'first-run');
    videoOcrStore.startProcessing(second.id, 'second-run');
    videoOcrStore.updateProgressForOperation(first.id, 'first-run', {
      phase: 'ocr',
      current: 10,
      total: 100,
      percentage: 10,
      message: 'Processing frame 10/100...',
    });
    videoOcrStore.updateProgressForOperation(first.id, 'second-run', {
      phase: 'ocr',
      current: 90,
      total: 100,
      percentage: 90,
      message: 'Stale cross-file progress',
    });

    expect(videoOcrStore.videoFiles[0].progress?.percentage).toBe(10);
    expect(videoOcrStore.videoFiles[1].progress).toBeUndefined();
  });
});
