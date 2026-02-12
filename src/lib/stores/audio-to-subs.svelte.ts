/**
 * Store for Audio to Subs transcription feature
 * Manages audio files, Deepgram transcription config, and progress state
 */

import type WaveSurfer from 'wavesurfer.js';
import type { 
  AudioFile, 
  TranscriptionConfig,
  DeepgramConfig,
  DeepgramModel,
  TranscriptionVersion
} from '$lib/types';
import { DEFAULT_DEEPGRAM_CONFIG } from '$lib/types';

// ============================================================================
// STATE
// ============================================================================

// Audio files state
let audioFiles = $state<AudioFile[]>([]);
let selectedFileId = $state<string | null>(null);

// Transcription configuration
let config = $state<TranscriptionConfig>({
  deepgramConfig: { ...DEFAULT_DEEPGRAM_CONFIG },
  outputFormat: 'srt',
  maxConcurrentTranscriptions: 5,
});

let outputDir = $state<string>('');

// Transcription state
let isTranscribing = $state(false);
let currentTranscribingId = $state<string | null>(null);
let cancelledFileIds = $state<Set<string>>(new Set());
let isCancelling = $state(false);

// Transcoding state
let isTranscoding = $state(false);
let transcodingFileIds = $state<Set<string>>(new Set());

// Waveform persistence - stores WaveSurfer instances by fileId
interface WaveformInstance {
  wavesurfer: WaveSurfer;
  blobUrl: string;
  convertedPath?: string;
}

const waveformInstances = new Map<string, WaveformInstance>();

// ============================================================================
// HELPERS
// ============================================================================

