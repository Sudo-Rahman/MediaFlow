import { countExportableSubtitleOcrCues } from '$lib/services/subtitle-ocr-export';
import type { SubtitleOcrCue } from '$lib/types';

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

export interface TimelineBucket<TCue extends TimedCue = TimedCue> {
  id: string;
  startMs: number;
  endMs: number;
  cueCount: number;
  representativeCue: TCue | null;
  exactCue: TCue | null;
  isGap: boolean;
}

export interface BuildTimelineBucketsOptions {
  viewport: TimelineViewport;
  durationMs: number;
  timelineWidthPx: number;
  minBucketWidthPx?: number;
  exactCueMaxViewportSpanMs?: number;
}

export interface TimelineScaleWindowOptions {
  window: TimelineViewport;
  durationMs: number;
  viewportWidthPx: number;
  scale: number;
  factor: number;
  minWindowWidthPx?: number;
  maxWindowMarginPx?: number;
  minWindowDurationMs?: number;
}

export interface TimelineScaleWindowResult {
  scale: number;
  window: TimelineViewport;
}

export interface TimelineCueZone<TCue extends TimedCue = TimedCue> {
  id: string;
  cue: TCue;
  leftPx: number;
  widthPx: number;
}

export interface BuildTimelineCueZonesOptions {
  durationMs: number;
  viewportWidthPx: number;
  scale: number;
  minCueZoneWidthPx?: number;
}

export interface RailCenterSearchOptions {
  itemCount: number;
  itemWidthPx: number;
  scrollLeftPx: number;
  viewportWidthPx: number;
}

export interface TimelineAutoScrollIntentOptions {
  pointerClientX: number;
  viewportLeft: number;
  viewportWidth: number;
  scrollLeft: number;
  maxScrollLeft: number;
}

export interface TimelineAutoScrollIntent {
  direction: -1 | 0 | 1;
  pressure: number;
}

export interface TimelineWheelIntentOptions {
  deltaX: number;
  deltaY: number;
}

export interface TimelineLocalWindowReleaseOptions {
  dragging: boolean;
  hasLocalWindow: boolean;
  localWindowKey: string | null;
  nextPropWindowKey: string;
}

export interface ProgrammaticRailViewportReportOptions {
  source: 'rail' | 'timeline-window' | 'timeline-zone' | 'timeline-zoom' | 'selection' | null;
  timelineWindowDragging: boolean;
}

export interface RailViewportPublishOptions {
  nextViewportKey: string;
  currentViewportKey: string;
  lastReportedViewportKey: string;
}

export interface RailScrollSelectionCommitOptions {
  pendingCueId: string | null;
  selectedCueId: string | null;
}

export interface TimelineZoneSelectionSuppressOptions {
  timelineScrolling: boolean;
  draggingWindow: boolean;
}

export interface SubtitleOcrReviewTextSelectionSuppressOptions {
  timelineWindowDragging: boolean;
}

export type TimelineWheelIntent = 'native-scroll' | 'zoom-in' | 'zoom-out';

export type SubtitleOcrReviewMode = 'compact' | 'wide';

export const WIDE_REVIEW_MIN_CENTER_WIDTH_PX = 1_700;
export const DEFAULT_TIMELINE_MIN_SPAN_MS = 1_000;
export const MIN_TIMELINE_WINDOW_WIDTH_PX = 200;
export const MAX_TIMELINE_WINDOW_MARGIN_PX = 24;
export const MIN_TIMELINE_WINDOW_DURATION_MS = 1_000;
export const MIN_CUE_ZONE_WIDTH_PX = 4;
export const MIN_TIMELINE_SCALE = 1;
export const MAX_TIMELINE_SCALE = 8;

