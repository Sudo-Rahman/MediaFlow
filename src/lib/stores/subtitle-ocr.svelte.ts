import type {
  SubtitleOcrConfig,
  SubtitleOcrCue,
  SubtitleOcrCueBitmap,
  SubtitleOcrLiveCueEvent,
  SubtitleOcrLogEntry,
  SubtitleOcrProcessingDraft,
  SubtitleOcrProgress,
  SubtitleOcrRawCue,
  SubtitleOcrSourceItem,
  SubtitleOcrSourceSnapshot,
  SubtitleOcrStatus,
  SubtitleOcrTrackMetadata,
  SubtitleOcrVersion,
  SubtitleOcrVobSubPair,
} from '$lib/types';
import { cloneSubtitleOcrSourceSnapshot, DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';
import {
  buildSubtitleOcrProcessingDraftId,
  isSubtitleOcrProcessingDraftId,
} from '$lib/utils/subtitle-ocr-review-target';
import { logStore } from './logs.svelte';
import { mergeSubtitleOcrProgress } from './subtitle-ocr-progress';
import {
  EMPTY_SUBTITLE_OCR_BITMAPS,
  EMPTY_SUBTITLE_OCR_CUES,
  bitmapMatchesLiveBitmap,
  cloneBitmap,
  cloneCue,
  cloneRawCue,
  cueMatchesLiveCue,
  freezeBitmapProjection,
  freezeCueProjection,
  rawCueMatchesLiveRawCue,
  restoredBitmapMatches,
  upsertBy,
} from './subtitle-ocr-cow';
import {
  cloneConfig,
  clonePair,
  cloneProcessingDraft,
  cloneProgress,
  cloneTrack,
  cloneVersion,
  findVersionByReviewTarget,
  isProcessingDraftSelected,
  normalizeActiveVersionId,
  normalizeReviewTargetId,
  resolveSelectedVersionId,
  type SubtitleOcrItemFields,
} from './subtitle-ocr-snapshots';
import {
  buildSubtitleOcrItemSummary,
  buildSubtitleOcrProcessingDraftSummary,
  buildSubtitleOcrVersionSummary,
  type SubtitleOcrExportItemSummary,
  type SubtitleOcrItemSummary,
  type SubtitleOcrProcessingDraftSummary,
  type SubtitleOcrVersionSummary,
  type SubtitleOcrWorkspaceItemSummary,
} from './subtitle-ocr-summaries';

interface SubtitleOcrItemUpdates {
  displayName?: string;
  status?: SubtitleOcrStatus;
  size?: number;
  duration?: number;
  error?: string;
  progress?: SubtitleOcrProgress;
  ocrModelOverride?: SubtitleOcrSourceItem['ocrModelOverride'];
}

interface ReplaceSubtitleOcrItemVersionsOptions {
  status?: SubtitleOcrStatus;
  preserveProgress?: boolean;
  preserveError?: boolean;
}

type SubtitleOcrProcessingStatus = 'extracting' | 'decoding' | 'ocr_processing' | 'ai_cleaning';

let items = $state.raw<SubtitleOcrSourceItem[]>([]);
let selectedItemId = $state<string | null>(null);
let config = $state<SubtitleOcrConfig>({ ...DEFAULT_SUBTITLE_OCR_CONFIG });
let isProcessing = $state(false);
let isCancelling = $state(false);
let processingScopeItemIds = $state<Set<string>>(new Set());
let processingBatchItemIds = $state<Set<string>>(new Set());
let processingStartedItemIds = $state<Set<string>>(new Set());
let cancelledItemIds = $state<Set<string>>(new Set());
let hydratingItemTokens = $state<Map<string, string>>(new Map());
let completedHydrationTokens = $state<Map<string, string>>(new Map());
let logs = $state<SubtitleOcrLogEntry[]>([]);

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function generateLogId(): string {
  return `subtitle-ocr-log-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function cloneItemFields(item: SubtitleOcrSourceItem): SubtitleOcrItemFields {
  const versions = item.versions.map(cloneVersion);

  return {
    id: item.id,
    displayName: item.displayName,
    status: item.status,
    size: item.size,
    duration: item.duration,
    error: item.error,
    progress: item.progress ? cloneProgress(item.progress) : undefined,
    versions,
    activeVersionId: normalizeActiveVersionId(versions, item.activeVersionId),
    reviewTargetId: normalizeReviewTargetId(
      versions,
      normalizeActiveVersionId(versions, item.activeVersionId),
      item.reviewTargetId,
      item.processingDraft,
    ),
    processingDraft: item.processingDraft ? cloneProcessingDraft(item.processingDraft) : undefined,
  };
}

function referenceItemFields(item: SubtitleOcrSourceItem): SubtitleOcrItemFields {
  return {
    id: item.id,
    displayName: item.displayName,
    status: item.status,
    size: item.size,
    duration: item.duration,
    error: item.error,
    progress: item.progress,
    versions: item.versions,
    activeVersionId: item.activeVersionId,
    reviewTargetId: item.reviewTargetId,
    processingDraft: item.processingDraft,
  };
}

function buildItemFromSnapshot(
  snapshot: SubtitleOcrSourceSnapshot,
  fields: SubtitleOcrItemFields,
): SubtitleOcrSourceItem {
  switch (snapshot.sourceKind) {
    case 'container_track':
      return {
        ...fields,
        sourceKind: 'container_track',
        sourcePath: snapshot.sourcePath,
        ocrModelOverride: snapshot.ocrModelOverride,
        track: cloneTrack(snapshot.track),
      };
    case 'standalone_sup':
      return {
        ...fields,
        sourceKind: 'standalone_sup',
        sourcePath: snapshot.sourcePath,
        ocrModelOverride: snapshot.ocrModelOverride,
      };
    case 'standalone_vobsub':
      return {
        ...fields,
        sourceKind: 'standalone_vobsub',
        sourcePath: snapshot.sourcePath,
        ocrModelOverride: snapshot.ocrModelOverride,
        pair: clonePair(snapshot.pair),
      };
  }
}

function cloneItem(item: SubtitleOcrSourceItem): SubtitleOcrSourceItem {
  return buildItemFromSnapshot(cloneSubtitleOcrSourceSnapshot(item), cloneItemFields(item));
}

function applySourceUpdates(
  item: SubtitleOcrSourceItem,
  updates: Partial<SubtitleOcrSourceItem>,
): SubtitleOcrSourceSnapshot {
  const sourcePath = updates.sourcePath ?? item.sourcePath;
  const ocrModelOverride = updates.ocrModelOverride ?? item.ocrModelOverride;

  switch (item.sourceKind) {
    case 'container_track':
      return {
        sourceKind: 'container_track',
        sourcePath,
        ocrModelOverride,
        track: cloneTrack(updates.track ?? item.track),
      };
    case 'standalone_sup':
      return {
        sourceKind: 'standalone_sup',
        sourcePath,
        ocrModelOverride,
      };
    case 'standalone_vobsub':
      return {
        sourceKind: 'standalone_vobsub',
        sourcePath,
        ocrModelOverride,
        pair: clonePair(updates.pair ?? item.pair),
      };
  }
}

function applyItemUpdates(
  item: SubtitleOcrSourceItem,
  updates: Partial<SubtitleOcrSourceItem>,
): SubtitleOcrSourceItem {
  const fields = referenceItemFields(item);

  if (updates.id !== undefined) fields.id = updates.id;
  if (updates.displayName !== undefined) fields.displayName = updates.displayName;
  if (updates.status !== undefined) fields.status = updates.status;
  if (hasOwn(updates, 'size')) fields.size = updates.size;
  if (hasOwn(updates, 'duration')) fields.duration = updates.duration;
  if (hasOwn(updates, 'error')) fields.error = updates.error;
  if (hasOwn(updates, 'progress')) {
    fields.progress = updates.progress
      ? mergeSubtitleOcrProgress(item.progress, updates.progress)
      : undefined;
  }
  if (updates.versions !== undefined) {
    fields.versions = updates.versions;
  }
  if (updates.activeVersionId !== undefined) fields.activeVersionId = updates.activeVersionId;
  if (hasOwn(updates, 'reviewTargetId')) {
    fields.reviewTargetId = updates.reviewTargetId;
  }
  if (hasOwn(updates, 'processingDraft')) {
    fields.processingDraft = updates.processingDraft;
  }

  fields.activeVersionId = normalizeActiveVersionId(fields.versions, fields.activeVersionId);
  fields.reviewTargetId = normalizeReviewTargetId(
    fields.versions,
    fields.activeVersionId,
    fields.reviewTargetId,
    fields.processingDraft,
  );

  return buildItemFromSnapshot(applySourceUpdates(item, updates), fields);
}

function applySafeItemUpdates(
  item: SubtitleOcrSourceItem,
  updates: SubtitleOcrItemUpdates,
): SubtitleOcrSourceItem {
  const fields = referenceItemFields(item);

  if (updates.displayName !== undefined) fields.displayName = updates.displayName;
  if (updates.status !== undefined) fields.status = updates.status;
  if (hasOwn(updates, 'size')) fields.size = updates.size;
  if (hasOwn(updates, 'duration')) fields.duration = updates.duration;
  if (hasOwn(updates, 'error')) fields.error = updates.error;
  if (hasOwn(updates, 'progress')) {
    fields.progress = updates.progress
      ? mergeSubtitleOcrProgress(item.progress, updates.progress)
      : undefined;
  }

  return buildItemFromSnapshot(
    applySourceUpdates(item, { ocrModelOverride: updates.ocrModelOverride }),
    fields,
  );
}

function findItem(itemId: string): SubtitleOcrSourceItem | undefined {
  return items.find((item) => item.id === itemId);
}

function findActiveVersion(item: SubtitleOcrSourceItem): SubtitleOcrVersion | undefined {
  return item.versions.find((version) => version.id === item.activeVersionId);
}

export const subtitleOcrStore = {
  get items(): SubtitleOcrSourceItem[] {
    return items.map(cloneItem);
  },

  get selectedItemId() {
    return selectedItemId;
  },

  get itemSummaries(): SubtitleOcrItemSummary[] {
    return items.map(buildSubtitleOcrItemSummary);
  },

  get exportItemSummaries(): SubtitleOcrExportItemSummary[] {
    return items.map((item) => ({
      id: item.id,
      displayName: item.displayName,
      versions: item.versions.map(buildSubtitleOcrVersionSummary),
    }));
  },

  get selectedItem(): SubtitleOcrSourceItem | undefined {
    const item = items.find((entry) => entry.id === selectedItemId);
    return item ? cloneItem(item) : undefined;
  },

  get config() {
    return cloneConfig(config);
  },

  get isProcessing() {
    return isProcessing;
  },

  get isCancelling() {
    return isCancelling;
  },

  get processingScopeItemIds() {
    return new Set(processingScopeItemIds);
  },

  get processingBatchItemIds() {
    return new Set(processingBatchItemIds);
  },

  get processingStartedItemIds() {
    return new Set(processingStartedItemIds);
  },

  get cancelledItemIds() {
    return new Set(cancelledItemIds);
  },

  get hydratingItemIds() {
    return new Set(hydratingItemTokens.keys());
  },

  get logs(): SubtitleOcrLogEntry[] {
    return logs.map((entry) => ({ ...entry, timestamp: new Date(entry.timestamp) }));
  },

  reset() {
    items = [];
    selectedItemId = null;
    config = { ...DEFAULT_SUBTITLE_OCR_CONFIG };
    isProcessing = false;
    isCancelling = false;
    processingScopeItemIds = new Set();
    processingBatchItemIds = new Set();
    processingStartedItemIds = new Set();
    cancelledItemIds = new Set();
    hydratingItemTokens = new Map();
    completedHydrationTokens = new Map();
    logs = [];
  },

  addItems(nextItems: SubtitleOcrSourceItem[]): SubtitleOcrSourceItem[] {
    const existingIds = new Set(items.map((item) => item.id));
    const newItems = nextItems
      .filter((item) => {
        if (existingIds.has(item.id)) {
          return false;
        }

        existingIds.add(item.id);
        return true;
      })
      .map(cloneItem);

    items = [...items, ...newItems];

    if (!selectedItemId && newItems.length > 0) {
      selectedItemId = newItems[0].id;
    }

    return newItems.map(cloneItem);
  },

  selectItem(itemId: string) {
    if (items.some((item) => item.id === itemId)) {
      selectedItemId = itemId;
    }
  },

  updateConfig(updates: Partial<SubtitleOcrConfig>) {
    config = { ...config, ...updates };
  },

  updateItem(itemId: string, updates: SubtitleOcrItemUpdates) {
    items = items.map((item) => (item.id === itemId ? applySafeItemUpdates(item, updates) : item));
  },

  removeItem(itemId: string) {
    const removedIndex = items.findIndex((item) => item.id === itemId);
    if (removedIndex === -1) {
      return;
    }

    items = items.filter((item) => item.id !== itemId);
    processingScopeItemIds = new Set([...processingScopeItemIds].filter((id) => id !== itemId));
    processingBatchItemIds = new Set([...processingBatchItemIds].filter((id) => id !== itemId));
    processingStartedItemIds = new Set([...processingStartedItemIds].filter((id) => id !== itemId));
    cancelledItemIds = new Set([...cancelledItemIds].filter((id) => id !== itemId));
    const nextHydratingItemTokens = new Map(hydratingItemTokens);
    nextHydratingItemTokens.delete(itemId);
    hydratingItemTokens = nextHydratingItemTokens;
    const nextCompletedHydrationTokens = new Map(completedHydrationTokens);
    nextCompletedHydrationTokens.delete(itemId);
    completedHydrationTokens = nextCompletedHydrationTokens;
    if (selectedItemId === itemId) {
      selectedItemId = items[removedIndex]?.id ?? items[removedIndex - 1]?.id ?? null;
    }
  },

  clearItems() {
    items = [];
    selectedItemId = null;
    processingScopeItemIds = new Set();
    processingBatchItemIds = new Set();
    processingStartedItemIds = new Set();
    cancelledItemIds = new Set();
    hydratingItemTokens = new Map();
    completedHydrationTokens = new Map();
  },

  startHydration(itemId: string): string {
    const token = `${itemId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const nextHydratingItemTokens = new Map(hydratingItemTokens);
    nextHydratingItemTokens.set(itemId, token);
    hydratingItemTokens = nextHydratingItemTokens;
    const nextCompletedHydrationTokens = new Map(completedHydrationTokens);
    nextCompletedHydrationTokens.delete(itemId);
    completedHydrationTokens = nextCompletedHydrationTokens;
    return token;
  },

  isItemHydrating(itemId: string): boolean {
    return hydratingItemTokens.has(itemId);
  },

  isHydrationCurrent(itemId: string, token: string): boolean {
    return hydratingItemTokens.get(itemId) === token && items.some((item) => item.id === itemId);
  },

  isHydrationTokenValid(itemId: string, token: string): boolean {
    return (
      (hydratingItemTokens.get(itemId) === token || completedHydrationTokens.get(itemId) === token)
      && items.some((item) => item.id === itemId)
    );
  },

  finishHydration(itemId: string, token: string): void {
    if (hydratingItemTokens.get(itemId) !== token) {
      return;
    }

    const nextHydratingItemTokens = new Map(hydratingItemTokens);
    nextHydratingItemTokens.delete(itemId);
    hydratingItemTokens = nextHydratingItemTokens;
    const nextCompletedHydrationTokens = new Map(completedHydrationTokens);
    nextCompletedHydrationTokens.set(itemId, token);
    completedHydrationTokens = nextCompletedHydrationTokens;
  },

  setItemStatus(itemId: string, status: SubtitleOcrStatus, error?: string) {
    items = items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      return applyItemUpdates(item, {
        status,
        error: error ?? (status === 'error' ? item.error : undefined),
      });
    });
  },

  setProgress(itemId: string, progress: SubtitleOcrProgress | undefined) {
    if (cancelledItemIds.has(itemId)) {
      return;
    }

    items = items.map((item) => (item.id === itemId ? applyItemUpdates(item, { progress }) : item));
  },

  addVersion(itemId: string, version: SubtitleOcrVersion) {
    const nextVersion = cloneVersion(version);
    items = items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      return applyItemUpdates(item, {
        status: 'completed',
        versions: [...item.versions, nextVersion],
        activeVersionId: nextVersion.id,
        reviewTargetId: nextVersion.id,
        progress: undefined,
        error: undefined,
      });
    });
  },

  replaceItemVersions(
    itemId: string,
    versions: SubtitleOcrVersion[],
    activeVersionId: string | null,
    options: ReplaceSubtitleOcrItemVersionsOptions = {},
  ) {
    const nextVersions = versions.map(cloneVersion);
    const nextActiveVersionId = normalizeActiveVersionId(nextVersions, activeVersionId);

    items = items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      return applyItemUpdates(item, {
        ...(options.status !== undefined ? { status: options.status } : {}),
        versions: nextVersions,
        activeVersionId: nextActiveVersionId,
        reviewTargetId: nextActiveVersionId,
        ...(options.preserveProgress ? {} : { progress: undefined }),
        ...(options.preserveError ? {} : { error: undefined }),
      });
    });
  },

  replaceHydratedItemVersions(
    itemId: string,
    hydrationToken: string,
    versions: SubtitleOcrVersion[],
    activeVersionId: string | null,
    options: ReplaceSubtitleOcrItemVersionsOptions = {},
  ): boolean {
    if (!this.isHydrationCurrent(itemId, hydrationToken) || processingScopeItemIds.has(itemId)) {
      return false;
    }

    this.replaceItemVersions(itemId, versions, activeVersionId, options);
    return true;
  },

  updateRestoredBitmap(itemId: string, restoredBitmap: SubtitleOcrCueBitmap): boolean {
    let updated = false;

    items = items.map((item) => {
      if (item.id !== itemId || !restoredBitmap.previewPath) {
        return item;
      }

      const versions = item.versions.map((version) => {
        let versionUpdated = false;
        const bitmaps = version.bitmaps.map((bitmap) => {
          if (!restoredBitmapMatches(bitmap, restoredBitmap)
            || bitmap.previewPath === restoredBitmap.previewPath) {
            return bitmap;
          }

          versionUpdated = true;
          updated = true;
          return { ...bitmap, previewPath: restoredBitmap.previewPath };
        });

        return versionUpdated ? { ...version, bitmaps } : version;
      });

      return updated ? applyItemUpdates(item, { versions }) : item;
    });

    return updated;
  },

  selectVersion(itemId: string, versionId: string | null) {
    items = items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      if (
        item.processingDraft
        && versionId === buildSubtitleOcrProcessingDraftId(item.processingDraft.runId)
      ) {
        return applyItemUpdates(item, {
          reviewTargetId: versionId,
        });
      }

      const nextActiveVersionId = resolveSelectedVersionId(item, versionId);
      return applyItemUpdates(item, {
        activeVersionId: nextActiveVersionId,
        reviewTargetId: nextActiveVersionId,
      });
    });
  },

  getActiveVersion(itemId: string): SubtitleOcrVersion | undefined {
    const item = findItem(itemId);
    const version = item ? findActiveVersion(item) : undefined;
    return version ? cloneVersion(version) : undefined;
  },

  getItemSnapshot(itemId: string): SubtitleOcrSourceItem | undefined {
    const item = findItem(itemId);
    return item ? cloneItem(item) : undefined;
  },

  getItemProgress(itemId: string): SubtitleOcrProgress | undefined {
    const progress = findItem(itemId)?.progress;
    return progress ? cloneProgress(progress) : undefined;
  },

  getWorkspaceItemSummary(itemId: string): SubtitleOcrWorkspaceItemSummary | undefined {
    const item = findItem(itemId);
    return item
      ? {
          ...buildSubtitleOcrItemSummary(item),
          versions: item.versions.map(buildSubtitleOcrVersionSummary),
        }
      : undefined;
  },

  getReviewVersionSummary(itemId: string): SubtitleOcrVersionSummary | undefined {
    const item = findItem(itemId);
    const version = item ? findVersionByReviewTarget(item) : undefined;
    return version ? buildSubtitleOcrVersionSummary(version) : undefined;
  },

  getProcessingDraftSummary(itemId: string): SubtitleOcrProcessingDraftSummary | undefined {
    const draft = findItem(itemId)?.processingDraft;
    return draft ? buildSubtitleOcrProcessingDraftSummary(draft) : undefined;
  },

  getReviewVersion(itemId: string): SubtitleOcrVersion | undefined {
    const item = findItem(itemId);
    const version = item ? findVersionByReviewTarget(item) : undefined;
    return version ? cloneVersion(version) : undefined;
  },

  isProcessingDraftSelected(itemId: string): boolean {
    const item = findItem(itemId);
    return item ? isProcessingDraftSelected(item) : false;
  },

  getActiveCues(itemId: string): SubtitleOcrCue[] {
    const item = findItem(itemId);
    const version = item ? findActiveVersion(item) : undefined;
    return version ? version.finalCues.map(cloneCue) : [];
  },

  getRenderedCues(itemId: string): readonly SubtitleOcrCue[] {
    const item = findItem(itemId);
    if (!item) {
      return EMPTY_SUBTITLE_OCR_CUES;
    }

    if (isProcessingDraftSelected(item) && item.processingDraft) {
      return freezeCueProjection(item.processingDraft.finalCues);
    }

    const version = findVersionByReviewTarget(item);
    return version ? freezeCueProjection(version.finalCues) : EMPTY_SUBTITLE_OCR_CUES;
  },

  getRenderedBitmaps(itemId: string): readonly SubtitleOcrCueBitmap[] {
    const item = findItem(itemId);
    if (!item) {
      return EMPTY_SUBTITLE_OCR_BITMAPS;
    }

    if (isProcessingDraftSelected(item) && item.processingDraft) {
      return freezeBitmapProjection(item.processingDraft.bitmaps);
    }

    const version = findVersionByReviewTarget(item);
    return version ? freezeBitmapProjection(version.bitmaps) : EMPTY_SUBTITLE_OCR_BITMAPS;
  },

  updateCueText(itemId: string, cueId: string, text: string): boolean {
    let updated = false;

    items = items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      if (isProcessingDraftSelected(item)) {
        return item;
      }

      const reviewVersion = findVersionByReviewTarget(item);
      if (!reviewVersion) {
        return item;
      }

      let foundCue = false;
      let changed = false;
      const versions = item.versions.map((version) => {
        if (version.id !== reviewVersion.id) {
          return version;
        }

        const finalCues = version.finalCues.map((cue) => {
          if (cue.id !== cueId) {
            return cue;
          }

          foundCue = true;
          if (cue.text === text) {
            return cue;
          }

          changed = true;
          return {
            ...cloneCue(cue),
            text,
          };
        });

        if (!changed) {
          return version;
        }

        return {
          ...version,
          finalCues,
        };
      });

      if (!foundCue || !changed) {
        return item;
      }

      updated = true;
      return applyItemUpdates(item, { versions });
    });

    return updated;
  },

  beginProcessingDraft(itemId: string, draft: { runId: string; name: string; startedAt?: string }) {
    const nextDraft: SubtitleOcrProcessingDraft = {
      runId: draft.runId,
      name: draft.name,
      startedAt: draft.startedAt ?? new Date().toISOString(),
      bitmaps: [],
      rawOcr: [],
      finalCues: [],
    };
    const nextDraftId = buildSubtitleOcrProcessingDraftId(nextDraft.runId);

    items = items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      const activeVersionId = normalizeActiveVersionId(item.versions, item.activeVersionId);
      const shouldShowDraft = item.versions.length === 0;

      return applyItemUpdates(item, {
        processingDraft: nextDraft,
        activeVersionId,
        reviewTargetId: shouldShowDraft
          ? nextDraftId
          : normalizeReviewTargetId(item.versions, activeVersionId, item.reviewTargetId, nextDraft),
      });
    });
  },

  appendProcessingDraftCue(
    itemId: string,
    runId: string,
    liveCue: Omit<SubtitleOcrLiveCueEvent, 'itemId' | 'runId'>,
  ) {
    if (cancelledItemIds.has(itemId)) {
      return;
    }

    items = items.map((item) => {
      if (item.id !== itemId || item.processingDraft?.runId !== runId) {
        return item;
      }

      const processingDraft = item.processingDraft;
      return applyItemUpdates(item, {
        processingDraft: {
          ...processingDraft,
          bitmaps: upsertBy(
            processingDraft.bitmaps,
            liveCue.bitmap,
            (bitmap) => bitmapMatchesLiveBitmap(bitmap, liveCue.bitmap),
            cloneBitmap,
          ),
          rawOcr: upsertBy(
            processingDraft.rawOcr,
            liveCue.rawCue,
            (rawCue) => rawCueMatchesLiveRawCue(rawCue, liveCue.rawCue),
            cloneRawCue,
          ),
          finalCues: upsertBy(
            processingDraft.finalCues,
            liveCue.provisionalCue,
            (cue) => cueMatchesLiveCue(cue, liveCue.provisionalCue),
            cloneCue,
          ),
        },
      });
    });
  },

  completeProcessingDraft(itemId: string, runId: string, version: SubtitleOcrVersion) {
    const nextVersion = cloneVersion(version);
    const draftId = buildSubtitleOcrProcessingDraftId(runId);
    items = items.map((item) => {
      if (item.id !== itemId || item.processingDraft?.runId !== runId) {
        return item;
      }

      const wasViewingProcessingDraft = item.reviewTargetId === draftId;
      const activeVersionId = wasViewingProcessingDraft || item.versions.length === 0 || !item.activeVersionId
        ? nextVersion.id
        : item.activeVersionId;

      return applyItemUpdates(item, {
        status: 'completed',
        versions: [...item.versions, nextVersion],
        activeVersionId,
        reviewTargetId: wasViewingProcessingDraft ? nextVersion.id : item.reviewTargetId ?? activeVersionId,
        processingDraft: undefined,
        progress: undefined,
        error: undefined,
      });
    });
  },

  clearProcessingDraft(itemId: string, runId: string) {
    const draftId = buildSubtitleOcrProcessingDraftId(runId);
    items = items.map((item) => {
      if (item.id !== itemId || item.processingDraft?.runId !== runId) {
        return item;
      }

      const activeVersionId = normalizeActiveVersionId(item.versions, item.activeVersionId);
      return applyItemUpdates(item, {
        processingDraft: undefined,
        reviewTargetId: item.reviewTargetId === draftId ? activeVersionId : item.reviewTargetId,
      });
    });
  },

  startProcessing(itemIds: string[]): boolean {
    if (isProcessing || itemIds.some((itemId) => hydratingItemTokens.has(itemId))) {
      return false;
    }

    isProcessing = true;
    isCancelling = false;
    processingScopeItemIds = new Set(itemIds);
    processingBatchItemIds = new Set(itemIds);
    processingStartedItemIds = new Set();
    cancelledItemIds = new Set();
    this.addLog(
      'info',
      itemIds.length === 1
        ? 'Starting Subtitle OCR processing'
      : `Starting Subtitle OCR processing for ${itemIds.length} sources`,
    );
    return true;
  },

  stopProcessing() {
    isProcessing = false;
    isCancelling = false;
    processingScopeItemIds = new Set();
    processingBatchItemIds = new Set();
    processingStartedItemIds = new Set();
    cancelledItemIds = new Set();
  },

  setCancelling(value: boolean) {
    isCancelling = value;
  },

  isItemCancelled(itemId: string): boolean {
    return cancelledItemIds.has(itemId);
  },

  markProcessingItemStarted(
    itemId: string,
    status: SubtitleOcrProcessingStatus = 'decoding',
  ): boolean {
    if (
      !isProcessing
      || hydratingItemTokens.has(itemId)
      || !processingScopeItemIds.has(itemId)
      || cancelledItemIds.has(itemId)
    ) {
      return false;
    }

    if (processingStartedItemIds.has(itemId)) {
      return true;
    }

    processingStartedItemIds = new Set([...processingStartedItemIds, itemId]);
    items = items.map((item) => (item.id === itemId
      ? applyItemUpdates(item, {
          status,
          progress: undefined,
          error: undefined,
        })
      : item));

    return true;
  },

  cancelProcessing(itemId: string) {
    if (!processingScopeItemIds.has(itemId)) {
      return;
    }

    cancelledItemIds = new Set([...cancelledItemIds, itemId]);
    processingScopeItemIds = new Set([...processingScopeItemIds].filter((id) => id !== itemId));

    items = items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      const activeVersionId = normalizeActiveVersionId(item.versions, item.activeVersionId);
      const status: SubtitleOcrStatus = item.versions.length > 0 ? 'completed' : 'ready';

      return applyItemUpdates(item, {
        status,
        activeVersionId,
        reviewTargetId: activeVersionId,
        processingDraft: undefined,
        progress: undefined,
        error: undefined,
      });
    });

    this.addLog('warning', 'Processing cancelled by user', itemId);
  },

  finishProcessingItem(itemId: string) {
    if (!processingScopeItemIds.has(itemId)) {
      return;
    }

    processingScopeItemIds = new Set([...processingScopeItemIds].filter((id) => id !== itemId));
  },

  addLog(level: SubtitleOcrLogEntry['level'], message: string, itemId?: string): void {
    const item = itemId ? findItem(itemId) : undefined;
    const details = item ? `[${item.displayName}] ${message}` : message;

    logStore.addLog({
      level,
      source: 'subtitle-ocr',
      title: message,
      details,
      context: item ? { filePath: item.sourcePath } : undefined,
    });

    logs = [
      ...logs,
      {
        id: generateLogId(),
        timestamp: new Date(),
        level,
        message: details,
      },
    ];

    if (logs.length > 100) {
      logs = logs.slice(-100);
    }
  },

  clearLogs(): void {
    logs = [];
  },
};
