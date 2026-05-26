import type {
  OcrConfig,
  OcrDraft,
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
import { DEFAULT_OCR_CONFIG, OCR_LANGUAGES } from '$lib/types';
import { validateVideoOcrSelection } from '$lib/utils/ocr-selection';
import { loadMediaflowData, saveMediaflowData } from './mediaflow-storage';

const UNSUPPORTED_OCR_DATA_ERROR = 'This Video OCR data is not compatible with this MediaFlow version.';

export class UnsupportedOcrPersistenceError extends Error {
  constructor(message = UNSUPPORTED_OCR_DATA_ERROR) {
    super(message);
    this.name = 'UnsupportedOcrPersistenceError';
  }
}

export function isUnsupportedOcrPersistenceError(error: unknown): error is UnsupportedOcrPersistenceError {
  return error instanceof UnsupportedOcrPersistenceError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOcrRetryMode(value: unknown): value is OcrRetryMode {
  return value === 'full_pipeline'
    || value === 'cleanup_only'
    || value === 'cleanup_and_ai'
    || value === 'ai_only';
}

function isOcrRawFrame(value: unknown): value is OcrRawFrame {
  return isRecord(value)
    && isFiniteNonNegativeNumber(value.frameIndex)
    && isFiniteNonNegativeNumber(value.timeMs)
    && typeof value.text === 'string'
    && isUnitInterval(value.confidence)
    && isOptionalString(value.segmentId)
    && isOptionalString(value.zoneId)
    && isOptionalOcrZoneRole(value.role)
    && isOptionalOcrRegion(value.region);
}

function isOcrSubtitle(value: unknown): value is OcrSubtitle {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.text === 'string'
    && isFiniteNonNegativeNumber(value.startTime)
    && isFiniteNonNegativeNumber(value.endTime)
    && value.endTime > value.startTime
    && isUnitInterval(value.confidence)
    && isOptionalString(value.segmentId)
    && isOptionalString(value.zoneId)
    && isOptionalOcrZoneRole(value.role)
    && isOptionalOcrRegion(value.region);
}

function isOcrVersion(value: unknown): value is OcrVersion {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.createdAt === 'string'
    && isOcrRetryMode(value.mode)
    && isRecord(value.configSnapshot)
    && toFinitePositiveNumber(value.configSnapshot.frameRate) !== null
    && isValidOcrSelectionValue(value.selectionSnapshot)
    && Array.isArray(value.rawOcr)
    && value.rawOcr.every(isOcrRawFrame)
    && Array.isArray(value.finalSubtitles)
    && value.finalSubtitles.every(isOcrSubtitle);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isUnitInterval(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOcrZoneRole(value: unknown): value is OcrZoneRole {
  return value === 'main_subtitle' || value === 'on_screen_text';
}

function isOptionalOcrZoneRole(value: unknown): value is OcrZoneRole | undefined {
  return value === undefined || isOcrZoneRole(value);
}

function isOcrRegion(value: unknown): value is OcrRegion {
  return isRecord(value)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.width)
    && isFiniteNumber(value.height);
}

function isOptionalOcrRegion(value: unknown): value is OcrRegion | undefined {
  return value === undefined || isValidOcrResultRegion(value);
}

function isValidOcrResultRegion(value: unknown): value is OcrRegion {
  return isOcrRegion(value)
    && value.x >= 0
    && value.y >= 0
    && value.width > 0
    && value.height > 0
    && value.x + value.width <= 1
    && value.y + value.height <= 1;
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

function isValidOcrSelectionValue(value: unknown): value is VideoOcrSelection {
  if (!isRecord(value) || !Array.isArray(value.segments) || !value.segments.every(isOcrSegment)) {
    return false;
  }

  return isSemanticallyValidOcrSelection({ segments: value.segments });
}

function isOcrPreviewSourceIdentity(value: unknown): value is OcrPreviewSourceIdentity {
  return isRecord(value)
    && typeof value.path === 'string'
    && isFiniteNonNegativeNumber(value.size)
    && isFiniteNonNegativeNumber(value.modifiedMs);
}

function isOcrDraft(value: unknown): value is OcrDraft {
  return isRecord(value)
    && (value.baseVersionId === null || typeof value.baseVersionId === 'string')
    && isValidOcrSelectionValue(value.selection)
    && typeof value.dirty === 'boolean'
    && typeof value.updatedAt === 'string';
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
  if (!isValidOcrSelectionValue(selection)) {
    return false;
  }

  const ocrSelection: VideoOcrSelection = { segments: selection.segments };
  return typeof value.videoPath === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && (value.previewPath === undefined || typeof value.previewPath === 'string')
    && (value.previewVersion === undefined || typeof value.previewVersion === 'string')
    && (
      value.previewSourceIdentity === undefined
      || isOcrPreviewSourceIdentity(value.previewSourceIdentity)
    )
    && (
      value.activeOcrVersionId === undefined
      || value.activeOcrVersionId === null
      || typeof value.activeOcrVersionId === 'string'
    )
    && (value.draft === undefined || isOcrDraft(value.draft))
    && isSemanticallyValidOcrSelection(ocrSelection)
    && Array.isArray(value.ocrVersions)
    && value.ocrVersions.every(isOcrVersion);
}

function sanitizeOcrSelection(selection: VideoOcrSelection): VideoOcrSelection {
  return {
    segments: selection.segments.map((segment) => ({
      id: segment.id,
      startTimeMs: segment.startTimeMs,
      endTimeMs: segment.endTimeMs,
      zones: segment.zones.map((zone) => ({
        id: zone.id,
        role: zone.role,
        ...(zone.label !== undefined ? { label: zone.label } : {}),
        region: {
          x: zone.region.x,
          y: zone.region.y,
          width: zone.region.width,
          height: zone.region.height,
        },
      })),
    })),
  };
}

function sanitizePreviewSourceIdentity(
  previewSourceIdentity: OcrPreviewSourceIdentity | undefined,
): OcrPreviewSourceIdentity | undefined {
  return previewSourceIdentity
    ? {
        path: previewSourceIdentity.path,
        size: previewSourceIdentity.size,
        modifiedMs: previewSourceIdentity.modifiedMs,
      }
    : undefined;
}

function sanitizeOcrDraft(draft: OcrDraft | undefined): OcrDraft | undefined {
  return draft
    ? {
        baseVersionId: draft.baseVersionId,
        selection: sanitizeOcrSelection(draft.selection),
        dirty: draft.dirty,
        updatedAt: draft.updatedAt,
      }
    : undefined;
}

function sanitizeOcrConfig(config: OcrConfig): OcrConfig {
  return {
    frameRate: config.frameRate,
    language: OCR_LANGUAGES.some((language) => language.value === config.language)
      ? config.language
      : DEFAULT_OCR_CONFIG.language,
    useGpu: config.useGpu,
    confidenceThreshold: config.confidenceThreshold,
    threadCount: config.threadCount,
    mergeSimilar: config.mergeSimilar,
    similarityThreshold: config.similarityThreshold,
    maxGapMs: config.maxGapMs,
    minCueDurationMs: config.minCueDurationMs,
    filterUrlLike: config.filterUrlLike,
    aiCleanupEnabled: config.aiCleanupEnabled,
    aiCleanupProvider: config.aiCleanupProvider,
    aiCleanupModel: config.aiCleanupModel,
  };
}

function sanitizeOcrRawFrame(frame: OcrRawFrame): OcrRawFrame {
  return {
    frameIndex: frame.frameIndex,
    timeMs: frame.timeMs,
    text: frame.text,
    confidence: frame.confidence,
    ...sanitizeOcrResultMetadata(frame),
  };
}

function sanitizeOcrSubtitle(subtitle: OcrSubtitle): OcrSubtitle {
  return {
    id: subtitle.id,
    text: subtitle.text,
    startTime: subtitle.startTime,
    endTime: subtitle.endTime,
    confidence: subtitle.confidence,
    ...sanitizeOcrResultMetadata(subtitle),
  };
}

function sanitizeOcrResultMetadata(
  result: Pick<OcrRawFrame, 'segmentId' | 'zoneId' | 'role' | 'region'>,
): Pick<OcrRawFrame, 'segmentId' | 'zoneId' | 'role' | 'region'> {
  return {
    ...(typeof result.segmentId === 'string' ? { segmentId: result.segmentId } : {}),
    ...(typeof result.zoneId === 'string' ? { zoneId: result.zoneId } : {}),
    ...(isOcrZoneRole(result.role) ? { role: result.role } : {}),
    ...(isValidOcrResultRegion(result.region)
      ? {
          region: {
            x: result.region.x,
            y: result.region.y,
            width: result.region.width,
            height: result.region.height,
          },
        }
      : {}),
  };
}

function normalizeAndSanitizeOcrVersion(version: OcrVersion): OcrVersion {
  const normalized = normalizeOcrVersion(version);
  if (!normalized.selectionSnapshot) {
    throw new UnsupportedOcrPersistenceError();
  }

  return {
    id: normalized.id,
    name: normalized.name,
    createdAt: normalized.createdAt,
    mode: normalized.mode,
    configSnapshot: sanitizeOcrConfig(normalized.configSnapshot),
    selectionSnapshot: sanitizeOcrSelection(normalized.selectionSnapshot),
    rawFrameRate: normalized.rawFrameRate,
    rawOcr: normalized.rawOcr.map(sanitizeOcrRawFrame),
    finalSubtitles: normalized.finalSubtitles.map(sanitizeOcrSubtitle),
  };
}

function sanitizeActiveOcrVersionId(
  activeOcrVersionId: string | null | undefined,
  versions: readonly OcrVersion[],
  draft?: OcrDraft,
): string | null | undefined {
  if (activeOcrVersionId === null) {
    if (draft) {
      return null;
    }

    throw new UnsupportedOcrPersistenceError();
  }

  if (
    typeof activeOcrVersionId === 'string'
    && versions.some((version) => version.id === activeOcrVersionId)
  ) {
    return activeOcrVersionId;
  }

  if (activeOcrVersionId === undefined) {
    return versions.at(-1)?.id;
  }

  throw new UnsupportedOcrPersistenceError();
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
  selectionSnapshot?: VideoOcrSelection,
): OcrVersion {
  return {
    id: generateVersionId(),
    name,
    createdAt: new Date().toISOString(),
    mode,
    configSnapshot: { ...configSnapshot },
    ...(selectionSnapshot ? { selectionSnapshot: sanitizeOcrSelection(selectionSnapshot) } : {}),
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

function parseVideoOcrPersistenceData(value: unknown): VideoOcrPersistenceData {
  if (!isVideoOcrPersistenceData(value)) {
    throw new UnsupportedOcrPersistenceError();
  }

  const ocrSelection = sanitizeOcrSelection(value.ocrSelection);
  const draft = sanitizeOcrDraft(value.draft);
  const ocrVersions = value.ocrVersions.map(normalizeAndSanitizeOcrVersion);

  return {
    version: 2,
    videoPath: value.videoPath,
    previewPath: value.previewPath,
    previewSourceIdentity: sanitizePreviewSourceIdentity(value.previewSourceIdentity),
    previewVersion: value.previewVersion,
    ocrSelection,
    activeOcrVersionId: sanitizeActiveOcrVersionId(value.activeOcrVersionId, ocrVersions, draft),
    draft,
    ocrVersions,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function loadOcrData(videoPath: string): Promise<VideoOcrPersistenceData | null> {
  const mediaflowData = await loadMediaflowData(videoPath);
  if (!mediaflowData?.videoOcr) {
    return null;
  }

  return parseVideoOcrPersistenceData(mediaflowData.videoOcr);
}

export async function saveOcrData(
  videoPath: string,
  data: VideoOcrPersistenceData,
): Promise<boolean> {
  const existing = await loadMediaflowData(videoPath);
  if (existing?.videoOcr) {
    parseVideoOcrPersistenceData(existing.videoOcr);
  }

  const now = new Date().toISOString();

  return saveMediaflowData(videoPath, {
    version: 1,
    audioToSubs: existing?.audioToSubs,
    translation: existing?.translation,
    videoOcr: {
      version: 2,
      videoPath,
      previewPath: data.previewPath,
      previewSourceIdentity: sanitizePreviewSourceIdentity(data.previewSourceIdentity),
      previewVersion: data.previewVersion,
      ocrSelection: sanitizeOcrSelection(data.ocrSelection),
      activeOcrVersionId: sanitizeActiveOcrVersionId(data.activeOcrVersionId, data.ocrVersions, data.draft),
      draft: sanitizeOcrDraft(data.draft),
      ocrVersions: data.ocrVersions.map(normalizeAndSanitizeOcrVersion),
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

  data.ocrVersions = [
    ...data.ocrVersions,
    {
      ...version,
      selectionSnapshot: sanitizeOcrSelection(version.selectionSnapshot ?? options.ocrSelection),
    },
  ];
  data.ocrSelection = options.ocrSelection;
  data.activeOcrVersionId = version.id;
  data.draft = undefined;

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
