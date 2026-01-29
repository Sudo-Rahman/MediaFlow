/**
 * Store for Audio to Subs transcription feature
 * Manages audio files, transcription config, and progress state
 */

import type { 
  AudioFile, 
  TranscriptionConfig, 
  WhisperModel,
  DEFAULT_TRANSCRIPTION_CONFIG 
} from '$lib/types';

// ============================================================================
// STATE
// ============================================================================

// Audio files state
let audioFiles = $state<AudioFile[]>([]);
let selectedFileId = $state<string | null>(null);

// Transcription configuration
let config = $state<TranscriptionConfig>({
  model: 'large-v3',
  language: 'auto',
  outputFormat: 'srt',
  wordTimestamps: false,
  translate: false,
  maxSegmentLength: 50
});

let outputDir = $state<string>('');

// Transcription state
let isTranscribing = $state(false);
let currentTranscribingId = $state<string | null>(null);
let cancelledFileIds = $state<Set<string>>(new Set());
let isCancelling = $state(false);

// Whisper installation state
let whisperInstalled = $state<boolean | null>(null);
let whisperVersion = $state<string | null>(null);

// Downloaded models
let downloadedModels = $state<Set<WhisperModel>>(new Set());
let isDownloadingModel = $state(false);
let downloadingModelId = $state<WhisperModel | null>(null);
let downloadProgress = $state(0);

// ============================================================================
// HELPERS
// ============================================================================

