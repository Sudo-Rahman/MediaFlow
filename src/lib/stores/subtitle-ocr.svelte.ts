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
import { DEFAULT_SUBTITLE_OCR_CONFIG } from '$lib/types';
import {
  buildSubtitleOcrProcessingDraftId,
  isSubtitleOcrProcessingDraftId,
} from '$lib/utils/subtitle-ocr-review-target';
import { logStore } from './logs.svelte';
import { mergeSubtitleOcrProgress } from './subtitle-ocr-progress';

interface SubtitleOcrItemFields {
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

let items = $state.raw<SubtitleOcrSourceItem[]>([]);
let selectedItemId = $state<string | null>(null);
let config = $state<SubtitleOcrConfig>({ ...DEFAULT_SUBTITLE_OCR_CONFIG });
let isProcessing = $state(false);
let isCancelling = $state(false);
let processingScopeItemIds = $state<Set<string>>(new Set());
let cancelledItemIds = $state<Set<string>>(new Set());
let logs = $state<SubtitleOcrLogEntry[]>([]);

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function generateLogId(): string {
  return `subtitle-ocr-log-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function cloneConfig(value: SubtitleOcrConfig): SubtitleOcrConfig {
  return { ...value };
}

function cloneTrack(track: SubtitleOcrTrackMetadata): SubtitleOcrTrackMetadata {
  return { ...track };
}

function clonePair(pair: SubtitleOcrVobSubPair): SubtitleOcrVobSubPair {
  return { ...pair };
}

function cloneProgress(progress: SubtitleOcrProgress): SubtitleOcrProgress {
  return { ...progress };
}

function cloneCue(cue: SubtitleOcrCue): SubtitleOcrCue {
  return {
    ...cue,
    sourceCueIds: [...cue.sourceCueIds],
  };
}

function cloneBitmap(bitmap: SubtitleOcrCueBitmap): SubtitleOcrCueBitmap {
  return { ...bitmap };
}

function cloneRawCue(rawCue: SubtitleOcrRawCue): SubtitleOcrRawCue {
  return {
    ...rawCue,
    boxes: rawCue.boxes.map((box) => ({ ...box })),
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

function cloneVersion(version: SubtitleOcrVersion): SubtitleOcrVersion {
  return {
    ...version,
    configSnapshot: cloneConfig(version.configSnapshot),
    sourceSnapshot: cloneSourceSnapshot(version.sourceSnapshot),
    bitmaps: version.bitmaps.map(cloneBitmap),
    rawOcr: version.rawOcr.map(cloneRawCue),
    stabilizedCues: version.stabilizedCues.map(cloneCue),
    finalCues: version.finalCues.map(cloneCue),
  };
}

function cloneProcessingDraft(draft: SubtitleOcrProcessingDraft): SubtitleOcrProcessingDraft {
  return {
    runId: draft.runId,
    name: draft.name,
    startedAt: draft.startedAt,
    bitmaps: draft.bitmaps.map(cloneBitmap),
    rawOcr: draft.rawOcr.map(cloneRawCue),
    finalCues: draft.finalCues.map(cloneCue),
  };
}

function normalizeReviewTargetId(
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

function normalizeActiveVersionId(versions: SubtitleOcrVersion[], activeVersionId: string | null): string | null {
  if (activeVersionId === null) {
    return null;
  }

  return versions.some((version) => version.id === activeVersionId)
    ? activeVersionId
    : versions[0]?.id ?? null;
}

function findVersionByReviewTarget(item: SubtitleOcrSourceItem): SubtitleOcrVersion | undefined {
  const targetId = item.reviewTargetId ?? item.activeVersionId;
  if (isSubtitleOcrProcessingDraftId(targetId)) {
    return undefined;
  }

  return item.versions.find((version) => version.id === targetId)
    ?? findActiveVersion(item)
    ?? item.versions[0];
}

function isProcessingDraftSelected(item: SubtitleOcrSourceItem): boolean {
  return Boolean(
    item.processingDraft
    && item.reviewTargetId === buildSubtitleOcrProcessingDraftId(item.processingDraft.runId),
  );
}

function resolveSelectedVersionId(item: SubtitleOcrSourceItem, versionId: string | null): string | null {
  if (versionId === null) {
    return null;
  }

  if (item.versions.some((version) => version.id === versionId)) {
    return versionId;
  }

  return normalizeActiveVersionId(item.versions, item.activeVersionId);
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
  return buildItemFromSnapshot(cloneSourceSnapshot(item), cloneItemFields(item));
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
  const fields = cloneItemFields(item);

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
    fields.versions = updates.versions.map(cloneVersion);
  }
  if (updates.activeVersionId !== undefined) fields.activeVersionId = updates.activeVersionId;
  if (hasOwn(updates, 'reviewTargetId')) {
    fields.reviewTargetId = updates.reviewTargetId;
  }
  if (hasOwn(updates, 'processingDraft')) {
    fields.processingDraft = updates.processingDraft
      ? cloneProcessingDraft(updates.processingDraft)
      : undefined;
  }

  return buildItemFromSnapshot(applySourceUpdates(item, updates), fields);
}

function applySafeItemUpdates(
  item: SubtitleOcrSourceItem,
  updates: SubtitleOcrItemUpdates,
): SubtitleOcrSourceItem {
  const fields = cloneItemFields(item);

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

function upsertBy<T>(
  values: readonly T[],
  candidate: T,
  matches: (value: T) => boolean,
  clone: (value: T) => T,
): T[] {
  let replaced = false;
  const nextValues = values.map((value) => {
    if (!matches(value)) {
      return clone(value);
    }

    replaced = true;
    return clone(candidate);
  });

  return replaced ? nextValues : [...nextValues, clone(candidate)];
}

function cueMatchesLiveCue(cue: SubtitleOcrCue, liveCue: SubtitleOcrCue): boolean {
  return cue.id === liveCue.id
    || cue.sourceCueIds.some((sourceCueId) => liveCue.sourceCueIds.includes(sourceCueId));
}

function bitmapMatchesLiveBitmap(bitmap: SubtitleOcrCueBitmap, liveBitmap: SubtitleOcrCueBitmap): boolean {
  return Boolean(bitmap.cacheKey && liveBitmap.cacheKey && bitmap.cacheKey === liveBitmap.cacheKey)
    || bitmap.cueId === liveBitmap.cueId;
}

function rawCueMatchesLiveRawCue(rawCue: SubtitleOcrRawCue, liveRawCue: SubtitleOcrRawCue): boolean {
  return Boolean(rawCue.cacheKey && liveRawCue.cacheKey && rawCue.cacheKey === liveRawCue.cacheKey)
    || rawCue.cueId === liveRawCue.cueId;
}

export const subtitleOcrStore = {
  get items(): SubtitleOcrSourceItem[] {
    return items.map(cloneItem);
  },

  get selectedItemId() {
    return selectedItemId;
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

  get cancelledItemIds() {
    return new Set(cancelledItemIds);
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
    cancelledItemIds = new Set();
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
    cancelledItemIds = new Set([...cancelledItemIds].filter((id) => id !== itemId));
    if (selectedItemId === itemId) {
      selectedItemId = items[removedIndex]?.id ?? items[removedIndex - 1]?.id ?? null;
    }
  },

  clearItems() {
    items = [];
    selectedItemId = null;
    processingScopeItemIds = new Set();
    cancelledItemIds = new Set();
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
        versions: [...item.versions.map(cloneVersion), nextVersion],
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

  getRenderedCues(itemId: string): SubtitleOcrCue[] {
    const item = findItem(itemId);
    if (!item) {
      return [];
    }

    if (isProcessingDraftSelected(item) && item.processingDraft) {
      return item.processingDraft.finalCues.map(cloneCue);
    }

    const version = findVersionByReviewTarget(item);
    return version ? version.finalCues.map(cloneCue) : [];
  },

  getRenderedBitmaps(itemId: string): SubtitleOcrCueBitmap[] {
    const item = findItem(itemId);
    if (!item) {
      return [];
    }

    if (isProcessingDraftSelected(item) && item.processingDraft) {
      return item.processingDraft.bitmaps.map(cloneBitmap);
    }

    const version = findVersionByReviewTarget(item);
    return version ? version.bitmaps.map(cloneBitmap) : [];
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
          return cloneVersion(version);
        }

        const finalCues = version.finalCues.map((cue) => {
          if (cue.id !== cueId) {
            return cloneCue(cue);
          }

          foundCue = true;
          if (cue.text === text) {
            return cloneCue(cue);
          }

          changed = true;
          return {
            ...cloneCue(cue),
            text,
          };
        });

        if (!changed) {
          return cloneVersion(version);
        }

        return {
          ...cloneVersion(version),
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
        versions: [...item.versions.map(cloneVersion), nextVersion],
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

  startProcessing(itemIds: string[]) {
    isProcessing = true;
    isCancelling = false;
    processingScopeItemIds = new Set(itemIds);
    cancelledItemIds = new Set();
    this.addLog(
      'info',
      itemIds.length === 1
        ? 'Starting Subtitle OCR processing'
        : `Starting Subtitle OCR processing for ${itemIds.length} sources`,
    );
  },

  stopProcessing() {
    isProcessing = false;
    isCancelling = false;
    processingScopeItemIds = new Set();
    cancelledItemIds = new Set();
  },

  setCancelling(value: boolean) {
    isCancelling = value;
  },

  isItemCancelled(itemId: string): boolean {
    return cancelledItemIds.has(itemId);
  },

  cancelProcessing(itemId: string) {
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
