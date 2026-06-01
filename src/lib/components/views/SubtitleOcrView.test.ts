import { describe, expect, it } from 'vitest';

import type {
  SubtitleOcrPersistenceData,
  SubtitleOcrSourceItem,
  SubtitleOcrVersion,
} from '$lib/types';
import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';
import {
  buildSubtitleOcrDraftVersionInput,
  buildSubtitleOcrProgressFromEvent,
  buildSubtitleOcrSourceSnapshot,
  collectMissingSubtitleOcrBitmapAssets,
  filterSubtitleOcrPersistenceForItem,
  getSubtitleOcrActiveVersionItemIds,
  getSubtitleOcrBackendCancelTargets,
  getSubtitleOcrVersionedItemIds,
  mergeRestoredSubtitleOcrBitmapAssets,
  mergeSubtitleOcrPersistenceForItem,
  resolveSubtitleOcrExpectedBitmapCount,
  resolveSubtitleOcrEffectiveModelForConfig,
  shouldApplySubtitleOcrProgressEvent,
  summarizeSubtitleOcrItems,
} from './subtitle-ocr-view-state';

function version(
  id: string,
  sourceSnapshot: SubtitleOcrVersion['sourceSnapshot'],
): SubtitleOcrVersion {
  return {
    id,
    name: id,
    createdAt: '2026-05-28T00:00:00.000Z',
    mode: 'full_ocr',
    configSnapshot: DEFAULT_SUBTITLE_OCR_CONFIG,
    effectiveOcrModel: DEFAULT_SUBTITLE_OCR_CONFIG.ocrModel,
    sourceSnapshot,
    bitmaps: [],
    rawOcr: [],
    stabilizedCues: [],
    finalCues: [],
    aiCleanupApplied: false,
  };
}

function containerItem(streamIndex: number): SubtitleOcrSourceItem {
  return {
    id: `track-${streamIndex}`,
    sourceKind: 'container_track',
    sourcePath: '/media/movie.mkv',
    displayName: 'movie.mkv',
    status: 'ready',
    ocrModelOverride: 'default',
    track: {
      streamIndex,
      codec: 'hdmv_pgs_subtitle',
      codecLabel: 'PGS',
    },
    versions: [],
    activeVersionId: null,
  };
}

function persistenceData(versions: SubtitleOcrVersion[], activeVersionId: string | null): SubtitleOcrPersistenceData {
  return {
    version: 1,
    sourcePath: '/media/movie.mkv',
    versions,
    activeVersionId,
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
  };
}

describe('summarizeSubtitleOcrItems', () => {
  it('counts ready and scanning items', () => {
    expect(summarizeSubtitleOcrItems([
      { status: 'ready' },
      { status: 'completed' },
      { status: 'error' },
      { status: 'scanning' },
    ])).toEqual({ readyCount: 1, scanningCount: 1 });
  });
});

describe('subtitle OCR retry target selection', () => {
  it('targets every versioned source for Full OCR retry', () => {
    expect(getSubtitleOcrVersionedItemIds([
      { id: 'ready', versions: [], activeVersionId: null },
      { id: 'active', versions: [{ id: 'v1' }], activeVersionId: 'v1' },
      { id: 'stale-active', versions: [{ id: 'v1' }], activeVersionId: 'missing' },
      { id: 'inactive', versions: [{ id: 'v2' }], activeVersionId: null },
    ])).toEqual(['active', 'stale-active', 'inactive']);
  });

  it('targets only sources with a valid active version for AI cleanup-only retry', () => {
    expect(getSubtitleOcrActiveVersionItemIds([
      { id: 'ready', versions: [], activeVersionId: null },
      { id: 'active', versions: [{ id: 'v1' }], activeVersionId: 'v1' },
      { id: 'stale-active', versions: [{ id: 'v1' }], activeVersionId: 'missing' },
      { id: 'inactive', versions: [{ id: 'v2' }], activeVersionId: null },
    ])).toEqual(['active']);
  });
});

