import type { OcrSubtitle } from '$lib/types/video-ocr';

export interface RustOcrSubtitle {
  id: string;
  text: string;
  start_time: number;
  end_time: number;
  confidence: number;
}

export interface OcrSubtitleLike {
  id?: unknown;
  text?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  confidence?: unknown;
}

function toFiniteMilliseconds(value: unknown): number | null {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.max(0, Math.round(numericValue));
}

function toFiniteConfidence(value: unknown): number {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numericValue));
}

export function normalizeOcrSubtitle(raw: OcrSubtitleLike, fallbackIndex: number): OcrSubtitle | null {
  const startTime = toFiniteMilliseconds(raw.startTime ?? raw.start_time);
  const endTimeRaw = toFiniteMilliseconds(raw.endTime ?? raw.end_time);

  if (startTime === null || endTimeRaw === null) {
    return null;
  }

  const endTime = endTimeRaw > startTime ? endTimeRaw : startTime + 1;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `sub-${fallbackIndex + 1}`;
  const text = typeof raw.text === 'string' ? raw.text : String(raw.text ?? '');

  return {
    id,
    text: text.trim(),
    startTime,
    endTime,
    confidence: toFiniteConfidence(raw.confidence),
  };
}

export function normalizeOcrSubtitles(rawItems: OcrSubtitleLike[]): OcrSubtitle[] {
  const normalized: OcrSubtitle[] = [];

  for (let index = 0; index < rawItems.length; index += 1) {
    const subtitle = normalizeOcrSubtitle(rawItems[index], index);
    if (!subtitle) {
      continue;
    }
    normalized.push(subtitle);
  }

  return normalized;
}

export function toRustOcrSubtitle(subtitle: OcrSubtitle): RustOcrSubtitle {
  const startTime = Math.max(0, Math.round(subtitle.startTime));
  const endTime = Math.max(startTime + 1, Math.round(subtitle.endTime));

  return {
    id: subtitle.id,
    text: subtitle.text,
    start_time: startTime,
    end_time: endTime,
    confidence: toFiniteConfidence(subtitle.confidence),
  };
}

export function toRustOcrSubtitles(subtitles: OcrSubtitle[]): RustOcrSubtitle[] {
  return subtitles.map((subtitle) => toRustOcrSubtitle(subtitle));
}
