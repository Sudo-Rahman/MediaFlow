import type {
  OcrLanguage,
  SubtitleOcrConfig,
  SubtitleOcrCue,
  SubtitleOcrCueBitmap,
  SubtitleOcrModelOverride,
  SubtitleOcrPersistenceData,
  SubtitleOcrRawBox,
  SubtitleOcrRawCue,
  SubtitleOcrRetryMode,
  SubtitleOcrSourceSnapshot,
  SubtitleOcrTrackMetadata,
  SubtitleOcrVersion,
  SubtitleOcrVobSubPair,
} from '$lib/types';
import { DEFAULT_SUBTITLE_OCR_CONFIG, LLM_PROVIDERS, OCR_LANGUAGES } from '$lib/types';
import { loadMediaflowData, saveMediaflowData } from './mediaflow-storage';

export interface CreateSubtitleOcrVersionInput {
  name: string;
  mode: SubtitleOcrRetryMode;
  configSnapshot: SubtitleOcrConfig;
  effectiveOcrModel: OcrLanguage;
  sourceSnapshot: SubtitleOcrSourceSnapshot;
  bitmaps: SubtitleOcrCueBitmap[];
  rawOcr: SubtitleOcrRawCue[];
  stabilizedCues: SubtitleOcrCue[];
  finalCues: SubtitleOcrCue[];
  aiCleanupApplied: boolean;
}

