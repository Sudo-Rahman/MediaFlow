import type {
  OcrOutputFormat,
  OcrRegion,
  OcrSegment,
  OcrZone,
  OcrZoneRole,
  VideoOcrSelection,
} from '$lib/types';

export const DEFAULT_MAIN_SUBTITLE_REGION: OcrRegion = {
  x: 0,
  y: 0.75,
  width: 1,
  height: 0.25,
};

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
  const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 1;

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
  return {
    id: generateSelectionId('ocr-segment'),
    startTimeMs: Math.max(0, Math.round(startTimeMs)),
    endTimeMs: Math.max(Math.round(startTimeMs) + 1, Math.round(endTimeMs)),
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
  const safeDurationMs = Math.max(1, Math.round(durationMs));

  for (const segment of selection.segments) {
    if (segment.startTimeMs < 0 || segment.endTimeMs > safeDurationMs) {
      errors.push(`Segment ${segment.id} must stay within the video duration.`);
    }
    if (segment.startTimeMs >= segment.endTimeMs) {
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

function generateSelectionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