describe('shouldApplySubtitleOcrProgressEvent', () => {
  it('requires the progress event run id to match the active item run', () => {
    const activeRunIds = new Map([['item-1', 'run-current']]);

    expect(
      shouldApplySubtitleOcrProgressEvent('item-1', 'run-current', activeRunIds, false),
    ).toBe(true);
    expect(
      shouldApplySubtitleOcrProgressEvent('item-1', undefined, activeRunIds, false),
    ).toBe(false);
    expect(
      shouldApplySubtitleOcrProgressEvent('item-1', 'run-stale', activeRunIds, false),
    ).toBe(false);
    expect(
      shouldApplySubtitleOcrProgressEvent('item-2', 'run-current', activeRunIds, false),
    ).toBe(false);
    expect(
      shouldApplySubtitleOcrProgressEvent('item-1', 'run-current', activeRunIds, true),
    ).toBe(false);
  });
});

describe('buildSubtitleOcrProgressFromEvent', () => {
  it('uses direct overall progress while restoring preview assets', () => {
    const progress = buildSubtitleOcrProgressFromEvent({
      phase: 'decoding',
      current: 183,
      total: 685,
      totalKnown: true,
      percentage: 26,
    }, true);

    expect(progress).toEqual({
      phase: 'decoding',
      current: 183,
      total: 685,
      totalKnown: true,
      percentage: 26,
      overallPercentage: 26,
    });
  });

  it('leaves normal OCR progress phase-weighted by default', () => {
    const progress = buildSubtitleOcrProgressFromEvent({
      phase: 'decoding',
      current: 183,
      total: 685,
      totalKnown: true,
      percentage: 26,
    });

    expect(progress).toEqual({
      phase: 'decoding',
      current: 183,
      total: 685,
      totalKnown: true,
      percentage: 26,
    });
  });
});

describe('getSubtitleOcrBackendCancelTargets', () => {
  it('excludes queued processing items without an active backend operation', () => {
    expect(getSubtitleOcrBackendCancelTargets(
      new Set(['active-item', 'queued-item']),
      new Map([['active-item', 'run-active']]),
    )).toEqual([{ itemId: 'active-item', runId: 'run-active' }]);
  });

  it('excludes AI cleanup-only items without an active backend operation', () => {
    expect(getSubtitleOcrBackendCancelTargets(
      new Set(['ai-cleanup-item']),
      new Map(),
    )).toEqual([]);
  });

  it('excludes an item in the prepare-to-pipeline gap', () => {
    expect(getSubtitleOcrBackendCancelTargets(
      new Set(['container-track']),
      new Map(),
    )).toEqual([]);
  });
});

describe('retry model resolution', () => {
  it('resolves OCR model from the retry snapshot global model plus the current item override', () => {
    const item = {
      ...containerItem(3),
      ocrModelOverride: 'default' as const,
    };

    expect(resolveSubtitleOcrEffectiveModelForConfig(item, {
      ...DEFAULT_SUBTITLE_OCR_CONFIG,
      ocrModel: 'latin',
    })).toBe('latin');

    expect(resolveSubtitleOcrEffectiveModelForConfig({
      ...item,
      ocrModelOverride: 'en',
    }, {
      ...DEFAULT_SUBTITLE_OCR_CONFIG,
      ocrModel: 'latin',
    })).toBe('en');
  });
});

describe('resolveSubtitleOcrExpectedBitmapCount', () => {
  it('uses the active version bitmap count when available', () => {
    const activeVersion = version('v1', {
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/source.sup',
      ocrModelOverride: 'default',
    });
    activeVersion.bitmaps = [
      {
        cueId: 'bitmap-1',
        startTimeMs: 1_000,
        endTimeMs: 2_000,
        width: 640,
        height: 120,
      },
      {
        cueId: 'bitmap-2',
        startTimeMs: 3_000,
        endTimeMs: 4_000,
        width: 640,
        height: 120,
      },
    ];

    expect(resolveSubtitleOcrExpectedBitmapCount(activeVersion)).toBe(2);
    expect(resolveSubtitleOcrExpectedBitmapCount(version('empty', activeVersion.sourceSnapshot)))
      .toBeUndefined();
    expect(resolveSubtitleOcrExpectedBitmapCount(null)).toBeUndefined();
  });
});

