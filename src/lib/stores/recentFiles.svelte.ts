/**
 * Centralized store for recently created files from extraction and merge operations.
 * The Rename tool can import files from this list instead of direct integration.
 */

export interface RecentFile {
  path: string;
  name: string;
  source: 'extraction' | 'merge';
  addedAt: number;
}

let extractedFiles = $state<RecentFile[]>([]);
let mergedFiles = $state<RecentFile[]>([]);

function getFileName(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path;
}

export const recentFilesStore = {
  get extractedFiles() {
    return extractedFiles;
  },

  get mergedFiles() {
    return mergedFiles;
  },

  get hasExtractedFiles() {
    return extractedFiles.length > 0;
  },

  get hasMergedFiles() {
    return mergedFiles.length > 0;
  },

  /**
   * Add extracted files to the recent list.
   * Replaces any previous extracted files.
   */
  addExtractedFiles(paths: string[]) {
    const now = Date.now();
    extractedFiles = paths.map(path => ({
      path,
      name: getFileName(path),
      source: 'extraction' as const,
      addedAt: now
    }));
  },

  /**
   * Add merged files to the recent list.
   * Replaces any previous merged files.
   */
  addMergedFiles(paths: string[]) {
    const now = Date.now();
    mergedFiles = paths.map(path => ({
      path,
      name: getFileName(path),
      source: 'merge' as const,
      addedAt: now
    }));
  },

  /**
   * Clear extracted files from the recent list.
   */
  clearExtracted() {
    extractedFiles = [];
  },

  /**
   * Clear merged files from the recent list.
   */
  clearMerged() {
    mergedFiles = [];
  },

  /**
   * Clear all recent files.
   */
  clearAll() {
    extractedFiles = [];
    mergedFiles = [];
  },

  /**
   * Remove specific files from both lists.
   * Useful after files have been renamed.
   */
  removeFiles(paths: string[]) {
    const pathSet = new Set(paths);
    extractedFiles = extractedFiles.filter(f => !pathSet.has(f.path));
    mergedFiles = mergedFiles.filter(f => !pathSet.has(f.path));
  }
};
