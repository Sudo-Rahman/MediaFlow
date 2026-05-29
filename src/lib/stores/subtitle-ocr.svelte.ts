import type {
  SubtitleOcrConfig,
  SubtitleOcrCue,
  SubtitleOcrCueBitmap,
  SubtitleOcrDraft,
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
  draft?: SubtitleOcrDraft;
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
}

let items = $state.raw<SubtitleOcrSourceItem[]>([]);
let selectedItemId = $state<string | null>(null);
let config = $state<SubtitleOcrConfig>({ ...DEFAULT_SUBTITLE_OCR_CONFIG });
let isProcessing = $state(false);
let isCancelling = $state(false);
let processingScopeItemIds = $state<Set<string>>(new Set());

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
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

function cloneDraft(draft: SubtitleOcrDraft): SubtitleOcrDraft {
  return {
    ...draft,
    cues: draft.cues.map(cloneCue),
  };
}

function createDraftFromVersion(version: SubtitleOcrVersion): SubtitleOcrDraft {
  return {
    baseVersionId: version.id,
    cues: version.finalCues.map(cloneCue),
    dirty: false,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeActiveVersionId(versions: SubtitleOcrVersion[], activeVersionId: string | null): string | null {
  if (activeVersionId === null) {
    return null;
  }

  return versions.some((version) => version.id === activeVersionId)
    ? activeVersionId
    : versions[0]?.id ?? null;
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
    draft: item.draft ? cloneDraft(item.draft) : undefined,
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
    fields.progress = updates.progress ? cloneProgress(updates.progress) : undefined;
  }
  if (updates.versions !== undefined) {
    fields.versions = updates.versions.map(cloneVersion);
  }
  if (updates.activeVersionId !== undefined) fields.activeVersionId = updates.activeVersionId;
  if (hasOwn(updates, 'draft')) {
    fields.draft = updates.draft ? cloneDraft(updates.draft) : undefined;
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
    fields.progress = updates.progress ? cloneProgress(updates.progress) : undefined;
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

  reset() {
    items = [];
    selectedItemId = null;
    config = { ...DEFAULT_SUBTITLE_OCR_CONFIG };
    isProcessing = false;
    isCancelling = false;
    processingScopeItemIds = new Set();
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
    if (selectedItemId === itemId) {
      selectedItemId = items[removedIndex]?.id ?? items[removedIndex - 1]?.id ?? null;
    }
  },

  clearItems() {
    items = [];
    selectedItemId = null;
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
        draft: undefined,
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
        draft: undefined,
        progress: undefined,
        error: undefined,
      });
    });
  },

  selectVersion(itemId: string, versionId: string | null) {
    items = items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      const nextActiveVersionId = resolveSelectedVersionId(item, versionId);
      const shouldClearDraft = versionId === null
        || item.versions.some((version) => version.id === versionId)
        || nextActiveVersionId !== item.activeVersionId;

      return applyItemUpdates(item, {
        activeVersionId: nextActiveVersionId,
        ...(shouldClearDraft ? { draft: undefined } : {}),
      });
    });
  },

  getActiveVersion(itemId: string): SubtitleOcrVersion | undefined {
    const item = findItem(itemId);
    const version = item ? findActiveVersion(item) : undefined;
    return version ? cloneVersion(version) : undefined;
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

    if (item.draft) {
      return item.draft.cues.map(cloneCue);
    }

    const version = findActiveVersion(item);
    return version ? version.finalCues.map(cloneCue) : [];
  },

  updateCueText(itemId: string, cueId: string, text: string) {
    items = items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      const activeVersion = findActiveVersion(item);
      const currentDraft = item.draft ? cloneDraft(item.draft) : undefined;
      if (!currentDraft && !activeVersion) {
        return item;
      }

      const draft = currentDraft
        ?? (activeVersion ? createDraftFromVersion(activeVersion) : undefined);
      if (!draft) {
        return item;
      }
      let foundCue = false;
      const cues = draft.cues.map((cue) => {
        if (cue.id !== cueId) {
          return cloneCue(cue);
        }

        foundCue = true;
        return {
          ...cloneCue(cue),
          text,
        };
      });

      if (!foundCue) {
        return item;
      }

      return applyItemUpdates(item, {
        draft: {
          ...draft,
          cues,
          dirty: true,
          updatedAt: new Date().toISOString(),
        },
      });
    });
  },

  startProcessing(itemIds: string[]) {
    isProcessing = true;
    isCancelling = false;
    processingScopeItemIds = new Set(itemIds);
  },

  stopProcessing() {
    isProcessing = false;
    isCancelling = false;
    processingScopeItemIds = new Set();
  },

  setCancelling(value: boolean) {
    isCancelling = value;
  },
};
