import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SUBTITLE_OCR_CONFIG,
  SUBTITLE_OCR_OUTPUT_FORMATS,
  buildSubtitleOcrSourceLabel,
  getSubtitleOcrEffectiveModel,
  type SubtitleOcrSourceItem,
} from './subtitle-ocr';

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

  it('defaults to GPU on and AI cleanup off', () => {
    expect(DEFAULT_SUBTITLE_OCR_CONFIG.useGpu).toBe(true);
    expect(DEFAULT_SUBTITLE_OCR_CONFIG.aiCleanupEnabled).toBe(false);
  });
});
