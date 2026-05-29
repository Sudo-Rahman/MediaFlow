import type {
  OcrLanguage,
  SubtitleOcrConfig,
  SubtitleOcrPersistenceData,
  SubtitleOcrSourceItem,
  SubtitleOcrSourceSnapshot,
  SubtitleOcrStatus,
  SubtitleOcrVersion,
} from '$lib/types';
import { getSubtitleOcrEffectiveModel } from '$lib/types';
import type { CreateSubtitleOcrVersionInput } from '$lib/services/subtitle-ocr-storage';

interface SubtitleOcrSummaryItem {
  status: SubtitleOcrStatus;
  versions: readonly unknown[];
}

export interface SubtitleOcrItemsSummary {
  readyCount: number;
  retryableCount: number;
  scanningCount: number;
}

export interface SubtitleOcrBackendCancelTarget {
  itemId: string;
  runId: string;
}

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

      if (item.status === 'error' || (item.status === 'completed' && item.versions.length > 0)) {
        summary.retryableCount += 1;
      }

      return summary;
    },
    { readyCount: 0, retryableCount: 0, scanningCount: 0 },
  );
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

export function resolveSubtitleOcrFullRetryConfig(
  activeVersion: Pick<SubtitleOcrVersion, 'configSnapshot'> | null | undefined,
  globalConfig: SubtitleOcrConfig,
): SubtitleOcrConfig {
  return { ...(activeVersion?.configSnapshot ?? globalConfig) };
}

export function resolveSubtitleOcrEffectiveModelForConfig(
  item: Pick<SubtitleOcrSourceItem, 'ocrModelOverride'>,
  config: Pick<SubtitleOcrConfig, 'ocrModel'>,
): OcrLanguage {
  return getSubtitleOcrEffectiveModel(item, config.ocrModel);
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
