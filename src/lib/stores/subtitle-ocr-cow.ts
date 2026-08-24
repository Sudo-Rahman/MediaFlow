import type {
  SubtitleOcrCue,
  SubtitleOcrCueBitmap,
  SubtitleOcrRawCue,
} from '$lib/types';

export const EMPTY_SUBTITLE_OCR_CUES: readonly SubtitleOcrCue[] = Object.freeze([]);
export const EMPTY_SUBTITLE_OCR_BITMAPS: readonly SubtitleOcrCueBitmap[] = Object.freeze([]);

const frozenCueProjectionArrays = new WeakSet<readonly SubtitleOcrCue[]>();
const frozenBitmapProjectionArrays = new WeakSet<readonly SubtitleOcrCueBitmap[]>();

export function cloneCue(cue: SubtitleOcrCue): SubtitleOcrCue {
  return {
    ...cue,
    sourceCueIds: [...cue.sourceCueIds],
  };
}

export function cloneBitmap(bitmap: SubtitleOcrCueBitmap): SubtitleOcrCueBitmap {
  return { ...bitmap };
}

export function cloneRawCue(rawCue: SubtitleOcrRawCue): SubtitleOcrRawCue {
  return {
    ...rawCue,
    boxes: rawCue.boxes.map((box) => ({ ...box })),
  };
}

export function upsertBy<T>(
  values: readonly T[],
  candidate: T,
  matches: (value: T) => boolean,
  clone: (value: T) => T,
): T[] {
  const existingIndex = values.findIndex(matches);
  if (existingIndex === -1) {
    return [...values, clone(candidate)];
  }

  const nextValues = [...values];
  nextValues[existingIndex] = clone(candidate);
  return nextValues;
}

export function cueMatchesLiveCue(cue: SubtitleOcrCue, liveCue: SubtitleOcrCue): boolean {
  return cue.id === liveCue.id
    || cue.sourceCueIds.some((sourceCueId) => liveCue.sourceCueIds.includes(sourceCueId));
}

export function bitmapMatchesLiveBitmap(
  bitmap: SubtitleOcrCueBitmap,
  liveBitmap: SubtitleOcrCueBitmap,
): boolean {
  return Boolean(bitmap.cacheKey && liveBitmap.cacheKey && bitmap.cacheKey === liveBitmap.cacheKey)
    || bitmap.cueId === liveBitmap.cueId;
}

export function rawCueMatchesLiveRawCue(
  rawCue: SubtitleOcrRawCue,
  liveRawCue: SubtitleOcrRawCue,
): boolean {
  return Boolean(rawCue.cacheKey && liveRawCue.cacheKey && rawCue.cacheKey === liveRawCue.cacheKey)
    || rawCue.cueId === liveRawCue.cueId;
}

export function restoredBitmapMatches(
  bitmap: SubtitleOcrCueBitmap,
  restored: SubtitleOcrCueBitmap,
): boolean {
  return Boolean(bitmap.cacheKey && restored.cacheKey && bitmap.cacheKey === restored.cacheKey)
    || Boolean(bitmap.cueId && restored.cueId && bitmap.cueId === restored.cueId)
    || (
      bitmap.startTimeMs === restored.startTimeMs
      && bitmap.endTimeMs === restored.endTimeMs
      && bitmap.width === restored.width
      && bitmap.height === restored.height
    );
}

export function freezeCueProjection(cues: readonly SubtitleOcrCue[]): readonly SubtitleOcrCue[] {
  if (!frozenCueProjectionArrays.has(cues)) {
    for (const cue of cues) {
      Object.freeze(cue.sourceCueIds);
      Object.freeze(cue);
    }
    Object.freeze(cues);
    frozenCueProjectionArrays.add(cues);
  }

  return cues;
}

export function freezeBitmapProjection(
  bitmaps: readonly SubtitleOcrCueBitmap[],
): readonly SubtitleOcrCueBitmap[] {
  if (!frozenBitmapProjectionArrays.has(bitmaps)) {
    for (const bitmap of bitmaps) {
      Object.freeze(bitmap);
    }
    Object.freeze(bitmaps);
    frozenBitmapProjectionArrays.add(bitmaps);
  }

  return bitmaps;
}
