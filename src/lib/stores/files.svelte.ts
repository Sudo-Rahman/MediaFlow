import type { VideoFile } from '$lib/types';

// État réactif avec Svelte 5 runes
let files = $state<VideoFile[]>([]);
let selectedFilePath = $state<string | null>(null);

// Index Map for O(1) lookups by path
let filesByPath = $state<Map<string, VideoFile>>(new Map());

/**
 * Rebuild the index Map from the files array
 */
function rebuildIndex(): void {
  filesByPath = new Map(files.map(f => [f.path, f]));
}

export const fileListStore = {
  get files() {
    return files;
  },

  get selectedFilePath() {
    return selectedFilePath;
  },

  get selectedFile(): VideoFile | undefined {
    // O(1) lookup using index
    return selectedFilePath ? filesByPath.get(selectedFilePath) : undefined;
  },

  addFiles(newFiles: VideoFile[]) {
    // Use index for O(1) duplicate check
    const filesToAdd = newFiles.filter(f => !filesByPath.has(f.path));
    if (filesToAdd.length === 0) return;
    
    files = [...files, ...filesToAdd];
    
    // Update index with new files
    for (const file of filesToAdd) {
      filesByPath.set(file.path, file);
    }
    // Trigger reactivity for the Map
    filesByPath = new Map(filesByPath);
  },

  updateFile(path: string, updates: Partial<VideoFile>) {
    const existingFile = filesByPath.get(path);
    if (!existingFile) return;
    
    const updatedFile = { ...existingFile, ...updates };
    
    files = files.map(f => f.path === path ? updatedFile : f);
    
    // Update index
    filesByPath.set(path, updatedFile);
    filesByPath = new Map(filesByPath);
  },

  removeFile(path: string) {
    files = files.filter(f => f.path !== path);
    filesByPath.delete(path);
    filesByPath = new Map(filesByPath);
    
    if (selectedFilePath === path) {
      selectedFilePath = files.length > 0 ? files[0].path : null;
    }
  },

  selectFile(path: string | null) {
    selectedFilePath = path;
  },

  clear() {
    files = [];
    filesByPath = new Map();
    selectedFilePath = null;
  },

  getFileByPath(path: string): VideoFile | undefined {
    // O(1) lookup using index
    return filesByPath.get(path);
  },
  
  /**
   * Check if a file with the given path exists
   * O(1) lookup
   */
  hasFile(path: string): boolean {
    return filesByPath.has(path);
  }
};

