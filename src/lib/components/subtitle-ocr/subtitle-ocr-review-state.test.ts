import { describe, expect, it } from 'vitest';

import {
  clampTimelineViewport,
  findCueNearestTime,
  getVisibleCueRange,
  toCueTileWidth,
  type TimedCue,
} from './subtitle-ocr-review-state';

const cues: TimedCue[] = [
  { id: 'cue-1', startTimeMs: 1_000, endTimeMs: 2_000 },
  { id: 'cue-2', startTimeMs: 2_500, endTimeMs: 3_000 },
  { id: 'cue-3', startTimeMs: 5_000, endTimeMs: 8_000 },
  { id: 'cue-4', startTimeMs: 9_500, endTimeMs: 10_000 },
];

describe('subtitle OCR review state', () => {
  describe('getVisibleCueRange', () => {
    it('returns the half-open range of cues intersecting the viewport', () => {
      expect(getVisibleCueRange(cues, 2_700, 5_100)).toEqual({
        startIndex: 1,
        endIndex: 3,
      });
    });

    it('returns an empty insertion range when no cues intersect', () => {
      expect(getVisibleCueRange(cues, 3_100, 4_900)).toEqual({
        startIndex: 2,
        endIndex: 2,
      });
    });

    it('normalizes reversed viewports before calculating visibility', () => {
      expect(getVisibleCueRange(cues, 5_100, 2_700)).toEqual({
        startIndex: 1,
        endIndex: 3,
      });
    });
  });

  describe('findCueNearestTime', () => {
    it('prefers a cue that contains the timestamp', () => {
      expect(findCueNearestTime(cues, 5_500)?.id).toBe('cue-3');
    });

    it('returns the cue with the closest boundary when the timestamp is between cues', () => {
      expect(findCueNearestTime(cues, 4_000)?.id).toBe('cue-2');
    });

    it('returns null for empty cue lists', () => {
      expect(findCueNearestTime([], 4_000)).toBeNull();
    });
  });

  describe('toCueTileWidth', () => {
    it('scales tile width by cue duration', () => {
      const short = toCueTileWidth({ id: 'short', startTimeMs: 0, endTimeMs: 500 });
      const long = toCueTileWidth({ id: 'long', startTimeMs: 0, endTimeMs: 4_000 });

      expect(long).toBeGreaterThan(short);
    });

    it('clamps tile width to configured minimum and maximum bounds', () => {
      expect(toCueTileWidth({ id: 'tiny', startTimeMs: 0, endTimeMs: 1 }, {
        minWidth: 120,
        maxWidth: 240,
        pixelsPerSecond: 100,
      })).toBe(120);
      expect(toCueTileWidth({ id: 'huge', startTimeMs: 0, endTimeMs: 100_000 }, {
        minWidth: 120,
        maxWidth: 240,
        pixelsPerSecond: 100,
      })).toBe(240);
    });
  });

  describe('clampTimelineViewport', () => {
    it('preserves viewport duration while clamping to media bounds', () => {
      expect(clampTimelineViewport(8_000, 13_000, 10_000)).toEqual({
        startMs: 5_000,
        endMs: 10_000,
      });
    });

    it('expands very small viewports to the minimum span', () => {
      expect(clampTimelineViewport(4_900, 5_000, 10_000, 1_000)).toEqual({
        startMs: 4_450,
        endMs: 5_450,
      });
    });

    it('handles zero-duration media with an empty viewport', () => {
      expect(clampTimelineViewport(100, 200, 0)).toEqual({
        startMs: 0,
        endMs: 0,
      });
    });
  });
});
