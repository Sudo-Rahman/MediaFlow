import { DEFAULT_OCR_REGION } from '$lib/types';
import type {
  OcrOutputFormat,
  OcrRegion,
  OcrSegment,
  OcrVersion,
  OcrZone,
  OcrZoneRole,
  VideoOcrSelection,
} from '$lib/types';

export const DEFAULT_MAIN_SUBTITLE_REGION: OcrRegion = { ...DEFAULT_OCR_REGION };

const MIN_REGION_SIZE = 0.02;
const MIN_TIMELINE_VIEWPORT_MS = 10_000;
const TIMELINE_TICK_TARGET_COUNT = 8;
const TIMELINE_TICK_INTERVALS_MS = [
  1_000,
  2_000,
  5_000,
  10_000,
  15_000,
  30_000,
  60_000,
  120_000,
  300_000,
  600_000,
  900_000,
  1_800_000,
  3_600_000,
];

export interface TimelineBlock {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
}

export interface TimelineBlockWithLane extends TimelineBlock {
  lane: number;
}

export interface OcrTimelineRenderedLaneOptions {
  viewport: OcrTimelineViewport;
  trackWidthPx: number;
  minWidthPercent: number;
}

interface RenderedTimelineBounds {
  leftPx: number;
  rightPx: number;
}

export interface OcrTimelineViewport {
  startTimeMs: number;
  endTimeMs: number;
}

export interface OcrTimelineTick {
  timeMs: number;
  label: string;
}

export type OcrTimelineWheelIntent =
  | { type: 'none' }
  | { type: 'pan'; deltaTimeMs: number }
  | { type: 'zoom'; zoomFactor: number };

export interface OcrTimelineWheelInput {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey?: boolean;
  viewportWindowMs: number;
  durationMs: number;
  trackWidth?: number;
}

export function createDefaultVideoOcrSelection(durationMs: number): VideoOcrSelection {
  const safeDurationMs = normalizePositiveDurationMs(durationMs);

  return {
    segments: [
      {
        id: generateSelectionId('ocr-segment'),
        startTimeMs: 0,
        endTimeMs: safeDurationMs,
        zones: [
          {
            id: generateSelectionId('ocr-zone'),
            role: 'main_subtitle',
            region: { ...DEFAULT_MAIN_SUBTITLE_REGION },
            label: 'Zone 1',
          },
        ],
      },
    ],
  };
}

export function createOcrSegmentFromZone(
  startTimeMs: number,
  endTimeMs: number,
  region: OcrRegion,
  role: OcrZoneRole = 'main_subtitle',
): OcrSegment {
  const safeStartTimeMs = normalizeTimeMs(startTimeMs, 0);
  const safeEndTimeMs = Math.max(safeStartTimeMs + 1, normalizeTimeMs(endTimeMs, safeStartTimeMs + 1));

  return {
    id: generateSelectionId('ocr-segment'),
    startTimeMs: safeStartTimeMs,
    endTimeMs: safeEndTimeMs,
    zones: [
      {
        id: generateSelectionId('ocr-zone'),
        role,
        region: clampRegion(region),
        label: 'Zone 1',
      },
    ],
  };
}

export function normalizeOcrZoneLabels(selection: VideoOcrSelection): VideoOcrSelection {
  let defaultZoneIndex = 1;

  return {
    segments: selection.segments.map((segment) => ({
      ...segment,
      zones: segment.zones.map((zone) => {
        const nextZone = { ...zone, region: { ...zone.region } };
        const label = nextZone.label?.trim();

        if (label && !isDefaultZoneLabel(label)) {
          nextZone.label = label;
          return nextZone;
        }

        nextZone.label = `Zone ${defaultZoneIndex}`;
        defaultZoneIndex += 1;
        return nextZone;
      }),
    })),
  };
}

export function getActiveOcrZonesAtTime(selection: VideoOcrSelection, timeMs: number): OcrZone[] {
  return selection.segments
    .filter((segment) => timeMs >= segment.startTimeMs && timeMs < segment.endTimeMs)
    .flatMap((segment) => segment.zones);
}

