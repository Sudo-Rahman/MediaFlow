import { describe, expect, it } from 'vitest';

import {
  buildTimelineBuckets,
  centerTimelineViewport,
  clampTimelineViewport,
  findCueNearestTime,
  getVisibleCueRange,
  panTimelineViewport,
  resolveSubtitleOcrReviewMode,
  toCueTileWidth,
  WIDE_REVIEW_MIN_CENTER_WIDTH_PX,
  zoomTimelineViewport,
  type BuildTimelineBucketsOptions,
  type TimedCue,
  type TimelineBucket,
} from './subtitle-ocr-review-state';

interface ReviewedTimedCue extends TimedCue {
  text: string;
}

const cues: TimedCue[] = [
  { id: 'cue-1', startTimeMs: 1_000, endTimeMs: 2_000 },
  { id: 'cue-2', startTimeMs: 2_500, endTimeMs: 3_000 },
  { id: 'cue-3', startTimeMs: 5_000, endTimeMs: 8_000 },
  { id: 'cue-4', startTimeMs: 9_500, endTimeMs: 10_000 },
];

describe('subtitle OCR review state', () => {
  describe('resolveSubtitleOcrReviewMode', () => {
    it('uses compact mode below the wide review center breakpoint', () => {
      expect(resolveSubtitleOcrReviewMode(WIDE_REVIEW_MIN_CENTER_WIDTH_PX - 1)).toBe('compact');
    });

    it('uses wide mode at and above the wide review center breakpoint', () => {
      expect(resolveSubtitleOcrReviewMode(WIDE_REVIEW_MIN_CENTER_WIDTH_PX)).toBe('wide');
    });
  });

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

  describe('centerTimelineViewport', () => {
    it('centers a viewport around the selected cue while preserving the requested span', () => {
      expect(centerTimelineViewport(cues[2], 4_000, 12_000)).toEqual({
        startMs: 4_500,
        endMs: 8_500,
      });
    });
  });

  describe('zoomTimelineViewport', () => {
    it('zooms around the pointer anchor', () => {
      expect(zoomTimelineViewport(
        { startMs: 0, endMs: 10_000 },
        20_000,
        0.5,
        0.25,
      )).toEqual({
        startMs: 1_250,
        endMs: 6_250,
      });
    });
  });

  describe('panTimelineViewport', () => {
    it('pans the viewport by a time delta and clamps to duration bounds', () => {
      expect(panTimelineViewport(
        { startMs: 8_000, endMs: 12_000 },
        10_000,
        4_000,
      )).toEqual({
        startMs: 6_000,
        endMs: 10_000,
      });
    });
  });

  describe('buildTimelineBuckets', () => {
    const bucketCues: TimedCue[] = [
      { id: 'cue-a', startTimeMs: 1_000, endTimeMs: 2_000 },
      { id: 'cue-b', startTimeMs: 18_000, endTimeMs: 19_000 },
      { id: 'cue-c', startTimeMs: 34_000, endTimeMs: 36_000 },
    ];

    it('builds overview buckets across the full visible duration', () => {
      const buckets: TimelineBucket[] = buildTimelineBuckets(bucketCues, {
        viewport: { startMs: 0, endMs: 50_000 },
        durationMs: 50_000,
        timelineWidthPx: 600,
        minBucketWidthPx: 120,
        exactCueMaxViewportSpanMs: 8_000,
      });

      expect(buckets).toHaveLength(5);
      expect(buckets.map((bucket) => bucket.cueCount)).toEqual([1, 1, 0, 1, 0]);
      expect(buckets[2]).toMatchObject({
        isGap: true,
        representativeCue: null,
        exactCue: null,
      });
      expect(buckets[0]?.representativeCue?.id).toBe('cue-a');
    });

    it('builds exact cue and gap buckets when the viewport is precise enough', () => {
      const buckets = buildTimelineBuckets(bucketCues, {
        viewport: { startMs: 16_000, endMs: 22_000 },
        durationMs: 50_000,
        timelineWidthPx: 600,
        minBucketWidthPx: 120,
        exactCueMaxViewportSpanMs: 8_000,
      });

      expect(buckets.map((bucket) => ({
        cue: bucket.exactCue?.id ?? null,
        isGap: bucket.isGap,
      }))).toEqual([
        { cue: null, isGap: true },
        { cue: 'cue-b', isGap: false },
        { cue: null, isGap: true },
      ]);
    });

    it('uses the cue nearest the bucket center as the representative cue', () => {
      const buckets = buildTimelineBuckets([
        { id: 'early', startTimeMs: 1_000, endTimeMs: 1_500 },
        { id: 'near-center', startTimeMs: 8_000, endTimeMs: 9_000 },
      ], {
        viewport: { startMs: 0, endMs: 10_000 },
        durationMs: 10_000,
        timelineWidthPx: 140,
        minBucketWidthPx: 120,
        exactCueMaxViewportSpanMs: 1_000,
      });

      expect(buckets).toHaveLength(1);
      expect(buckets[0]?.representativeCue?.id).toBe('near-center');
    });

    it('returns stable bucket ids while preserving cue subtypes with optional bucket settings', () => {
      const reviewedCues: ReviewedTimedCue[] = [
        { id: 'reviewed-a', startTimeMs: 1_000, endTimeMs: 2_000, text: 'First cue' },
        { id: 'reviewed-b', startTimeMs: 18_000, endTimeMs: 19_000, text: 'Second cue' },
      ];
      const options: BuildTimelineBucketsOptions = {
        viewport: { startMs: 0, endMs: 50_000 },
        durationMs: 50_000,
        timelineWidthPx: 240,
      };
      const buckets: TimelineBucket<ReviewedTimedCue>[] = buildTimelineBuckets(reviewedCues, options);

      expect(buckets.map((bucket) => bucket.id)).toEqual([
        'overview:0-25000',
        'overview:25000-50000',
      ]);
      expect(buckets[0]?.representativeCue?.text).toBe('Second cue');
    });
  });
});
