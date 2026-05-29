import { describe, expect, it } from 'vitest';

import type {
  SubtitleOcrPersistenceData,
  SubtitleOcrSourceItem,
  SubtitleOcrVersion,
} from '$lib/types';
import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';
import {
  buildSubtitleOcrDraftVersionInput,
  buildSubtitleOcrSourceSnapshot,
  filterSubtitleOcrPersistenceForItem,
  getSubtitleOcrBackendCancelTargets,
  mergeSubtitleOcrPersistenceForItem,
  resolveSubtitleOcrEffectiveModelForConfig,
  resolveSubtitleOcrFullRetryConfig,
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
  it('counts ready, retryable, and scanning items', () => {
    expect(summarizeSubtitleOcrItems([
      { status: 'ready', versions: [] },
      { status: 'completed', versions: [{}] },
      { status: 'scanning', versions: [] },
    ])).toEqual({ readyCount: 1, retryableCount: 1, scanningCount: 1 });
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

describe('retry config resolution', () => {
  it('uses the active version config snapshot for full OCR retries', () => {
    const snapshotConfig = {
      ...DEFAULT_SUBTITLE_OCR_CONFIG,
      ocrModel: 'latin' as const,
      useGpu: false,
      aiCleanupEnabled: true,
      aiCleanupModel: 'snapshot-model',
    };
    const activeVersion = version('v1', {
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/source.sup',
      ocrModelOverride: 'default',
    });
    activeVersion.configSnapshot = snapshotConfig;
    const globalConfig = {
      ...DEFAULT_SUBTITLE_OCR_CONFIG,
      ocrModel: 'multi' as const,
      useGpu: true,
      aiCleanupEnabled: false,
      aiCleanupModel: 'global-model',
    };

    const resolved = resolveSubtitleOcrFullRetryConfig(activeVersion, globalConfig);

    expect(resolved).toEqual(snapshotConfig);
    expect(resolved).not.toBe(snapshotConfig);
  });

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
      thumbnailPath: '/tmp/thumb.png',
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
