import { untrack } from 'svelte';

import type {
  ImportItem,
  ImportSelectionMode,
  ImportSourceId,
  ImportSourceSnapshot,
  ImportableKind,
  ImportMenuOption,
  PathImportItem,
  ResolveImportRequest,
  ResolvedImportPayload,
  ToolId,
  VersionedImportItem,
} from '$lib/types/tool-import';

interface SourceRule {
  sourceId: ImportSourceId;
  allowKinds: ImportableKind[] | 'any';
}

const TARGET_RULES: Record<ToolId, SourceRule[]> = {
  extract: [],
  merge: [{ sourceId: 'extraction_outputs', allowKinds: ['track_audio', 'track_subtitle', 'track_video'] }],
  transcode: [],
  translate: [
    { sourceId: 'extraction_outputs', allowKinds: ['track_subtitle', 'subtitle'] },
    { sourceId: 'ocr_versions', allowKinds: 'any' },
    { sourceId: 'audio_to_subs_versions', allowKinds: 'any' },
  ],
  rename: [
    { sourceId: 'extraction_outputs', allowKinds: 'any' },
    { sourceId: 'merge_outputs', allowKinds: 'any' },
  ],
  'audio-to-subs': [{ sourceId: 'extraction_outputs', allowKinds: ['track_audio', 'audio'] }],
  'video-ocr': [],
  info: [
    { sourceId: 'extraction_media', allowKinds: ['media'] },
    { sourceId: 'merge_media', allowKinds: ['media'] },
  ],
};

const SOURCE_ORDER: ImportSourceId[] = [
  'extraction_outputs',
  'merge_outputs',
  'ocr_versions',
  'audio_to_subs_versions',
  'extraction_media',
  'merge_media',
];

let snapshots = $state<Map<ImportSourceId, ImportSourceSnapshot>>(new Map());

function isKindAllowed(kind: ImportableKind, allowKinds: ImportableKind[] | 'any'): boolean {
  if (allowKinds === 'any') {
    return true;
  }
  return allowKinds.includes(kind);
}

function getRulesForTarget(targetTool: ToolId): SourceRule[] {
  return TARGET_RULES[targetTool] ?? [];
}

function getSourceRule(targetTool: ToolId, sourceId: ImportSourceId): SourceRule | undefined {
  return getRulesForTarget(targetTool).find((rule) => rule.sourceId === sourceId);
}

function getCompatibleItems(sourceId: ImportSourceId, targetTool: ToolId): ImportItem[] {
  const sourceSnapshot = snapshots.get(sourceId);
  if (!sourceSnapshot) {
    return [];
  }

  const sourceRule = getSourceRule(targetTool, sourceId);
  if (!sourceRule) {
    return [];
  }

  return sourceSnapshot.items.filter((item) => isKindAllowed(item.kind, sourceRule.allowKinds));
}

function uniqueByKey(items: ImportItem[]): ImportItem[] {
  const seen = new Set<string>();
  const uniqueItems: ImportItem[] = [];

  for (const item of items) {
    if (seen.has(item.key)) {
      continue;
    }
    seen.add(item.key);
    uniqueItems.push(item);
  }

  return uniqueItems;
}

