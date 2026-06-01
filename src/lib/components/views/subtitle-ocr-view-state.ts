import type {
  OcrLanguage,
  SubtitleOcrConfig,
  SubtitleOcrCueBitmap,
  SubtitleOcrPersistenceData,
  SubtitleOcrProgress,
  SubtitleOcrSourceItem,
  SubtitleOcrSourceSnapshot,
  SubtitleOcrStatus,
  SubtitleOcrVersion,
} from '$lib/types';
import {
  getSubtitleOcrEffectiveModel,
  hasActiveSubtitleOcrVersion,
  hasSubtitleOcrVersions,
} from '$lib/types';
import type { CreateSubtitleOcrVersionInput } from '$lib/services/subtitle-ocr-storage';

interface SubtitleOcrSummaryItem {
  status: SubtitleOcrStatus;
}

interface SubtitleOcrRetryTargetItem {
  id: string;
  versions: readonly { id: string }[];
  activeVersionId: string | null;
}

export interface SubtitleOcrItemsSummary {
  readyCount: number;
  scanningCount: number;
}

export interface SubtitleOcrBackendCancelTarget {
  itemId: string;
  runId: string;
}

export type SubtitleOcrProgressEventInput = Pick<
  SubtitleOcrProgress,
  'phase' | 'current' | 'total' | 'totalKnown' | 'percentage'
>;

export type SubtitleOcrMissingBitmapCollector = (
  bitmaps: SubtitleOcrCueBitmap[],
) => Promise<SubtitleOcrCueBitmap[]>;

export function summarizeSubtitleOcrItems(
  items: readonly SubtitleOcrSummaryItem[],
): SubtitleOcrItemsSummary {
  return items.reduce<SubtitleOcrItemsSummary>(
    (summary, item) => {
      if (item.status === 'ready') {
        summary.readyCount += 1;
      }

      if (item.status === 'scanning') {
        summary.scanningCount += 1;
      }

      return summary;
    },
    { readyCount: 0, scanningCount: 0 },
  );
}

export function getSubtitleOcrVersionedItemIds(
  items: readonly SubtitleOcrRetryTargetItem[],
): string[] {
  return items
    .filter(hasSubtitleOcrVersions)
    .map((item) => item.id);
}

export function getSubtitleOcrActiveVersionItemIds(
  items: readonly SubtitleOcrRetryTargetItem[],
): string[] {
  return items
    .filter(hasActiveSubtitleOcrVersion)
    .map((item) => item.id);
}

export function shouldApplySubtitleOcrProgressEvent(
  itemId: string,
  runId: string | undefined,
  activeRunIdsByItemId: ReadonlyMap<string, string>,
  cancelRequested: boolean,
): boolean {
  if (cancelRequested) {
    return false;
  }

  const activeRunId = activeRunIdsByItemId.get(itemId);
  return activeRunId !== undefined && runId === activeRunId;
}

export function buildSubtitleOcrProgressFromEvent(
  payload: SubtitleOcrProgressEventInput,
  useDirectOverallPercentage = false,
): SubtitleOcrProgress {
  const progress: SubtitleOcrProgress = {
    phase: payload.phase,
    current: payload.current,
    total: payload.total,
    totalKnown: payload.totalKnown,
    percentage: payload.percentage,
  };

  return useDirectOverallPercentage
    ? { ...progress, overallPercentage: payload.percentage }
    : progress;
}

export function getSubtitleOcrBackendCancelTargets(
  processingScopeItemIds: ReadonlySet<string>,
  backendCancelableRunIdsByItemId: ReadonlyMap<string, string>,
): SubtitleOcrBackendCancelTarget[] {
  return [...processingScopeItemIds].flatMap((itemId) => {
    const runId = backendCancelableRunIdsByItemId.get(itemId);
    return runId ? [{ itemId, runId }] : [];
  });
}

