import type { ExtractionProgress, ExtractionResult, FileRunState } from '$lib/types';

// État de l'extraction
let outputDir = $state<string>('');
let selectedTracks = $state<Map<string, number[]>>(new Map());
let fileRunStates = $state<Map<string, FileRunState>>(new Map());
let progress = $state<ExtractionProgress>({
  currentFile: '',
  currentFileIndex: 0,
  totalFiles: 0,
  currentTrack: 0,
  totalTracks: 0,
  completedTracks: 0,
  currentTrackProgress: 0,
  currentFileProgress: 0,
  status: 'idle'
});
let results = $state<ExtractionResult[]>([]);

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function getDefaultFileRunState(): FileRunState {
  return {
    status: 'idle',
    progress: 0,
    speedBytesPerSec: undefined,
    error: undefined,
  };
}

export const extractionStore = {
  get outputDir() {
    return outputDir;
  },

  get selectedTracks() {
    return selectedTracks;
  },

  get fileRunStates() {
    return fileRunStates;
  },

  get progress() {
    return progress;
  },

  get results() {
    return results;
  },

  get isExtracting() {
    return progress.status === 'extracting';
  },

  setOutputDir(dir: string) {
    outputDir = dir;
  },

  toggleTrack(filePath: string, trackId: number) {
    const current = selectedTracks.get(filePath) || [];
    const newTracks = current.includes(trackId)
      ? current.filter(id => id !== trackId)
      : [...current, trackId];

    selectedTracks = new Map(selectedTracks);
    if (newTracks.length > 0) {
      selectedTracks.set(filePath, newTracks);
    } else {
      selectedTracks.delete(filePath);
    }
  },

  setTracksForFile(filePath: string, trackIds: number[]) {
    selectedTracks = new Map(selectedTracks);
    if (trackIds.length > 0) {
      selectedTracks.set(filePath, trackIds);
    } else {
      selectedTracks.delete(filePath);
    }
  },

  selectAllTracksOfType(filePath: string, trackIds: number[]) {
    const current = selectedTracks.get(filePath) || [];
    const newTracks = [...new Set([...current, ...trackIds])];
    selectedTracks = new Map(selectedTracks);
    selectedTracks.set(filePath, newTracks);
  },

  clearTracksForFile(filePath: string) {
    selectedTracks = new Map(selectedTracks);
    selectedTracks.delete(filePath);
  },

  clearAllTracks() {
    selectedTracks = new Map();
  },

  isTrackSelected(filePath: string, trackId: number): boolean {
    const tracks = selectedTracks.get(filePath);
    return tracks ? tracks.includes(trackId) : false;
  },

  getSelectedTracksForFile(filePath: string): number[] {
    return selectedTracks.get(filePath) || [];
  },

  getTotalSelectedTracks(): number {
    let total = 0;
    for (const tracks of selectedTracks.values()) {
      total += tracks.length;
    }
    return total;
  },

  updateProgress(updates: Partial<ExtractionProgress>) {
    progress = { ...progress, ...updates };
  },

  initializeFileRunStates(filePaths: string[]) {
    const next = new Map<string, FileRunState>();
    for (const filePath of filePaths) {
      next.set(filePath, {
        ...getDefaultFileRunState(),
        status: 'queued',
      });
    }
    fileRunStates = next;
  },

  setFileRunState(filePath: string, updates: Partial<FileRunState>) {
    const current = fileRunStates.get(filePath) ?? getDefaultFileRunState();
    fileRunStates = new Map(fileRunStates);
    fileRunStates.set(filePath, { ...current, ...updates });
  },

  setFileQueued(filePath: string) {
    this.setFileRunState(filePath, {
      status: 'queued',
      progress: 0,
      speedBytesPerSec: undefined,
      error: undefined,
    });
  },

  setFileProcessing(filePath: string) {
    this.setFileRunState(filePath, {
      status: 'processing',
      progress: 0,
      speedBytesPerSec: undefined,
      error: undefined,
    });
  },

  updateFileProgress(filePath: string, fileProgress: number, speedBytesPerSec?: number) {
    this.setFileRunState(filePath, {
      status: 'processing',
      progress: clampProgress(fileProgress),
      speedBytesPerSec,
      error: undefined,
    });
  },

  setFileCompleted(filePath: string) {
    this.setFileRunState(filePath, {
      status: 'completed',
      progress: 100,
      speedBytesPerSec: undefined,
      error: undefined,
    });
  },

  setFileCancelled(filePath: string) {
    this.setFileRunState(filePath, {
      status: 'cancelled',
      speedBytesPerSec: undefined,
    });
  },

  setFileError(filePath: string, error?: string) {
    this.setFileRunState(filePath, {
      status: 'error',
      speedBytesPerSec: undefined,
      error,
    });
  },

  removeFileRunState(filePath: string) {
    fileRunStates = new Map(fileRunStates);
    fileRunStates.delete(filePath);
  },

  clearFileRunStates() {
    fileRunStates = new Map();
  },

  setLiveProgress(
    currentTrackProgress: number,
    currentFileProgress: number,
    currentSpeedBytesPerSec?: number,
  ) {
    progress = {
      ...progress,
      currentTrackProgress,
      currentFileProgress,
      currentSpeedBytesPerSec,
    };
  },

  markTrackCompleted() {
    progress = {
      ...progress,
      completedTracks: Math.min(progress.totalTracks, progress.completedTracks + 1),
      currentTrackProgress: 0,
    };
  },

  addResult(result: ExtractionResult) {
    results = [...results, result];
  },

  reset() {
    progress = {
      currentFile: '',
      currentFileIndex: 0,
      totalFiles: 0,
      currentTrack: 0,
      totalTracks: 0,
      completedTracks: 0,
      currentTrackProgress: 0,
      currentFileProgress: 0,
      currentSpeedBytesPerSec: undefined,
      status: 'idle'
    };
    results = [];
    fileRunStates = new Map();
  },

  clearResults() {
    results = [];
  }
};
