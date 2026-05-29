import type { SubtitleOcrProgress } from '$lib/types';

const SUBTITLE_OCR_PHASE_ORDER: Record<SubtitleOcrProgress['phase'], number> = {
  extracting: 0,
  decoding: 1,
  ocr: 2,
  ai_cleaning: 3,
};

const SUBTITLE_OCR_PHASE_PROGRESS_RANGES: Record<
  SubtitleOcrProgress['phase'],
  { start: number; end: number }
> = {
  extracting: { start: 0, end: 10 },
  decoding: { start: 10, end: 20 },
  ocr: { start: 20, end: 95 },
  ai_cleaning: { start: 95, end: 100 },
};

const UNKNOWN_TOTAL_OCR_OVERALL_PERCENTAGE = 10;

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeProgress(progress: SubtitleOcrProgress): SubtitleOcrProgress {
  const total = Math.max(0, Math.round(progress.total));

  return {
    ...progress,
    current: Math.max(0, Math.round(progress.current)),
    total,
    totalKnown: progress.totalKnown ?? total > 0,
    percentage: clampPercentage(progress.percentage),
  };
}

export function getSubtitleOcrProgressPhaseOrder(phase: SubtitleOcrProgress['phase']): number {
  return SUBTITLE_OCR_PHASE_ORDER[phase] ?? 0;
}

export function isSubtitleOcrProgressPhaseStale(
  previous: Pick<SubtitleOcrProgress, 'phase'> | undefined,
  incomingPhase: SubtitleOcrProgress['phase'],
): boolean {
  return previous !== undefined
    && getSubtitleOcrProgressPhaseOrder(incomingPhase)
      < getSubtitleOcrProgressPhaseOrder(previous.phase);
}

export function getSubtitleOcrOverallPercentage(progress: SubtitleOcrProgress): number {
  if (typeof progress.overallPercentage === 'number') {
    return clampPercentage(progress.overallPercentage);
  }

  if (progress.phase === 'ocr' && progress.totalKnown === false) {
    return UNKNOWN_TOTAL_OCR_OVERALL_PERCENTAGE;
  }

  const range = SUBTITLE_OCR_PHASE_PROGRESS_RANGES[progress.phase];
  return clampPercentage(
    range.start + ((range.end - range.start) * clampPercentage(progress.percentage)) / 100,
  );
}

function shouldAcceptIncomingDetails(
  previous: SubtitleOcrProgress,
  incoming: SubtitleOcrProgress,
): boolean {
  if (previous.totalKnown === true && incoming.totalKnown !== true) {
    return false;
  }

  if (incoming.current < previous.current) {
    return false;
  }

  return true;
}

function mergeSamePhaseProgress(
  previous: SubtitleOcrProgress,
  incoming: SubtitleOcrProgress,
): SubtitleOcrProgress {
  const shouldAcceptDetails = shouldAcceptIncomingDetails(previous, incoming);
  const shouldAcceptTotal = incoming.totalKnown === true
    && (shouldAcceptDetails || previous.totalKnown !== true);

  return {
    ...incoming,
    current: Math.max(previous.current, incoming.current),
    total: shouldAcceptTotal ? incoming.total : previous.total,
    totalKnown: shouldAcceptTotal || previous.totalKnown,
    percentage: shouldAcceptDetails ? incoming.percentage : previous.percentage,
  };
}

export function mergeSubtitleOcrProgress(
  previous: SubtitleOcrProgress | undefined,
  incoming: SubtitleOcrProgress,
): SubtitleOcrProgress {
  const normalizedIncoming = normalizeProgress(incoming);
  if (!previous) {
    return {
      ...normalizedIncoming,
      overallPercentage: getSubtitleOcrOverallPercentage(normalizedIncoming),
    };
  }

  const normalizedPrevious = normalizeProgress(previous);
  const previousOrder = getSubtitleOcrProgressPhaseOrder(normalizedPrevious.phase);
  const incomingOrder = getSubtitleOcrProgressPhaseOrder(normalizedIncoming.phase);
  if (incomingOrder < previousOrder) {
    return normalizedPrevious;
  }

  const merged = incomingOrder === previousOrder
    ? mergeSamePhaseProgress(normalizedPrevious, normalizedIncoming)
    : normalizedIncoming;

  return {
    ...merged,
    overallPercentage: Math.max(
      getSubtitleOcrOverallPercentage(normalizedPrevious),
      getSubtitleOcrOverallPercentage(merged),
    ),
  };
}