export function buildSubtitleOcrSourceSnapshot(
  item: SubtitleOcrSourceItem,
): SubtitleOcrSourceSnapshot {
  switch (item.sourceKind) {
    case 'container_track':
      return {
        sourceKind: 'container_track',
        sourcePath: item.sourcePath,
        ocrModelOverride: item.ocrModelOverride,
        track: { ...item.track },
      };
    case 'standalone_sup':
      return {
        sourceKind: 'standalone_sup',
        sourcePath: item.sourcePath,
        ocrModelOverride: item.ocrModelOverride,
      };
    case 'standalone_vobsub':
      return {
        sourceKind: 'standalone_vobsub',
        sourcePath: item.sourcePath,
        ocrModelOverride: item.ocrModelOverride,
        pair: { ...item.pair },
      };
  }
}

export function resolveSubtitleOcrEffectiveModelForConfig(
  item: Pick<SubtitleOcrSourceItem, 'ocrModelOverride'>,
  config: Pick<SubtitleOcrConfig, 'ocrModel'>,
): OcrLanguage {
  return getSubtitleOcrEffectiveModel(item, config.ocrModel);
}

export function resolveSubtitleOcrExpectedBitmapCount(
  activeVersion: Pick<SubtitleOcrVersion, 'bitmaps'> | null | undefined,
): number | undefined {
  const count = activeVersion?.bitmaps.length ?? 0;
  return count > 0 ? count : undefined;
}

export async function collectMissingSubtitleOcrBitmapAssets(
  versions: readonly Pick<SubtitleOcrVersion, 'bitmaps'>[],
  collectMissingBitmaps: SubtitleOcrMissingBitmapCollector,
): Promise<SubtitleOcrCueBitmap[]> {
  const bitmaps: SubtitleOcrCueBitmap[] = [];

  for (const version of versions) {
    for (const bitmap of version.bitmaps) {
      bitmaps.push({ ...bitmap });
    }
  }

  if (bitmaps.length === 0) {
    return [];
  }

  return collectMissingBitmaps(bitmaps);
}

function restoredBitmapMatchesByCacheKey(
  bitmap: SubtitleOcrCueBitmap,
  restored: SubtitleOcrCueBitmap,
): boolean {
  return Boolean(bitmap.cacheKey && restored.cacheKey && bitmap.cacheKey === restored.cacheKey);
}

function restoredBitmapMatchesByCueId(
  bitmap: SubtitleOcrCueBitmap,
  restored: SubtitleOcrCueBitmap,
): boolean {
  return Boolean(bitmap.cueId && restored.cueId && bitmap.cueId === restored.cueId);
}

function restoredBitmapMatchesByTimingAndDimensions(
  bitmap: SubtitleOcrCueBitmap,
  restored: SubtitleOcrCueBitmap,
): boolean {
  return bitmap.startTimeMs === restored.startTimeMs
    && bitmap.endTimeMs === restored.endTimeMs
    && bitmap.width === restored.width
    && bitmap.height === restored.height;
}

function mergeRestoredBitmapPath(
  bitmap: SubtitleOcrCueBitmap,
  restoredBitmaps: readonly SubtitleOcrCueBitmap[],
): SubtitleOcrCueBitmap {
  const restored = restoredBitmaps.find((candidate) => (
    restoredBitmapMatchesByCacheKey(bitmap, candidate)
  )) ?? restoredBitmaps.find((candidate) => (
    restoredBitmapMatchesByCueId(bitmap, candidate)
  )) ?? restoredBitmaps.find((candidate) => (
    restoredBitmapMatchesByTimingAndDimensions(bitmap, candidate)
  ));
  if (!restored) {
    return { ...bitmap };
  }

  return {
    ...bitmap,
    ...(restored.previewPath !== undefined ? { previewPath: restored.previewPath } : {}),
  };
}

