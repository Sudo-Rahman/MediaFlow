import { getDefaultLLMModel, getDefaultLLMProvider } from './translation';
import type { LLMProvider } from './translation';
import type { OcrLanguage } from './video-ocr';

export type SubtitleOcrOutputFormat = 'ass' | 'srt' | 'vtt';

export const SUBTITLE_OCR_OUTPUT_FORMATS: { value: SubtitleOcrOutputFormat; label: string }[] = [
  { value: 'ass', label: 'Advanced SubStation Alpha (.ass)' },
  { value: 'srt', label: 'SubRip (.srt)' },
  { value: 'vtt', label: 'WebVTT (.vtt)' },
];

export type SubtitleOcrSourceKind = 'container_track' | 'standalone_sup' | 'standalone_vobsub';

export type SubtitleOcrStatus =
  | 'pending'
  | 'scanning'
  | 'ready'
  | 'extracting'
  | 'decoding'
  | 'ocr_processing'
  | 'ai_cleaning'
  | 'completed'
  | 'error';

export type SubtitleOcrModelOverride = 'default' | OcrLanguage;

export interface SubtitleOcrTrackMetadata {
  streamIndex: number;
  codec: string;
  codecLabel: 'PGS' | 'VobSub';
  language?: string;
  title?: string;
  forced?: boolean;
  default?: boolean;
}

export interface SubtitleOcrVobSubPair {
  idxPath: string;
  subPath: string;
}

export interface SubtitleOcrCueBitmap {
  cueId: string;
  startTimeMs: number;
  endTimeMs: number;
  width: number;
  height: number;
  cacheKey?: string;
  previewPath?: string;
}

export interface SubtitleOcrRawBox {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SubtitleOcrRawCue {
  cueId: string;
  startTimeMs: number;
  endTimeMs: number;
  cacheKey?: string;
  boxes: SubtitleOcrRawBox[];
  text: string;
  confidence: number;
}

export interface SubtitleOcrCue {
  id: string;
  sourceCueIds: string[];
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  confidence: number;
}

export type SubtitleOcrRetryMode = 'full_ocr' | 'ai_cleanup_only';

export interface SubtitleOcrConfig {
  ocrModel: OcrLanguage;
  useGpu: boolean;
  aiCleanupEnabled: boolean;
  aiCleanupProvider: LLMProvider;
  aiCleanupModel: string;
}

export interface SubtitleOcrVersion {
  id: string;
  name: string;
  createdAt: string;
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

export interface SubtitleOcrPipelineResult {
  decodedCues: SubtitleOcrCueBitmap[];
  rawOcrCues: SubtitleOcrRawCue[];
  stabilizedCues: SubtitleOcrCue[];
  finalCues: SubtitleOcrCue[];
}

export interface SubtitleOcrDraft {
  baseVersionId: string;
  cues: SubtitleOcrCue[];
  dirty: boolean;
  updatedAt: string;
}

export interface SubtitleOcrPersistenceData {
  version: 1;
  sourcePath: string;
  versions: SubtitleOcrVersion[];
  activeVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SubtitleOcrSourceSnapshotBase {
  sourcePath: string;
  ocrModelOverride: SubtitleOcrModelOverride;
}

export type SubtitleOcrSourceSnapshot =
  | (SubtitleOcrSourceSnapshotBase & {
      sourceKind: 'container_track';
      track: SubtitleOcrTrackMetadata;
      pair?: never;
    })
  | (SubtitleOcrSourceSnapshotBase & {
      sourceKind: 'standalone_sup';
      track?: never;
      pair?: never;
    })
  | (SubtitleOcrSourceSnapshotBase & {
      sourceKind: 'standalone_vobsub';
      pair: SubtitleOcrVobSubPair;
      track?: never;
    });

interface SubtitleOcrSourceItemFields {
  id: string;
  displayName: string;
  status: SubtitleOcrStatus;
  size?: number;
  duration?: number;
  error?: string;
  progress?: SubtitleOcrProgress;
  versions: SubtitleOcrVersion[];
  activeVersionId: string | null;
  draft?: SubtitleOcrDraft;
}

export type SubtitleOcrSourceItem = SubtitleOcrSourceSnapshot & SubtitleOcrSourceItemFields;

export interface SubtitleOcrProgress {
  phase: 'extracting' | 'decoding' | 'ocr' | 'ai_cleaning';
  current: number;
  total: number;
  totalKnown?: boolean;
  percentage: number;
  overallPercentage?: number;
}

const DEFAULT_AI_CLEANUP_PROVIDER = getDefaultLLMProvider();
const DEFAULT_AI_CLEANUP_MODEL = getDefaultLLMModel(DEFAULT_AI_CLEANUP_PROVIDER);

export const DEFAULT_SUBTITLE_OCR_CONFIG: SubtitleOcrConfig = {
  ocrModel: 'multi',
  useGpu: true,
  aiCleanupEnabled: false,
  aiCleanupProvider: DEFAULT_AI_CLEANUP_PROVIDER,
  aiCleanupModel: DEFAULT_AI_CLEANUP_MODEL,
};

export function getSubtitleOcrEffectiveModel(
  item: Pick<SubtitleOcrSourceItem, 'ocrModelOverride'>,
  globalModel: OcrLanguage,
): OcrLanguage {
  return item.ocrModelOverride === 'default' ? globalModel : item.ocrModelOverride;
}

interface SubtitleOcrVersionList {
  versions: readonly { id: string }[];
}

interface SubtitleOcrActiveVersionList extends SubtitleOcrVersionList {
  activeVersionId: string | null;
}

export function hasActiveSubtitleOcrVersion(item: SubtitleOcrActiveVersionList): boolean {
  return item.activeVersionId !== null
    && item.versions.some((version) => version.id === item.activeVersionId);
}

export function hasSubtitleOcrVersions(item: SubtitleOcrVersionList): boolean {
  return item.versions.length > 0;
}

export function buildSubtitleOcrSourceLabel(item: SubtitleOcrSourceItem): string {
  if (item.sourceKind !== 'container_track' || !item.track) {
    return item.displayName;
  }

  const parts = [`Track ${item.track.streamIndex}`, item.track.codecLabel];
  if (item.track.title?.trim()) {
    parts.push(item.track.title.trim());
  } else if (item.track.language?.trim()) {
    parts.push(item.track.language.trim());
  }
  if (item.track.forced) {
    parts.push('Forced');
  } else if (item.track.default) {
    parts.push('Default');
  }

  return parts.join(' - ');
}