function parseIsoTimestamp(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

function pickVersionedItems(items: VersionedImportItem[], selectionMode: ImportSelectionMode, selectedKeys?: string[]): VersionedImportItem[] {
  if (selectionMode === 'all_versions') {
    return items;
  }

  if (selectionMode === 'custom') {
    const keySet = new Set(selectedKeys ?? []);
    return items.filter((item) => keySet.has(item.key));
  }

  const byMediaPath = new Map<string, VersionedImportItem>();

  for (const item of items) {
    const current = byMediaPath.get(item.mediaPath);
    if (!current) {
      byMediaPath.set(item.mediaPath, item);
      continue;
    }

    const currentTimestamp = parseIsoTimestamp(current.versionCreatedAt);
    const incomingTimestamp = parseIsoTimestamp(item.versionCreatedAt);

    if (incomingTimestamp >= currentTimestamp) {
      byMediaPath.set(item.mediaPath, item);
    }
  }

  return Array.from(byMediaPath.values());
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

function dedupeSubtitleFiles(items: VersionedImportItem[]): VersionedImportItem[] {
  const byPath = new Map<string, VersionedImportItem>();

  for (const item of items) {
    byPath.set(item.subtitleFile.path, item);
  }

  return Array.from(byPath.values());
}

function buildItemSignature(item: ImportItem): string {
  if (item.itemType === 'path') {
    return `path|${item.key}|${item.kind}|${item.path}|${item.name}`;
  }

  const allowedFormats = item.allowedFormats?.join(',') ?? '';
  return `versioned|${item.key}|${item.kind}|${item.mediaPath}|${item.versionId}|${item.persisted}|${item.subtitleFile.path}|${item.subtitleFile.name}|${allowedFormats}`;
}

function buildItemsSignature(items: ImportItem[]): string {
  return items
    .map(buildItemSignature)
    .sort((a, b) => a.localeCompare(b))
    .join('||');
}

function isSameSnapshotMeta(current: ImportSourceSnapshot, next: ImportSourceSnapshot): boolean {
  return current.sourceId === next.sourceId
    && current.sourceTool === next.sourceTool
    && current.label === next.label
    && current.itemType === next.itemType;
}

export const toolImportStore = {
  get snapshots(): ImportSourceSnapshot[] {
    return SOURCE_ORDER
      .map((sourceId) => snapshots.get(sourceId))
      .filter((snapshot): snapshot is ImportSourceSnapshot => snapshot !== undefined);
  },

  getSnapshot(sourceId: ImportSourceId): ImportSourceSnapshot | null {
    return snapshots.get(sourceId) ?? null;
  },

  publishSnapshot(snapshot: ImportSourceSnapshot) {
    const normalizedItems = uniqueByKey(snapshot.items);
    const currentSnapshots = untrack(() => snapshots);
    const existing = currentSnapshots.get(snapshot.sourceId);

    if (existing && isSameSnapshotMeta(existing, snapshot)) {
      const currentSignature = buildItemsSignature(existing.items);
      const nextSignature = buildItemsSignature(normalizedItems);
      if (currentSignature === nextSignature) {
        return;
      }
    }

    const nextSnapshots = new Map(currentSnapshots);
    nextSnapshots.set(snapshot.sourceId, {
      ...snapshot,
      items: normalizedItems,
      updatedAt: Date.now(),
    });
    snapshots = nextSnapshots;
  },

  publishPathSource(
    sourceId: ImportSourceId,
    sourceTool: ToolId,
    label: string,
    items: Array<Omit<PathImportItem, 'sourceId' | 'sourceTool' | 'itemType'>>,
  ) {
    const normalizedItems: PathImportItem[] = items.map((item) => ({
      ...item,
      sourceId,
      sourceTool,
      itemType: 'path',
    }));

    this.publishSnapshot({
      sourceId,
      sourceTool,
      label,
      itemType: 'path',
      items: normalizedItems,
      updatedAt: Date.now(),
    });
  },

  publishVersionedSource(
    sourceId: ImportSourceId,
    sourceTool: ToolId,
    label: string,
    items: Array<Omit<VersionedImportItem, 'sourceId' | 'sourceTool' | 'itemType'>>,
  ) {
    const normalizedItems: VersionedImportItem[] = items.map((item) => ({
      ...item,
      sourceId,
      sourceTool,
      itemType: 'versioned',
    }));

    this.publishSnapshot({
      sourceId,
      sourceTool,
      label,
      itemType: 'versioned',
      items: normalizedItems,
      updatedAt: Date.now(),
    });
  },

  clearSource(sourceId: ImportSourceId) {
    const currentSnapshots = untrack(() => snapshots);
    if (!currentSnapshots.has(sourceId)) {
      return;
    }

    const nextSnapshots = new Map(currentSnapshots);
    nextSnapshots.delete(sourceId);
    snapshots = nextSnapshots;
  },

  clearSourcesForTool(sourceTool: ToolId) {
    const currentSnapshots = untrack(() => snapshots);
    const nextSnapshots = new Map(
      Array.from(currentSnapshots.entries()).filter(([, snapshot]) => snapshot.sourceTool !== sourceTool),
    );
    if (nextSnapshots.size === currentSnapshots.size) {
      return;
    }
    snapshots = nextSnapshots;
  },

  getItems(sourceId: ImportSourceId, targetTool: ToolId): ImportItem[] {
    return getCompatibleItems(sourceId, targetTool);
  },

  getAvailableSources(targetTool: ToolId, sourceFilter?: ImportSourceId[]): ImportMenuOption[] {
    const filterSet = sourceFilter ? new Set(sourceFilter) : null;
    const sourceRules = getRulesForTarget(targetTool);

    return sourceRules
      .filter((rule) => !filterSet || filterSet.has(rule.sourceId))
      .map((rule) => {
        const sourceSnapshot = snapshots.get(rule.sourceId);
        const items = getCompatibleItems(rule.sourceId, targetTool);
        return {
          sourceId: rule.sourceId,
          label: sourceSnapshot?.label ?? rule.sourceId,
          count: items.length,
          requiresDialog: sourceSnapshot?.itemType === 'versioned',
        };
      })
      .filter((option) => option.count > 0);
  },

  resolveImport(request: ResolveImportRequest): ResolvedImportPayload {
    const { targetTool, sourceId } = request;
    const items = getCompatibleItems(sourceId, targetTool);

    if (items.length === 0) {
      return { paths: [], subtitleFiles: [] };
    }

    const sourceSnapshot = snapshots.get(sourceId);
    if (!sourceSnapshot) {
      return { paths: [], subtitleFiles: [] };
    }

    if (sourceSnapshot.itemType === 'versioned') {
      const versionedItems = items.filter((item): item is VersionedImportItem => item.itemType === 'versioned');
      const pickedItems = pickVersionedItems(versionedItems, request.selectionMode ?? 'latest_per_file', request.selectedKeys);
      const uniqueItems = dedupeSubtitleFiles(pickedItems);

      return {
        paths: [],
        subtitleFiles: uniqueItems.map((item) => item.subtitleFile),
      };
    }

    const pathItems = items.filter((item): item is PathImportItem => item.itemType === 'path');
    return {
      paths: dedupePaths(pathItems.map((item) => item.path)),
      subtitleFiles: [],
    };
  },
};