export function mergeRestoredSubtitleOcrBitmapAssets(
  versions: readonly SubtitleOcrVersion[],
  restoredBitmaps: readonly SubtitleOcrCueBitmap[],
): SubtitleOcrVersion[] {
  if (restoredBitmaps.length === 0) {
    return versions.map((version) => ({
      ...version,
      bitmaps: version.bitmaps.map((bitmap) => ({ ...bitmap })),
    }));
  }

  return versions.map((version) => ({
    ...version,
    bitmaps: version.bitmaps.map((bitmap) => (
      mergeRestoredBitmapPath(bitmap, restoredBitmaps)
    )),
  }));
}

export function buildSubtitleOcrDraftVersionInput(
  item: SubtitleOcrSourceItem,
  activeVersion: SubtitleOcrVersion,
): Omit<CreateSubtitleOcrVersionInput, 'name'> | null {
  if (!item.draft?.dirty || item.draft.baseVersionId !== activeVersion.id) {
    return null;
  }

  return {
    mode: activeVersion.mode,
    configSnapshot: activeVersion.configSnapshot,
    effectiveOcrModel: activeVersion.effectiveOcrModel,
    sourceSnapshot: activeVersion.sourceSnapshot,
    bitmaps: activeVersion.bitmaps,
    rawOcr: activeVersion.rawOcr,
    stabilizedCues: activeVersion.stabilizedCues,
    finalCues: item.draft.cues,
    aiCleanupApplied: activeVersion.aiCleanupApplied,
  };
}

function sourceSnapshotMatchesItem(
  item: SubtitleOcrSourceItem,
  snapshot: SubtitleOcrSourceSnapshot,
): boolean {
  if (item.sourceKind !== snapshot.sourceKind) {
    return false;
  }

  switch (item.sourceKind) {
    case 'container_track':
      return snapshot.sourceKind === 'container_track'
        && snapshot.sourcePath === item.sourcePath
        && snapshot.track.streamIndex === item.track.streamIndex;
    case 'standalone_sup':
      return snapshot.sourceKind === 'standalone_sup'
        && snapshot.sourcePath === item.sourcePath;
    case 'standalone_vobsub':
      return snapshot.sourceKind === 'standalone_vobsub'
        && snapshot.pair.idxPath === item.pair.idxPath
        && snapshot.pair.subPath === item.pair.subPath;
  }
}

export function filterSubtitleOcrPersistenceForItem(
  item: SubtitleOcrSourceItem,
  data: SubtitleOcrPersistenceData,
): SubtitleOcrPersistenceData | null {
  const versions = data.versions.filter((version) => (
    sourceSnapshotMatchesItem(item, version.sourceSnapshot)
  ));

  if (versions.length === 0) {
    return null;
  }

  const activeVersionId = versions.some((version) => version.id === data.activeVersionId)
    ? data.activeVersionId
    : versions[0]?.id ?? null;

  return {
    ...data,
    versions,
    activeVersionId,
  };
}

function resolveMergedActiveVersionId(
  item: SubtitleOcrSourceItem,
  existingData: SubtitleOcrPersistenceData | null,
  versions: SubtitleOcrPersistenceData['versions'],
): string | null {
  if (item.activeVersionId && versions.some((version) => version.id === item.activeVersionId)) {
    return item.activeVersionId;
  }

  if (
    existingData?.activeVersionId
    && versions.some((version) => version.id === existingData.activeVersionId)
  ) {
    return existingData.activeVersionId;
  }

  return versions[0]?.id ?? null;
}

export function mergeSubtitleOcrPersistenceForItem(
  item: SubtitleOcrSourceItem,
  existingData: SubtitleOcrPersistenceData | null,
  now: string,
): SubtitleOcrPersistenceData {
  const existingOtherVersions = existingData?.versions.filter((version) => (
    !sourceSnapshotMatchesItem(item, version.sourceSnapshot)
  )) ?? [];
  const versions = [...existingOtherVersions, ...item.versions];

  return {
    version: 1,
    sourcePath: item.sourcePath,
    versions,
    activeVersionId: resolveMergedActiveVersionId(item, existingData, versions),
    createdAt: existingData?.createdAt ?? now,
    updatedAt: now,
  };
}