describe('subtitle OCR bitmap asset restore helpers', () => {
  it('collects bitmaps with missing preview files', async () => {
    const sourceSnapshot = {
      sourceKind: 'standalone_sup' as const,
      sourcePath: '/subs/source.sup',
      ocrModelOverride: 'default' as const,
    };
    const v1 = version('v1', sourceSnapshot);
    const v2 = version('v2', sourceSnapshot);
    const sharedMissing = {
      cueId: 'cue-1',
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      width: 640,
      height: 120,
      cacheKey: 'shared-cache',
      previewPath: '/tmp/missing-preview.png',
    };
    v1.bitmaps = [
      sharedMissing,
      {
        cueId: 'cue-2',
        startTimeMs: 3_000,
        endTimeMs: 4_000,
        width: 640,
        height: 120,
        cacheKey: 'existing-cache',
        previewPath: '/tmp/existing-preview.png',
      },
    ];
    v2.bitmaps = [{ ...sharedMissing, cueId: 'cue-1-copy' }];

    const seenMissingKeys = new Set<string>();
    const missing = await collectMissingSubtitleOcrBitmapAssets([v1, v2], async (bitmaps) => (
      bitmaps.filter((bitmap) => {
        if (!bitmap.previewPath?.includes('missing')) {
          return false;
        }

        const key = bitmap.cacheKey ?? bitmap.cueId;
        if (seenMissingKeys.has(key)) {
          return false;
        }

        seenMissingKeys.add(key);
        return true;
      })
    ));

    expect(missing).toEqual([sharedMissing]);
  });

  it('lets the backend evaluate duplicate bitmap keys before deduplication', async () => {
    const sourceSnapshot = {
      sourceKind: 'standalone_sup' as const,
      sourcePath: '/subs/source.sup',
      ocrModelOverride: 'default' as const,
    };
    const v1 = version('v1', sourceSnapshot);
    const v2 = version('v2', sourceSnapshot);
    const existingDuplicate = {
      cueId: 'cue-1',
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      width: 640,
      height: 120,
      cacheKey: 'shared-cache',
      previewPath: '/tmp/existing-preview.png',
    };
    const missingDuplicate = {
      ...existingDuplicate,
      cueId: 'cue-1-copy',
      previewPath: '/tmp/missing-preview.png',
    };
    v1.bitmaps = [existingDuplicate];
    v2.bitmaps = [missingDuplicate];

    const seenByCollector: SubtitleOcrVersion['bitmaps'] = [];
    const missing = await collectMissingSubtitleOcrBitmapAssets([v1, v2], async (bitmaps) => {
      seenByCollector.push(...bitmaps);
      return bitmaps.filter((bitmap) => bitmap.previewPath?.includes('missing'));
    });

    expect(seenByCollector).toEqual([existingDuplicate, missingDuplicate]);
    expect(missing).toEqual([missingDuplicate]);
  });

  it('treats absent preview paths as restore targets', async () => {
    const sourceSnapshot = {
      sourceKind: 'standalone_sup' as const,
      sourcePath: '/subs/source.sup',
      ocrModelOverride: 'default' as const,
    };
    const v1 = version('v1', sourceSnapshot);
    v1.bitmaps = [{
      cueId: 'cue-1',
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      width: 640,
      height: 120,
      cacheKey: 'cache-1',
    }];

    const missing = await collectMissingSubtitleOcrBitmapAssets([v1], async (bitmaps) => bitmaps);

    expect(missing).toEqual(v1.bitmaps);
  });

  it('merges restored bitmap paths across versions by cache key without changing OCR data', () => {
    const sourceSnapshot = {
      sourceKind: 'standalone_sup' as const,
      sourcePath: '/subs/source.sup',
      ocrModelOverride: 'default' as const,
    };
    const v1 = version('v1', sourceSnapshot);
    const v2 = version('v2', sourceSnapshot);
    v1.rawOcr = [{
      cueId: 'raw-1',
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      cacheKey: 'raw-cache',
      boxes: [],
      text: 'raw text',
      confidence: 0.8,
    }];
    v1.finalCues = [{
      id: 'cue-final',
      sourceCueIds: ['raw-1'],
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      text: 'edited text',
      confidence: 0.8,
    }];
    v1.bitmaps = [{
      cueId: 'cue-1',
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      width: 640,
      height: 120,
      cacheKey: 'shared-cache',
      previewPath: '/tmp/old-preview.png',
    }];
    v2.bitmaps = [{
      cueId: 'cue-1-copy',
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      width: 640,
      height: 120,
      cacheKey: 'shared-cache',
      previewPath: '/tmp/old-preview-copy.png',
    }];

    const merged = mergeRestoredSubtitleOcrBitmapAssets([v1, v2], [{
      cueId: 'cue-1',
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      width: 640,
      height: 120,
      cacheKey: 'shared-cache',
      previewPath: '/tmp/new-preview.png',
    }]);

    expect(merged[0].bitmaps[0]).toMatchObject({
      previewPath: '/tmp/new-preview.png',
    });
    expect(merged[1].bitmaps[0]).toMatchObject({
      previewPath: '/tmp/new-preview.png',
    });
    expect(merged[0].rawOcr).toEqual(v1.rawOcr);
    expect(merged[0].finalCues).toEqual(v1.finalCues);
    expect(merged[0].configSnapshot).toEqual(v1.configSnapshot);
  });

  it('prefers restored cache key matches over earlier lower-priority matches', () => {
    const sourceSnapshot = {
      sourceKind: 'standalone_sup' as const,
      sourcePath: '/subs/source.sup',
      ocrModelOverride: 'default' as const,
    };
    const v1 = version('v1', sourceSnapshot);
    v1.bitmaps = [{
      cueId: 'cue-1',
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      width: 640,
      height: 120,
      cacheKey: 'cache-target',
      previewPath: '/tmp/old-preview.png',
    }];

    const merged = mergeRestoredSubtitleOcrBitmapAssets([v1], [
      {
        cueId: 'cue-1',
        startTimeMs: 1_000,
        endTimeMs: 2_000,
        width: 640,
        height: 120,
        cacheKey: 'other-cache',
        previewPath: '/tmp/cue-id-preview.png',
      },
      {
        cueId: 'other-cue',
        startTimeMs: 3_000,
        endTimeMs: 4_000,
        width: 640,
        height: 120,
        cacheKey: 'cache-target',
        previewPath: '/tmp/cache-preview.png',
      },
    ]);

    expect(merged[0].bitmaps[0]).toMatchObject({
      previewPath: '/tmp/cache-preview.png',
    });
  });
});

