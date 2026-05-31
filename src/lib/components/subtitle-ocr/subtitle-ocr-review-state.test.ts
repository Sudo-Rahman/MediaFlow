import { describe, expect, it } from 'vitest';

import {
  buildSubtitleOcrReviewStats,
  buildTimelineCueZones,
  buildTimelineBuckets,
  centerTimelineViewport,
  clampTimelineViewport,
  findCueNearestTime,
  findCueNearestTimelineWindowCenter,
  findRailIndexNearestCenter,
  getRailVisibleViewportForCenteredIndex,
  getTimelineAutoScrollIntent,
  getTimelineWheelIntent,
  getVisibleCueRange,
  MIN_TIMELINE_WINDOW_WIDTH_PX,
  panTimelineViewport,
  resolveSubtitleOcrReviewMode,
  toCueTileWidth,
  zoomTimelineScaleWindow,
  WIDE_REVIEW_MIN_CENTER_WIDTH_PX,
  zoomTimelineViewport,
  type BuildTimelineBucketsOptions,
  type TimedCue,
  type TimelineBucket,
} from './subtitle-ocr-review-state';

interface ReviewedTimedCue extends TimedCue {
  text: string;
}

interface ReviewedSubtitleCue extends TimedCue {
  sourceCueIds: string[];
  text: string;
  confidence: number;
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