export function selectionHasRole(selection: VideoOcrSelection, role: OcrZoneRole): boolean {
  return selection.segments.some((segment) => segment.zones.some((zone) => zone.role === role));
}

export function getAllowedOcrExportFormats(selection: VideoOcrSelection): OcrOutputFormat[] {
  return selectionHasRole(selection, 'on_screen_text') ? ['ass'] : ['srt', 'vtt', 'ass'];
}

export function getAllowedOcrVersionExportFormats(
  version: Pick<OcrVersion, 'finalSubtitles'>,
): OcrOutputFormat[] {
  return version.finalSubtitles.some((subtitle) => subtitle.role === 'on_screen_text')
    ? ['ass']
    : ['srt', 'vtt', 'ass'];
}

export function assignOcrTimelineLanes<T extends TimelineBlock>(blocks: T[]): Array<T & { lane: number }> {
  const sorted = [...blocks].sort((a, b) => a.startTimeMs - b.startTimeMs || a.endTimeMs - b.endTimeMs);
  const laneEndTimes: number[] = [];

  return sorted.map((block) => {
    const lane = laneEndTimes.findIndex((endTimeMs) => block.startTimeMs >= endTimeMs);
    const nextLane = lane === -1 ? laneEndTimes.length : lane;
    laneEndTimes[nextLane] = block.endTimeMs;
    return { ...block, lane: nextLane };
  });
}

export function assignOcrTimelineRenderedLanes<T extends TimelineBlock>(
  blocks: T[],
  options: OcrTimelineRenderedLaneOptions,
): Array<T & { lane: number }> {
  const trackWidthPx = Number.isFinite(options.trackWidthPx) ? Math.max(0, options.trackWidthPx) : 0;
  if (trackWidthPx <= 0) {
    return assignOcrTimelineLanes(blocks);
  }

  const minWidthPercent = Number.isFinite(options.minWidthPercent)
    ? Math.max(0, options.minWidthPercent)
    : 0;
  const minWidthPx = trackWidthPx * (minWidthPercent / 100);
  const laneBlocks: RenderedTimelineBounds[][] = [];
  const lanesById = new Map<string, number>();

  const sortedForPlacement = [...blocks].sort((a, b) => {
    const durationDelta = (b.endTimeMs - b.startTimeMs) - (a.endTimeMs - a.startTimeMs);
    if (durationDelta !== 0) {
      return durationDelta;
    }

    return a.startTimeMs - b.startTimeMs || a.endTimeMs - b.endTimeMs || a.id.localeCompare(b.id);
  });

  for (const block of sortedForPlacement) {
    const bounds = getRenderedTimelineBounds(block, options.viewport, trackWidthPx, minWidthPx);
    const laneIndex = laneBlocks.findIndex((lane) =>
      lane.every((existingBounds) => !renderedBoundsOverlap(existingBounds, bounds)),
    );
    const nextLane = laneIndex === -1 ? laneBlocks.length : laneIndex;

    if (!laneBlocks[nextLane]) {
      laneBlocks[nextLane] = [];
    }
    laneBlocks[nextLane].push(bounds);
    lanesById.set(block.id, nextLane);
  }

  return blocks.map((block) => ({
    ...block,
    lane: lanesById.get(block.id) ?? 0,
  }));
}

export function createOcrTimelineViewport(
  durationMs: number,
  requestedStartTimeMs = 0,
  requestedWindowMs = durationMs,
): OcrTimelineViewport {
  const safeDurationMs = normalizePositiveDurationMs(durationMs);
  const minWindowMs = Math.min(MIN_TIMELINE_VIEWPORT_MS, safeDurationMs);
  const windowMs = Math.max(minWindowMs, Math.min(safeDurationMs, normalizePositiveDurationMs(requestedWindowMs)));
  const maxStartTimeMs = Math.max(0, safeDurationMs - windowMs);
  const startTimeMs = Math.max(0, Math.min(normalizeTimeMs(requestedStartTimeMs, 0), maxStartTimeMs));

  return {
    startTimeMs,
    endTimeMs: startTimeMs + windowMs,
  };
}

