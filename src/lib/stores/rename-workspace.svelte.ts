import { untrack } from 'svelte';

import type {
  RenameFile,
  RenameRule,
  RenameMode,
  RenameProgress,
  RuleType,
  RuleConfig,
  RulePreset,
  SortField,
  SortDirection,
  SortConfig,
} from '$lib/types/rename';
import { DEFAULT_RULE_CONFIGS, BUILT_IN_PRESETS } from '$lib/types/rename';
import {
  applyAllRules,
  buildNewPath,
  detectConflicts,
  generateId,
  hasRenameTargetChange,
  compareRenameFiles,
} from '$lib/services/rename';
import type { BuildNewPathOptions } from '$lib/services/rename';
import {
  assignSeriesSeasonsSequentially,
  planSeriesNumbering,
  type SeriesGroupResolution,
  type SeriesNumberingIssue,
} from '$lib/services/series-numbering';
import {
  normalizePathForIdentity,
  resolveSourceGroup,
  sameSourceGroup,
  sourceGroupForDirectFileParent,
} from '$lib/types/source-group';
import {
  loadUserPresets,
  savePreset as savePresetToStorage,
  deletePreset as deletePresetFromStorage,
  updatePreset as updatePresetInStorage,
  subscribeToPresetChanges,
} from '$lib/services/presets';

interface RenameWorkspaceOptions {
  mode?: RenameMode;
  outputDir?: string;
  includeOutputDirInTargetPath?: boolean;
  targetPathOptions?: Omit<BuildNewPathOptions, 'outputDir'>;
}

interface ReplaceFilesOptions {
  preserveSelection?: boolean;
}

function areSourceFileListsEquivalent(currentFiles: RenameFile[], nextFiles: RenameFile[]): boolean {
  if (currentFiles.length !== nextFiles.length) {
    return false;
  }

  for (let index = 0; index < currentFiles.length; index += 1) {
    const current = currentFiles[index];
    const next = nextFiles[index];

    if (
      current.id !== next.id
      || current.originalPath !== next.originalPath
      || current.originalName !== next.originalName
      || current.extension !== next.extension
      || current.selected !== next.selected
      || current.size !== next.size
      || current.modifiedAt?.getTime() !== next.modifiedAt?.getTime()
      || current.createdAt?.getTime() !== next.createdAt?.getTime()
      || current.seasonNumber !== next.seasonNumber
      || current.episodeNumber !== next.episodeNumber
      || !sameSourceGroup(
        resolveSourceGroup(current.originalPath, current.sourceGroup),
        resolveSourceGroup(next.originalPath, next.sourceGroup),
      )
    ) {
      return false;
    }
  }

  return true;
}

