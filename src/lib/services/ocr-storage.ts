import type {
  OcrConfig,
  OcrRetryMode,
  OcrSubtitle,
  OcrRawFrame,
  OcrRegion,
  OcrSegment,
  OcrVersion,
  OcrZone,
  OcrZoneRole,
  OcrPreviewSourceIdentity,
  VideoOcrSelection,
  VideoOcrPersistenceData,
} from '$lib/types';
import { validateVideoOcrSelection } from '$lib/utils/ocr-selection';
import { loadMediaflowData, saveMediaflowData } from './mediaflow-storage';

const LEGACY_OCR_DATA_ERROR = 'This Video OCR data was created with an older MediaFlow version and is not supported.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOcrVersion(value: unknown): value is OcrVersion {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.mode === 'string'
    && isRecord(value.configSnapshot)
    && toFinitePositiveNumber(value.configSnapshot.frameRate) !== null
    && Array.isArray(value.rawOcr)
    && Array.isArray(value.finalSubtitles);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOcrZoneRole(value: unknown): value is OcrZoneRole {
  return value === 'main_subtitle' || value === 'on_screen_text';
}

function isOcrRegion(value: unknown): value is OcrRegion {
  return isRecord(value)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.width)
    && isFiniteNumber(value.height);
}

function isOcrZone(value: unknown): value is OcrZone {
  return isRecord(value)
    && typeof value.id === 'string'
    && isOcrZoneRole(value.role)
    && isOcrRegion(value.region)
    && (value.label === undefined || typeof value.label === 'string');
}

function isOcrSegment(value: unknown): value is OcrSegment {
  return isRecord(value)
    && typeof value.id === 'string'
    && isFiniteNumber(value.startTimeMs)
    && isFiniteNumber(value.endTimeMs)
    && Array.isArray(value.zones)
    && value.zones.every(isOcrZone);
}

function isSemanticallyValidOcrSelection(selection: VideoOcrSelection): boolean {
  if (selection.segments.length === 0) {
    return false;
  }

  const maxEndTimeMs = Math.max(...selection.segments.map((segment) => segment.endTimeMs));
  if (!Number.isFinite(maxEndTimeMs) || maxEndTimeMs <= 0) {
    return false;
  }

  return validateVideoOcrSelection(selection, maxEndTimeMs).length === 0;
}

function isVideoOcrPersistenceData(value: unknown): value is VideoOcrPersistenceData {
  if (!isRecord(value) || 'ocrRegion' in value || 'ocrRegionMode' in value || value.version !== 2) {
    return false;
  }

  const selection = value.ocrSelection;
  if (!isRecord(selection) || !Array.isArray(selection.segments) || !selection.segments.every(isOcrSegment)) {
    return false;
  }

  const ocrSelection: VideoOcrSelection = { segments: selection.segments };
  return typeof value.videoPath === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && isSemanticallyValidOcrSelection(ocrSelection)
    && Array.isArray(value.ocrVersions)
    && value.ocrVersions.every(isOcrVersion);
}

function toFiniteNonNegativeNumber(value: unknown): number | null {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  return numericValue;
}

function toFinitePositiveNumber(value: unknown): number | null {
  const numericValue = toFiniteNonNegativeNumber(value);

  if (numericValue === null || numericValue <= 0) {
    return null;
  }

  return numericValue;
}

function getRawFrameTimeMs(frame: unknown): number | null {
  if (!frame || typeof frame !== 'object') {
    return null;
  }

  const record = frame as { timeMs?: unknown; time_ms?: unknown };
  return toFiniteNonNegativeNumber(record.timeMs ?? record.time_ms);
}

export function inferOcrRawFrameRate(rawOcr: ReadonlyArray<unknown>): number | null {
  if (rawOcr.length < 2) {
    return null;
  }

  const deltas: number[] = [];
  let previousTime: number | null = null;

  for (const frame of rawOcr) {
    const currentTime = getRawFrameTimeMs(frame);
    if (currentTime === null) {
      continue;
    }

    if (previousTime !== null) {
      const delta = currentTime - previousTime;
      if (delta > 0) {
        deltas.push(delta);
      }
    }

    previousTime = currentTime;
  }

  if (deltas.length === 0) {
    return null;
  }

  deltas.sort((a, b) => a - b);
  const medianDelta = deltas[Math.floor(deltas.length / 2)];

  if (medianDelta <= 0) {
    return null;
  }

  return Number((1000 / medianDelta).toFixed(3));
}

