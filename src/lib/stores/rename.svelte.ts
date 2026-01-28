/**
 * Rename Store - Svelte 5 runes state management for the Rename tool
 */

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
  detectConflicts,
  naturalCompare,
  generateId,
} from '$lib/services/rename';
import {
  loadUserPresets,
  savePreset as savePresetToStorage,
  deletePreset as deletePresetFromStorage,
  updatePreset as updatePresetInStorage,
} from '$lib/services/presets';

// State
let files = $state<RenameFile[]>([]);
let rules = $state<RenameRule[]>([]);
let mode = $state<RenameMode>('rename');
let outputDir = $state<string>('');
let searchQuery = $state<string>('');
let sortConfig = $state<SortConfig>({ field: 'name', direction: 'asc' });
let progress = $state<RenameProgress>({
  status: 'idle',
  current: 0,
  total: 0,
});

// AbortController for cancelling rename operations
let abortController = $state<AbortController | null>(null);

// Presets state
let userPresets = $state<RulePreset[]>([]);
let presetsLoaded = $state(false);

// ============================================================================
// DEBOUNCED RECALCULATION
// ============================================================================

const RECALCULATE_DEBOUNCE_MS = 50;
let recalculateTimeoutId: ReturnType<typeof setTimeout> | null = null;
let isRecalculating = false;

/**
 * Schedule a debounced recalculation of new names
 * Multiple calls within the debounce window will only trigger one recalculation
 */
function scheduleRecalculation(): void {
  // Clear any pending recalculation
  if (recalculateTimeoutId !== null) {
    clearTimeout(recalculateTimeoutId);
  }
  
  recalculateTimeoutId = setTimeout(() => {
    recalculateTimeoutId = null;
    performRecalculation();
  }, RECALCULATE_DEBOUNCE_MS);
}

/**
 * Perform immediate recalculation (bypasses debounce)
 * Use this when you need results immediately (e.g., before starting a rename operation)
 */
function performRecalculation(): void {
  if (isRecalculating) return;
  isRecalculating = true;
  
  try {
    recalculateNewNamesInternal();
  } finally {
    isRecalculating = false;
  }
}

/**
 * Internal recalculation logic
 */
function recalculateNewNamesInternal(): void {
  const enabledRules = rules.filter(r => r.enabled);
  
  // Get sorted selected files for proper numbering (respects current sort config)
  const { field, direction } = sortConfig;
  const multiplier = direction === 'asc' ? 1 : -1;
  
  const sortedSelectedFiles = [...files]
    .filter(f => f.selected)
    .sort((a, b) => {
      switch (field) {
        case 'name':
          return multiplier * naturalCompare(a.originalName, b.originalName);
        case 'size':
          return multiplier * ((a.size ?? 0) - (b.size ?? 0));
        case 'date':
          const dateA = a.modifiedAt?.getTime() ?? 0;
          const dateB = b.modifiedAt?.getTime() ?? 0;
          return multiplier * (dateA - dateB);
        default:
          return 0;
      }
    });
  
  const indexMap = new Map<string, number>();
  sortedSelectedFiles.forEach((f, i) => indexMap.set(f.id, i));
  
  files = files.map(file => {
    if (!file.selected) {
      return { ...file, newName: file.originalName, status: 'pending' as const };
    }
    
    const index = indexMap.get(file.id) ?? 0;
    const newName = applyAllRules(file.originalName, enabledRules, index, file);
    
    return { ...file, newName, status: 'pending' as const };
  });
  
  // Detect and mark conflicts
  const conflicts = detectConflicts(files);
  if (conflicts.size > 0) {
    const conflictingIds = new Set<string>();
    for (const ids of conflicts.values()) {
      ids.forEach(id => conflictingIds.add(id));
    }
    
    files = files.map(file => {
      if (conflictingIds.has(file.id)) {
        return { ...file, status: 'conflict' as const };
      }
      return file;
    });
  }
}