describe('buildSubtitleOcrDraftVersionInput', () => {
  it('turns dirty draft cues into a new version input without replacing OCR artifacts', () => {
    const item = containerItem(3);
    const activeVersion = version('v1', buildSubtitleOcrSourceSnapshot(item));
    activeVersion.bitmaps = [{
      cueId: 'bitmap-1',
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      width: 640,
      height: 120,
      cacheKey: 'bitmap-cache',
      previewPath: '/tmp/preview.png',
    }];
    activeVersion.rawOcr = [{
      cueId: 'raw-1',
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      cacheKey: 'raw-cache',
      boxes: [],
      text: 'raw',
      confidence: 0.9,
    }];
    activeVersion.stabilizedCues = [{
      id: 'cue-1',
      sourceCueIds: ['raw-1'],
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      text: 'before',
      confidence: 0.9,
    }];
    activeVersion.finalCues = [{
      id: 'cue-1',
      sourceCueIds: ['raw-1'],
      startTimeMs: 1_000,
      endTimeMs: 2_000,
      text: 'before',
      confidence: 0.9,
    }];
    item.versions = [activeVersion];
    item.activeVersionId = activeVersion.id;
    item.draft = {
      baseVersionId: activeVersion.id,
      cues: [{ ...activeVersion.finalCues[0], text: 'edited' }],
      dirty: true,
      updatedAt: '2026-05-29T10:00:00.000Z',
    };

    const input = buildSubtitleOcrDraftVersionInput(item, activeVersion);

    expect(input).toMatchObject({
      mode: 'full_ocr',
      bitmaps: activeVersion.bitmaps,
      rawOcr: activeVersion.rawOcr,
      stabilizedCues: activeVersion.stabilizedCues,
      finalCues: item.draft.cues,
      aiCleanupApplied: false,
    });
    expect(input?.finalCues[0]?.text).toBe('edited');
    expect(activeVersion.finalCues[0]?.text).toBe('before');
  });

  it('ignores clean or stale drafts', () => {
    const item = containerItem(3);
    const activeVersion = version('v1', buildSubtitleOcrSourceSnapshot(item));

    expect(buildSubtitleOcrDraftVersionInput(item, activeVersion)).toBeNull();

    item.draft = {
      baseVersionId: 'other-version',
      cues: [],
      dirty: true,
      updatedAt: '2026-05-29T10:00:00.000Z',
    };
    expect(buildSubtitleOcrDraftVersionInput(item, activeVersion)).toBeNull();
  });
});

