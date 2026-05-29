export interface TimedCue {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
}

export interface VisibleCueRange {
  startIndex: number;
  endIndex: number;
}

export interface TimelineViewport {
  startMs: number;
  endMs: number;
}

export interface CueTileWidthOptions {
  minWidth?: number;
  maxWidth?: number;
  pixelsPerSecond?: number;
}

export interface TimelineBucket {
  startMs: number;
  endMs: number;
  cueCount: number;
  isGap: boolean;
  representativeCue: TimedCue | null;
  exactCue: TimedCue | null;
}

export interface BuildTimelineBucketsOptions {
  viewport: TimelineViewport;
  durationMs: number;
  timelineWidthPx: number;
  minBucketWidthPx: number;
  exactCueMaxViewportSpanMs: number;
}

export type SubtitleOcrReviewMode = 'compact' | 'wide';

export const WIDE_REVIEW_MIN_CENTER_WIDTH_PX = 1_700;
export const DEFAULT_TIMELINE_MIN_SPAN_MS = 1_000;

const DEFAULT_TILE_MIN_WIDTH = 112;
const DEFAULT_TILE_MAX_WIDTH = 280;
const DEFAULT_TILE_PIXELS_PER_SECOND = 52;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteMs(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function normalizeTime(value: number): number {
  return isFiniteMs(value) ? value : 0;
}

function normalizeCueDurationMs(cue: TimedCue): number {
  const startTimeMs = normalizeTime(cue.startTimeMs);
  const endTimeMs = normalizeTime(cue.endTimeMs);

  return Math.max(0, endTimeMs - startTimeMs);
}

function cueIntersectsRange(cue: TimedCue, startMs: number, endMs: number): boolean {
  return normalizeTime(cue.endTimeMs) > startMs && normalizeTime(cue.startTimeMs) < endMs;
}

function getSortedVisibleCues(
  cues: readonly TimedCue[],
  viewport: TimelineViewport,
): TimedCue[] {
  return [...cues]
    .filter((cue) => cueIntersectsRange(cue, viewport.startMs, viewport.endMs))
    .sort((a, b) => normalizeTime(a.startTimeMs) - normalizeTime(b.startTimeMs));
}

function getBucketRepresentativeCue(
  cues: readonly TimedCue[],
  bucketCenterMs: number,
): TimedCue | null {
  let representativeCue: TimedCue | null = null;
  let nearestDistanceMs = Number.POSITIVE_INFINITY;

  for (const cue of cues) {
    const distanceMs = Math.abs(getCueCenterMs(cue) - bucketCenterMs);
    if (distanceMs < nearestDistanceMs) {
      representativeCue = cue;
      nearestDistanceMs = distanceMs;
    }
  }

  return representativeCue;
}

export function resolveSubtitleOcrReviewMode(centerWidthPx: number): SubtitleOcrReviewMode {
  return Number.isFinite(centerWidthPx) && centerWidthPx >= WIDE_REVIEW_MIN_CENTER_WIDTH_PX
    ? 'wide'
    : 'compact';
}

export function getCueCenterMs(cue: TimedCue): number {
  const startTimeMs = normalizeTime(cue.startTimeMs);
  const endTimeMs = Math.max(startTimeMs, normalizeTime(cue.endTimeMs));

  return Math.round(startTimeMs + (endTimeMs - startTimeMs) / 2);
}

export function getVisibleCueRange(
  cues: readonly TimedCue[],
  viewportStartMs: number,
  viewportEndMs: number,
): VisibleCueRange {
  if (cues.length === 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const startMs = Math.min(normalizeTime(viewportStartMs), normalizeTime(viewportEndMs));
  const endMs = Math.max(normalizeTime(viewportStartMs), normalizeTime(viewportEndMs));

  const firstVisibleIndex = cues.findIndex((cue) => cue.endTimeMs > startMs && cue.startTimeMs < endMs);
  if (firstVisibleIndex === -1) {
    const insertionIndex = cues.findIndex((cue) => cue.startTimeMs >= endMs);
    const index = insertionIndex === -1 ? cues.length : insertionIndex;

    return { startIndex: index, endIndex: index };
  }

  let endIndex = firstVisibleIndex + 1;
  while (endIndex < cues.length && cues[endIndex].startTimeMs < endMs) {
    endIndex += 1;
  }

  return { startIndex: firstVisibleIndex, endIndex };
}

export function findCueNearestTime<TCue extends TimedCue>(
  cues: readonly TCue[],
  timeMs: number,
): TCue | null {
  if (cues.length === 0) {
    return null;
  }

  const safeTimeMs = normalizeTime(timeMs);
  let nearestCue = cues[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const cue of cues) {
    if (cue.startTimeMs <= safeTimeMs && safeTimeMs <= cue.endTimeMs) {
      return cue;
    }

    const distance = safeTimeMs < cue.startTimeMs
      ? cue.startTimeMs - safeTimeMs
      : safeTimeMs - cue.endTimeMs;

    if (distance < nearestDistance) {
      nearestCue = cue;
      nearestDistance = distance;
    }
  }

  return nearestCue;
}

export function toCueTileWidth(
  cue: TimedCue,
  options: CueTileWidthOptions = {},
): number {
  const minWidth = options.minWidth ?? DEFAULT_TILE_MIN_WIDTH;
  const maxWidth = Math.max(minWidth, options.maxWidth ?? DEFAULT_TILE_MAX_WIDTH);
  const pixelsPerSecond = Math.max(1, options.pixelsPerSecond ?? DEFAULT_TILE_PIXELS_PER_SECOND);
  const durationSeconds = normalizeCueDurationMs(cue) / 1_000;

  return Math.round(clamp(durationSeconds * pixelsPerSecond, minWidth, maxWidth));
}

export function clampTimelineViewport(
  startMs: number,
  endMs: number,
  durationMs: number,
  minSpanMs = DEFAULT_TIMELINE_MIN_SPAN_MS,
): TimelineViewport {
  const safeDurationMs = normalizeTime(durationMs);
  if (safeDurationMs === 0) {
    return { startMs: 0, endMs: 0 };
  }

  const normalizedStartMs = Math.min(normalizeTime(startMs), normalizeTime(endMs));
  const normalizedEndMs = Math.max(normalizeTime(startMs), normalizeTime(endMs));
  const safeMinSpanMs = clamp(normalizeTime(minSpanMs), 0, safeDurationMs);
  const requestedSpanMs = normalizedEndMs - normalizedStartMs;
  const spanMs = clamp(Math.max(requestedSpanMs, safeMinSpanMs), safeMinSpanMs, safeDurationMs);
  const requestedCenterMs = normalizedStartMs + requestedSpanMs / 2;
  let nextStartMs = requestedSpanMs < safeMinSpanMs
    ? requestedCenterMs - spanMs / 2
    : normalizedStartMs;

  nextStartMs = clamp(nextStartMs, 0, safeDurationMs - spanMs);

  return {
    startMs: Math.round(nextStartMs),
    endMs: Math.round(nextStartMs + spanMs),
  };
}

export function centerTimelineViewport(
  cue: TimedCue | null | undefined,
  spanMs: number,
  durationMs: number,
): TimelineViewport {
  if (!cue) {
    return clampTimelineViewport(0, spanMs, durationMs);
  }

  const safeSpanMs = Math.max(DEFAULT_TIMELINE_MIN_SPAN_MS, normalizeTime(spanMs));
  const centerMs = getCueCenterMs(cue);

  return clampTimelineViewport(
    centerMs - safeSpanMs / 2,
    centerMs + safeSpanMs / 2,
    durationMs,
    DEFAULT_TIMELINE_MIN_SPAN_MS,
  );
}

export function zoomTimelineViewport(
  viewport: TimelineViewport,
  durationMs: number,
  factor: number,
  anchorRatio: number,
  minSpanMs = DEFAULT_TIMELINE_MIN_SPAN_MS,
): TimelineViewport {
  const safeDurationMs = normalizeTime(durationMs);
  const current = clampTimelineViewport(viewport.startMs, viewport.endMs, safeDurationMs, minSpanMs);
  const currentSpanMs = Math.max(minSpanMs, current.endMs - current.startMs);
  const safeFactor = clamp(Number.isFinite(factor) ? factor : 1, 0.05, 20);
  const safeAnchorRatio = clamp(Number.isFinite(anchorRatio) ? anchorRatio : 0.5, 0, 1);
  const nextSpanMs = clamp(currentSpanMs * safeFactor, minSpanMs, safeDurationMs);
  const anchorMs = current.startMs + currentSpanMs * safeAnchorRatio;
  const nextStartMs = anchorMs - nextSpanMs * safeAnchorRatio;

  return clampTimelineViewport(nextStartMs, nextStartMs + nextSpanMs, safeDurationMs, minSpanMs);
}

export function panTimelineViewport(
  viewport: TimelineViewport,
  durationMs: number,
  deltaMs: number,
  minSpanMs = DEFAULT_TIMELINE_MIN_SPAN_MS,
): TimelineViewport {
  const current = clampTimelineViewport(viewport.startMs, viewport.endMs, durationMs, minSpanMs);

  return clampTimelineViewport(
    current.startMs + deltaMs,
    current.endMs + deltaMs,
    durationMs,
    minSpanMs,
  );
}

export function buildTimelineBuckets(
  cues: readonly TimedCue[],
  options: BuildTimelineBucketsOptions,
): TimelineBucket[] {
  const viewport = clampTimelineViewport(
    options.viewport.startMs,
    options.viewport.endMs,
    options.durationMs,
    0,
  );
  const viewportSpanMs = viewport.endMs - viewport.startMs;

  if (viewportSpanMs <= 0) {
    return [];
  }

  const exactCueMaxViewportSpanMs = Math.max(0, normalizeTime(options.exactCueMaxViewportSpanMs));
  if (viewportSpanMs <= exactCueMaxViewportSpanMs) {
    const buckets: TimelineBucket[] = [];
    const visibleCues = getSortedVisibleCues(cues, viewport);
    let cursorMs = viewport.startMs;

    for (const cue of visibleCues) {
      const cueStartMs = clamp(normalizeTime(cue.startTimeMs), viewport.startMs, viewport.endMs);
      const cueEndMs = clamp(Math.max(cueStartMs, normalizeTime(cue.endTimeMs)), viewport.startMs, viewport.endMs);

      if (cursorMs < cueStartMs) {
        buckets.push({
          startMs: cursorMs,
          endMs: cueStartMs,
          cueCount: 0,
          isGap: true,
          representativeCue: null,
          exactCue: null,
        });
      }

      if (cueStartMs < cueEndMs) {
        buckets.push({
          startMs: cueStartMs,
          endMs: cueEndMs,
          cueCount: 1,
          isGap: false,
          representativeCue: cue,
          exactCue: cue,
        });
        cursorMs = cueEndMs;
      }
    }

    if (cursorMs < viewport.endMs) {
      buckets.push({
        startMs: cursorMs,
        endMs: viewport.endMs,
        cueCount: 0,
        isGap: true,
        representativeCue: null,
        exactCue: null,
      });
    }

    return buckets;
  }

  const safeTimelineWidthPx = Math.max(1, normalizeTime(options.timelineWidthPx));
  const safeMinBucketWidthPx = Math.max(1, normalizeTime(options.minBucketWidthPx));
  const bucketCount = Math.max(1, Math.floor(safeTimelineWidthPx / safeMinBucketWidthPx));
  const bucketSpanMs = viewportSpanMs / bucketCount;

  return Array.from({ length: bucketCount }, (_, index): TimelineBucket => {
    const startMs = Math.round(viewport.startMs + bucketSpanMs * index);
    const endMs = index === bucketCount - 1
      ? viewport.endMs
      : Math.round(viewport.startMs + bucketSpanMs * (index + 1));
    const bucketCues = cues.filter((cue) => cueIntersectsRange(cue, startMs, endMs));
    const representativeCue = getBucketRepresentativeCue(bucketCues, startMs + (endMs - startMs) / 2);

    return {
      startMs,
      endMs,
      cueCount: bucketCues.length,
      isGap: bucketCues.length === 0,
      representativeCue,
      exactCue: null,
    };
  });
}
