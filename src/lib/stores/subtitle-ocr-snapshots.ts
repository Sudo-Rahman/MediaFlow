import type {
  SubtitleOcrConfig,
  SubtitleOcrCue,
  SubtitleOcrProgress,
  SubtitleOcrProcessingDraft,
  SubtitleOcrSourceItem,
  SubtitleOcrStatus,
  SubtitleOcrTrackMetadata,
  SubtitleOcrVersion,
  SubtitleOcrVobSubPair,
} from '$lib/types';
import { cloneSubtitleOcrSourceSnapshot } from '$lib/types';
import {
  buildSubtitleOcrProcessingDraftId,
  isSubtitleOcrProcessingDraftId,
} from '$lib/utils/subtitle-ocr-review-target';
import {
  cloneBitmap,
  cloneCue,
  cloneRawCue,
} from './subtitle-ocr-cow';

export interface SubtitleOcrItemFields {
  id: string;
  displayName: string;
  status: SubtitleOcrStatus;
  size?: number;
  duration?: number;
  error?: string;
  progress?: SubtitleOcrProgress;
  versions: SubtitleOcrVersion[];
  activeVersionId: string | null;
  reviewTargetId?: string | null;
  processingDraft?: SubtitleOcrProcessingDraft;
}

export function cloneConfig(value: SubtitleOcrConfig): SubtitleOcrConfig {
  return { ...value };
}

export function cloneTrack(track: SubtitleOcrTrackMetadata): SubtitleOcrTrackMetadata {
  return { ...track };
}

export function clonePair(pair: SubtitleOcrVobSubPair): SubtitleOcrVobSubPair {
  return { ...pair };
}

export function cloneProgress(progress: SubtitleOcrProgress): SubtitleOcrProgress {
  return { ...progress };
}

export function cloneVersion(version: SubtitleOcrVersion): SubtitleOcrVersion {
  return {
    ...version,
    configSnapshot: cloneConfig(version.configSnapshot),
    sourceSnapshot: cloneSubtitleOcrSourceSnapshot(version.sourceSnapshot),
    bitmaps: version.bitmaps.map(cloneBitmap),
    rawOcr: version.rawOcr.map(cloneRawCue),
    stabilizedCues: version.stabilizedCues.map(cloneCue),
    finalCues: version.finalCues.map(cloneCue),
  };
}

export function cloneProcessingDraft(draft: SubtitleOcrProcessingDraft): SubtitleOcrProcessingDraft {
  return {
    runId: draft.runId,
    name: draft.name,
    startedAt: draft.startedAt,
    bitmaps: draft.bitmaps.map(cloneBitmap),
    rawOcr: draft.rawOcr.map(cloneRawCue),
    finalCues: draft.finalCues.map(cloneCue),
  };
}

export function normalizeReviewTargetId(
  versions: SubtitleOcrVersion[],
  activeVersionId: string | null,
  reviewTargetId: string | null | undefined,
  processingDraft?: SubtitleOcrProcessingDraft,
): string | null {
  if (
    processingDraft
    && reviewTargetId === buildSubtitleOcrProcessingDraftId(processingDraft.runId)
  ) {
    return reviewTargetId;
  }

  if (reviewTargetId && versions.some((version) => version.id === reviewTargetId)) {
    return reviewTargetId;
  }

  return normalizeActiveVersionId(versions, activeVersionId);
}

export function normalizeActiveVersionId(
  versions: SubtitleOcrVersion[],
  activeVersionId: string | null,
): string | null {
  if (activeVersionId === null) {
    return null;
  }

  return versions.some((version) => version.id === activeVersionId)
    ? activeVersionId
    : versions[0]?.id ?? null;
}

export function findVersionByReviewTarget(item: SubtitleOcrSourceItem): SubtitleOcrVersion | undefined {
  const targetId = item.reviewTargetId ?? item.activeVersionId;
  if (isSubtitleOcrProcessingDraftId(targetId)) {
    return undefined;
  }

  return item.versions.find((version) => version.id === targetId)
    ?? item.versions.find((version) => version.id === item.activeVersionId)
    ?? item.versions[0];
}

export function isProcessingDraftSelected(item: SubtitleOcrSourceItem): boolean {
  return Boolean(
    item.processingDraft
    && item.reviewTargetId === buildSubtitleOcrProcessingDraftId(item.processingDraft.runId),
  );
}

export function resolveSelectedVersionId(
  item: SubtitleOcrSourceItem,
  versionId: string | null,
): string | null {
  if (versionId === null) {
    return null;
  }

  if (item.versions.some((version) => version.id === versionId)) {
    return versionId;
  }

  return normalizeActiveVersionId(item.versions, item.activeVersionId);
}
