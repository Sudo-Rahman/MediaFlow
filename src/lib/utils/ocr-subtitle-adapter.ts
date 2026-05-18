import type { OcrRawFrame, OcrRegion, OcrSubtitle, OcrZoneRole } from '$lib/types/video-ocr';

export interface RustOcrSubtitle {
  id: string;
  text: string;
  start_time: number;
  end_time: number;
  confidence: number;
  segment_id?: string;
  zone_id?: string;
  role?: OcrZoneRole;
  region?: OcrRegion;
}

export interface RustOcrRawFrame {
  frame_index: number;
  time_ms: number;
  text: string;
  confidence: number;
  segment_id?: string;
  zone_id?: string;
  role?: OcrZoneRole;
  region?: OcrRegion;
}

export interface OcrSubtitleLike {
  id?: unknown;
  text?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  confidence?: unknown;
  segmentId?: unknown;
  segment_id?: unknown;
  zoneId?: unknown;
  zone_id?: unknown;
  role?: unknown;
  region?: unknown;
}

export interface OcrRawFrameLike {
  frameIndex?: unknown;
  timeMs?: unknown;
  frame_index?: unknown;
  time_ms?: unknown;
  text?: unknown;
  confidence?: unknown;
  segmentId?: unknown;
  segment_id?: unknown;
  zoneId?: unknown;
  zone_id?: unknown;
  role?: unknown;
  region?: unknown;
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

function toFiniteFrameIndex(value: unknown): number | null {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.max(0, Math.floor(numericValue));
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toOcrZoneRole(value: unknown): OcrZoneRole | undefined {
  return value === 'main_subtitle' || value === 'on_screen_text' ? value : undefined;
}

function toOcrRegion(value: unknown): OcrRegion | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const region = value as Partial<Record<keyof OcrRegion, unknown>>;
  const x = typeof region.x === 'number' ? region.x : Number.NaN;
  const y = typeof region.y === 'number' ? region.y : Number.NaN;
  const width = typeof region.width === 'number' ? region.width : Number.NaN;
  const height = typeof region.height === 'number' ? region.height : Number.NaN;

  return [x, y, width, height].every(Number.isFinite)
    ? { x, y, width, height }
    : undefined;
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
    ...(toOptionalString(raw.segmentId ?? raw.segment_id) ? { segmentId: toOptionalString(raw.segmentId ?? raw.segment_id) } : {}),
    ...(toOptionalString(raw.zoneId ?? raw.zone_id) ? { zoneId: toOptionalString(raw.zoneId ?? raw.zone_id) } : {}),
    ...(toOcrZoneRole(raw.role) ? { role: toOcrZoneRole(raw.role) } : {}),
    ...(toOcrRegion(raw.region) ? { region: toOcrRegion(raw.region) } : {}),
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

  const segmentId = toOptionalString(subtitle.segmentId);
  const zoneId = toOptionalString(subtitle.zoneId);

  return {
    id: subtitle.id,
    text: subtitle.text,
    start_time: startTime,
    end_time: endTime,
    confidence: toFiniteConfidence(subtitle.confidence),
    ...(segmentId ? { segment_id: segmentId } : {}),
    ...(zoneId ? { zone_id: zoneId } : {}),
    ...(subtitle.role ? { role: subtitle.role } : {}),
    ...(subtitle.region ? { region: subtitle.region } : {}),
  };
}

export function toRustOcrSubtitles(subtitles: OcrSubtitle[]): RustOcrSubtitle[] {
  return subtitles.map((subtitle) => toRustOcrSubtitle(subtitle));
}

export function toRustOcrFrame(frame: OcrRawFrameLike, fallbackIndex: number): RustOcrRawFrame {
  const frameIndex = toFiniteFrameIndex(frame.frameIndex ?? frame.frame_index) ?? fallbackIndex;
  const timeMs = toFiniteMilliseconds(frame.timeMs ?? frame.time_ms) ?? 0;
  const text = typeof frame.text === 'string' ? frame.text : String(frame.text ?? '');

  const segmentId = toOptionalString(frame.segmentId ?? frame.segment_id);
  const zoneId = toOptionalString(frame.zoneId ?? frame.zone_id);

  return {
    frame_index: frameIndex,
    time_ms: timeMs,
    text,
    confidence: toFiniteConfidence(frame.confidence),
    ...(segmentId ? { segment_id: segmentId } : {}),
    ...(zoneId ? { zone_id: zoneId } : {}),
    ...(toOcrZoneRole(frame.role) ? { role: toOcrZoneRole(frame.role) } : {}),
    ...(toOcrRegion(frame.region) ? { region: toOcrRegion(frame.region) } : {}),
  };
}

export function normalizeOcrRawFrame(raw: OcrRawFrameLike, fallbackIndex: number): OcrRawFrame {
  const frameIndex = toFiniteFrameIndex(raw.frameIndex ?? raw.frame_index) ?? fallbackIndex;
  const timeMs = toFiniteMilliseconds(raw.timeMs ?? raw.time_ms) ?? 0;
  const text = typeof raw.text === 'string' ? raw.text : String(raw.text ?? '');

  const segmentId = toOptionalString(raw.segmentId ?? raw.segment_id);
  const zoneId = toOptionalString(raw.zoneId ?? raw.zone_id);

  return {
    frameIndex,
    timeMs,
    text,
    confidence: toFiniteConfidence(raw.confidence),
    ...(segmentId ? { segmentId } : {}),
    ...(zoneId ? { zoneId } : {}),
    ...(toOcrZoneRole(raw.role) ? { role: toOcrZoneRole(raw.role) } : {}),
    ...(toOcrRegion(raw.region) ? { region: toOcrRegion(raw.region) } : {}),
  };
}

export function normalizeOcrRawFrames(rawItems: Array<OcrRawFrame | OcrRawFrameLike | unknown>): OcrRawFrame[] {
  const normalized: OcrRawFrame[] = [];

  for (let index = 0; index < rawItems.length; index += 1) {
    const raw = rawItems[index];
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    normalized.push(normalizeOcrRawFrame(raw as OcrRawFrameLike, index));
  }

  return normalized;
}

export function toRustOcrFrames(frames: Array<OcrRawFrame | OcrRawFrameLike | unknown>): RustOcrRawFrame[] {
  const normalized: RustOcrRawFrame[] = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (!frame || typeof frame !== 'object') {
      continue;
    }
    normalized.push(toRustOcrFrame(frame as OcrRawFrameLike, index));
  }

  return normalized;
}
