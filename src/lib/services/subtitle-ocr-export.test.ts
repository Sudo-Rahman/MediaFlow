import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubtitleOcrCue, SubtitleOcrSourceItem, SubtitleOcrVersion } from '$lib/types';
import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';

import type { VersionedExportRequest } from './versioned-export';
import {
  buildSubtitleOcrExportGroups,
  runSubtitleOcrBatchExport,
  SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS,
  toRustSubtitleOcrCues,
} from './subtitle-ocr-export';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: mocks.join,
}));

function createCue(overrides: Partial<SubtitleOcrCue> = {}): SubtitleOcrCue {
  return {
    id: 'cue-1',
    sourceCueIds: ['raw-1'],
    startTimeMs: 1_000,
    endTimeMs: 2_000,
    text: 'Detected text',
    confidence: 0.95,
    ...overrides,
  };
}

function createVersion(
  id: string,
  overrides: Partial<SubtitleOcrVersion> = {},
): SubtitleOcrVersion {
  return {
    id,
    name: `Version ${id}`,
    createdAt: `2026-05-18T12:00:0${id.replace(/\D/g, '') || '0'}.000Z`,
    mode: 'full_ocr',
    configSnapshot: DEFAULT_SUBTITLE_OCR_CONFIG,
    effectiveOcrModel: 'multi',
    sourceSnapshot: {
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/movie.sup',
      ocrModelOverride: 'default',
    },
    bitmaps: [],
    rawOcr: [],
    stabilizedCues: [],
    finalCues: [createCue()],
    aiCleanupApplied: false,
    ...overrides,
  };
}

function createItem(
  id: string,
  versions: SubtitleOcrVersion[],
  overrides: Partial<Pick<SubtitleOcrSourceItem, 'displayName' | 'status' | 'activeVersionId'>> = {},
): SubtitleOcrSourceItem {
  return {
    sourceKind: 'standalone_sup',
    sourcePath: `/subs/${id}.sup`,
    ocrModelOverride: 'default',
    id,
    displayName: `${id}.sup`,
    status: 'completed',
    versions,
    activeVersionId: versions.at(-1)?.id ?? null,
    ...overrides,
  };
}

function createExportRequest(overrides: Partial<VersionedExportRequest> = {}): VersionedExportRequest {
  return {
    mode: 'custom',
    format: 'srt',
    outputDir: '/exports',
    targets: [
      {
        fileId: 'movie',
        fileName: 'Movie.en.sup',
        versionKey: 'movie:v1',
        versionId: 'v1',
        versionName: 'Clean pass',
      },
    ],
    ...overrides,
  };
}

describe('Subtitle OCR export service', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.join.mockReset();
    mocks.join.mockImplementation(async (...parts: string[]) => parts.join('/'));
  });

  it('builds one export group per source with version badges and allowed formats', () => {
    const firstVersion = createVersion('v1');
    const secondVersion = createVersion('v2');
    const groups = buildSubtitleOcrExportGroups([
      createItem('movie', [firstVersion, secondVersion], { displayName: 'Movie.sup' }),
      createItem('episode', [createVersion('v3')], { displayName: 'Episode.idx' }),
      createItem('empty', []),
    ]);

    expect(groups).toEqual([
      {
        fileId: 'movie',
        fileName: 'Movie.sup',
        fileBadge: '2 versions',
        versions: [
          {
            key: 'movie:v1',
            versionId: 'v1',
            versionName: 'Version v1',
            createdAt: firstVersion.createdAt,
            allowedFormats: SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS,
          },
          {
            key: 'movie:v2',
            versionId: 'v2',
            versionName: 'Version v2',
            createdAt: secondVersion.createdAt,
            allowedFormats: SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS,
          },
        ],
      },
      {
        fileId: 'episode',
        fileName: 'Episode.idx',
        fileBadge: '1 version',
        versions: [
          {
            key: 'episode:v3',
            versionId: 'v3',
            versionName: 'Version v3',
            createdAt: '2026-05-18T12:00:03.000Z',
            allowedFormats: SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS,
          },
        ],
      },
    ]);
  });

  it('clones source cue ids and preserves real line breaks for Rust payloads', () => {
    const sourceCueIds = ['raw-1', 'raw-2'];
    const rustCues = toRustSubtitleOcrCues([
      createCue({
        sourceCueIds,
        text: 'First line\nSecond line',
      }),
    ]);

    expect(rustCues).toEqual([
      {
        id: 'cue-1',
        sourceCueIds: ['raw-1', 'raw-2'],
        startTimeMs: 1_000,
        endTimeMs: 2_000,
        text: 'First line\nSecond line',
        confidence: 0.95,
      },
    ]);
    expect(rustCues[0]?.sourceCueIds).not.toBe(sourceCueIds);
    sourceCueIds.push('raw-3');
    expect(rustCues[0]?.sourceCueIds).toEqual(['raw-1', 'raw-2']);
  });

  it('exports selected versions through the Rust command and writes joined output paths', async () => {
    const item = createItem('movie', [
      createVersion('v1', {
        name: 'Clean pass',
        finalCues: [
          createCue({
            text: 'First line\nSecond line',
            sourceCueIds: ['raw-1', 'raw-2'],
          }),
        ],
      }),
    ], { displayName: 'Movie.en.sup' });

    const result = await runSubtitleOcrBatchExport(createExportRequest(), [item]);

    expect(result).toEqual({ successCount: 1, failCount: 0, failures: [] });
    expect(mocks.join).toHaveBeenCalledWith('/exports', 'Movie.en_clean_pass.srt');
    expect(mocks.invoke).toHaveBeenCalledWith('export_subtitle_ocr_version', {
      cues: [
        {
          id: 'cue-1',
          sourceCueIds: ['raw-1', 'raw-2'],
          startTimeMs: 1_000,
          endTimeMs: 2_000,
          text: 'First line\nSecond line',
          confidence: 0.95,
        },
      ],
      outputPath: '/exports/Movie.en_clean_pass.srt',
      format: 'srt',
    });
  });

  it('rejects invalid export formats before running the batch', async () => {
    await expect(
      runSubtitleOcrBatchExport(createExportRequest({ format: 'json' }), [
        createItem('movie', [createVersion('v1')]),
      ]),
    ).rejects.toThrow('Invalid export format');

    expect(mocks.join).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('reports a missing version as a failed export target', async () => {
    const result = await runSubtitleOcrBatchExport(
      createExportRequest({
        targets: [
          {
            fileId: 'movie',
            fileName: 'Movie.en.sup',
            versionKey: 'movie:missing',
            versionId: 'missing',
            versionName: 'Missing version',
          },
        ],
      }),
      [createItem('movie', [createVersion('v1')])],
    );

    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(1);
    expect(result.failures[0]?.message).toBe('Subtitle OCR version not found: missing');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('reports versions without exportable cues as failed export targets', async () => {
    const result = await runSubtitleOcrBatchExport(createExportRequest(), [
      createItem('movie', [
        createVersion('v1', {
          finalCues: [
            createCue({ id: 'blank', text: '   ' }),
            createCue({ id: 'invalid-range', startTimeMs: 3_000, endTimeMs: 3_000 }),
          ],
        }),
      ]),
    ]);

    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(1);
    expect(result.failures[0]?.message).toBe('No valid Subtitle OCR cues to export');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
