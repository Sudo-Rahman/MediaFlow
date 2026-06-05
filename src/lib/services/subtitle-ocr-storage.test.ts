import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SubtitleOcrConfig,
  SubtitleOcrCue,
  SubtitleOcrCueBitmap,
  SubtitleOcrPersistenceData,
  SubtitleOcrRawCue,
  SubtitleOcrSourceSnapshot,
} from '$lib/types';
import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';
import {
  createSubtitleOcrVersion,
  loadSubtitleOcrData,
  sanitizeSubtitleOcrPersistenceData,
  saveSubtitleOcrData,
} from './subtitle-ocr-storage';

const loadMediaflowDataMock = vi.hoisted(() => vi.fn());
const saveMediaflowDataMock = vi.hoisted(() => vi.fn());

vi.mock('./mediaflow-storage', () => ({
  loadMediaflowData: loadMediaflowDataMock,
  saveMediaflowData: saveMediaflowDataMock,
}));

const NOW = '2026-05-28T10:15:30.000Z';

type StandaloneVobSubSnapshot = Extract<SubtitleOcrSourceSnapshot, { sourceKind: 'standalone_vobsub' }>;

function cue(id: string, text: string): SubtitleOcrCue {
  return {
    id,
    sourceCueIds: [`raw-${id}`],
    startTimeMs: 1_000,
    endTimeMs: 2_000,
    text,
    confidence: 0.92,
  };
}

function placedCue(id: string, text: string, placement: SubtitleOcrCue['placement']): SubtitleOcrCue {
  return {
    ...cue(id, text),
    placement,
  };
}

function bitmap(cueId: string): SubtitleOcrCueBitmap {
  return {
    cueId,
    startTimeMs: 1_000,
    endTimeMs: 2_000,
    width: 1920,
    height: 1080,
    cacheKey: `cache-${cueId}`,
    previewPath: `/tmp/${cueId}-preview.png`,
  };
}

function rawCue(cueId: string): SubtitleOcrRawCue {
  return {
    cueId,
    startTimeMs: 1_000,
    endTimeMs: 2_000,
    text: 'Detected text',
    confidence: 0.87,
    boxes: [
      {
        text: 'Detected',
        confidence: 0.9,
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      },
    ],
  };
}

function sourceSnapshot(): StandaloneVobSubSnapshot {
  return {
    sourceKind: 'standalone_vobsub',
    sourcePath: '/subs/movie.idx',
    ocrModelOverride: 'default',
    pair: {
      idxPath: '/subs/movie.idx',
      subPath: '/subs/movie.sub',
    },
  };
}

function persistenceData(overrides: Partial<SubtitleOcrPersistenceData> = {}): SubtitleOcrPersistenceData {
  const version = createSubtitleOcrVersion({
    name: 'Version 1',
    mode: 'full_ocr',
    configSnapshot: DEFAULT_SUBTITLE_OCR_CONFIG,
    effectiveOcrModel: 'multi',
    sourceSnapshot: sourceSnapshot(),
    bitmaps: [bitmap('cue-1')],
    rawOcr: [rawCue('cue-1')],
    stabilizedCues: [cue('cue-1', 'Stabilized')],
    finalCues: [cue('cue-1', 'Final')],
    aiCleanupApplied: true,
  });

  return {
    version: 1,
    sourcePath: '/subs/movie.idx',
    versions: [version],
    activeVersionId: version.id,
    createdAt: '2026-05-27T08:00:00.000Z',
    updatedAt: '2026-05-27T08:00:00.000Z',
    ...overrides,
  };
}

