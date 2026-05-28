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

const DEFAULT_TILE_MIN_WIDTH = 112;
const DEFAULT_TILE_MAX_WIDTH = 280;
const DEFAULT_TILE_PIXELS_PER_SECOND = 52;
const DEFAULT_MIN_TIMELINE_SPAN_MS = 1_000;

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
  minSpanMs = DEFAULT_MIN_TIMELINE_SPAN_MS,
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
