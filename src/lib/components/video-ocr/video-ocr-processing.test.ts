import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OcrPipelineResult, OcrRawFrame, OcrVideoFile, OcrVersion, VideoOcrSelection } from '$lib/types';
import { DEFAULT_OCR_CONFIG, DEFAULT_OCR_WORKER_COUNT } from '$lib/types';
import { videoOcrStore } from '$lib/stores';
import {
  canRunOcrRetryMode,
  processVideoOcrFile,
  summarizeOcrFiles,
  willRetryFallbackToFullPipeline,
} from './video-ocr-processing';

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

function ocrSelection(): OcrVideoFile['ocrSelection'] {
  return {
    segments: [
      {
        id: 'segment-1',
        startTimeMs: 0,
        endTimeMs: 60_000,
        zones: [
          {
            id: 'zone-1',
            role: 'main_subtitle',
            region: { x: 0, y: 0.75, width: 1, height: 0.25 },
          },
        ],
      },
    ],
  };
}

function videoFile(overrides: Partial<OcrVideoFile>): OcrVideoFile {
  return {
    id: 'video-1',
    path: '/Users/sr-71/Movies/sample.mp4',
    name: 'sample.mp4',
    size: 0,
    status: 'pending',
    ocrSelection: ocrSelection(),
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
      telemetry: {
        extractedFrames: 0,
        ocrAttemptedFrames: 0,
        textFrames: 0,
        unchangedSkippedFrames: 0,
        noTextSkippedFrames: 0,
        effectiveWorkers: 1,
        engineThreads: 1,
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
      operationId: 'ocr-run-1',
      versionName: 'Version 1',
      mode: 'full_pipeline',
      config: { ...DEFAULT_OCR_CONFIG, aiCleanupEnabled: false },
      aiCleanupControllers: new Map(),
      getFreshFile: (fileId) => videoOcrStore.videoFiles.find((entry) => entry.id === fileId),
      persistFileData: async () => true,
      markPersistedVersions: () => {},
    });

    const pipelinePayload = invokeMock.mock.calls.find(([command]) => command === 'run_ocr_pipeline')?.[1];

    expect(pipelinePayload).toEqual(
      expect.objectContaining({
        numWorkers: DEFAULT_OCR_WORKER_COUNT,
        selection: file.ocrSelection,
        videoPath: '/Volumes/NAS/source.mkv',
      }),
    );
    expect(pipelinePayload).not.toHaveProperty('region');
  });

  it('runs the full OCR pipeline with the active version selection snapshot', async () => {
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
      telemetry: {
        extractedFrames: 0,
        ocrAttemptedFrames: 0,
        textFrames: 0,
        unchangedSkippedFrames: 0,
        noTextSkippedFrames: 0,
        effectiveWorkers: 1,
        engineThreads: 1,
      },
    });

    const [addedFile] = videoOcrStore.addFilesFromPaths(['/Volumes/NAS/source.mkv']);
    const firstSelection = selectionWithZone('segment-active', 'zone-active', 0.44);
    const secondSelection = selectionWithZone('segment-latest', 'zone-latest', 0.7);
    videoOcrStore.updateFile(addedFile.id, { status: 'ready' });
    videoOcrStore.addOcrVersion(addedFile.id, rawVersion('version-1', firstSelection, 'first raw'));
    videoOcrStore.addOcrVersion(addedFile.id, rawVersion('version-2', secondSelection, 'second raw'));
    videoOcrStore.selectOcrVersion(addedFile.id, 'version-1');

    const file = videoOcrStore.videoFiles[0];
    await processVideoOcrFile({
      file,
      operationId: 'ocr-run-1',
      versionName: 'Version 3',
      mode: 'full_pipeline',
      config: { ...DEFAULT_OCR_CONFIG, aiCleanupEnabled: false },
      aiCleanupControllers: new Map(),
      getFreshFile: (fileId) => videoOcrStore.videoFiles.find((entry) => entry.id === fileId),
      persistFileData: async () => true,
      markPersistedVersions: () => {},
    });

    const pipelinePayload = invokeMock.mock.calls.find(([command]) => command === 'run_ocr_pipeline')?.[1];

    expect(pipelinePayload).toEqual(
      expect.objectContaining({
        selection: firstSelection,
      }),
    );
  });

  it('uses active version raw OCR as the source for partial retries', async () => {
    invokeMock.mockResolvedValueOnce([]);

    const [addedFile] = videoOcrStore.addFilesFromPaths(['/Volumes/NAS/source.mkv']);
    videoOcrStore.updateFile(addedFile.id, { status: 'completed' });
    videoOcrStore.addOcrVersion(
      addedFile.id,
      rawVersion('version-1', selectionWithZone('segment-1', 'zone-1', 0.44), 'active raw'),
    );
    videoOcrStore.addOcrVersion(
      addedFile.id,
      rawVersion('version-2', selectionWithZone('segment-2', 'zone-2', 0.7), 'latest raw'),
    );
    videoOcrStore.selectOcrVersion(addedFile.id, 'version-1');

    const file = videoOcrStore.videoFiles[0];
    await processVideoOcrFile({
      file,
      operationId: 'ocr-run-1',
      versionName: 'Version 3',
      mode: 'cleanup_only',
      config: { ...DEFAULT_OCR_CONFIG, aiCleanupEnabled: false },
      aiCleanupControllers: new Map(),
      getFreshFile: (fileId) => videoOcrStore.videoFiles.find((entry) => entry.id === fileId),
      persistFileData: async () => true,
      markPersistedVersions: () => {},
    });

    const subtitlePayload = invokeMock.mock.calls.find(([command]) => command === 'generate_subtitles_from_ocr')?.[1];

    expect(subtitlePayload.frameResults[0].text).toBe('active raw');
  });

  it('falls back to the full pipeline for partial retries from a draft selection', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'run_ocr_pipeline') {
        return pipelineResult();
      }

      return [];
    });

    const [addedFile] = videoOcrStore.addFilesFromPaths(['/Volumes/NAS/source.mkv']);
    videoOcrStore.updateFile(addedFile.id, { status: 'completed' });
    videoOcrStore.addOcrVersion(
      addedFile.id,
      rawVersion('version-1', selectionWithZone('segment-1', 'zone-1', 0.44), 'active raw'),
    );
    videoOcrStore.addOcrVersion(
      addedFile.id,
      rawVersion('version-2', selectionWithZone('segment-2', 'zone-2', 0.7), 'latest raw'),
    );
    videoOcrStore.selectOcrVersion(addedFile.id, 'version-1');
    videoOcrStore.setOcrZoneRegion(addedFile.id, 'segment-1', 'zone-1', {
      x: 0.2,
      y: 0.5,
      width: 0.4,
      height: 0.2,
    });
    const draftSelection = videoOcrStore.getActiveOcrSelection(addedFile.id);

    const file = videoOcrStore.videoFiles[0];
    const result = await processVideoOcrFile({
      file,
      operationId: 'ocr-run-1',
      versionName: 'Version 3',
      mode: 'cleanup_only',
      config: { ...DEFAULT_OCR_CONFIG, aiCleanupEnabled: false },
      aiCleanupControllers: new Map(),
      getFreshFile: (fileId) => videoOcrStore.videoFiles.find((entry) => entry.id === fileId),
      persistFileData: async () => true,
      markPersistedVersions: () => {},
      suppressFallbackToast: true,
    });

    const pipelinePayload = invokeMock.mock.calls.find(([command]) => command === 'run_ocr_pipeline')?.[1];
    const subtitlePayload = invokeMock.mock.calls.find(([command]) => command === 'generate_subtitles_from_ocr')?.[1];

    expect(result.effectiveMode).toBe('full_pipeline');
    expect(pipelinePayload).toEqual(expect.objectContaining({ selection: draftSelection }));
    expect(subtitlePayload).toBeUndefined();
  });

  it('treats an active completed version without raw OCR as missing raw for retry summaries', () => {
    const sourceSelection = selectionWithZone('segment-1', 'zone-1', 0.44);
    const summary = summarizeOcrFiles([
      videoFile({
        status: 'completed',
        activeOcrVersionId: 'version-1',
        ocrVersions: [
          { ...rawVersion('version-1', sourceSelection, 'no raw active'), rawOcr: [] },
          rawVersion('version-2', selectionWithZone('segment-2', 'zone-2', 0.7), 'latest raw'),
        ],
      }),
      videoFile({
        id: 'draft-file',
        status: 'completed',
        activeOcrVersionId: null,
        draft: {
          baseVersionId: 'version-3',
          selection: sourceSelection,
          dirty: true,
          updatedAt: '2026-05-26T12:00:00.000Z',
        },
        ocrVersions: [
          rawVersion('version-3', sourceSelection, 'draft fallback raw'),
        ],
      }),
    ]);

    expect(summary.retryTargets.map((file) => file.id)).toEqual(['video-1', 'draft-file']);
    expect(summary.retryAllMissingRawCount).toBe(2);
  });

  it('reports full pipeline fallback for partial retry dialogs when the active entry has no raw OCR', () => {
    const sourceSelection = selectionWithZone('segment-1', 'zone-1', 0.44);
    const draftFile = videoFile({
      activeOcrVersionId: null,
      draft: {
        baseVersionId: 'version-1',
        selection: sourceSelection,
        dirty: true,
        updatedAt: '2026-05-26T12:00:00.000Z',
      },
      ocrVersions: [
        rawVersion('version-1', sourceSelection, 'available raw from completed version'),
      ],
    });
    const noRawActiveFile = videoFile({
      activeOcrVersionId: 'version-1',
      ocrVersions: [
        { ...rawVersion('version-1', sourceSelection, 'no raw active'), rawOcr: [] },
        rawVersion('version-2', selectionWithZone('segment-2', 'zone-2', 0.7), 'latest raw'),
      ],
    });
    const rawActiveFile = videoFile({
      activeOcrVersionId: 'version-2',
      ocrVersions: [
        { ...rawVersion('version-1', sourceSelection, 'no raw inactive'), rawOcr: [] },
        rawVersion('version-2', selectionWithZone('segment-2', 'zone-2', 0.7), 'active raw'),
      ],
    });

    expect(willRetryFallbackToFullPipeline(draftFile, 'cleanup_only')).toBe(true);
    expect(willRetryFallbackToFullPipeline(noRawActiveFile, 'cleanup_and_ai')).toBe(true);
    expect(willRetryFallbackToFullPipeline(rawActiveFile, 'ai_only')).toBe(false);
    expect(willRetryFallbackToFullPipeline(draftFile, 'full_pipeline')).toBe(false);
    expect(canRunOcrRetryMode(draftFile, 'cleanup_only')).toBe(false);
    expect(canRunOcrRetryMode(draftFile, 'full_pipeline')).toBe(true);
    expect(canRunOcrRetryMode(rawActiveFile, 'ai_only')).toBe(true);
  });

  it('stores the same selection snapshot that was sent to the full OCR pipeline', async () => {
    const [addedFile] = videoOcrStore.addFilesFromPaths(['/Volumes/NAS/source.mkv']);
    const firstSelection = selectionWithZone('segment-active', 'zone-active', 0.44);
    const secondSelection = selectionWithZone('segment-latest', 'zone-latest', 0.7);
    videoOcrStore.updateFile(addedFile.id, { status: 'ready' });
    videoOcrStore.addOcrVersion(addedFile.id, rawVersion('version-1', firstSelection, 'first raw'));
    videoOcrStore.addOcrVersion(addedFile.id, rawVersion('version-2', secondSelection, 'second raw'));
    videoOcrStore.selectOcrVersion(addedFile.id, 'version-1');

    invokeMock.mockImplementationOnce(async () => {
      videoOcrStore.selectOcrVersion(addedFile.id, 'version-2');
      return pipelineResult();
    });

    const file = videoOcrStore.videoFiles[0];
    await processVideoOcrFile({
      file,
      operationId: 'ocr-run-1',
      versionName: 'Version 3',
      mode: 'full_pipeline',
      config: { ...DEFAULT_OCR_CONFIG, aiCleanupEnabled: false },
      aiCleanupControllers: new Map(),
      getFreshFile: (fileId) => videoOcrStore.videoFiles.find((entry) => entry.id === fileId),
      persistFileData: async () => true,
      markPersistedVersions: () => {},
    });

    const pipelinePayload = invokeMock.mock.calls.find(([command]) => command === 'run_ocr_pipeline')?.[1];
    const createdVersion = videoOcrStore.videoFiles[0].ocrVersions.at(-1);

    expect(pipelinePayload).toEqual(expect.objectContaining({ selection: firstSelection }));
    expect(createdVersion?.selectionSnapshot).toEqual(firstSelection);
  });
});