describe('filterSubtitleOcrPersistenceForItem', () => {
  it('hydrates only versions matching the selected container track', () => {
    const matchingItem = containerItem(3);
    const matchingVersion = version('match', buildSubtitleOcrSourceSnapshot(matchingItem));
    const otherVersion = version('other', buildSubtitleOcrSourceSnapshot(containerItem(4)));

    const filtered = filterSubtitleOcrPersistenceForItem(
      matchingItem,
      persistenceData([otherVersion, matchingVersion], otherVersion.id),
    );

    expect(filtered?.versions.map((entry) => entry.id)).toEqual(['match']);
    expect(filtered?.activeVersionId).toBe('match');
  });

  it('matches standalone VobSub persistence by pair paths', () => {
    const item: SubtitleOcrSourceItem = {
      id: 'vobsub',
      sourceKind: 'standalone_vobsub',
      sourcePath: '/subs/movie.idx',
      displayName: 'movie.idx/movie.sub',
      status: 'ready',
      ocrModelOverride: 'default',
      pair: {
        idxPath: '/subs/movie.idx',
        subPath: '/subs/movie.sub',
      },
      versions: [],
      activeVersionId: null,
    };
    const matchingVersion = version('vobsub-v1', buildSubtitleOcrSourceSnapshot(item));
    const filtered = filterSubtitleOcrPersistenceForItem(
      item,
      persistenceData([matchingVersion], matchingVersion.id),
    );

    expect(filtered?.versions).toHaveLength(1);
    expect(filtered?.activeVersionId).toBe('vobsub-v1');
  });
});

describe('mergeSubtitleOcrPersistenceForItem', () => {
  it('preserves versions for other container tracks sharing the same source path', () => {
    const currentItem = containerItem(3);
    const currentVersion = version('track-3-new', buildSubtitleOcrSourceSnapshot(currentItem));
    currentItem.versions = [currentVersion];
    currentItem.activeVersionId = currentVersion.id;

    const oldCurrentVersion = version('track-3-old', buildSubtitleOcrSourceSnapshot(currentItem));
    const otherTrackVersion = version(
      'track-4-existing',
      buildSubtitleOcrSourceSnapshot(containerItem(4)),
    );
    const existingData = persistenceData(
      [oldCurrentVersion, otherTrackVersion],
      otherTrackVersion.id,
    );

    const merged = mergeSubtitleOcrPersistenceForItem(
      currentItem,
      existingData,
      '2026-05-29T10:00:00.000Z',
    );

    expect(merged).toMatchObject({
      sourcePath: '/media/movie.mkv',
      activeVersionId: 'track-3-new',
      createdAt: existingData.createdAt,
      updatedAt: '2026-05-29T10:00:00.000Z',
    });
    expect(merged.versions.map((entry) => entry.id)).toEqual([
      'track-4-existing',
      'track-3-new',
    ]);
  });
});
