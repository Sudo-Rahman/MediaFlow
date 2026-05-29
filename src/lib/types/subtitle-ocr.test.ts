import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SUBTITLE_OCR_CONFIG,
  SUBTITLE_OCR_OUTPUT_FORMATS,
  buildSubtitleOcrSourceLabel,
  getSubtitleOcrEffectiveModel,
  hasActiveSubtitleOcrVersion,
  hasSubtitleOcrVersions,
  type SubtitleOcrSourceSnapshot,
  type SubtitleOcrSourceItem,
  type SubtitleOcrTrackMetadata,
  type SubtitleOcrVobSubPair,
} from './subtitle-ocr';
import { getDefaultLLMModel, getDefaultLLMProvider } from './translation';

describe('subtitle OCR types', () => {
  it('keeps output formats limited to ASS, SRT, and VTT', () => {
    expect(SUBTITLE_OCR_OUTPUT_FORMATS.map((format) => format.value)).toEqual(['ass', 'srt', 'vtt']);
  });

  it('uses the global OCR model when an item is set to Default', () => {
    const item = {
      id: 'source-1',
      sourceKind: 'container_track',
      sourcePath: '/media/Movie.mkv',
      displayName: 'Movie.mkv',
      status: 'ready',
      ocrModelOverride: 'default',
      track: {
        streamIndex: 5,
        codec: 'hdmv_pgs_subtitle',
        codecLabel: 'PGS',
        language: 'fre',
        title: 'French subtitles',
        forced: false,
        default: true,
      },
      versions: [],
      activeVersionId: null,
    } satisfies SubtitleOcrSourceItem;

    expect(getSubtitleOcrEffectiveModel(item, 'latin')).toBe('latin');
  });

  it('uses a concrete item OCR model override when present', () => {
    const item = {
      id: 'source-2',
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/French.sup',
      displayName: 'French.sup',
      status: 'ready',
      ocrModelOverride: 'multi',
      versions: [],
      activeVersionId: null,
    } satisfies SubtitleOcrSourceItem;

    expect(getSubtitleOcrEffectiveModel(item, 'latin')).toBe('multi');
  });

  it('detects only valid active subtitle OCR versions', () => {
    expect(hasActiveSubtitleOcrVersion({
      activeVersionId: 'v1',
      versions: [{ id: 'v1' }],
    })).toBe(true);
    expect(hasActiveSubtitleOcrVersion({
      activeVersionId: 'missing',
      versions: [{ id: 'v1' }],
    })).toBe(false);
    expect(hasActiveSubtitleOcrVersion({
      activeVersionId: null,
      versions: [{ id: 'v1' }],
    })).toBe(false);
  });

  it('detects sources with any subtitle OCR version', () => {
    expect(hasSubtitleOcrVersions({ versions: [{ id: 'v1' }] })).toBe(true);
    expect(hasSubtitleOcrVersions({ versions: [] })).toBe(false);
  });

  it('enforces source metadata by source kind', () => {
    const track = {
      streamIndex: 4,
      codec: 'hdmv_pgs_subtitle',
      codecLabel: 'PGS',
    } satisfies SubtitleOcrTrackMetadata;
    const pair = {
      idxPath: '/subs/Movie.idx',
      subPath: '/subs/Movie.sub',
    } satisfies SubtitleOcrVobSubPair;

    const containerTrack = {
      sourceKind: 'container_track',
      sourcePath: '/media/Movie.mkv',
      ocrModelOverride: 'default',
      track,
    } satisfies SubtitleOcrSourceSnapshot;
    const standaloneSup = {
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/Movie.sup',
      ocrModelOverride: 'default',
    } satisfies SubtitleOcrSourceSnapshot;
    const standaloneVobSub = {
      sourceKind: 'standalone_vobsub',
      sourcePath: '/subs/Movie.idx',
      ocrModelOverride: 'default',
      pair,
    } satisfies SubtitleOcrSourceSnapshot;

    expect(containerTrack.sourceKind).toBe('container_track');
    expect(standaloneSup.sourceKind).toBe('standalone_sup');
    expect(standaloneVobSub.sourceKind).toBe('standalone_vobsub');

    // @ts-expect-error container tracks require track metadata.
    const containerTrackWithoutTrack: SubtitleOcrSourceSnapshot = { sourceKind: 'container_track', sourcePath: '/media/Movie.mkv', ocrModelOverride: 'default' };
    // @ts-expect-error container tracks do not accept VobSub pair metadata.
    const containerTrackWithPair: SubtitleOcrSourceSnapshot = { sourceKind: 'container_track', sourcePath: '/media/Movie.mkv', ocrModelOverride: 'default', track, pair };
    // @ts-expect-error standalone SUP sources do not accept track metadata.
    const standaloneSupWithTrack: SubtitleOcrSourceSnapshot = { sourceKind: 'standalone_sup', sourcePath: '/subs/Movie.sup', ocrModelOverride: 'default', track };
    // @ts-expect-error standalone SUP sources do not accept VobSub pair metadata.
    const standaloneSupWithPair: SubtitleOcrSourceSnapshot = { sourceKind: 'standalone_sup', sourcePath: '/subs/Movie.sup', ocrModelOverride: 'default', pair };
    // @ts-expect-error standalone VobSub sources require pair metadata.
    const standaloneVobSubWithoutPair: SubtitleOcrSourceSnapshot = { sourceKind: 'standalone_vobsub', sourcePath: '/subs/Movie.idx', ocrModelOverride: 'default' };
    // @ts-expect-error standalone VobSub sources do not accept track metadata.
    const standaloneVobSubWithTrack: SubtitleOcrSourceSnapshot = { sourceKind: 'standalone_vobsub', sourcePath: '/subs/Movie.idx', ocrModelOverride: 'default', pair, track };

    void containerTrackWithoutTrack;
    void containerTrackWithPair;
    void standaloneSupWithTrack;
    void standaloneSupWithPair;
    void standaloneVobSubWithoutPair;
    void standaloneVobSubWithTrack;
  });

  it('builds a source label with track metadata for container tracks', () => {
    const item = {
      id: 'source-3',
      sourceKind: 'container_track',
      sourcePath: '/media/Movie.mkv',
      displayName: 'Movie.mkv',
      status: 'ready',
      ocrModelOverride: 'default',
      track: {
        streamIndex: 6,
        codec: 'hdmv_pgs_subtitle',
        codecLabel: 'PGS',
        language: 'jpn',
        title: 'Japanese signs',
        forced: true,
        default: false,
      },
      versions: [],
      activeVersionId: null,
    } satisfies SubtitleOcrSourceItem;

    expect(buildSubtitleOcrSourceLabel(item)).toBe('Track 6 - PGS - Japanese signs - Forced');
  });

  it('defaults to multi OCR, GPU on, and AI cleanup off', () => {
    const expectedProvider = getDefaultLLMProvider();

    expect(DEFAULT_SUBTITLE_OCR_CONFIG.ocrModel).toBe('multi');
    expect(DEFAULT_SUBTITLE_OCR_CONFIG.useGpu).toBe(true);
    expect(DEFAULT_SUBTITLE_OCR_CONFIG.aiCleanupEnabled).toBe(false);
    expect(DEFAULT_SUBTITLE_OCR_CONFIG.aiCleanupProvider).toBe(expectedProvider);
    expect(DEFAULT_SUBTITLE_OCR_CONFIG.aiCleanupModel).toBe(getDefaultLLMModel(expectedProvider));
  });
});
