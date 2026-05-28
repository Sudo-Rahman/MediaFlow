import { describe, expect, it } from 'vitest';

import type {
  SubtitleOcrPersistenceData,
  SubtitleOcrSourceItem,
  SubtitleOcrVersion,
} from '$lib/types';
import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';
import {
  buildSubtitleOcrSourceSnapshot,
  filterSubtitleOcrPersistenceForItem,
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