function generateVersionId(): string {
  return `subtitle-ocr-v-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isUnitInterval(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOcrLanguage(value: unknown): value is OcrLanguage {
  return typeof value === 'string' && OCR_LANGUAGES.some((language) => language.value === value);
}

function isLLMProvider(value: unknown): value is SubtitleOcrConfig['aiCleanupProvider'] {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LLM_PROVIDERS, value);
}

function isSubtitleOcrModelOverride(value: unknown): value is SubtitleOcrModelOverride {
  return value === 'default' || isOcrLanguage(value);
}

function isSubtitleOcrRetryMode(value: unknown): value is SubtitleOcrRetryMode {
  return value === 'full_ocr' || value === 'ai_cleanup_only';
}

function isSubtitleOcrConfig(value: unknown): value is SubtitleOcrConfig {
  return isRecord(value)
    && isOcrLanguage(value.ocrModel)
    && typeof value.useGpu === 'boolean'
    && typeof value.aiCleanupEnabled === 'boolean'
    && isLLMProvider(value.aiCleanupProvider)
    && typeof value.aiCleanupModel === 'string';
}

function isSubtitleOcrTrackMetadata(value: unknown): value is SubtitleOcrTrackMetadata {
  return isRecord(value)
    && Number.isInteger(value.streamIndex)
    && typeof value.codec === 'string'
    && (value.codecLabel === 'PGS' || value.codecLabel === 'VobSub')
    && isOptionalString(value.language)
    && isOptionalString(value.title)
    && (value.forced === undefined || typeof value.forced === 'boolean')
    && (value.default === undefined || typeof value.default === 'boolean');
}

function isSubtitleOcrVobSubPair(value: unknown): value is SubtitleOcrVobSubPair {
  return isRecord(value)
    && typeof value.idxPath === 'string'
    && typeof value.subPath === 'string';
}

function isSubtitleOcrSourceSnapshot(value: unknown): value is SubtitleOcrSourceSnapshot {
  if (
    !isRecord(value)
    || typeof value.sourcePath !== 'string'
    || !isSubtitleOcrModelOverride(value.ocrModelOverride)
  ) {
    return false;
  }

  switch (value.sourceKind) {
    case 'container_track':
      return isSubtitleOcrTrackMetadata(value.track);
    case 'standalone_sup':
      return true;
    case 'standalone_vobsub':
      return isSubtitleOcrVobSubPair(value.pair);
    default:
      return false;
  }
}

function isSubtitleOcrCueBitmap(value: unknown): value is SubtitleOcrCueBitmap {
  return isRecord(value)
    && typeof value.cueId === 'string'
    && isFiniteNonNegativeNumber(value.startTimeMs)
    && isFiniteNonNegativeNumber(value.endTimeMs)
    && value.endTimeMs > value.startTimeMs
    && isPositiveNumber(value.width)
    && isPositiveNumber(value.height)
    && isOptionalString(value.cacheKey)
    && isOptionalString(value.thumbnailPath);
}

function isSubtitleOcrRawBox(value: unknown): value is SubtitleOcrRawBox {
  return isRecord(value)
    && typeof value.text === 'string'
    && isUnitInterval(value.confidence)
    && isFiniteNonNegativeNumber(value.x)
    && isFiniteNonNegativeNumber(value.y)
    && isPositiveNumber(value.width)
    && isPositiveNumber(value.height);
}

function isSubtitleOcrRawCue(value: unknown): value is SubtitleOcrRawCue {
  return isRecord(value)
    && typeof value.cueId === 'string'
    && isFiniteNonNegativeNumber(value.startTimeMs)
    && isFiniteNonNegativeNumber(value.endTimeMs)
    && value.endTimeMs > value.startTimeMs
    && Array.isArray(value.boxes)
    && value.boxes.every(isSubtitleOcrRawBox)
    && typeof value.text === 'string'
    && isUnitInterval(value.confidence);
}

function isSubtitleOcrCue(value: unknown): value is SubtitleOcrCue {
  return isRecord(value)
    && typeof value.id === 'string'
    && Array.isArray(value.sourceCueIds)
    && value.sourceCueIds.every((id) => typeof id === 'string')
    && isFiniteNonNegativeNumber(value.startTimeMs)
    && isFiniteNonNegativeNumber(value.endTimeMs)
    && value.endTimeMs > value.startTimeMs
    && typeof value.text === 'string'
    && isUnitInterval(value.confidence);
}

function isSubtitleOcrVersion(value: unknown): value is SubtitleOcrVersion {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.createdAt === 'string'
    && isSubtitleOcrRetryMode(value.mode)
    && isSubtitleOcrConfig(value.configSnapshot)
    && isOcrLanguage(value.effectiveOcrModel)
    && isSubtitleOcrSourceSnapshot(value.sourceSnapshot)
    && Array.isArray(value.bitmaps)
    && value.bitmaps.every(isSubtitleOcrCueBitmap)
    && Array.isArray(value.rawOcr)
    && value.rawOcr.every(isSubtitleOcrRawCue)
    && Array.isArray(value.stabilizedCues)
    && value.stabilizedCues.every(isSubtitleOcrCue)
    && Array.isArray(value.finalCues)
    && value.finalCues.every(isSubtitleOcrCue)
    && typeof value.aiCleanupApplied === 'boolean';
}

function cloneConfig(config: SubtitleOcrConfig): SubtitleOcrConfig {
  return {
    ocrModel: isOcrLanguage(config.ocrModel) ? config.ocrModel : DEFAULT_SUBTITLE_OCR_CONFIG.ocrModel,
    useGpu: config.useGpu,
    aiCleanupEnabled: config.aiCleanupEnabled,
    aiCleanupProvider: config.aiCleanupProvider,
    aiCleanupModel: config.aiCleanupModel,
  };
}

function cloneTrack(track: SubtitleOcrTrackMetadata): SubtitleOcrTrackMetadata {
  return {
    streamIndex: track.streamIndex,
    codec: track.codec,
    codecLabel: track.codecLabel,
    ...(track.language !== undefined ? { language: track.language } : {}),
    ...(track.title !== undefined ? { title: track.title } : {}),
    ...(track.forced !== undefined ? { forced: track.forced } : {}),
    ...(track.default !== undefined ? { default: track.default } : {}),
  };
}

function clonePair(pair: SubtitleOcrVobSubPair): SubtitleOcrVobSubPair {
  return {
    idxPath: pair.idxPath,
    subPath: pair.subPath,
  };
}

function cloneSourceSnapshot(snapshot: SubtitleOcrSourceSnapshot): SubtitleOcrSourceSnapshot {
  switch (snapshot.sourceKind) {
    case 'container_track':
      return {
        sourceKind: 'container_track',
        sourcePath: snapshot.sourcePath,
        ocrModelOverride: snapshot.ocrModelOverride,
        track: cloneTrack(snapshot.track),
      };
    case 'standalone_sup':
      return {
        sourceKind: 'standalone_sup',
        sourcePath: snapshot.sourcePath,
        ocrModelOverride: snapshot.ocrModelOverride,
      };
    case 'standalone_vobsub':
      return {
        sourceKind: 'standalone_vobsub',
        sourcePath: snapshot.sourcePath,
        ocrModelOverride: snapshot.ocrModelOverride,
        pair: clonePair(snapshot.pair),
      };
  }
}

function cloneBitmap(bitmap: SubtitleOcrCueBitmap): SubtitleOcrCueBitmap {
  return {
    cueId: bitmap.cueId,
    startTimeMs: bitmap.startTimeMs,
    endTimeMs: bitmap.endTimeMs,
    width: bitmap.width,
    height: bitmap.height,
    ...(bitmap.cacheKey !== undefined ? { cacheKey: bitmap.cacheKey } : {}),
    ...(bitmap.thumbnailPath !== undefined ? { thumbnailPath: bitmap.thumbnailPath } : {}),
  };
}

function cloneRawBox(box: SubtitleOcrRawBox): SubtitleOcrRawBox {
  return {
    text: box.text,
    confidence: box.confidence,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

function cloneRawCue(rawCue: SubtitleOcrRawCue): SubtitleOcrRawCue {
  return {
    cueId: rawCue.cueId,
    startTimeMs: rawCue.startTimeMs,
    endTimeMs: rawCue.endTimeMs,
    boxes: rawCue.boxes.map(cloneRawBox),
    text: rawCue.text,
    confidence: rawCue.confidence,
  };
}

function cloneCue(cue: SubtitleOcrCue): SubtitleOcrCue {
  return {
    id: cue.id,
    sourceCueIds: [...cue.sourceCueIds],
    startTimeMs: cue.startTimeMs,
    endTimeMs: cue.endTimeMs,
    text: cue.text,
    confidence: cue.confidence,
  };
}

function cloneVersion(version: SubtitleOcrVersion): SubtitleOcrVersion {
  return {
    id: version.id,
    name: version.name,
    createdAt: version.createdAt,
    mode: version.mode,
    configSnapshot: cloneConfig(version.configSnapshot),
    effectiveOcrModel: version.effectiveOcrModel,
    sourceSnapshot: cloneSourceSnapshot(version.sourceSnapshot),
    bitmaps: version.bitmaps.map(cloneBitmap),
    rawOcr: version.rawOcr.map(cloneRawCue),
    stabilizedCues: version.stabilizedCues.map(cloneCue),
    finalCues: version.finalCues.map(cloneCue),
    aiCleanupApplied: version.aiCleanupApplied,
  };
}

function hasValidActiveVersionId(
  activeVersionId: string | null,
  versions: readonly SubtitleOcrVersion[],
): boolean {
  return activeVersionId === null || versions.some((version) => version.id === activeVersionId);
}

export function createSubtitleOcrVersion(input: CreateSubtitleOcrVersionInput): SubtitleOcrVersion {
  return {
    id: generateVersionId(),
    name: input.name,
    createdAt: new Date().toISOString(),
    mode: input.mode,
    configSnapshot: cloneConfig(input.configSnapshot),
    effectiveOcrModel: input.effectiveOcrModel,
    sourceSnapshot: cloneSourceSnapshot(input.sourceSnapshot),
    bitmaps: input.bitmaps.map(cloneBitmap),
    rawOcr: input.rawOcr.map(cloneRawCue),
    stabilizedCues: input.stabilizedCues.map(cloneCue),
    finalCues: input.finalCues.map(cloneCue),
    aiCleanupApplied: input.aiCleanupApplied,
  };
}

export function sanitizeSubtitleOcrPersistenceData(value: unknown): SubtitleOcrPersistenceData | null {
  if (
    !isRecord(value)
    || value.version !== 1
    || typeof value.sourcePath !== 'string'
    || !Array.isArray(value.versions)
    || !value.versions.every(isSubtitleOcrVersion)
    || !(value.activeVersionId === null || typeof value.activeVersionId === 'string')
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  const versions = value.versions.map(cloneVersion);
  if (!hasValidActiveVersionId(value.activeVersionId, versions)) {
    return null;
  }

  return {
    version: 1,
    sourcePath: value.sourcePath,
    versions,
    activeVersionId: value.activeVersionId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function loadSubtitleOcrData(path: string): Promise<SubtitleOcrPersistenceData | null> {
  const mediaflowData = await loadMediaflowData(path);
  return sanitizeSubtitleOcrPersistenceData(mediaflowData?.subtitleOcr);
}

export async function saveSubtitleOcrData(
  path: string,
  data: SubtitleOcrPersistenceData,
): Promise<boolean> {
  const sanitized = sanitizeSubtitleOcrPersistenceData({
    ...data,
    sourcePath: path,
  });

  if (!sanitized) {
    return false;
  }

  const existing = await loadMediaflowData(path);
  const now = new Date().toISOString();

  return saveMediaflowData(path, {
    version: 1,
    audioToSubs: existing?.audioToSubs,
    videoOcr: existing?.videoOcr,
    translation: existing?.translation,
    subtitleOcr: {
      ...sanitized,
      sourcePath: path,
      createdAt: sanitized.createdAt || now,
      updatedAt: now,
    },
  });
}
