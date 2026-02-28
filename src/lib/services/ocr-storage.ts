import type {
  OcrConfig,
  OcrRegion,
  OcrRegionMode,
  OcrRetryMode,
  OcrSubtitle,
  OcrRawFrame,
  OcrVersion,
  VideoOcrPersistenceData,
} from '$lib/types';
import { loadRsextData, saveRsextData } from './rsext-storage';

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
  previewPath?: string,
  ocrRegion?: OcrRegion,
  ocrRegionMode?: OcrRegionMode,
): VideoOcrPersistenceData {
  const now = new Date().toISOString();
  return {
    version: 1,
    videoPath,
    previewPath,
    ocrRegion,
    ocrRegionMode,
    ocrVersions: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadOcrData(videoPath: string): Promise<VideoOcrPersistenceData | null> {
  const rsextData = await loadRsextData(videoPath);
  if (!rsextData?.videoOcr) {
    return null;
  }

  return {
    ...rsextData.videoOcr,
    ocrVersions: rsextData.videoOcr.ocrVersions.map(normalizeOcrVersion),
  };
}

export async function saveOcrData(
  videoPath: string,
  data: VideoOcrPersistenceData,
): Promise<boolean> {
  const existing = await loadRsextData(videoPath);
  const now = new Date().toISOString();

  return saveRsextData(videoPath, {
    version: 1,
    audioToSubs: existing?.audioToSubs,
    translation: existing?.translation,
    videoOcr: {
      ...data,
      version: 1,
      videoPath,
      ocrVersions: data.ocrVersions.map(normalizeOcrVersion),
      createdAt: data.createdAt || now,
      updatedAt: now,
    },
  });
}

export async function addOcrVersion(
  videoPath: string,
  version: OcrVersion,
  options?: {
    previewPath?: string;
    ocrRegion?: OcrRegion;
    ocrRegionMode?: OcrRegionMode;
  },
): Promise<VideoOcrPersistenceData | null> {
  const data = (await loadOcrData(videoPath))
    ?? createEmptyOcrData(videoPath, options?.previewPath, options?.ocrRegion, options?.ocrRegionMode);

  data.ocrVersions = [...data.ocrVersions, version];

  if (options?.previewPath !== undefined) {
    data.previewPath = options.previewPath;
  }
  if (options?.ocrRegion !== undefined) {
    data.ocrRegion = options.ocrRegion;
  }
  if (options?.ocrRegionMode !== undefined) {
    data.ocrRegionMode = options.ocrRegionMode;
  }

  const success = await saveOcrData(videoPath, data);
  return success ? data : null;
}