export function zoomOcrTimelineViewport(
  viewport: OcrTimelineViewport,
  durationMs: number,
  anchorTimeMs: number,
  zoomFactor: number,
): OcrTimelineViewport {
  const currentWindowMs = Math.max(1, viewport.endTimeMs - viewport.startTimeMs);
  const nextWindowMs = currentWindowMs * Math.max(0.1, zoomFactor);
  const safeAnchorTimeMs = Math.max(viewport.startTimeMs, Math.min(anchorTimeMs, viewport.endTimeMs));
  const anchorRatio = (safeAnchorTimeMs - viewport.startTimeMs) / currentWindowMs;

  return createOcrTimelineViewport(
    durationMs,
    safeAnchorTimeMs - nextWindowMs * anchorRatio,
    nextWindowMs,
  );
}

export function panOcrTimelineViewport(
  viewport: OcrTimelineViewport,
  durationMs: number,
  deltaTimeMs: number,
): OcrTimelineViewport {
  return createOcrTimelineViewport(
    durationMs,
    viewport.startTimeMs + deltaTimeMs,
    viewport.endTimeMs - viewport.startTimeMs,
  );
}

export function createOcrTimelineTicks(viewport: OcrTimelineViewport): OcrTimelineTick[] {
  const startTimeMs = normalizeTimeMs(viewport.startTimeMs, 0);
  const endTimeMs = Math.max(startTimeMs + 1, normalizeTimeMs(viewport.endTimeMs, startTimeMs + 1));
  const intervalMs = chooseTimelineTickIntervalMs(endTimeMs - startTimeMs);
  const firstTickMs = Math.ceil(startTimeMs / intervalMs) * intervalMs;
  const ticks: OcrTimelineTick[] = [];

  for (let timeMs = firstTickMs; timeMs <= endTimeMs; timeMs += intervalMs) {
    ticks.push({ timeMs, label: formatTimelineTickLabel(timeMs) });
  }

  return ticks;
}

export function createOcrTimelineMinorTicks(viewport: OcrTimelineViewport): OcrTimelineTick[] {
  const startTimeMs = normalizeTimeMs(viewport.startTimeMs, 0);
  const endTimeMs = Math.max(startTimeMs + 1, normalizeTimeMs(viewport.endTimeMs, startTimeMs + 1));
  const majorIntervalMs = chooseTimelineTickIntervalMs(endTimeMs - startTimeMs);
  const minorIntervalMs = Math.max(1, Math.round(majorIntervalMs / 5));
  const firstTickMs = Math.ceil(startTimeMs / minorIntervalMs) * minorIntervalMs;
  const ticks: OcrTimelineTick[] = [];

  for (let timeMs = firstTickMs; timeMs <= endTimeMs; timeMs += minorIntervalMs) {
    if (timeMs % majorIntervalMs === 0) {
      continue;
    }

    ticks.push({ timeMs, label: '' });
  }

  return ticks;
}

export function getOcrTimelineWheelIntent(input: OcrTimelineWheelInput): OcrTimelineWheelIntent {
  const viewportWindowMs = normalizePositiveDurationMs(input.viewportWindowMs);
  const durationMs = normalizePositiveDurationMs(input.durationMs);
  const zoomGesture = input.ctrlKey || input.metaKey === true;

  if (zoomGesture) {
    return {
      type: 'zoom',
      zoomFactor: Math.exp(input.deltaY * 0.002),
    };
  }

  const horizontalIntent = Math.abs(input.deltaX) > Math.abs(input.deltaY);
  if (horizontalIntent && viewportWindowMs < durationMs) {
    const trackWidth = Number.isFinite(input.trackWidth) && input.trackWidth && input.trackWidth > 0
      ? input.trackWidth
      : 1;

    return {
      type: 'pan',
      deltaTimeMs: (input.deltaX / trackWidth) * viewportWindowMs,
    };
  }

  return { type: 'none' };
}

