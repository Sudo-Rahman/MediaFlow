import { beforeEach, describe, expect, it } from 'vitest';

import type { OcrVideoFile, OcrZoneFrame } from '$lib/types';
import { DEFAULT_OCR_WORKER_COUNT } from '$lib/types';
import { createOcrSegmentFromZone, DEFAULT_MAIN_SUBTITLE_REGION } from '$lib/utils';

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

  it('creates imported files with a full-duration main subtitle selection', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.updateFile(file.id, { duration: 120 });

    const selected = videoOcrStore.videoFiles[0].ocrSelection;
    expect(selected.segments[0].startTimeMs).toBe(0);
    expect(selected.segments[0].endTimeMs).toBe(120_000);
    expect(selected.segments[0].zones[0].role).toBe('main_subtitle');
  });

  it('adds a segment zone from the current timestamp and defaults to main subtitles', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);
    videoOcrStore.updateFile(file.id, { duration: 120 });

    const segment = createOcrSegmentFromZone(10_000, 120_000, DEFAULT_MAIN_SUBTITLE_REGION);
    videoOcrStore.addOcrSegment(file.id, segment);

    expect(videoOcrStore.videoFiles[0].ocrSelection.segments).toContainEqual(segment);
  });

  it('clones imported OCR selections when adding files', () => {
    const ocrSelection = {
      segments: [createOcrSegmentFromZone(0, 60_000, DEFAULT_MAIN_SUBTITLE_REGION)],
    };
    const file: OcrVideoFile = {
      id: 'file-1',
      path: '/Users/sr-71/Movies/sample.mp4',
      name: 'sample.mp4',
      size: 0,
      status: 'pending',
      ocrSelection,
      ocrVersions: [],
    };

    videoOcrStore.addFiles([file]);
    ocrSelection.segments[0].zones[0].region.y = 0.5;
    ocrSelection.segments[0].zones[0].role = 'on_screen_text';

    const storedZone = videoOcrStore.videoFiles[0].ocrSelection.segments[0].zones[0];
    expect(storedZone.region.y).toBe(DEFAULT_MAIN_SUBTITLE_REGION.y);
    expect(storedZone.role).toBe('main_subtitle');
  });

  it('returns cloned OCR selections when adding files', () => {
    const ocrSelection = {
      segments: [createOcrSegmentFromZone(0, 60_000, DEFAULT_MAIN_SUBTITLE_REGION)],
    };
    const file: OcrVideoFile = {
      id: 'file-1',
      path: '/Users/sr-71/Movies/sample.mp4',
      name: 'sample.mp4',
      size: 0,
      status: 'pending',
      ocrSelection,
      ocrVersions: [],
    };

    const [added] = videoOcrStore.addFiles([file]);
    added.ocrSelection.segments[0].zones[0].region.y = 0.5;
    added.ocrSelection.segments[0].zones[0].role = 'on_screen_text';

    const storedZone = videoOcrStore.videoFiles[0].ocrSelection.segments[0].zones[0];
    expect(storedZone.region.y).toBe(DEFAULT_MAIN_SUBTITLE_REGION.y);
    expect(storedZone.role).toBe('main_subtitle');
  });

  it('clones OCR selections passed through updateFile', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);
    const ocrSelection = {
      segments: [createOcrSegmentFromZone(0, 60_000, DEFAULT_MAIN_SUBTITLE_REGION)],
    };

    videoOcrStore.updateFile(file.id, { ocrSelection });
    ocrSelection.segments[0].zones[0].region.y = 0.5;
    ocrSelection.segments[0].zones[0].role = 'on_screen_text';

    const storedZone = videoOcrStore.videoFiles[0].ocrSelection.segments[0].zones[0];
    expect(storedZone.region.y).toBe(DEFAULT_MAIN_SUBTITLE_REGION.y);
    expect(storedZone.role).toBe('main_subtitle');
  });

  it('ignores undefined OCR selections passed through updateFile', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);
    const existingSelection = videoOcrStore.videoFiles[0].ocrSelection;

    videoOcrStore.updateFile(file.id, { ocrSelection: undefined });

    expect(videoOcrStore.videoFiles[0].ocrSelection).toEqual(existingSelection);
    expect(videoOcrStore.videoFiles[0].ocrSelection).not.toBe(existingSelection);

    existingSelection.segments[0].zones[0].region.y = 0.5;
    existingSelection.segments[0].zones[0].role = 'on_screen_text';

    const storedZone = videoOcrStore.videoFiles[0].ocrSelection.segments[0].zones[0];
    expect(storedZone.region.y).toBe(DEFAULT_MAIN_SUBTITLE_REGION.y);
    expect(storedZone.role).toBe('main_subtitle');
  });

  it('preserves explicit OCR selection when duration is updated at the same time', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);
    const segment = createOcrSegmentFromZone(10_000, 60_000, DEFAULT_MAIN_SUBTITLE_REGION);
    const ocrSelection = { segments: [segment] };

    videoOcrStore.updateFile(file.id, { duration: 120, ocrSelection });

    expect(videoOcrStore.videoFiles[0].ocrSelection).toEqual(ocrSelection);
  });

  it('clones OCR selections passed through setOcrSelection', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);
    const ocrSelection = {
      segments: [createOcrSegmentFromZone(0, 60_000, DEFAULT_MAIN_SUBTITLE_REGION)],
    };

    videoOcrStore.setOcrSelection(file.id, ocrSelection);
    ocrSelection.segments[0].zones[0].region.y = 0.5;
    ocrSelection.segments[0].zones[0].role = 'on_screen_text';

    const storedZone = videoOcrStore.videoFiles[0].ocrSelection.segments[0].zones[0];
    expect(storedZone.region.y).toBe(DEFAULT_MAIN_SUBTITLE_REGION.y);
    expect(storedZone.role).toBe('main_subtitle');
  });

  it('clones segments passed through addOcrSegment', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);
    const segment = createOcrSegmentFromZone(10_000, 60_000, DEFAULT_MAIN_SUBTITLE_REGION);

    videoOcrStore.addOcrSegment(file.id, segment);
    segment.zones[0].region.y = 0.5;
    segment.zones[0].role = 'on_screen_text';

    const storedZone = videoOcrStore.videoFiles[0].ocrSelection.segments[1].zones[0];
    expect(storedZone.region.y).toBe(DEFAULT_MAIN_SUBTITLE_REGION.y);
    expect(storedZone.role).toBe('main_subtitle');
  });

  it('changes a zone role without changing its geometry', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);
    const segment = file.ocrSelection.segments[0];
    const zone = segment.zones[0];

    videoOcrStore.setOcrZoneRole(file.id, segment.id, zone.id, 'on_screen_text');

    const updatedZone = videoOcrStore.videoFiles[0].ocrSelection.segments[0].zones[0];
    expect(updatedZone.role).toBe('on_screen_text');
    expect(updatedZone.region).toEqual(zone.region);
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

  it('stores live OCR detections for the active operation', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);
    const detection = createLiveDetection('Hello there');

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', detection);

    expect(videoOcrStore.getLiveDetections(file.id)).toEqual([detection]);
  });

  it('ignores live OCR detections from stale operations', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-2', createLiveDetection('Stale'));

    expect(videoOcrStore.getLiveDetections(file.id)).toEqual([]);
  });

  it('ignores live OCR detections without an active operation', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('Late'));

    expect(videoOcrStore.getLiveDetections(file.id)).toEqual([]);
  });

  it('returns cloned live OCR detection arrays', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('First'));
    const detections = videoOcrStore.getLiveDetections(file.id);
    detections.push(createLiveDetection('Mutated'));

    expect(videoOcrStore.getLiveDetections(file.id)).toHaveLength(1);
  });

  it('caps live OCR detections to the latest 100 per file', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    for (let index = 0; index < 101; index += 1) {
      videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection(`Text ${index}`, index));
    }

    const detections = videoOcrStore.getLiveDetections(file.id);
    expect(detections).toHaveLength(100);
    expect(detections[0].text).toBe('Text 1');
    expect(detections.at(-1)?.text).toBe('Text 100');
  });

  it('clears old live OCR detections when processing starts again', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('Old'));
    videoOcrStore.startProcessing(file.id, 'ocr-run-2');

    expect(videoOcrStore.getLiveDetections(file.id)).toEqual([]);
  });

  it('clears live OCR detections when processing is cancelled', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('Before cancel'));
    videoOcrStore.cancelProcessing(file.id);
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('Late after cancel'));

    expect(videoOcrStore.getLiveDetections(file.id)).toEqual([]);
  });

  it('ignores late live OCR detections after processing stops', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('Before stop'));
    videoOcrStore.stopProcessing();
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('Late after stop'));

    expect(videoOcrStore.getLiveDetections(file.id)).toEqual([]);
  });

  it('clears live OCR detections when all processing is cancelled', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('Before cancel'));
    videoOcrStore.cancelAll();

    expect(videoOcrStore.getLiveDetections(file.id)).toEqual([]);
  });

  it('clears live OCR detections when OCR versions are set after completion', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('Before complete'));
    videoOcrStore.setOcrVersions(file.id, []);

    expect(videoOcrStore.getLiveDetections(file.id)).toEqual([]);
  });

  it('clears live OCR detections when an OCR version is added after completion', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('Before complete'));
    videoOcrStore.addOcrVersion(file.id, {
      id: 'version-1',
      name: 'Version 1',
      createdAt: new Date().toISOString(),
      mode: 'full_pipeline',
      configSnapshot: videoOcrStore.config,
      rawOcr: [],
      finalSubtitles: [],
    });

    expect(videoOcrStore.getLiveDetections(file.id)).toEqual([]);
  });

  it('clears live OCR detections when a file is removed', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('Before remove'));
    videoOcrStore.removeFile(file.id);

    expect(videoOcrStore.getLiveDetections(file.id)).toEqual([]);
  });

  it('clears live OCR detections when the store is reset', () => {
    const [file] = videoOcrStore.addFilesFromPaths(['/Users/sr-71/Movies/sample.mp4']);

    videoOcrStore.startProcessing(file.id, 'ocr-run-1');
    videoOcrStore.addLiveDetection(file.id, 'ocr-run-1', createLiveDetection('Before reset'));
    videoOcrStore.reset();

    expect(videoOcrStore.getLiveDetections(file.id)).toEqual([]);
  });
});

function createLiveDetection(text: string, frameIndex = 1): OcrZoneFrame {
  return {
    frameIndex,
    timeMs: frameIndex * 100,
    segmentId: 'segment-1',
    zoneId: 'zone-1',
    role: 'main_subtitle',
    region: DEFAULT_MAIN_SUBTITLE_REGION,
    text,
    confidence: 0.87,
  };
}