  describe('buildSubtitleOcrReviewStats', () => {
    it('counts only exportable subtitle cues in the review header summary', () => {
      const reviewCues: ReviewedSubtitleCue[] = [
        {
          id: 'valid-1',
          sourceCueIds: ['raw-1'],
          startTimeMs: 1_000,
          endTimeMs: 2_000,
          text: 'First subtitle',
          confidence: 0.9,
        },
        {
          id: 'blank',
          sourceCueIds: ['raw-2'],
          startTimeMs: 2_000,
          endTimeMs: 3_000,
          text: '   ',
          confidence: 0.9,
        },
        {
          id: 'valid-2',
          sourceCueIds: ['raw-3'],
          startTimeMs: 4_000,
          endTimeMs: 5_000,
          text: 'Second subtitle',
          confidence: 0.9,
        },
      ];

      expect(buildSubtitleOcrReviewStats(reviewCues, 5_000)).toBe('2 cues · 0:05');
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

    it('keeps exact gaps monotonic for overlapping and contained cues', () => {
      const buckets = buildTimelineBuckets([
        { id: 'outer', startTimeMs: 1_000, endTimeMs: 6_000 },
        { id: 'contained', startTimeMs: 2_000, endTimeMs: 3_000 },
        { id: 'after', startTimeMs: 7_000, endTimeMs: 8_000 },
      ], {
        viewport: { startMs: 0, endMs: 10_000 },
        durationMs: 10_000,
        timelineWidthPx: 600,
        exactCueMaxViewportSpanMs: 12_000,
      });

      expect(buckets.filter((bucket) => bucket.isGap).map((bucket) => ({
        startMs: bucket.startMs,
        endMs: bucket.endMs,
      }))).toEqual([
        { startMs: 0, endMs: 1_000 },
        { startMs: 6_000, endMs: 7_000 },
        { startMs: 8_000, endMs: 10_000 },
      ]);
      expect(buckets.map((bucket) => [bucket.startMs, bucket.endMs])).toEqual([
        [0, 1_000],
        [1_000, 6_000],
        [6_000, 7_000],
        [7_000, 8_000],
        [8_000, 10_000],
      ]);
    });

    it('skips zero-length exact cues without emitting duplicate gaps', () => {
      const buckets = buildTimelineBuckets([
        { id: 'before', startTimeMs: 1_000, endTimeMs: 2_000 },
        { id: 'zero', startTimeMs: 2_500, endTimeMs: 2_500 },
        { id: 'after', startTimeMs: 3_000, endTimeMs: 4_000 },
      ], {
        viewport: { startMs: 0, endMs: 5_000 },
        durationMs: 5_000,
        timelineWidthPx: 600,
        exactCueMaxViewportSpanMs: 12_000,
      });

      expect(buckets.map((bucket) => bucket.id)).toEqual([
        'gap:0-1000',
        'cue:before:1000-2000',
        'gap:2000-3000',
        'cue:after:3000-4000',
        'gap:4000-5000',
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
        timelineWidthPx: 256,
      };
      const buckets: TimelineBucket<ReviewedTimedCue>[] = buildTimelineBuckets(reviewedCues, options);

      expect(buckets.map((bucket) => bucket.id)).toEqual([
        'overview:0-25000',
        'overview:25000-50000',
      ]);
      expect(buckets[0]?.representativeCue?.text).toBe('Second cue');
    });

    it('bounds overview buckets for invalid dimensions, empty cues, and clamped viewports', () => {
      const buckets = buildTimelineBuckets([], {
        viewport: { startMs: 100_000, endMs: 250_000 },
        durationMs: 100_000,
        timelineWidthPx: 100_000,
        minBucketWidthPx: 0,
        exactCueMaxViewportSpanMs: 1,
      });

      expect(buckets).toHaveLength(80);
      expect(buckets.every((bucket) => bucket.isGap)).toBe(true);
      expect(buckets.at(0)).toMatchObject({
        id: 'overview:0-1250',
        startMs: 0,
        endMs: 1_250,
        cueCount: 0,
        representativeCue: null,
        exactCue: null,
      });
      expect(buckets.at(-1)).toMatchObject({
        id: 'overview:98750-100000',
        startMs: 98_750,
        endMs: 100_000,
      });
    });

    it('lower-bounds tiny overview bucket widths', () => {
      const buckets = buildTimelineBuckets([], {
        viewport: { startMs: 0, endMs: 96_000 },
        durationMs: 96_000,
        timelineWidthPx: 96,
        minBucketWidthPx: 1,
        exactCueMaxViewportSpanMs: 1,
      });

      expect(buckets.map((bucket) => bucket.id)).toEqual([
        'overview:0-48000',
        'overview:48000-96000',
      ]);
    });

    it('returns no buckets for zero-duration media', () => {
      expect(buildTimelineBuckets(bucketCues, {
        viewport: { startMs: 0, endMs: 10_000 },
        durationMs: 0,
        timelineWidthPx: 600,
      })).toEqual([]);
    });
  });

  describe('timeline scale window helpers', () => {
    it('enforces the minimum filmstrip window pixel width', () => {
      const window = zoomTimelineScaleWindow({
        window: { startMs: 10_000, endMs: 11_000 },
        durationMs: 100_000,
        viewportWidthPx: 1_000,
        scale: 1,
        factor: 1,
      }).window;

      expect(window.endMs - window.startMs).toBe(20_000);
    });

    it('enforces the maximum filmstrip window pixel width inside the visible timeline', () => {
      const window = zoomTimelineScaleWindow({
        window: { startMs: 0, endMs: 100_000 },
        durationMs: 100_000,
        viewportWidthPx: 1_000,
        scale: 1,
        factor: 1,
      }).window;

      expect(window).toEqual({
        startMs: 1_200,
        endMs: 98_800,
      });
    });

    it('clamps the filmstrip window to media duration bounds', () => {
      const window = zoomTimelineScaleWindow({
        window: { startMs: 90_000, endMs: 110_000 },
        durationMs: 100_000,
        viewportWidthPx: 1_000,
        scale: 1,
        factor: 1,
      }).window;

      expect(window).toEqual({
        startMs: 80_000,
        endMs: 100_000,
      });
    });

    it('preserves the filmstrip window center while zooming when possible', () => {
      const result = zoomTimelineScaleWindow({
        window: { startMs: 30_000, endMs: 50_000 },
        durationMs: 100_000,
        viewportWidthPx: 1_000,
        scale: 1,
        factor: 2,
      });

      expect(result.scale).toBe(2);
      expect(result.window).toEqual({
        startMs: 30_000,
        endMs: 50_000,
      });
    });

    it('expands a tiny filmstrip window when zoom would make it unusably small', () => {
      const result = zoomTimelineScaleWindow({
        window: { startMs: 40_000, endMs: 41_000 },
        durationMs: 100_000,
        viewportWidthPx: 1_000,
        scale: 8,
        factor: 0.5,
      });

      expect(result.scale).toBe(4);
      expect(result.window.endMs - result.window.startMs).toBe(5_000);
    });

    it('shrinks a filmstrip window that would be wider than the visible timeline', () => {
      const result = zoomTimelineScaleWindow({
        window: { startMs: 0, endMs: 100_000 },
        durationMs: 100_000,
        viewportWidthPx: 1_000,
        scale: 4,
        factor: 2,
      });

      expect(result.scale).toBe(8);
      expect(result.window.endMs - result.window.startMs).toBe(12_200);
    });
  });

  describe('timeline cue zones', () => {
    it('keeps very short cue zones visible with a minimum width', () => {
      const zones = buildTimelineCueZones([
        { id: 'short', startTimeMs: 10_000, endTimeMs: 10_010 },
      ], {
        durationMs: 100_000,
        viewportWidthPx: 1_000,
        scale: 1,
      });

      expect(zones).toEqual([
        {
          cue: { id: 'short', startTimeMs: 10_000, endTimeMs: 10_010 },
          id: 'short',
          leftPx: 100,
          widthPx: 4,
        },
      ]);
    });
  });

  describe('timeline and filmstrip nearest-target helpers', () => {
    it('finds the cue nearest the filmstrip window center timestamp', () => {
      expect(findCueNearestTimelineWindowCenter(cues, { startMs: 5_200, endMs: 6_200 })?.id)
        .toBe('cue-3');
    });

    it('finds the rail card nearest the viewport center', () => {
      expect(findRailIndexNearestCenter({
        itemCount: 4,
        itemWidthPx: 330,
        scrollLeftPx: 0,
        viewportWidthPx: 330,
      })).toBe(0);

      expect(findRailIndexNearestCenter({
        itemCount: 4,
        itemWidthPx: 330,
        scrollLeftPx: 330,
        viewportWidthPx: 330,
      })).toBe(1);
    });

    it('derives the filmstrip viewport range after centering a rail card programmatically', () => {
      const railCues: TimedCue[] = [
        { id: 'a', startTimeMs: 0, endTimeMs: 1_000 },
        { id: 'b', startTimeMs: 1_000, endTimeMs: 2_000 },
        { id: 'c', startTimeMs: 2_000, endTimeMs: 3_000 },
        { id: 'd', startTimeMs: 10_000, endTimeMs: 11_000 },
        { id: 'e', startTimeMs: 50_000, endTimeMs: 51_000 },
      ];

      expect(getRailVisibleViewportForCenteredIndex(railCues, {
        targetIndex: 3,
        itemWidthPx: 100,
        viewportWidthPx: 300,
        durationMs: 60_000,
      })).toEqual({
        startMs: 2_000,
        endMs: 51_000,
      });
    });

    it('excludes the next rail card when the viewport right edge lands on a card boundary', () => {
      const railCues: TimedCue[] = [
        { id: 'a', startTimeMs: 0, endTimeMs: 1_000 },
        { id: 'b', startTimeMs: 1_000, endTimeMs: 2_000 },
        { id: 'c', startTimeMs: 2_000, endTimeMs: 3_000 },
        { id: 'd', startTimeMs: 10_000, endTimeMs: 11_000 },
      ];

      expect(getRailVisibleViewportForCenteredIndex(railCues, {
        targetIndex: 0,
        itemWidthPx: 100,
        viewportWidthPx: 300,
        durationMs: 12_000,
      })).toEqual({
        startMs: 0,
        endMs: 3_000,
      });
    });
  });

  describe('timeline window auto-scroll intent', () => {
    it('computes left and right auto-scroll pressure near timeline edges', () => {
      const left = getTimelineAutoScrollIntent({
        pointerClientX: 40,
        viewportLeft: 0,
        viewportWidth: 1_000,
        scrollLeft: 500,
        maxScrollLeft: 2_000,
      });
      const right = getTimelineAutoScrollIntent({
        pointerClientX: 960,
        viewportLeft: 0,
        viewportWidth: 1_000,
        scrollLeft: 500,
        maxScrollLeft: 2_000,
      });

      expect(left.direction).toBe(-1);
      expect(left.pressure).toBeGreaterThan(0);
      expect(right.direction).toBe(1);
      expect(right.pressure).toBeGreaterThan(0);
    });

    it('does not auto-scroll beyond available timeline bounds', () => {
      expect(getTimelineAutoScrollIntent({
        pointerClientX: 20,
        viewportLeft: 0,
        viewportWidth: 1_000,
        scrollLeft: 0,
        maxScrollLeft: 2_000,
      })).toEqual({ direction: 0, pressure: 0 });

      expect(getTimelineAutoScrollIntent({
        pointerClientX: 980,
        viewportLeft: 0,
        viewportWidth: 1_000,
        scrollLeft: 2_000,
        maxScrollLeft: 2_000,
      })).toEqual({ direction: 0, pressure: 0 });
    });
  });

  describe('timeline wheel intent', () => {
    it('lets horizontal trackpad gestures scroll the timeline instead of zooming', () => {
      expect(getTimelineWheelIntent({
        deltaX: 120,
        deltaY: 4,
      })).toBe('native-scroll');
    });

    it('keeps vertical wheel gestures as timeline zoom controls', () => {
      expect(getTimelineWheelIntent({
        deltaX: 0,
        deltaY: -80,
      })).toBe('zoom-in');

      expect(getTimelineWheelIntent({
        deltaX: 0,
        deltaY: 80,
      })).toBe('zoom-out');
    });
  });

  describe('timeline window constants', () => {
    it('uses the approved minimum filmstrip window width', () => {
      expect(MIN_TIMELINE_WINDOW_WIDTH_PX).toBe(200);
    });
  });
});