const DEFAULT_TILE_MIN_WIDTH = 112;
const DEFAULT_TILE_MAX_WIDTH = 280;
const DEFAULT_TILE_PIXELS_PER_SECOND = 52;
const DEFAULT_TIMELINE_MIN_BUCKET_WIDTH_PX = 128;
const MIN_TIMELINE_BUCKET_WIDTH_PX = 48;
const DEFAULT_TIMELINE_MAX_BUCKET_COUNT = 80;
const DEFAULT_EXACT_CUE_MAX_VIEWPORT_SPAN_MS = 12_000;
const TIMELINE_AUTOSCROLL_MIN_EDGE_WIDTH_PX = 32;
const TIMELINE_AUTOSCROLL_MAX_EDGE_WIDTH_PX = 96;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteMs(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function normalizeTime(value: number): number {
  return isFiniteMs(value) ? value : 0;
}

function formatCompactDuration(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safeMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function normalizeCueDurationMs(cue: TimedCue): number {
  const startTimeMs = normalizeTime(cue.startTimeMs);
  const endTimeMs = normalizeTime(cue.endTimeMs);

  return Math.max(0, endTimeMs - startTimeMs);
}

function cueIntersectsRange(cue: TimedCue, startMs: number, endMs: number): boolean {
  return normalizeTime(cue.endTimeMs) > startMs && normalizeTime(cue.startTimeMs) < endMs;
}

function getSortedVisibleCues<TCue extends TimedCue>(
  cues: readonly TCue[],
  viewport: TimelineViewport,
): TCue[] {
  return [...cues]
    .filter((cue) => cueIntersectsRange(cue, viewport.startMs, viewport.endMs))
    .sort((a, b) => normalizeTime(a.startTimeMs) - normalizeTime(b.startTimeMs));
}

function getBucketRepresentativeCue<TCue extends TimedCue>(
  cues: readonly TCue[],
  bucketCenterMs: number,
): TCue | null {
  let representativeCue: TCue | null = null;
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

export function buildSubtitleOcrReviewStats(
  cues: readonly SubtitleOcrCue[],
  durationMs: number,
): string {
  const exportableCueCount = countExportableSubtitleOcrCues(cues);

  return `${exportableCueCount} cue${exportableCueCount === 1 ? '' : 's'} · ${formatCompactDuration(durationMs)}`;
}

export function getCueCenterMs(cue: TimedCue): number {
  const startTimeMs = normalizeTime(cue.startTimeMs);
  const endTimeMs = Math.max(startTimeMs, normalizeTime(cue.endTimeMs));

  return Math.round(startTimeMs + (endTimeMs - startTimeMs) / 2);
}

export function getTimelineContentWidthPx(
  durationMs: number,
  viewportWidthPx: number,
  scale: number,
): number {
  const safeViewportWidthPx = Math.max(1, normalizeTime(viewportWidthPx));
  if (normalizeTime(durationMs) <= 0) {
    return safeViewportWidthPx;
  }

  return Math.max(
    safeViewportWidthPx,
    Math.round(safeViewportWidthPx * clamp(Number.isFinite(scale) ? scale : 1, MIN_TIMELINE_SCALE, MAX_TIMELINE_SCALE)),
  );
}

export function timelineMsToPx(
  timeMs: number,
  durationMs: number,
  viewportWidthPx: number,
  scale: number,
): number {
  const safeDurationMs = normalizeTime(durationMs);
  if (safeDurationMs <= 0) {
    return 0;
  }

  return Math.round((normalizeTime(timeMs) / safeDurationMs) * getTimelineContentWidthPx(
    safeDurationMs,
    viewportWidthPx,
    scale,
  ));
}

export function timelinePxToMs(
  positionPx: number,
  durationMs: number,
  viewportWidthPx: number,
  scale: number,
): number {
  const safeDurationMs = normalizeTime(durationMs);
  if (safeDurationMs <= 0) {
    return 0;
  }

  return Math.round(
    (normalizeTime(positionPx) / getTimelineContentWidthPx(safeDurationMs, viewportWidthPx, scale))
      * safeDurationMs,
  );
}

export function clampTimelineScale(scale: number): number {
  return clamp(Number.isFinite(scale) ? scale : MIN_TIMELINE_SCALE, MIN_TIMELINE_SCALE, MAX_TIMELINE_SCALE);
}

export function clampTimelineScaleWindow(options: Omit<TimelineScaleWindowOptions, 'factor'>): TimelineViewport {
  const safeDurationMs = normalizeTime(options.durationMs);
  if (safeDurationMs <= 0) {
    return { startMs: 0, endMs: 0 };
  }

  const scale = clampTimelineScale(options.scale);
  const contentWidthPx = getTimelineContentWidthPx(safeDurationMs, options.viewportWidthPx, scale);
  const maxWindowMarginPx = normalizeTime(options.maxWindowMarginPx ?? MAX_TIMELINE_WINDOW_MARGIN_PX);
  const maxWindowWidthPx = Math.max(1, normalizeTime(options.viewportWidthPx) - maxWindowMarginPx);
  const minWindowWidthPx = Math.min(
    Math.max(1, normalizeTime(options.minWindowWidthPx ?? MIN_TIMELINE_WINDOW_WIDTH_PX)),
    maxWindowWidthPx,
  );
  const minWindowDurationMs = Math.min(
    safeDurationMs,
    Math.max(
      normalizeTime(options.minWindowDurationMs ?? MIN_TIMELINE_WINDOW_DURATION_MS),
      (minWindowWidthPx / contentWidthPx) * safeDurationMs,
    ),
  );
  const maxWindowDurationMs = Math.min(
    safeDurationMs,
    Math.max(minWindowDurationMs, (maxWindowWidthPx / contentWidthPx) * safeDurationMs),
  );
  const normalizedStartMs = Math.min(normalizeTime(options.window.startMs), normalizeTime(options.window.endMs));
  const normalizedEndMs = Math.max(normalizeTime(options.window.startMs), normalizeTime(options.window.endMs));
  const requestedSpanMs = normalizedEndMs - normalizedStartMs;
  const nextSpanMs = Math.round(clamp(requestedSpanMs, minWindowDurationMs, maxWindowDurationMs));
  const requestedCenterMs = normalizedStartMs + requestedSpanMs / 2;
  const nextStartMs = clamp(Math.round(requestedCenterMs - nextSpanMs / 2), 0, safeDurationMs - nextSpanMs);

  return {
    startMs: nextStartMs,
    endMs: nextStartMs + nextSpanMs,
  };
}

export function zoomTimelineScaleWindow(options: TimelineScaleWindowOptions): TimelineScaleWindowResult {
  const scale = clampTimelineScale(options.scale * (Number.isFinite(options.factor) ? options.factor : 1));

  return {
    scale,
    window: clampTimelineScaleWindow({
      window: options.window,
      durationMs: options.durationMs,
      viewportWidthPx: options.viewportWidthPx,
      scale,
      minWindowWidthPx: options.minWindowWidthPx,
      maxWindowMarginPx: options.maxWindowMarginPx,
      minWindowDurationMs: options.minWindowDurationMs,
    }),
  };
}

export function buildTimelineCueZones<TCue extends TimedCue>(
  cues: readonly TCue[],
  options: BuildTimelineCueZonesOptions,
): TimelineCueZone<TCue>[] {
  const safeDurationMs = normalizeTime(options.durationMs);
  if (safeDurationMs <= 0) {
    return [];
  }

  const minCueZoneWidthPx = Math.max(1, normalizeTime(options.minCueZoneWidthPx ?? MIN_CUE_ZONE_WIDTH_PX));

  return cues
    .filter((cue) => normalizeCueDurationMs(cue) > 0)
    .map((cue) => {
      const leftPx = timelineMsToPx(cue.startTimeMs, safeDurationMs, options.viewportWidthPx, options.scale);
      const endPx = timelineMsToPx(cue.endTimeMs, safeDurationMs, options.viewportWidthPx, options.scale);

      return {
        id: cue.id,
        cue,
        leftPx,
        widthPx: Math.max(minCueZoneWidthPx, endPx - leftPx),
      };
    });
}

export function getTimelineSelectedMarkerTimeMs<TCue extends TimedCue>(
  cues: readonly TCue[],
  selectedCueId: string | null | undefined,
): number | null {
  if (!selectedCueId) {
    return null;
  }

  const selectedCue = cues.find((cue) => cue.id === selectedCueId);
  return selectedCue ? getCueCenterMs(selectedCue) : null;
}

export function findCueNearestTimelineWindowCenter<TCue extends TimedCue>(
  cues: readonly TCue[],
  window: TimelineViewport,
): TCue | null {
  return findCueNearestTime(cues, window.startMs + (window.endMs - window.startMs) / 2);
}

export function findRailIndexNearestCenter(options: RailCenterSearchOptions): number {
  const itemCount = Math.max(0, Math.floor(options.itemCount));
  if (itemCount === 0) {
    return -1;
  }

  const itemWidthPx = Math.max(1, normalizeTime(options.itemWidthPx));
  const viewportCenterPx = normalizeTime(options.scrollLeftPx) + normalizeTime(options.viewportWidthPx) / 2;
  const index = Math.round((viewportCenterPx - itemWidthPx / 2) / itemWidthPx);

  return clamp(index, 0, itemCount - 1);
}

export function getTimelineAutoScrollIntent(
  options: TimelineAutoScrollIntentOptions,
): TimelineAutoScrollIntent {
  const viewportWidth = normalizeTime(options.viewportWidth);
  const maxScrollLeft = normalizeTime(options.maxScrollLeft);
  const scrollLeft = clamp(normalizeTime(options.scrollLeft), 0, maxScrollLeft);

  if (viewportWidth <= 0 || maxScrollLeft <= 0) {
    return { direction: 0, pressure: 0 };
  }

  const edgeWidth = clamp(
    viewportWidth * 0.12,
    TIMELINE_AUTOSCROLL_MIN_EDGE_WIDTH_PX,
    TIMELINE_AUTOSCROLL_MAX_EDGE_WIDTH_PX,
  );
  if (edgeWidth * 2 >= viewportWidth) {
    return { direction: 0, pressure: 0 };
  }

  const localX = options.pointerClientX - options.viewportLeft;
  if (localX < edgeWidth && scrollLeft > 0) {
    return {
      direction: -1,
      pressure: clamp((edgeWidth - localX) / edgeWidth, 0, 1),
    };
  }

  if (localX > viewportWidth - edgeWidth && scrollLeft < maxScrollLeft) {
    return {
      direction: 1,
      pressure: clamp((localX - (viewportWidth - edgeWidth)) / edgeWidth, 0, 1),
    };
  }

  return { direction: 0, pressure: 0 };
}

export function getTimelineWheelIntent(options: TimelineWheelIntentOptions): TimelineWheelIntent {
  const deltaX = Number.isFinite(options.deltaX) ? options.deltaX : 0;
  const deltaY = Number.isFinite(options.deltaY) ? options.deltaY : 0;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (absX > absY || absY < 1) {
    return 'native-scroll';
  }

  return deltaY > 0 ? 'zoom-out' : 'zoom-in';
}

export function shouldReleaseTimelineLocalWindow(options: TimelineLocalWindowReleaseOptions): boolean {
  return options.hasLocalWindow
    && !options.dragging
    && options.localWindowKey !== null
    && options.localWindowKey === options.nextPropWindowKey;
}

export function shouldReportProgrammaticRailViewport(options: ProgrammaticRailViewportReportOptions): boolean {
  if (options.timelineWindowDragging) {
    return false;
  }

  return options.source === 'timeline-window' || options.source === 'timeline-zone';
}

export function shouldPublishRailViewportUpdate(options: RailViewportPublishOptions): boolean {
  return options.nextViewportKey !== options.lastReportedViewportKey
    || options.nextViewportKey !== options.currentViewportKey;
}

export function shouldCommitRailScrollSelection(options: RailScrollSelectionCommitOptions): boolean {
  return options.pendingCueId !== null && options.pendingCueId !== options.selectedCueId;
}

export function shouldSuppressTimelineZoneSelection(options: TimelineZoneSelectionSuppressOptions): boolean {
  return options.timelineScrolling || options.draggingWindow;
}

export function shouldSuppressSubtitleOcrReviewTextSelection(
  options: SubtitleOcrReviewTextSelectionSuppressOptions,
): boolean {
  return options.timelineWindowDragging;
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

export function buildTimelineBuckets<TCue extends TimedCue>(
  cues: readonly TCue[],
  options: BuildTimelineBucketsOptions,
): TimelineBucket<TCue>[] {
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

  const exactCueMaxViewportSpanMs = Math.max(
    0,
    normalizeTime(options.exactCueMaxViewportSpanMs ?? DEFAULT_EXACT_CUE_MAX_VIEWPORT_SPAN_MS),
  );
  if (viewportSpanMs <= exactCueMaxViewportSpanMs) {
    const buckets: TimelineBucket<TCue>[] = [];
    const visibleCues = getSortedVisibleCues(cues, viewport);
    let cursorMs = viewport.startMs;

    for (const cue of visibleCues) {
      const cueStartMs = clamp(normalizeTime(cue.startTimeMs), viewport.startMs, viewport.endMs);
      const cueEndMs = clamp(Math.max(cueStartMs, normalizeTime(cue.endTimeMs)), viewport.startMs, viewport.endMs);

      if (cueStartMs >= cueEndMs || cueEndMs <= cursorMs) {
        continue;
      }

      if (cursorMs < cueStartMs) {
        buckets.push({
          id: `gap:${cursorMs}-${cueStartMs}`,
          startMs: cursorMs,
          endMs: cueStartMs,
          cueCount: 0,
          representativeCue: null,
          exactCue: null,
          isGap: true,
        });
      }

      const bucketStartMs = Math.max(cursorMs, cueStartMs);
      buckets.push({
        id: `cue:${cue.id}:${bucketStartMs}-${cueEndMs}`,
        startMs: bucketStartMs,
        endMs: cueEndMs,
        cueCount: 1,
        representativeCue: cue,
        exactCue: cue,
        isGap: false,
      });
      cursorMs = cueEndMs;
    }

    if (cursorMs < viewport.endMs) {
      buckets.push({
        id: `gap:${cursorMs}-${viewport.endMs}`,
        startMs: cursorMs,
        endMs: viewport.endMs,
        cueCount: 0,
        representativeCue: null,
        exactCue: null,
        isGap: true,
      });
    }

    return buckets;
  }

  const safeTimelineWidthPx = Math.max(1, normalizeTime(options.timelineWidthPx));
  const safeMinBucketWidthPx = Math.max(
    MIN_TIMELINE_BUCKET_WIDTH_PX,
    normalizeTime(options.minBucketWidthPx ?? DEFAULT_TIMELINE_MIN_BUCKET_WIDTH_PX),
  );
  const bucketCount = clamp(
    Math.max(1, Math.floor(safeTimelineWidthPx / safeMinBucketWidthPx)),
    1,
    DEFAULT_TIMELINE_MAX_BUCKET_COUNT,
  );
  const bucketSpanMs = viewportSpanMs / bucketCount;

  return Array.from({ length: bucketCount }, (_, index): TimelineBucket<TCue> => {
    const startMs = Math.round(viewport.startMs + bucketSpanMs * index);
    const endMs = index === bucketCount - 1
      ? viewport.endMs
      : Math.round(viewport.startMs + bucketSpanMs * (index + 1));
    const bucketCues = cues.filter((cue) => cueIntersectsRange(cue, startMs, endMs));
    const representativeCue = getBucketRepresentativeCue(bucketCues, startMs + (endMs - startMs) / 2);

    return {
      id: `overview:${startMs}-${endMs}`,
      startMs,
      endMs,
      cueCount: bucketCues.length,
      representativeCue,
      exactCue: null,
      isGap: bucketCues.length === 0,
    };
  });
}