export function resolveOcrVersionRawFrameRate(version: OcrVersion, fallbackFrameRate: number): number {
  const explicitRawFrameRate = toFinitePositiveNumber(version.rawFrameRate);
  if (explicitRawFrameRate !== null) {
    return explicitRawFrameRate;
  }

  const configFrameRate = toFinitePositiveNumber(version.configSnapshot.frameRate);
  if (version.mode === 'full_pipeline' && configFrameRate !== null) {
    return configFrameRate;
  }

  const inferredRawFrameRate = inferOcrRawFrameRate(version.rawOcr);
  if (inferredRawFrameRate !== null) {
    return inferredRawFrameRate;
  }

  if (configFrameRate !== null) {
    return configFrameRate;
  }

  return toFinitePositiveNumber(fallbackFrameRate) ?? 1;
}

function normalizeOcrVersion(version: OcrVersion): OcrVersion {
  return {
    ...version,
    rawFrameRate: resolveOcrVersionRawFrameRate(version, version.configSnapshot.frameRate),
  };
}

function generateVersionId(): string {
  return `ocr-v-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function createOcrVersion(
  name: string,
  mode: OcrRetryMode,
  configSnapshot: OcrConfig,
  rawOcr: OcrRawFrame[],
  finalSubtitles: OcrSubtitle[],
  rawFrameRate?: number,
): OcrVersion {
  return {
    id: generateVersionId(),
    name,
    createdAt: new Date().toISOString(),
    mode,
    configSnapshot: { ...configSnapshot },
    rawFrameRate: toFinitePositiveNumber(rawFrameRate) ?? undefined,
    rawOcr: [...rawOcr],
    finalSubtitles: [...finalSubtitles],
  };
}

export function generateOcrVersionName(existingVersions: OcrVersion[]): string {
  return `Version ${existingVersions.length + 1}`;
}

function createEmptyOcrData(
  videoPath: string,
  ocrSelection: VideoOcrSelection,
  previewPath?: string,
  previewSourceIdentity?: OcrPreviewSourceIdentity,
  previewVersion?: string,
): VideoOcrPersistenceData {
  const now = new Date().toISOString();
  return {
    version: 2,
    videoPath,
    previewPath,
    previewSourceIdentity,
    previewVersion,
    ocrSelection,
    ocrVersions: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadOcrData(videoPath: string): Promise<VideoOcrPersistenceData | null> {
  const mediaflowData = await loadMediaflowData(videoPath);
  if (!mediaflowData?.videoOcr) {
    return null;
  }

  const videoOcr: unknown = mediaflowData.videoOcr;
  if (!isVideoOcrPersistenceData(videoOcr)) {
    throw new Error(LEGACY_OCR_DATA_ERROR);
  }

  return {
    ...videoOcr,
    version: 2,
    ocrVersions: videoOcr.ocrVersions.map(normalizeOcrVersion),
  };
}

export async function saveOcrData(
  videoPath: string,
  data: VideoOcrPersistenceData,
): Promise<boolean> {
  const existing = await loadMediaflowData(videoPath);
  const now = new Date().toISOString();

  return saveMediaflowData(videoPath, {
    version: 1,
    audioToSubs: existing?.audioToSubs,
    translation: existing?.translation,
    videoOcr: {
      version: 2,
      videoPath,
      previewPath: data.previewPath,
      previewSourceIdentity: data.previewSourceIdentity,
      previewVersion: data.previewVersion,
      ocrSelection: data.ocrSelection,
      ocrVersions: data.ocrVersions.map(normalizeOcrVersion),
      createdAt: data.createdAt || now,
      updatedAt: now,
    },
  });
}

export async function addOcrVersion(
  videoPath: string,
  version: OcrVersion,
  options: {
    ocrSelection: VideoOcrSelection;
    previewPath?: string;
    previewSourceIdentity?: OcrPreviewSourceIdentity;
    previewVersion?: string;
  },
): Promise<VideoOcrPersistenceData | null> {
  const data = (await loadOcrData(videoPath))
    ?? createEmptyOcrData(
      videoPath,
      options.ocrSelection,
      options.previewPath,
      options.previewSourceIdentity,
      options.previewVersion,
    );

  data.ocrVersions = [...data.ocrVersions, version];
  data.ocrSelection = options.ocrSelection;

  if (options.previewPath !== undefined) {
    data.previewPath = options.previewPath;
  }
  if (options.previewSourceIdentity !== undefined) {
    data.previewSourceIdentity = options.previewSourceIdentity;
  }
  if (options.previewVersion !== undefined) {
    data.previewVersion = options.previewVersion;
  }

  const success = await saveOcrData(videoPath, data);
  return success ? data : null;
}