function generateId(): string {
  return `audio-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function getFileName(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path;
}

function createEmptyAudioFile(path: string, id?: string): AudioFile {
  return {
    id: id ?? generateId(),
    path,
    name: getFileName(path),
    size: 0,
    status: 'pending',
    transcriptionVersions: [],
  };
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
    return audioFiles.filter(f => f.status === 'ready' || f.status === 'completed');
  },
  
  get completedFiles(): AudioFile[] {
    return audioFiles.filter(f => f.status === 'completed');
  },
  
  get hasFiles(): boolean {
    return audioFiles.length > 0;
  },

  get pendingTranscodeFiles(): AudioFile[] {
    return audioFiles.filter(f => f.status === 'pending' || f.status === 'scanning');
  },

  get transcodingFiles(): AudioFile[] {
    return audioFiles.filter(f => f.status === 'transcoding');
  },

  // -------------------------------------------------------------------------
  // Getters - Config
  // -------------------------------------------------------------------------
  get config() { 
    return config; 
  },

  get deepgramConfig(): DeepgramConfig {
    return config.deepgramConfig;
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
    // Can transcribe if we have ready files, not currently transcribing,
    // output dir is set, and no files are still transcoding
    return audioFiles.some(f => f.status === 'ready' || f.status === 'completed') && 
           !isTranscribing && 
           outputDir.length > 0 &&
           !audioFiles.some(f => f.status === 'transcoding');
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
  // Getters - Transcoding State
  // -------------------------------------------------------------------------
  get isTranscoding() {
    return isTranscoding;
  },

  get transcodingFileIds() {
    return transcodingFileIds;
  },

  get hasFilesTranscoding(): boolean {
    return audioFiles.some(f => f.status === 'transcoding');
  },

  // -------------------------------------------------------------------------
  // Getters - Waveform Persistence
  // -------------------------------------------------------------------------
  getWaveformInstance(fileId: string): WaveformInstance | undefined {
    return waveformInstances.get(fileId);
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
    const newFiles: AudioFile[] = paths.map(path => createEmptyAudioFile(path));
    this.addFiles(newFiles);
    return newFiles;
  },

  removeFile(id: string) {
    // Clean up waveform instance and blob URL for this file
    this.removeWaveformInstance(id);

    // Ensure transcoding bookkeeping is cleaned when removing an in-flight file.
    if (transcodingFileIds.has(id)) {
      transcodingFileIds = new Set([...transcodingFileIds].filter((fileId) => fileId !== id));
      isTranscoding = transcodingFileIds.size > 0;
    }
    
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
  // Actions - Transcription Versions
  // -------------------------------------------------------------------------
  addTranscriptionVersion(fileId: string, version: TranscriptionVersion) {
    audioFiles = audioFiles.map(f => {
      if (f.id === fileId) {
        return {
          ...f,
          transcriptionVersions: [...f.transcriptionVersions, version],
          status: 'completed' as const,
        };
      }
      return f;
    });
  },

  removeTranscriptionVersion(fileId: string, versionId: string) {
    audioFiles = audioFiles.map(f => {
      if (f.id === fileId) {
        const updatedVersions = f.transcriptionVersions.filter(v => v.id !== versionId);
        return {
          ...f,
          transcriptionVersions: updatedVersions,
          // If no more versions, set back to ready
          status: updatedVersions.length > 0 ? 'completed' as const : 'ready' as const,
        };
      }
      return f;
    });
  },

  getTranscriptionVersionCount(fileId: string): number {
    const file = audioFiles.find(f => f.id === fileId);
    return file?.transcriptionVersions.length ?? 0;
  },

  // -------------------------------------------------------------------------
  // Actions - Waveform Persistence
  // -------------------------------------------------------------------------
  saveWaveformInstance(
    fileId: string, 
    wavesurfer: WaveSurfer, 
    blobUrl: string, 
    convertedPath?: string
  ) {
    waveformInstances.set(fileId, {
      wavesurfer,
      blobUrl,
      convertedPath
    });
  },

  removeWaveformInstance(fileId: string) {
    const instance = waveformInstances.get(fileId);
    if (instance) {
      // Destroy the WaveSurfer instance
      try {
        instance.wavesurfer.destroy();
      } catch {
        // Ignore cleanup errors
      }
      // Revoke blob URL to free memory
      if (instance.blobUrl) {
        URL.revokeObjectURL(instance.blobUrl);
      }
      waveformInstances.delete(fileId);
    }
  },

  // -------------------------------------------------------------------------
  // Actions - Config
  // -------------------------------------------------------------------------
  updateConfig(updates: Partial<TranscriptionConfig>) {
    config = { ...config, ...updates };
  },

  updateDeepgramConfig(updates: Partial<DeepgramConfig>) {
    config = { 
      ...config, 
      deepgramConfig: { ...config.deepgramConfig, ...updates } 
    };
  },

  setModel(model: DeepgramModel) {
    config = { 
      ...config, 
      deepgramConfig: { ...config.deepgramConfig, model } 
    };
  },

  setLanguage(language: string) {
    config = { 
      ...config, 
      deepgramConfig: { ...config.deepgramConfig, language } 
    };
  },

  setOutputFormat(format: TranscriptionConfig['outputFormat']) {
    config = { ...config, outputFormat: format };
  },

  setOutputDir(dir: string) {
    outputDir = dir;
  },

  setUttSplit(value: number) {
    config = {
      ...config,
      deepgramConfig: { ...config.deepgramConfig, uttSplit: value }
    };
  },

  togglePunctuate() {
    config = {
      ...config,
      deepgramConfig: { ...config.deepgramConfig, punctuate: !config.deepgramConfig.punctuate }
    };
  },

  toggleSmartFormat() {
    config = {
      ...config,
      deepgramConfig: { ...config.deepgramConfig, smartFormat: !config.deepgramConfig.smartFormat }
    };
  },

  toggleParagraphs() {
    config = {
      ...config,
      deepgramConfig: { ...config.deepgramConfig, paragraphs: !config.deepgramConfig.paragraphs }
    };
  },

  toggleDiarize() {
    config = {
      ...config,
      deepgramConfig: { ...config.deepgramConfig, diarize: !config.deepgramConfig.diarize }
    };
  },

  setMaxConcurrentTranscriptions(value: number) {
    const clampedValue = Math.max(1, Math.min(10, value));
    config = {
      ...config,
      maxConcurrentTranscriptions: clampedValue
    };
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
    // Update file status - keep versions if they exist
    audioFiles = audioFiles.map(f => {
      if (f.id === id && f.status === 'transcribing') {
        return { 
          ...f, 
          status: f.transcriptionVersions.length > 0 ? 'completed' as const : 'ready' as const,
          error: undefined
        };
      }
      return f;
    });
  },
  
  cancelAll() {
    isCancelling = true;
    // Mark all transcribing files as cancelled and reset to appropriate status
    audioFiles = audioFiles.map(f => {
      if (f.status === 'transcribing') {
        cancelledFileIds = new Set([...cancelledFileIds, f.id]);
        return {
          ...f,
          status: f.transcriptionVersions.length > 0 ? 'completed' as const : 'ready' as const,
          error: undefined
        };
      }
      if (f.status === 'ready' || f.status === 'pending') {
        cancelledFileIds = new Set([...cancelledFileIds, f.id]);
      }
      return f;
    });
  },

  completeFile(id: string) {
    audioFiles = audioFiles.map(f =>
      f.id === id ? { ...f, status: 'completed' as const, progress: 100 } : f
    );
  },

  failFile(id: string, error: string) {
    audioFiles = audioFiles.map(f =>
      f.id === id ? { ...f, status: 'error' as const, error } : f
    );
  },

  // -------------------------------------------------------------------------
  // Actions - Transcoding State
  // -------------------------------------------------------------------------
  startTranscoding(fileId: string) {
    transcodingFileIds = new Set([...transcodingFileIds, fileId]);
    isTranscoding = transcodingFileIds.size > 0;
    audioFiles = audioFiles.map(f =>
      f.id === fileId ? { ...f, status: 'transcoding' as const, isTranscoding: true, transcodingProgress: 0 } : f
    );
  },

  updateTranscodingProgress(fileId: string, progress: number) {
    audioFiles = audioFiles.map(f =>
      f.id === fileId ? { ...f, transcodingProgress: progress } : f
    );
  },

  finishTranscoding(fileId: string, opusPath: string) {
    audioFiles = audioFiles.map(f =>
      f.id === fileId ? { 
        ...f, 
        status: 'ready' as const, 
        isTranscoding: false, 
        transcodingProgress: 100,
        opusPath 
      } : f
    );
    
    // Remove from transcoding set
    transcodingFileIds = new Set([...transcodingFileIds].filter(id => id !== fileId));
    isTranscoding = transcodingFileIds.size > 0;
  },

  failTranscoding(fileId: string, error: string) {
    audioFiles = audioFiles.map(f =>
      f.id === fileId ? { 
        ...f, 
        status: 'error' as const, 
        isTranscoding: false,
        error 
      } : f
    );
    
    // Remove from transcoding set
    transcodingFileIds = new Set([...transcodingFileIds].filter(id => id !== fileId));
    isTranscoding = transcodingFileIds.size > 0;
  },

  // -------------------------------------------------------------------------
  // Actions - Import from Extraction
  // -------------------------------------------------------------------------
  importFromExtraction(files: { path: string; name: string }[]) {
    const newFiles: AudioFile[] = files.map((f, i) => 
      createEmptyAudioFile(f.path, `imported-${Date.now()}-${i}`)
    );
    this.addFiles(newFiles);
    return newFiles;
  },

  // -------------------------------------------------------------------------
  // Actions - Reset
  // -------------------------------------------------------------------------
  clear() {
    // Clean up all waveform instances and blob URLs
    for (const [, instance] of waveformInstances) {
      try {
        instance.wavesurfer.destroy();
      } catch {
        // Ignore cleanup errors
      }
      if (instance.blobUrl) {
        URL.revokeObjectURL(instance.blobUrl);
      }
    }
    waveformInstances.clear();
    
    audioFiles = [];
    selectedFileId = null;
    isTranscribing = false;
    currentTranscribingId = null;
    cancelledFileIds = new Set();
    isCancelling = false;
    isTranscoding = false;
    transcodingFileIds = new Set();
  },

  reset() {
    this.clear();
    config = {
      deepgramConfig: { ...DEFAULT_DEEPGRAM_CONFIG },
      outputFormat: 'srt',
      maxConcurrentTranscriptions: 5,
    };
    outputDir = '';
  }
};