function createDefaultProgressState(status: RenameProgress['status'] = 'idle'): RenameProgress {
  return {
    status,
    current: 0,
    total: 0,
    currentFile: undefined,
    currentFileId: undefined,
    currentFilePath: undefined,
    currentFileProgress: 0,
    currentSpeedBytesPerSec: undefined,
    completedBytes: 0,
    totalBytes: 0,
    currentFileBytesCopied: 0,
    currentFileTotalBytes: 0,
  };
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

type CurrentFileOutcome = 'success' | 'error' | 'cancelled';

const RECALCULATE_DEBOUNCE_MS = 50;

export function createRenameWorkspaceStore(options: RenameWorkspaceOptions = {}) {
  let files = $state<RenameFile[]>([]);
  let rules = $state<RenameRule[]>([]);
  let mode = $state<RenameMode>(options.mode ?? 'rename');
  let outputDir = $state<string>(options.outputDir ?? '');
  let searchQuery = $state<string>('');
  let sortConfig = $state<SortConfig>({ field: 'name', direction: 'asc' });
  let progress = $state<RenameProgress>(createDefaultProgressState());
  let abortController = $state<AbortController | null>(null);
  let userPresets = $state<RulePreset[]>([]);
  let presetsLoaded = $state(false);
  let recalculateTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let isRecalculating = false;
  let unsubscribePresetChanges: (() => void) | null = null;
  let seasonAssignments = $state.raw<Map<string, number>>(new Map());

  function getTargetPathOptions(): BuildNewPathOptions | undefined {
    const includeOutputDirInTargetPath = options.includeOutputDirInTargetPath ?? mode === 'copy';
    const nextOutputDir = includeOutputDirInTargetPath ? outputDir : undefined;

    if (!nextOutputDir && !options.targetPathOptions) {
      return undefined;
    }

    return {
      ...options.targetPathOptions,
      outputDir: nextOutputDir,
    };
  }

  function calculateConflicts(sourceFiles: RenameFile[] = files): Map<string, string[]> {
    return detectConflicts(sourceFiles, getTargetPathOptions());
  }

  function pruneSeasonAssignments(sourceFiles: RenameFile[] = files): void {
    const activeGroupKeys = new Set(
      planSeriesNumbering(sourceFiles, sortConfig, seasonAssignments).resolutions.map((resolution) => resolution.groupKey),
    );
    const nextAssignments = new Map(
      [...seasonAssignments].filter(([groupKey]) => activeGroupKeys.has(groupKey)),
    );

    if (nextAssignments.size !== seasonAssignments.size) {
      seasonAssignments = nextAssignments;
    }
  }

  function ensurePresetSubscription(): void {
    if (unsubscribePresetChanges) {
      return;
    }

    unsubscribePresetChanges = subscribeToPresetChanges((nextPresets) => {
      userPresets = nextPresets;
      presetsLoaded = true;
    });
  }

  function scheduleRecalculation(): void {
    if (recalculateTimeoutId !== null) {
      clearTimeout(recalculateTimeoutId);
    }

    recalculateTimeoutId = setTimeout(() => {
      recalculateTimeoutId = null;
      performRecalculation();
    }, RECALCULATE_DEBOUNCE_MS);
  }

  function performRecalculation(): void {
    if (isRecalculating) return;
    isRecalculating = true;

    try {
      recalculateNewNamesInternal();
    } finally {
      isRecalculating = false;
    }
  }

  function recalculateNewNamesInternal(): void {
    const enabledRules = rules.filter((rule) => rule.enabled);
    pruneSeasonAssignments(files);
    const seriesPlan = planSeriesNumbering(files, sortConfig, seasonAssignments);
    const selectedContexts = seriesPlan.contextsByFileId;

    files = files.map((file) => {
      if (!file.selected) {
        return { ...file, newName: file.originalName, status: 'pending' as const, error: undefined };
      }

      const context = selectedContexts.get(file.id) ?? { globalIndex: 0, seriesIndex: 0 };
      const newName = applyAllRules(file.originalName, enabledRules, context, file);

      return { ...file, newName, status: 'pending' as const, error: undefined };
    });

    const conflicts = calculateConflicts();

    if (conflicts.size > 0) {
      const conflictingIds = new Set<string>();
      for (const ids of conflicts.values()) {
        ids.forEach((id) => conflictingIds.add(id));
      }

      files = files.map((file) => {
        if (conflictingIds.has(file.id)) {
          return { ...file, status: 'conflict' as const };
        }
        return file;
      });
    }
  }

  const workspace = {
    get files() {
      return files;
    },

    get sortedFiles(): RenameFile[] {
      const sorted = [...files];

      sorted.sort((a, b) => {
        return compareRenameFiles(a, b, sortConfig);
      });

      return sorted;
    },

    get filteredFiles(): RenameFile[] {
      const query = searchQuery.toLowerCase().trim();
      if (!query) {
        return workspace.sortedFiles;
      }

      return workspace.sortedFiles.filter((file) =>
        file.originalName.toLowerCase().includes(query)
        || file.newName.toLowerCase().includes(query),
      );
    },

    get selectedFiles(): RenameFile[] {
      return files.filter((file) => file.selected);
    },

    get selectedCount(): number {
      return files.filter((file) => file.selected).length;
    },

    get rules() {
      return rules;
    },

    get enabledRules(): RenameRule[] {
      return rules.filter((rule) => rule.enabled);
    },

    get mode() {
      return mode;
    },

    get outputDir() {
      return outputDir;
    },

    get searchQuery() {
      return searchQuery;
    },

    get progress() {
      return progress;
    },

    get hasConflicts(): boolean {
      return files.some((file) => file.status === 'conflict');
    },

    get conflictCount(): number {
      return files.filter((file) => file.status === 'conflict').length;
    },

    get seriesResolutions(): SeriesGroupResolution[] {
      return planSeriesNumbering(files, sortConfig, seasonAssignments).resolutions;
    },

    get seriesIssues(): SeriesNumberingIssue[] {
      return planSeriesNumbering(files, sortConfig, seasonAssignments).issues;
    },

    get hasSeriesNumberingIssues(): boolean {
      return workspace.seriesIssues.length > 0;
    },

    get hasBlockingIssues(): boolean {
      const hasEnabledSeriesRule = rules.some((rule) => rule.enabled && rule.type === 'series-number');
      return workspace.hasConflicts || (hasEnabledSeriesRule && workspace.hasSeriesNumberingIssues);
    },

    get isProcessing(): boolean {
      return progress.status === 'processing';
    },

    get hasChanges(): boolean {
      const pathOptions = getTargetPathOptions();
      return files.some((file) => file.selected && hasRenameTargetChange(file, pathOptions));
    },

    get sortConfig(): SortConfig {
      return sortConfig;
    },

    getTargetPath(file: RenameFile): string {
      return buildNewPath(file, getTargetPathOptions());
    },

    setSeasonAssignment(groupKey: string, seasonNumber: number): void {
      if (!Number.isInteger(seasonNumber) || seasonNumber < 1) {
        return;
      }

      const normalizedGroupKey = normalizePathForIdentity(groupKey);
      seasonAssignments = new Map(seasonAssignments).set(normalizedGroupKey, seasonNumber);
      scheduleRecalculation();
    },

    clearSeasonAssignment(groupKey: string): void {
      const normalizedGroupKey = normalizePathForIdentity(groupKey);
      if (!seasonAssignments.has(normalizedGroupKey)) {
        return;
      }

      const nextAssignments = new Map(seasonAssignments);
      nextAssignments.delete(normalizedGroupKey);
      seasonAssignments = nextAssignments;
      scheduleRecalculation();
    },

    assignSeasonsSequentially(): void {
      seasonAssignments = assignSeriesSeasonsSequentially(files);
      scheduleRecalculation();
    },

    getConflicts(sourceFiles: RenameFile[] = files): Map<string, string[]> {
      return calculateConflicts(sourceFiles);
    },

    addFiles(newFiles: RenameFile[]) {
      const existingPaths = new Set(files.map((file) => file.originalPath));
      const uniqueFiles = newFiles.filter((file) => !existingPaths.has(file.originalPath));

      files = [...files, ...uniqueFiles];
      pruneSeasonAssignments();
      scheduleRecalculation();
    },

    replaceFiles(newFiles: RenameFile[], replaceOptions: ReplaceFilesOptions = {}) {
      const { preserveSelection = true } = replaceOptions;
      const currentFiles = untrack(() => files);
      const existingById = new Map(currentFiles.map((file) => [file.id, file]));
      const existingByPath = new Map(currentFiles.map((file) => [file.originalPath, file]));

      const nextFiles = newFiles.map((file) => {
        const existing = existingById.get(file.id) ?? existingByPath.get(file.originalPath);
        return {
          ...file,
          selected: preserveSelection ? existing?.selected ?? file.selected : file.selected,
          status: 'pending' as const,
          error: undefined,
        };
      });

      if (areSourceFileListsEquivalent(currentFiles, nextFiles)) {
        return;
      }

      files = nextFiles;

      pruneSeasonAssignments();
      scheduleRecalculation();
    },

    removeFile(id: string) {
      files = files.filter((file) => file.id !== id);
      pruneSeasonAssignments();
      scheduleRecalculation();
    },

    removeSelected() {
      files = files.filter((file) => !file.selected);
      pruneSeasonAssignments();
      scheduleRecalculation();
    },

    toggleFileSelection(id: string) {
      files = files.map((file) =>
        file.id === id ? { ...file, selected: !file.selected } : file,
      );
      scheduleRecalculation();
    },

    setFileSelection(id: string, selected: boolean) {
      files = files.map((file) =>
        file.id === id ? { ...file, selected } : file,
      );
      scheduleRecalculation();
    },

    selectAll() {
      files = files.map((file) => ({ ...file, selected: true }));
      scheduleRecalculation();
    },

    deselectAll() {
      files = files.map((file) => ({ ...file, selected: false }));
      scheduleRecalculation();
    },

    invertSelection() {
      files = files.map((file) => ({ ...file, selected: !file.selected }));
      scheduleRecalculation();
    },

    clear() {
      files = [];
      seasonAssignments = new Map();
      progress = createDefaultProgressState();
    },

    setSearchQuery(query: string) {
      searchQuery = query;
    },

    setSort(field: SortField, direction: SortDirection) {
      sortConfig = { field, direction };
      scheduleRecalculation();
    },

    toggleSortDirection() {
      sortConfig = {
        ...sortConfig,
        direction: sortConfig.direction === 'asc' ? 'desc' : 'asc',
      };
      scheduleRecalculation();
    },

    addRule(type: RuleType) {
      const newRule: RenameRule = {
        id: generateId(),
        type,
        enabled: true,
        config: { ...DEFAULT_RULE_CONFIGS[type] },
      };

      rules = [...rules, newRule];
      scheduleRecalculation();
    },

    removeRule(id: string) {
      rules = rules.filter((rule) => rule.id !== id);
      scheduleRecalculation();
    },

    updateRule(id: string, updates: Partial<RenameRule>) {
      rules = rules.map((rule) =>
        rule.id === id ? { ...rule, ...updates } : rule,
      );
      scheduleRecalculation();
    },

    updateRuleConfig(id: string, config: RuleConfig) {
      rules = rules.map((rule) =>
        rule.id === id ? { ...rule, config } : rule,
      );
      scheduleRecalculation();
    },

    toggleRule(id: string) {
      rules = rules.map((rule) =>
        rule.id === id ? { ...rule, enabled: !rule.enabled } : rule,
      );
      scheduleRecalculation();
    },

    moveRule(fromIndex: number, toIndex: number) {
      if (fromIndex === toIndex) return;
      if (fromIndex < 0 || fromIndex >= rules.length) return;
      if (toIndex < 0 || toIndex >= rules.length) return;

      const newRules = [...rules];
      const [removed] = newRules.splice(fromIndex, 1);
      newRules.splice(toIndex, 0, removed);

      rules = newRules;
      scheduleRecalculation();
    },

    reorderRules(newRules: RenameRule[]) {
      rules = newRules;
      scheduleRecalculation();
    },

    duplicateRule(id: string) {
      const rule = rules.find((item) => item.id === id);
      if (!rule) return;

      const newRule: RenameRule = {
        ...rule,
        id: generateId(),
        config: { ...rule.config },
      };

      const index = rules.findIndex((item) => item.id === id);
      const newRules = [...rules];
      newRules.splice(index + 1, 0, newRule);

      rules = newRules;
      scheduleRecalculation();
    },

    clearRules() {
      rules = [];
      scheduleRecalculation();
    },

    setMode(newMode: RenameMode) {
      mode = newMode;
      scheduleRecalculation();
    },

    setOutputDir(dir: string) {
      if (outputDir === dir) {
        return;
      }

      outputDir = dir;
      scheduleRecalculation();
    },

    updateProgress(updates: Partial<RenameProgress>) {
      progress = { ...progress, ...updates };
    },

    startProcessingRun(total: number, totalBytes: number) {
      abortController = new AbortController();
      progress = {
        ...createDefaultProgressState('processing'),
        total: Math.max(0, total),
        totalBytes: Math.max(0, totalBytes),
      };
    },

    setCurrentFile(file: RenameFile) {
      progress = {
        ...progress,
        currentFile: file.originalName,
        currentFileId: file.id,
        currentFilePath: file.originalPath,
        currentFileProgress: 0,
        currentSpeedBytesPerSec: undefined,
        currentFileBytesCopied: 0,
        currentFileTotalBytes: Math.max(0, file.size ?? 0),
      };
    },

    updateCurrentCopyProgress(
      sourcePath: string,
      bytesCopied: number,
      totalBytes: number,
      fileProgress: number,
      speedBytesPerSec?: number,
    ) {
      if (progress.status !== 'processing' || progress.currentFilePath !== sourcePath) {
        return;
      }

      const normalizedTotalBytes = Math.max(0, totalBytes);
      const effectiveTotalBytes = Math.max(normalizedTotalBytes, progress.currentFileTotalBytes);
      const normalizedBytesCopied = Math.max(0, Math.floor(bytesCopied));
      const clampedBytesCopied =
        effectiveTotalBytes > 0
          ? Math.min(normalizedBytesCopied, effectiveTotalBytes)
          : normalizedBytesCopied;

      progress = {
        ...progress,
        currentFileProgress: clampPercentage(fileProgress),
        currentSpeedBytesPerSec:
          speedBytesPerSec && Number.isFinite(speedBytesPerSec) && speedBytesPerSec > 0
            ? speedBytesPerSec
            : undefined,
        currentFileBytesCopied: clampedBytesCopied,
        currentFileTotalBytes: effectiveTotalBytes,
      };
    },

    markCurrentFileProcessed(outcome: CurrentFileOutcome = 'success') {
      const shouldAdvanceCurrent = outcome !== 'cancelled';
      const bytesToCredit = outcome === 'success'
        ? Math.max(0, progress.currentFileTotalBytes)
        : 0;
      const nextCompletedBytes = progress.completedBytes + bytesToCredit;

      progress = {
        ...progress,
        current: shouldAdvanceCurrent
          ? Math.min(progress.total, progress.current + 1)
          : progress.current,
        completedBytes:
          progress.totalBytes > 0
            ? Math.min(progress.totalBytes, nextCompletedBytes)
            : nextCompletedBytes,
        currentFile: undefined,
        currentFileId: undefined,
        currentFilePath: undefined,
        currentFileProgress: 0,
        currentSpeedBytesPerSec: undefined,
        currentFileBytesCopied: 0,
        currentFileTotalBytes: 0,
      };
    },

    startProcessing() {
      abortController = new AbortController();
      progress = {
        ...createDefaultProgressState('processing'),
        total: progress.total,
        totalBytes: progress.totalBytes,
      };
    },

    cancelProcessing() {
      if (abortController && !abortController.signal.aborted) {
        abortController.abort();
      }
    },

    get isCancelled(): boolean {
      return abortController?.signal?.aborted || progress.status === 'cancelled';
    },

    get signal(): AbortSignal | undefined {
      return abortController?.signal;
    },

    setFileStatus(id: string, status: RenameFile['status'], error?: string) {
      files = files.map((file) =>
        file.id === id ? { ...file, status, error } : file,
      );
    },

    markFileComplete(id: string, success: boolean, error?: string) {
      files = files.map((file) =>
        file.id === id
          ? {
              ...file,
              status: success ? 'success' : 'error',
              error,
            }
          : file,
      );
    },

    recalculate() {
      scheduleRecalculation();
    },

    recalculateImmediate() {
      if (recalculateTimeoutId !== null) {
        clearTimeout(recalculateTimeoutId);
        recalculateTimeoutId = null;
      }
      performRecalculation();
    },

    reset() {
      files = [];
      rules = [];
      mode = 'rename';
      outputDir = '';
      searchQuery = '';
      progress = createDefaultProgressState();
      seasonAssignments = new Map();
    },

    resetProgress() {
      abortController = null;
      progress = createDefaultProgressState();
      files = files.map((file) => ({ ...file, status: 'pending' as const, error: undefined }));
    },

    importFromPaths(paths: string[]) {
      const newFiles = paths.map((path) => {
        const filename = path.split(/[/\\]/).pop() || path;
        const lastDot = filename.lastIndexOf('.');
        const baseName = lastDot > 0 ? filename.substring(0, lastDot) : filename;
        const extension = lastDot > 0 ? filename.substring(lastDot) : '';

        return {
          id: generateId(),
          originalPath: path,
          originalName: baseName,
          extension,
          newName: baseName,
          selected: true,
          status: 'pending' as const,
          sourceGroup: sourceGroupForDirectFileParent(path),
        } as RenameFile;
      });

      files = newFiles;
      seasonAssignments = new Map();
      scheduleRecalculation();
    },

    get presets(): RulePreset[] {
      return [...BUILT_IN_PRESETS, ...userPresets];
    },

    get userPresets(): RulePreset[] {
      return userPresets;
    },

    get presetsLoaded(): boolean {
      return presetsLoaded;
    },

    async loadPresets() {
      ensurePresetSubscription();

      if (presetsLoaded) return;

      try {
        userPresets = await loadUserPresets();
        presetsLoaded = true;
      } catch (error) {
        console.error('Failed to load presets:', error);
        userPresets = [];
        presetsLoaded = true;
      }
    },

    applyPreset(presetId: string) {
      const allPresets = [...BUILT_IN_PRESETS, ...userPresets];
      const preset = allPresets.find((item) => item.id === presetId);

      if (!preset) {
        console.error('Preset not found:', presetId);
        return;
      }

      rules = preset.rules.map((rule) => ({
        id: generateId(),
        type: rule.type,
        enabled: rule.enabled,
        config: { ...rule.config },
      }));

      scheduleRecalculation();
    },

    async saveAsPreset(name: string, description: string): Promise<RulePreset | null> {
      try {
        return await savePresetToStorage(name, description, rules);
      } catch (error) {
        console.error('Failed to save preset:', error);
        return null;
      }
    },

    async updatePreset(
      presetId: string,
      updates: { name?: string; description?: string; saveRules?: boolean },
    ): Promise<boolean> {
      try {
        const updatePayload: Parameters<typeof updatePresetInStorage>[1] = {};

        if (updates.name !== undefined) updatePayload.name = updates.name;
        if (updates.description !== undefined) updatePayload.description = updates.description;
        if (updates.saveRules) updatePayload.rules = rules;

        const updated = await updatePresetInStorage(presetId, updatePayload);
        return updated !== null;
      } catch (error) {
        console.error('Failed to update preset:', error);
        return false;
      }
    },

    async deletePreset(presetId: string): Promise<boolean> {
      try {
        return await deletePresetFromStorage(presetId);
      } catch (error) {
        console.error('Failed to delete preset:', error);
        return false;
      }
    },

    destroy() {
      if (recalculateTimeoutId !== null) {
        clearTimeout(recalculateTimeoutId);
        recalculateTimeoutId = null;
      }

      unsubscribePresetChanges?.();
      unsubscribePresetChanges = null;
    },
  };

  return workspace;
}

export type RenameWorkspaceStore = ReturnType<typeof createRenameWorkspaceStore>;
