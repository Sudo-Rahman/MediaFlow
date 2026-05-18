import { describe, expect, it } from 'vitest';

import type { OcrConfig, OcrVersion, OcrVideoFile } from '$lib/types/video-ocr';
import { createDefaultVideoOcrSelection } from '$lib/utils';
import {
  buildOcrResultVersionLoadKey,
  createOcrResultVersionSnapshot,
} from './ocr-result-dialog-state';

const configSnapshot: OcrConfig = {
  frameRate: 10,
  language: 'multi',
  useGpu: true,
  confidenceThreshold: 0.5,
  threadCount: 2,
  mergeSimilar: true,
  similarityThreshold: 0.92,
  maxGapMs: 250,
  minCueDurationMs: 500,
  filterUrlLike: true,
  aiCleanupEnabled: false,
  aiCleanupProvider: 'openai',
  aiCleanupModel: 'gpt-5.4',
};

function createVersion(id: string, createdAt: string): OcrVersion {
  return {
    id,
    name: `Version ${id}`,
    createdAt,
    mode: 'full_pipeline',
    configSnapshot,
    rawOcr: [
      {
        frameIndex: 1,
        timeMs: 1000,
        text: 'raw text',
        confidence: 0.95,
      },
    ],
    finalSubtitles: [
      {
        id: 'subtitle-1',
        text: 'Subtitle text',
        startTime: 1000,
        endTime: 2000,
        confidence: 0.95,
      },
    ],
  };
}

function createFile(overrides: Partial<OcrVideoFile> = {}): OcrVideoFile {
  return {
    id: 'video-1',
    path: '/Users/sr-71/Movies/sample.mp4',
    name: 'sample.mp4',
    size: 123,
    status: 'completed',
    ocrSelection: createDefaultVideoOcrSelection(60_000),
    ocrVersions: [createVersion('ocr-v-1', '2026-05-12T17:00:00.000Z')],
    ...overrides,
  };
}

describe('OCR result dialog state', () => {
  it('keeps the version load key stable for preview-only file updates', () => {
    const file = createFile();
    const initialKey = buildOcrResultVersionLoadKey(file);

    const transcodingFile = createFile({
      status: 'transcoding',
      isTranscoding: true,
      transcodingProgress: 42,
      transcodingCodec: 'H.264 VideoToolbox',
      previewPath: '/tmp/mediaflow-preview/sample.mp4',
      previewVersion: 'ocr-preview-v3-480p-progress-timeout',
    });

    expect(buildOcrResultVersionLoadKey(transcodingFile)).toBe(initialKey);
  });

  it('changes the version load key when the file or OCR versions change', () => {
    const file = createFile();
    const initialKey = buildOcrResultVersionLoadKey(file);

    expect(buildOcrResultVersionLoadKey(createFile({ id: 'video-2' }))).not.toBe(initialKey);
    expect(buildOcrResultVersionLoadKey(createFile({
      ocrVersions: [
        ...file.ocrVersions,
        createVersion('ocr-v-2', '2026-05-12T17:05:00.000Z'),
      ],
    }))).not.toBe(initialKey);
    expect(buildOcrResultVersionLoadKey(createFile({
      ocrVersions: [{
        ...file.ocrVersions[0],
        finalSubtitles: [{
          ...file.ocrVersions[0].finalSubtitles[0],
          text: 'Updated subtitle text',
        }],
      }],
    }))).not.toBe(initialKey);
  });

  it('creates a lightweight version snapshot without mutating the source versions', () => {
    const [version] = createFile().ocrVersions;
    const snapshot = createOcrResultVersionSnapshot([version]);

    expect(snapshot[0]).toMatchObject({
      id: version.id,
      createdAt: version.createdAt,
      finalSubtitles: version.finalSubtitles,
    });
    expect(snapshot[0].rawOcr).toEqual([]);
    expect(version.rawOcr).toHaveLength(1);
  });
});
