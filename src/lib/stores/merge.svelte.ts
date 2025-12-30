import type { MergeSourceFile, MergeTrack, MergeTrackConfig, MergeOutputConfig } from '$lib/types';

// État du merge
let sourceFiles = $state<MergeSourceFile[]>([]);
let selectedFileId = $state<string | null>(null);
let trackConfigs = $state<Map<string, MergeTrackConfig>>(new Map());
let outputConfig = $state<MergeOutputConfig>({
  outputPath: '',
  outputName: '',
  tracks: []
});
let status = $state<'idle' | 'processing' | 'completed' | 'error'>('idle');
let progress = $state(0);
let error = $state<string | null>(null);

// Counter pour générer des IDs uniques
let idCounter = 0;
function generateId(): string {
  return `merge-${Date.now()}-${++idCounter}`;
}

export const mergeStore = {
  get sourceFiles() {
    return sourceFiles;
  },

  get selectedFileId() {
    return selectedFileId;
  },

  get selectedFile(): MergeSourceFile | undefined {
    return sourceFiles.find(f => f.id === selectedFileId);
  },

  get trackConfigs() {
    return trackConfigs;
  },

  get outputConfig() {
    return outputConfig;
  },

  get status() {
    return status;
  },

  get progress() {
    return progress;
  },

  get error() {
    return error;
  },

  get isProcessing() {
    return status === 'processing';
  },

  // Obtenir toutes les tracks de tous les fichiers
  get allTracks(): MergeTrack[] {
    return sourceFiles.flatMap(f => f.tracks);
  },

  // Obtenir les tracks activées et triées par ordre
  get enabledTracks(): MergeTrackConfig[] {
    return Array.from(trackConfigs.values())
      .filter(tc => tc.enabled)
      .sort((a, b) => a.order - b.order);
  },

  // File management
  addFile(file: Omit<MergeSourceFile, 'id'>) {
    const newFile: MergeSourceFile = {
      ...file,
      id: generateId()
    };
    sourceFiles = [...sourceFiles, newFile];

    // Auto-select if first file
    if (sourceFiles.length === 1) {
      selectedFileId = newFile.id;
    }

    return newFile.id;
  },

  updateFile(fileId: string, updates: Partial<MergeSourceFile>) {
    sourceFiles = sourceFiles.map(f =>
      f.id === fileId ? { ...f, ...updates } : f
    );
  },

  removeFile(fileId: string) {
    // Remove track configs for this file
    const file = sourceFiles.find(f => f.id === fileId);
    if (file) {
      trackConfigs = new Map(trackConfigs);
      for (const track of file.tracks) {
        trackConfigs.delete(track.id);
      }
    }

    sourceFiles = sourceFiles.filter(f => f.id !== fileId);

    if (selectedFileId === fileId) {
      selectedFileId = sourceFiles.length > 0 ? sourceFiles[0].id : null;
    }
  },

  selectFile(fileId: string | null) {
    selectedFileId = fileId;
  },

  // Track configuration
  initTrackConfig(track: MergeTrack) {
    if (!trackConfigs.has(track.id)) {
      const config: MergeTrackConfig = {
        trackId: track.id,
        enabled: true,
        language: track.language,
        title: track.title,
        default: track.default,
        forced: track.forced,
        delayMs: 0,
        order: trackConfigs.size
      };
      trackConfigs = new Map(trackConfigs);
      trackConfigs.set(track.id, config);
    }
  },

  updateTrackConfig(trackId: string, updates: Partial<MergeTrackConfig>) {
    const current = trackConfigs.get(trackId);
    if (current) {
      trackConfigs = new Map(trackConfigs);
      trackConfigs.set(trackId, { ...current, ...updates });
    }
  },

  toggleTrack(trackId: string) {
    const current = trackConfigs.get(trackId);
    if (current) {
      trackConfigs = new Map(trackConfigs);
      trackConfigs.set(trackId, { ...current, enabled: !current.enabled });
    }
  },

  getTrackConfig(trackId: string): MergeTrackConfig | undefined {
    return trackConfigs.get(trackId);
  },

  // Reorder tracks
  reorderTrack(trackId: string, newOrder: number) {
    const configs = Array.from(trackConfigs.values());
    const currentConfig = configs.find(c => c.trackId === trackId);
    if (!currentConfig) return;

    const oldOrder = currentConfig.order;

    trackConfigs = new Map(trackConfigs);

    for (const config of configs) {
      let order = config.order;
      if (config.trackId === trackId) {
        order = newOrder;
      } else if (oldOrder < newOrder && config.order > oldOrder && config.order <= newOrder) {
        order = config.order - 1;
      } else if (oldOrder > newOrder && config.order < oldOrder && config.order >= newOrder) {
        order = config.order + 1;
      }
      trackConfigs.set(config.trackId, { ...config, order });
    }
  },

  // Output configuration
  setOutputPath(path: string) {
    outputConfig = { ...outputConfig, outputPath: path };
  },

  setOutputName(name: string) {
    outputConfig = { ...outputConfig, outputName: name };
  },

  setOutputTitle(title: string) {
    outputConfig = { ...outputConfig, title };
  },

  // Status management
  setStatus(newStatus: typeof status) {
    status = newStatus;
  },

  setProgress(value: number) {
    progress = value;
  },

  setError(err: string | null) {
    error = err;
    if (err) {
      status = 'error';
    }
  },

  // Reset
  reset() {
    sourceFiles = [];
    selectedFileId = null;
    trackConfigs = new Map();
    outputConfig = {
      outputPath: '',
      outputName: '',
      tracks: []
    };
    status = 'idle';
    progress = 0;
    error = null;
  },

  clearFiles() {
    sourceFiles = [];
    selectedFileId = null;
    trackConfigs = new Map();
    status = 'idle';
    progress = 0;
    error = null;
  }
};