function generateId(): string {
  return `audio-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function getFileName(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path;
}

// ============================================================================
// STORE EXPORT
// ============================================================================

export const audioToSubsStore = {
  // -------------------------------------------------------------------------
  // Getters - Audio Files
  // -------------------------------------------------------------------------
  get audioFiles() { 
    return audioFiles; 
  },
  
  get selectedFileId() { 
    return selectedFileId; 
  },
  
  get selectedFile(): AudioFile | undefined { 
    return audioFiles.find(f => f.id === selectedFileId); 
  },
  
  get readyFiles(): AudioFile[] {
    return audioFiles.filter(f => f.status === 'ready');
  },
  
  get completedFiles(): AudioFile[] {
    return audioFiles.filter(f => f.status === 'completed');
  },
  
  get hasFiles(): boolean {
    return audioFiles.length > 0;
  },

  // -------------------------------------------------------------------------
  // Getters - Config
  // -------------------------------------------------------------------------
  get config() { 
    return config; 
  },
  
  get outputDir() { 
    return outputDir; 
  },

  // -------------------------------------------------------------------------
  // Getters - Transcription State
  // -------------------------------------------------------------------------
  get isTranscribing() { 
    return isTranscribing; 
  },
  
  get currentTranscribingId() {
    return currentTranscribingId;
  },
  
  get canTranscribe(): boolean {
    return audioFiles.some(f => f.status === 'ready') && 
           !isTranscribing && 
           outputDir.length > 0 &&
           whisperInstalled === true &&
           downloadedModels.has(config.model);
  },
  
  get isCancelling() {
    return isCancelling;
  },
  
  get cancelledFileIds() {
    return cancelledFileIds;
  },
  
  isFileCancelled(id: string): boolean {
    return cancelledFileIds.has(id);
  },

  // -------------------------------------------------------------------------
  // Getters - Whisper State
  // -------------------------------------------------------------------------
  get whisperInstalled() {
    return whisperInstalled;
  },
  
  get whisperVersion() {
    return whisperVersion;
  },
  
  get downloadedModels() { 
    return downloadedModels; 
  },
  
  get isDownloadingModel() { 
    return isDownloadingModel; 
  },
  
  get downloadingModelId() {
    return downloadingModelId;
  },
  
  get downloadProgress() { 
    return downloadProgress; 
  },
  
  get isModelDownloaded(): boolean {
    return downloadedModels.has(config.model);
  },

  // -------------------------------------------------------------------------
  // Actions - File Management
  // -------------------------------------------------------------------------
  addFiles(files: AudioFile[]) {
    const existingPaths = new Set(audioFiles.map(f => f.path));
    const newFiles = files.filter(f => !existingPaths.has(f.path));
    audioFiles = [...audioFiles, ...newFiles];
    
    if (!selectedFileId && newFiles.length > 0) {
      selectedFileId = newFiles[0].id;
    }
  },

  addFilesFromPaths(paths: string[]) {
    const newFiles: AudioFile[] = paths.map(path => ({
      id: generateId(),
      path,
      name: getFileName(path),
      size: 0,
      status: 'pending' as const
    }));
    this.addFiles(newFiles);
    return newFiles;
  },

  removeFile(id: string) {
    audioFiles = audioFiles.filter(f => f.id !== id);
    if (selectedFileId === id) {
      selectedFileId = audioFiles[0]?.id ?? null;
    }
  },

  selectFile(id: string) {
    if (audioFiles.some(f => f.id === id)) {
      selectedFileId = id;
    }
  },

  updateFile(id: string, updates: Partial<AudioFile>) {
    audioFiles = audioFiles.map(f => 
      f.id === id ? { ...f, ...updates } : f
    );
  },

  setFileStatus(id: string, status: AudioFile['status'], error?: string) {
    audioFiles = audioFiles.map(f => 
      f.id === id ? { ...f, status, error: error ?? f.error } : f
    );
  },

  setFileProgress(id: string, progress: number) {
    audioFiles = audioFiles.map(f =>
      f.id === id ? { ...f, progress } : f
    );
  },

  // -------------------------------------------------------------------------
  // Actions - Config
  // -------------------------------------------------------------------------
  updateConfig(updates: Partial<TranscriptionConfig>) {
    config = { ...config, ...updates };
  },

  setModel(model: WhisperModel) {
    config = { ...config, model };
  },

  setLanguage(language: string) {
    config = { ...config, language };
  },

  setOutputFormat(format: TranscriptionConfig['outputFormat']) {
    config = { ...config, outputFormat: format };
  },

  setOutputDir(dir: string) {
    outputDir = dir;
  },

  toggleWordTimestamps() {
    config = { ...config, wordTimestamps: !config.wordTimestamps };
  },

  toggleTranslate() {
    config = { ...config, translate: !config.translate };
  },

  // -------------------------------------------------------------------------
  // Actions - Transcription State
  // -------------------------------------------------------------------------
  startTranscription(fileId?: string) {
    isTranscribing = true;
    currentTranscribingId = fileId ?? null;
  },

  stopTranscription() {
    isTranscribing = false;
    currentTranscribingId = null;
    cancelledFileIds = new Set();
    isCancelling = false;
  },
  
  cancelFile(id: string) {
    cancelledFileIds = new Set([...cancelledFileIds, id]);
    // Update file status to cancelled
    audioFiles = audioFiles.map(f =>
      f.id === id && f.status === 'transcribing' 
        ? { ...f, status: 'error' as const, error: 'Cancelled by user' } 
        : f
    );
  },
  
  cancelAll() {
    isCancelling = true;
    // Mark all pending/ready files as needing to be skipped
    for (const file of audioFiles) {
      if (file.status === 'ready' || file.status === 'pending') {
        cancelledFileIds = new Set([...cancelledFileIds, file.id]);
      }
    }
  },

  completeFile(id: string, outputPath: string) {
    audioFiles = audioFiles.map(f =>
      f.id === id ? { ...f, status: 'completed', progress: 100, outputPath } : f
    );
  },

  failFile(id: string, error: string) {
    audioFiles = audioFiles.map(f =>
      f.id === id ? { ...f, status: 'error', error } : f
    );
  },

  // -------------------------------------------------------------------------
  // Actions - Whisper State
  // -------------------------------------------------------------------------
  setWhisperInstalled(installed: boolean, version?: string | null) {
    whisperInstalled = installed;
    whisperVersion = version ?? null;
  },

  setDownloadedModels(models: WhisperModel[]) {
    downloadedModels = new Set(models);
  },

  addDownloadedModel(model: WhisperModel) {
    downloadedModels = new Set([...downloadedModels, model]);
  },

  startModelDownload(model: WhisperModel) {
    isDownloadingModel = true;
    downloadingModelId = model;
    downloadProgress = 0;
  },

  setDownloadProgress(progress: number) {
    downloadProgress = progress;
  },

  finishModelDownload(model: WhisperModel, success: boolean) {
    isDownloadingModel = false;
    downloadingModelId = null;
    downloadProgress = 0;
    if (success) {
      this.addDownloadedModel(model);
    }
  },

  // -------------------------------------------------------------------------
  // Actions - Import from Extraction
  // -------------------------------------------------------------------------
  importFromExtraction(files: { path: string; name: string }[]) {
    const newFiles: AudioFile[] = files.map((f, i) => ({
      id: `imported-${Date.now()}-${i}`,
      path: f.path,
      name: f.name,
      size: 0,
      status: 'pending' as const
    }));
    this.addFiles(newFiles);
    return newFiles;
  },

  // -------------------------------------------------------------------------
  // Actions - Reset
  // -------------------------------------------------------------------------
  clear() {
    audioFiles = [];
    selectedFileId = null;
    isTranscribing = false;
    currentTranscribingId = null;
    cancelledFileIds = new Set();
    isCancelling = false;
  },

  reset() {
    this.clear();
    config = {
      model: 'large-v3',
      language: 'auto',
      outputFormat: 'srt',
      wordTimestamps: false,
      translate: false,
      maxSegmentLength: 50
    };
    outputDir = '';
  }
};
