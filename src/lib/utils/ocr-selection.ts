import { DEFAULT_OCR_REGION } from '$lib/types';
import type {
  OcrOutputFormat,
  OcrRegion,
  OcrSegment,
  OcrZone,
  OcrZoneRole,
  VideoOcrSelection,
} from '$lib/types';

export const DEFAULT_MAIN_SUBTITLE_REGION: OcrRegion = { ...DEFAULT_OCR_REGION };

const MIN_REGION_SIZE = 0.02;

export interface TimelineBlock {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
}

export interface TimelineBlockWithLane extends TimelineBlock {
  lane: number;
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
      },
    ],
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
  return selectionHasRole(selection, 'on_screen_text') ? ['ass'] : ['srt', 'vtt'];
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

function generateSelectionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