function selectionWithZone(segmentId: string, zoneId: string, y: number): VideoOcrSelection {
  return {
    segments: [
      {
        id: segmentId,
        startTimeMs: 0,
        endTimeMs: 60_000,
        zones: [
          {
            id: zoneId,
            role: 'main_subtitle',
            label: 'Zone 1',
            region: { x: 0.1, y, width: 0.8, height: 0.15 },
          },
        ],
      },
    ],
  };
}

function rawFrame(text: string): OcrRawFrame {
  return {
    frameIndex: 0,
    timeMs: 1_000,
    text,
    confidence: 0.91,
  };
}

function rawVersion(id: string, selectionSnapshot: VideoOcrSelection, text: string): OcrVersion {
  return {
    id,
    name: `Version ${id}`,
    createdAt: '2026-05-20T10:00:00.000Z',
    mode: 'full_pipeline',
    configSnapshot: DEFAULT_OCR_CONFIG,
    selectionSnapshot,
    rawFrameRate: DEFAULT_OCR_CONFIG.frameRate,
    rawOcr: [rawFrame(text)],
    finalSubtitles: [],
  };
}

function pipelineResult(): OcrPipelineResult {
  return {
    rawOcr: [rawFrame('pipeline raw')],
    subtitles: [],
    frameCount: 1,
    timings: {
      extractMs: 1,
      ocrMs: 1,
      subtitleMs: 1,
      totalMs: 3,
    },
    telemetry: {
      extractedFrames: 1,
      ocrAttemptedFrames: 1,
      textFrames: 1,
      unchangedSkippedFrames: 0,
      noTextSkippedFrames: 0,
      effectiveWorkers: 1,
      engineThreads: 1,
    },
  };
}