export const renameStore = {
  // ============ Getters ============
  
  get files() {
    return files;
  },
  
  get sortedFiles(): RenameFile[] {
    const sorted = [...files];
    const { field, direction } = sortConfig;
    const multiplier = direction === 'asc' ? 1 : -1;
    
    sorted.sort((a, b) => {
      switch (field) {
        case 'name':
          return multiplier * naturalCompare(a.originalName, b.originalName);
        case 'size':
          return multiplier * ((a.size ?? 0) - (b.size ?? 0));
        case 'date':
          const dateA = a.modifiedAt?.getTime() ?? 0;
          const dateB = b.modifiedAt?.getTime() ?? 0;
          return multiplier * (dateA - dateB);
        default:
          return 0;
      }
    });
    
    return sorted;
  },
  
  get filteredFiles(): RenameFile[] {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return this.sortedFiles;
    
    return this.sortedFiles.filter(f => 
      f.originalName.toLowerCase().includes(query) ||
      f.newName.toLowerCase().includes(query)
    );
  },
  
  get selectedFiles(): RenameFile[] {
    return files.filter(f => f.selected);
  },
  
  get selectedCount(): number {
    return files.filter(f => f.selected).length;
  },
  
  get rules() {
    return rules;
  },
  
  get enabledRules(): RenameRule[] {
    return rules.filter(r => r.enabled);
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
    return files.some(f => f.status === 'conflict');
  },
  
  get conflictCount(): number {
    return files.filter(f => f.status === 'conflict').length;
  },
  
  get isProcessing(): boolean {
    return progress.status === 'processing';
  },
  
  get hasChanges(): boolean {
    return files.some(f => f.selected && f.originalName !== f.newName);
  },
  
  get sortConfig(): SortConfig {
    return sortConfig;
  },
  
  // ============ File Management ============
  
  addFiles(newFiles: RenameFile[]) {
    // Filter out duplicates by path
    const existingPaths = new Set(files.map(f => f.originalPath));
    const uniqueFiles = newFiles.filter(f => !existingPaths.has(f.originalPath));
    
    files = [...files, ...uniqueFiles];
    scheduleRecalculation();
  },
  
  removeFile(id: string) {
    files = files.filter(f => f.id !== id);
    scheduleRecalculation();
  },
  
  removeSelected() {
    files = files.filter(f => !f.selected);
    scheduleRecalculation();
  },
  
  toggleFileSelection(id: string) {
    files = files.map(f => 
      f.id === id ? { ...f, selected: !f.selected } : f
    );
    scheduleRecalculation();
  },
  
  setFileSelection(id: string, selected: boolean) {
    files = files.map(f => 
      f.id === id ? { ...f, selected } : f
    );
    scheduleRecalculation();
  },
  
  selectAll() {
    files = files.map(f => ({ ...f, selected: true }));
    scheduleRecalculation();
  },
  
  deselectAll() {
    files = files.map(f => ({ ...f, selected: false }));
    scheduleRecalculation();
  },
  
  invertSelection() {
    files = files.map(f => ({ ...f, selected: !f.selected }));
    scheduleRecalculation();
  },
  
  clear() {
    files = [];
    progress = { status: 'idle', current: 0, total: 0 };
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
      direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' 
    };
    scheduleRecalculation();
  },
  
  // ============ Rule Management ============
  
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
    rules = rules.filter(r => r.id !== id);
    scheduleRecalculation();
  },
  
  updateRule(id: string, updates: Partial<RenameRule>) {
    rules = rules.map(r => 
      r.id === id ? { ...r, ...updates } : r
    );
    scheduleRecalculation();
  },
  
  updateRuleConfig(id: string, config: RuleConfig) {
    rules = rules.map(r => 
      r.id === id ? { ...r, config } : r
    );
    scheduleRecalculation();
  },
  
  toggleRule(id: string) {
    rules = rules.map(r => 
      r.id === id ? { ...r, enabled: !r.enabled } : r
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
  
  /**
   * Reorder rules based on new array (used by drag-and-drop)
   */
  reorderRules(newRules: RenameRule[]) {
    rules = newRules;
    scheduleRecalculation();
  },
  
  duplicateRule(id: string) {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    
    const newRule: RenameRule = {
      ...rule,
      id: generateId(),
      config: { ...rule.config },
    };
    
    const index = rules.findIndex(r => r.id === id);
    const newRules = [...rules];
    newRules.splice(index + 1, 0, newRule);
    
    rules = newRules;
    scheduleRecalculation();
  },
  
  clearRules() {
    rules = [];
    scheduleRecalculation();
  },
  
  // ============ Mode & Output ============
  
  setMode(newMode: RenameMode) {
    mode = newMode;
  },
  
  setOutputDir(dir: string) {
    outputDir = dir;
  },
  
  // ============ Progress & Status ============
  
  updateProgress(updates: Partial<RenameProgress>) {
    progress = { ...progress, ...updates };
  },
  
  /**
   * Start processing and create a new AbortController
   */
  startProcessing() {
    abortController = new AbortController();
    progress = { ...progress, status: 'processing' };
  },
  
  /**
   * Cancel the current processing operation
   */
  cancelProcessing() {
    if (abortController) {
      abortController.abort();
      // Note: Don't set abortController to null here!
      // The loop needs to check isCancelled which reads from the signal.
      // abortController will be reset in startProcessing() or resetProgress()
    }
    progress = { ...progress, status: 'cancelled' };
  },
  
  /**
   * Check if the current operation has been cancelled
   */
  get isCancelled(): boolean {
    // Check both the abort signal AND the progress status
    // The status check is a fallback in case abortController was reset
    return abortController?.signal?.aborted || progress.status === 'cancelled';
  },
  
  /**
   * Get the abort signal for the current operation
   */
  get signal(): AbortSignal | undefined {
    return abortController?.signal;
  },
  
  setFileStatus(id: string, status: RenameFile['status'], error?: string) {
    files = files.map(f => 
      f.id === id ? { ...f, status, error } : f
    );
  },
  
  markFileComplete(id: string, success: boolean, error?: string) {
    files = files.map(f => 
      f.id === id ? { 
        ...f, 
        status: success ? 'success' : 'error',
        error,
      } : f
    );
  },
  
  // ============ Recalculate ============
  
  /**
   * Schedule a debounced recalculation (default behavior)
   */
  recalculate() {
    scheduleRecalculation();
  },
  
  /**
   * Force immediate recalculation, bypassing debounce
   * Use before operations that need up-to-date new names
   */
  recalculateImmediate() {
    // Clear any pending debounced recalculation
    if (recalculateTimeoutId !== null) {
      clearTimeout(recalculateTimeoutId);
      recalculateTimeoutId = null;
    }
    performRecalculation();
  },
  
  // ============ Reset ============
  
  reset() {
    files = [];
    rules = [];
    mode = 'rename';
    outputDir = '';
    searchQuery = '';
    progress = { status: 'idle', current: 0, total: 0 };
  },
  
  resetProgress() {
    abortController = null;
    progress = { status: 'idle', current: 0, total: 0 };
    files = files.map(f => ({ ...f, status: 'pending' as const, error: undefined }));
  },
  
  // ============ Import from other tools ============
  
  /**
   * Import files from extraction tool
   */
  importFromPaths(paths: string[]) {
    const newFiles = paths.map(path => {
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
      } as RenameFile;
    });
    
    // Clear existing files and replace with new ones
    files = newFiles;
    scheduleRecalculation();
  },
  
  // ============ Presets ============
  
  get presets(): RulePreset[] {
    return [...BUILT_IN_PRESETS, ...userPresets];
  },
  
  get userPresets(): RulePreset[] {
    return userPresets;
  },
  
  get presetsLoaded(): boolean {
    return presetsLoaded;
  },
  
  /**
   * Load user presets from storage
   */
  async loadPresets() {
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
  
  /**
   * Apply a preset to the current rules
   */
  applyPreset(presetId: string) {
    const allPresets = [...BUILT_IN_PRESETS, ...userPresets];
    const preset = allPresets.find(p => p.id === presetId);
    
    if (!preset) {
      console.error('Preset not found:', presetId);
      return;
    }
    
    // Convert preset rules to full rules with IDs
    rules = preset.rules.map(rule => ({
      id: generateId(),
      type: rule.type,
      enabled: rule.enabled,
      config: { ...rule.config },
    }));
    
    scheduleRecalculation();
  },
  
  /**
   * Save current rules as a new preset
   */
  async saveAsPreset(name: string, description: string): Promise<RulePreset | null> {
    try {
      const preset = await savePresetToStorage(name, description, rules);
      userPresets = [...userPresets, preset];
      return preset;
    } catch (error) {
      console.error('Failed to save preset:', error);
      return null;
    }
  },
  
  /**
   * Update an existing user preset with current rules
   */
  async updatePreset(
    presetId: string, 
    updates: { name?: string; description?: string; saveRules?: boolean }
  ): Promise<boolean> {
    try {
      const updatePayload: Parameters<typeof updatePresetInStorage>[1] = {};
      
      if (updates.name !== undefined) updatePayload.name = updates.name;
      if (updates.description !== undefined) updatePayload.description = updates.description;
      if (updates.saveRules) updatePayload.rules = rules;
      
      const updated = await updatePresetInStorage(presetId, updatePayload);
      
      if (updated) {
        userPresets = userPresets.map(p => p.id === presetId ? updated : p);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update preset:', error);
      return false;
    }
  },
  
  /**
   * Delete a user preset
   */
  async deletePreset(presetId: string): Promise<boolean> {
    try {
      const success = await deletePresetFromStorage(presetId);
      if (success) {
        userPresets = userPresets.filter(p => p.id !== presetId);
      }
      return success;
    } catch (error) {
      console.error('Failed to delete preset:', error);
      return false;
    }
  },
};
