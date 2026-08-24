import type {
  SubtitleOcrProcessingDraft,
  SubtitleOcrProgress,
  SubtitleOcrSourceItem,
  SubtitleOcrSourceSnapshot,
  SubtitleOcrStatus,
  SubtitleOcrVersion,
} from '$lib/types';
import { cloneSubtitleOcrSourceSnapshot } from '$lib/types';

export type SubtitleOcrItemSummary = SubtitleOcrSourceSnapshot & {
  id: string;
  displayName: string;
  status: SubtitleOcrStatus;
  size?: number;
  duration?: number;
  error?: string;
  progress?: SubtitleOcrProgress;
  versionCount: number;
  hasActiveVersion: boolean;
  activeVersionId: string | null;
  reviewTargetId: string | null;
};

export interface SubtitleOcrVersionSummary {
  id: string;
  name: string;
  createdAt: string;
  mode: SubtitleOcrVersion['mode'];
}

export type SubtitleOcrProcessingDraftSummary = Pick<
  SubtitleOcrProcessingDraft,
  'runId' | 'name' | 'startedAt'
>;

export type SubtitleOcrWorkspaceItemSummary = SubtitleOcrItemSummary & {
  versions: SubtitleOcrVersionSummary[];
};

export interface SubtitleOcrExportItemSummary {
  id: string;
  displayName: string;
  versions: SubtitleOcrVersionSummary[];
}

export function buildSubtitleOcrItemSummary(
  item: SubtitleOcrSourceItem,
): SubtitleOcrItemSummary {
  return {
    ...cloneSubtitleOcrSourceSnapshot(item),
    id: item.id,
    displayName: item.displayName,
    status: item.status,
    size: item.size,
    duration: item.duration,
    error: item.error,
    progress: item.progress ? { ...item.progress } : undefined,
    versionCount: item.versions.length,
    hasActiveVersion: item.activeVersionId !== null
      && item.versions.some((version) => version.id === item.activeVersionId),
    activeVersionId: item.activeVersionId,
    reviewTargetId: item.reviewTargetId ?? item.activeVersionId,
  };
}

export function buildSubtitleOcrVersionSummary(
  version: SubtitleOcrVersion,
): SubtitleOcrVersionSummary {
  return {
    id: version.id,
    name: version.name,
    createdAt: version.createdAt,
    mode: version.mode,
  };
}

export function buildSubtitleOcrProcessingDraftSummary(
  draft: SubtitleOcrProcessingDraft,
): SubtitleOcrProcessingDraftSummary {
  return {
    runId: draft.runId,
    name: draft.name,
    startedAt: draft.startedAt,
  };
}