describe('subtitle OCR storage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
    loadMediaflowDataMock.mockReset();
    saveMediaflowDataMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates versions with immutable nested snapshots', () => {
    const config: SubtitleOcrConfig = {
      ...DEFAULT_SUBTITLE_OCR_CONFIG,
      ocrModel: 'latin',
      aiCleanupEnabled: true,
      aiCleanupModel: 'cleanup-model',
    };
    const snapshot = sourceSnapshot();
    const inputBitmaps = [bitmap('cue-1')];
    const inputRawOcr = [rawCue('cue-1')];
    const inputStabilizedCues = [cue('cue-1', 'Stabilized')];
    const inputFinalCues = [cue('cue-1', 'Final')];

    const version = createSubtitleOcrVersion({
      name: 'Version 1',
      mode: 'full_ocr',
      configSnapshot: config,
      effectiveOcrModel: 'latin',
      sourceSnapshot: snapshot,
      bitmaps: inputBitmaps,
      rawOcr: inputRawOcr,
      stabilizedCues: inputStabilizedCues,
      finalCues: inputFinalCues,
      aiCleanupApplied: true,
    });

    config.ocrModel = 'multi';
    config.aiCleanupModel = 'mutated-model';
    snapshot.pair.subPath = '/subs/mutated.sub';
    inputBitmaps[0].width = 100;
    inputRawOcr[0].boxes[0].text = 'Mutated box';
    inputStabilizedCues[0].sourceCueIds.push('mutated-source');
    inputFinalCues[0].text = 'Mutated final';

    expect(version).toEqual({
      id: 'subtitle-ocr-v-1779963330000-4fzzzxj',
      name: 'Version 1',
      createdAt: NOW,
      mode: 'full_ocr',
      configSnapshot: {
        ...DEFAULT_SUBTITLE_OCR_CONFIG,
        ocrModel: 'latin',
        aiCleanupEnabled: true,
        aiCleanupModel: 'cleanup-model',
      },
      effectiveOcrModel: 'latin',
      sourceSnapshot: {
        sourceKind: 'standalone_vobsub',
        sourcePath: '/subs/movie.idx',
        ocrModelOverride: 'default',
        pair: {
          idxPath: '/subs/movie.idx',
          subPath: '/subs/movie.sub',
        },
      },
      bitmaps: [bitmap('cue-1')],
      rawOcr: [rawCue('cue-1')],
      stabilizedCues: [cue('cue-1', 'Stabilized')],
      finalCues: [cue('cue-1', 'Final')],
      aiCleanupApplied: true,
    });
    expect(version.sourceSnapshot).not.toHaveProperty('track');
  });

  it('preserves raw OCR cache keys when creating versions', () => {
    const rawOcr = [{
      ...rawCue('cue-1'),
      cacheKey: 'raw-cache-cue-1',
    }];

    const version = createSubtitleOcrVersion({
      name: 'Version 1',
      mode: 'full_ocr',
      configSnapshot: DEFAULT_SUBTITLE_OCR_CONFIG,
      effectiveOcrModel: 'multi',
      sourceSnapshot: sourceSnapshot(),
      bitmaps: [],
      rawOcr,
      stabilizedCues: [],
      finalCues: [],
      aiCleanupApplied: false,
    });

    rawOcr[0].cacheKey = 'mutated-cache';

    expect(version.rawOcr[0]).toMatchObject({
      cueId: 'cue-1',
      cacheKey: 'raw-cache-cue-1',
    });
  });

  it('returns null for unsupported persistence versions', () => {
    expect(sanitizeSubtitleOcrPersistenceData({ version: 99 })).toBeNull();
  });

  it('sanitizes valid persistence data and preserves versions and active version id', () => {
    const data = persistenceData();

    const sanitized = sanitizeSubtitleOcrPersistenceData({
      ...data,
      unexpectedTopLevel: 'drop me',
      versions: [
        {
          ...data.versions[0],
          unexpectedVersionField: 'drop me',
        },
      ],
    });

    expect(sanitized).toEqual(data);
  });

  it('accepts old persisted cues without placement', () => {
    const data = persistenceData();
    const cueWithoutPlacement = cue('cue-1', 'Legacy cue');

    const sanitized = sanitizeSubtitleOcrPersistenceData({
      ...data,
      versions: [{
        ...data.versions[0],
        stabilizedCues: [cueWithoutPlacement],
        finalCues: [cueWithoutPlacement],
      }],
    });

    expect(sanitized?.versions[0]?.finalCues[0]).not.toHaveProperty('placement');
  });

  it('preserves cue placement in persisted versions', () => {
    const data = persistenceData();
    const topCue = {
      ...placedCue('cue-1', 'Top cue', 'top'),
      placementSourceCount: 3,
      topPlacementSourceCount: 2,
    };

    const sanitized = sanitizeSubtitleOcrPersistenceData({
      ...data,
      versions: [{
        ...data.versions[0],
        rawOcr: [{
          ...data.versions[0].rawOcr[0],
          placement: 'top',
          placementSourceCount: 3,
          topPlacementSourceCount: 2,
        }],
        stabilizedCues: [topCue],
        finalCues: [topCue],
      }],
    });

    expect(sanitized?.versions[0]?.rawOcr[0]?.placement).toBe('top');
    expect(sanitized?.versions[0]?.rawOcr[0]?.placementSourceCount).toBe(3);
    expect(sanitized?.versions[0]?.rawOcr[0]?.topPlacementSourceCount).toBe(2);
    expect(sanitized?.versions[0]?.stabilizedCues[0]?.placement).toBe('top');
    expect(sanitized?.versions[0]?.stabilizedCues[0]?.placementSourceCount).toBe(3);
    expect(sanitized?.versions[0]?.stabilizedCues[0]?.topPlacementSourceCount).toBe(2);
    expect(sanitized?.versions[0]?.finalCues[0]?.placement).toBe('top');
    expect(sanitized?.versions[0]?.finalCues[0]?.placementSourceCount).toBe(3);
    expect(sanitized?.versions[0]?.finalCues[0]?.topPlacementSourceCount).toBe(2);
  });

  it('rejects persisted placement counts that disagree with placement', () => {
    const data = persistenceData();
    const inconsistentCue = {
      ...placedCue('cue-1', 'Inconsistent cue', 'bottom'),
      placementSourceCount: 3,
      topPlacementSourceCount: 2,
    };

    expect(sanitizeSubtitleOcrPersistenceData({
      ...data,
      versions: [{
        ...data.versions[0],
        finalCues: [inconsistentCue],
      }],
    })).toBeNull();
  });

  it('rejects persisted placement counts without placement', () => {
    const data = persistenceData();

    expect(sanitizeSubtitleOcrPersistenceData({
      ...data,
      versions: [{
        ...data.versions[0],
        rawOcr: [{
          ...data.versions[0].rawOcr[0],
          placementSourceCount: 1,
          topPlacementSourceCount: 0,
        }],
      }],
    })).toBeNull();
  });

  it('sanitizes valid persistence data and preserves optional raw OCR cache keys', () => {
    const data = persistenceData();

    const sanitized = sanitizeSubtitleOcrPersistenceData({
      ...data,
      versions: [{
        ...data.versions[0],
        rawOcr: [{
          ...data.versions[0].rawOcr[0],
          cacheKey: 'raw-cache-cue-1',
        }],
      }],
    });

    expect(sanitized?.versions[0]?.rawOcr[0]).toMatchObject({
      cueId: 'cue-1',
      cacheKey: 'raw-cache-cue-1',
    });
  });

  it('rejects persisted data with an invalid active version id', () => {
    const data = persistenceData({ activeVersionId: 'missing-version' });

    expect(sanitizeSubtitleOcrPersistenceData(data)).toBeNull();
  });

  it('loads subtitle OCR data from common MediaFlow storage', async () => {
    const data = persistenceData();
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      subtitleOcr: data,
    });

    await expect(loadSubtitleOcrData('/subs/movie.idx')).resolves.toEqual(data);
  });

  it('saves subtitle OCR data while preserving existing tool data and updating timestamps', async () => {
    const data = persistenceData();
    const existingAudioToSubs = { version: 1, transcriptionVersions: [] };
    const existingVideoOcr = { version: 2, marker: 'video' };
    const existingTranslation = { version: 1, translationVersions: [] };
    loadMediaflowDataMock.mockResolvedValueOnce({
      version: 1,
      audioToSubs: existingAudioToSubs,
      videoOcr: existingVideoOcr,
      translation: existingTranslation,
    });
    saveMediaflowDataMock.mockResolvedValueOnce(true);

    await expect(saveSubtitleOcrData('/subs/movie.idx', data)).resolves.toBe(true);

    expect(saveMediaflowDataMock).toHaveBeenCalledWith('/subs/movie.idx', {
      version: 1,
      audioToSubs: existingAudioToSubs,
      videoOcr: existingVideoOcr,
      translation: existingTranslation,
      subtitleOcr: {
        ...data,
        sourcePath: '/subs/movie.idx',
        updatedAt: NOW,
      },
    });
  });
});