export function validateVideoOcrSelection(selection: VideoOcrSelection, durationMs: number): string[] {
  const errors: string[] = [];
  const durationIsPositiveFinite = Number.isFinite(durationMs) && durationMs > 0;
  const safeDurationMs = durationIsPositiveFinite
    ? normalizePositiveDurationMs(durationMs)
    : Number.POSITIVE_INFINITY;

  if (!durationIsPositiveFinite) {
    errors.push('Video duration must be a positive finite number.');
  }
  if (selection.segments.length === 0) {
    errors.push('OCR selection must contain at least one segment.');
  }

  for (const segment of selection.segments) {
    const segmentTimesAreFinite = Number.isFinite(segment.startTimeMs) && Number.isFinite(segment.endTimeMs);

    if (!segmentTimesAreFinite) {
      errors.push(`Segment ${segment.id} must use finite start and end times.`);
    }
    if (segmentTimesAreFinite && (segment.startTimeMs < 0 || segment.endTimeMs > safeDurationMs)) {
      errors.push(`Segment ${segment.id} must stay within the video duration.`);
    }
    if (segmentTimesAreFinite && segment.startTimeMs >= segment.endTimeMs) {
      errors.push(`Segment ${segment.id} must start before it ends.`);
    }
    if (segment.zones.length === 0) {
      errors.push(`Segment ${segment.id} must contain at least one OCR zone.`);
    }

    for (const zone of segment.zones) {
      if (!regionIsInsideFrame(zone.region)) {
        errors.push(`Zone ${zone.id} must stay within the video frame.`);
      }
      if (zone.region.width < MIN_REGION_SIZE || zone.region.height < MIN_REGION_SIZE) {
        errors.push(`Zone ${zone.id} is too small.`);
      }
    }
  }

  return errors;
}

export function clampRegion(region: OcrRegion): OcrRegion {
  const x = clamp01(region.x);
  const y = clamp01(region.y);
  const width = Math.min(clamp01(region.width), 1 - x);
  const height = Math.min(clamp01(region.height), 1 - y);
  return { x, y, width, height };
}

function regionIsInsideFrame(region: OcrRegion): boolean {
  return region.x >= 0
    && region.y >= 0
    && region.width > 0
    && region.height > 0
    && region.x + region.width <= 1
    && region.y + region.height <= 1;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function normalizeTimeMs(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

function normalizePositiveDurationMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 1;
}

function getRenderedTimelineBounds(
  block: TimelineBlock,
  viewport: OcrTimelineViewport,
  trackWidthPx: number,
  minWidthPx: number,
): RenderedTimelineBounds {
  const viewportStartTimeMs = normalizeTimeMs(viewport.startTimeMs, 0);
  const viewportEndTimeMs = Math.max(
    viewportStartTimeMs + 1,
    normalizeTimeMs(viewport.endTimeMs, viewportStartTimeMs + 1),
  );
  const viewportWindowMs = Math.max(1, viewportEndTimeMs - viewportStartTimeMs);
  const visibleStartTimeMs = Math.max(block.startTimeMs, viewportStartTimeMs);
  const visibleEndTimeMs = Math.min(block.endTimeMs, viewportEndTimeMs);
  const leftRatio = (visibleStartTimeMs - viewportStartTimeMs) / viewportWindowMs;
  const rightRatio = (visibleEndTimeMs - viewportStartTimeMs) / viewportWindowMs;
  const leftPx = Math.max(0, Math.min(trackWidthPx, leftRatio * trackWidthPx));
  const naturalRightPx = Math.max(leftPx, rightRatio * trackWidthPx);

  return {
    leftPx,
    rightPx: Math.max(naturalRightPx, leftPx + minWidthPx),
  };
}

function renderedBoundsOverlap(
  left: RenderedTimelineBounds,
  right: RenderedTimelineBounds,
): boolean {
  return left.leftPx < right.rightPx && right.leftPx < left.rightPx;
}

function chooseTimelineTickIntervalMs(windowMs: number): number {
  const targetIntervalMs = windowMs / TIMELINE_TICK_TARGET_COUNT;
  return TIMELINE_TICK_INTERVALS_MS.find((intervalMs) => intervalMs >= targetIntervalMs)
    ?? TIMELINE_TICK_INTERVALS_MS.at(-1)
    ?? 3_600_000;
}

function formatTimelineTickLabel(timeMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, timeMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function isDefaultZoneLabel(label: string): boolean {
  return /^Zone \d+$/.test(label);
}

function generateSelectionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
