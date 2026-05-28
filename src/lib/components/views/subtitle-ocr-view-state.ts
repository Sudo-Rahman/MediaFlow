import type {
  SubtitleOcrPersistenceData,
  SubtitleOcrSourceItem,
  SubtitleOcrSourceSnapshot,
  SubtitleOcrStatus,
} from '$lib/types';

interface SubtitleOcrSummaryItem {
  status: SubtitleOcrStatus;
  versions: readonly unknown[];
}

export interface SubtitleOcrItemsSummary {
  readyCount: number;
  retryableCount: number;
  scanningCount: number;
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
  activeBackendItemIds: ReadonlySet<string>,
  cancelRequested: boolean,
): boolean {
  return !cancelRequested && activeBackendItemIds.has(itemId);
}

export function getSubtitleOcrBackendCancelTargets(
  processingScopeItemIds: ReadonlySet<string>,
  activeBackendItemIds: ReadonlySet<string>,
): string[] {
  return [...processingScopeItemIds].filter((itemId) => activeBackendItemIds.has(itemId));
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
