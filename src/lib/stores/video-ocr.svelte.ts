/**
 * Store for Video OCR subtitle extraction feature
 * Manages video files, OCR configuration, progress, and logs
 */

import type {
  OcrVideoFile,
  OcrFileStatus,
  OcrConfig,
  OcrRegion,
  OcrRegionMode,
  OcrVersion,
  OcrProgress,
  OcrPhase,
  OcrLogEntry,
  OcrModelsStatus,
} from '$lib/types';
import { DEFAULT_OCR_CONFIG, DEFAULT_OCR_REGION } from '$lib/types';

// ============================================================================
// STATE
// ============================================================================

// Video files state
let videoFiles = $state.raw<OcrVideoFile[]>([]);
let selectedFileId = $state<string | null>(null);

// OCR configuration
let config = $state<OcrConfig>({ ...DEFAULT_OCR_CONFIG });
let globalRegion = $state<OcrRegion>({ ...DEFAULT_OCR_REGION });

// Processing state
let isProcessing = $state(false);
let currentProcessingId = $state<string | null>(null);
let isCancelling = $state(false);
let cancelledFileIds = $state<Set<string>>(new Set());

// Operation tracking for cancellation
let currentOperationId = $state<string | null>(null);

// Scoped run targets (for precise global progress aggregation)
let processingScopeFileIds = $state<Set<string>>(new Set());

// Logs
let logs = $state<OcrLogEntry[]>([]);

// OCR Models Status
let modelsStatus = $state<OcrModelsStatus | null>(null);
let modelsChecked = $state(false);

// ============================================================================
// HELPERS
// ============================================================================

function generateId(): string {
  return `video-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function generateLogId(): string {
  return `log-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function getFileName(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path;
}

function createEmptyVideoFile(path: string, id?: string): OcrVideoFile {
  return {
    id: id ?? generateId(),
    path,
    name: getFileName(path),
    size: 0,
    status: 'pending',
    ocrRegion: { ...globalRegion },
    ocrRegionMode: 'global',
    ocrVersions: [],
  };
}

// ============================================================================
// STORE EXPORT
// ============================================================================

export const videoOcrStore = {
  // -------------------------------------------------------------------------
  // Getters - Video Files
  // -------------------------------------------------------------------------
  get videoFiles() {
    return videoFiles;
  },

  get selectedFileId() {
    return selectedFileId;
  },

  get selectedFile(): OcrVideoFile | undefined {
    return videoFiles.find(f => f.id === selectedFileId);
  },

  get readyFiles(): OcrVideoFile[] {
    return videoFiles.filter(f => f.status === 'ready' || f.status === 'completed');
  },

  get completedFiles(): OcrVideoFile[] {
    return videoFiles.filter(f => f.status === 'completed');
  },

  get hasFiles(): boolean {
    return videoFiles.length > 0;
  },

  // -------------------------------------------------------------------------
  // Getters - Config
  // -------------------------------------------------------------------------
  get config() {
    return config;
  },

  get globalRegion() {
    return { ...globalRegion };
  },

  // -------------------------------------------------------------------------
  // Getters - Processing State
  // -------------------------------------------------------------------------
  get isProcessing() {
    return isProcessing;
  },

  get currentProcessingId() {
    return currentProcessingId;
  },

  get currentOperationId() {
    return currentOperationId;
  },

  get processingScopeFileIds() {
    return processingScopeFileIds;
  },

  get isCancelling() {
    return isCancelling;
  },

  get cancelledFileIds() {
    return cancelledFileIds;
  },

  get canStartOcr(): boolean {
    return videoFiles.some(f => f.status === 'ready' || f.status === 'completed') &&
      !isProcessing;
  },

  isFileCancelled(id: string): boolean {
    return cancelledFileIds.has(id);
  },

  // -------------------------------------------------------------------------
  // Getters - Logs
  // -------------------------------------------------------------------------
  get logs() {
    return logs;
  },

  get errorLogs(): OcrLogEntry[] {
    return logs.filter(l => l.level === 'error');
  },

  // -------------------------------------------------------------------------
  // Getters - Models Status
  // -------------------------------------------------------------------------
  get modelsStatus() {
    return modelsStatus;
  },

  get modelsChecked() {
    return modelsChecked;
  },

  get modelsInstalled(): boolean {
    return modelsStatus?.installed ?? false;
  },

  get availableLanguages(): string[] {
    return modelsStatus?.availableLanguages ?? [];
  },

  // -------------------------------------------------------------------------
  // Actions - File Management
  // -------------------------------------------------------------------------
  addFiles(files: OcrVideoFile[]) {
    const existingPaths = new Set(videoFiles.map(f => f.path));
    const newFiles = files
      .filter(f => !existingPaths.has(f.path))
      .map((file) => ({
        ...file,
        ocrRegionMode: file.ocrRegionMode ?? 'global',
        ocrRegion: file.ocrRegion ?? { ...globalRegion },
      }));
    videoFiles = [...videoFiles, ...newFiles];

    if (!selectedFileId && newFiles.length > 0) {
      selectedFileId = newFiles[0].id;
    }
  },

  addFilesFromPaths(paths: string[]) {
    const newFiles: OcrVideoFile[] = paths.map(path => createEmptyVideoFile(path));
    this.addFiles(newFiles);
    return newFiles;
  },

  removeFile(id: string) {
    videoFiles = videoFiles.filter(f => f.id !== id);
    if (processingScopeFileIds.has(id)) {
      processingScopeFileIds = new Set(
        [...processingScopeFileIds].filter((fileId) => fileId !== id)
      );
    }
    if (selectedFileId === id) {
      selectedFileId = videoFiles[0]?.id ?? null;
    }
  },

  selectFile(id: string) {
    if (videoFiles.some(f => f.id === id)) {
      selectedFileId = id;
    }
  },

  updateFile(id: string, updates: Partial<OcrVideoFile>) {
    videoFiles = videoFiles.map(f =>
      f.id === id ? { ...f, ...updates } : f
    );
  },

  setFileStatus(id: string, status: OcrFileStatus, error?: string) {
    videoFiles = videoFiles.map(f =>
      f.id === id ? { ...f, status, error: error ?? f.error } : f
    );
  },

  // -------------------------------------------------------------------------
  // Actions - Preview Transcoding
  // -------------------------------------------------------------------------
  startTranscoding(fileId: string) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? {
        ...f,
        status: 'transcoding' as const,
        isTranscoding: true,
        transcodingProgress: 0,
        transcodingCodec: undefined,
      } : f
    );
  },

  updateTranscodingProgress(fileId: string, progress: number) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? { ...f, transcodingProgress: progress } : f
    );
  },

  setTranscodingCodec(fileId: string, codec: string) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? { ...f, transcodingCodec: codec } : f
    );
  },

  finishTranscoding(fileId: string, previewPath: string) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? {
        ...f,
        status: f.ocrVersions.length > 0 ? 'completed' as const : 'ready' as const,
        isTranscoding: false,
        transcodingProgress: 100,
        previewPath,
        transcodingCodec: undefined,
      } : f
    );
  },

  failTranscoding(fileId: string, error: string) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? {
        ...f,
        status: 'error' as const,
        isTranscoding: false,
        error,
        transcodingCodec: undefined,
      } : f
    );
    this.addLog('error', `Transcoding failed: ${error}`, fileId);
  },

  // -------------------------------------------------------------------------
  // Actions - OCR Region
  // -------------------------------------------------------------------------
  setGlobalRegion(region: OcrRegion) {
    globalRegion = { ...region };
    this.applyGlobalRegionToGlobalFiles();
  },

  setFileRegionMode(fileId: string, mode: OcrRegionMode) {
    videoFiles = videoFiles.map(f => {
      if (f.id !== fileId) {
        return f;
      }

      if (mode === 'global') {
        return {
          ...f,
          ocrRegionMode: 'global',
          ocrRegion: { ...globalRegion },
        };
      }

      return {
        ...f,
        ocrRegionMode: 'custom',
        ocrRegion: f.ocrRegion ? { ...f.ocrRegion } : { ...globalRegion },
      };
    });
  },

  setFileRegionCustom(fileId: string, region: OcrRegion | undefined) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId
        ? { ...f, ocrRegionMode: 'custom', ocrRegion: region }
        : f
    );
  },

  applyGlobalRegionToGlobalFiles() {
    videoFiles = videoFiles.map(f =>
      f.ocrRegionMode === 'global'
        ? { ...f, ocrRegion: { ...globalRegion } }
        : f
    );
  },

  setOcrRegion(fileId: string, region: OcrRegion | undefined) {
    this.setFileRegionCustom(fileId, region);
  },

  clearOcrRegion(fileId: string) {
    this.setFileRegionCustom(fileId, undefined);
  },

  // -------------------------------------------------------------------------
  // Actions - OCR Progress
  // -------------------------------------------------------------------------
  updateProgress(fileId: string, progress: OcrProgress) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? { ...f, progress } : f
    );
  },

  setPhase(fileId: string, phase: OcrPhase, current: number = 0, total: number = 0) {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    this.updateProgress(fileId, { phase, current, total, percentage });
  },

  clearProgress(fileId: string) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? { ...f, progress: undefined } : f
    );
  },

  // -------------------------------------------------------------------------
  // Actions - Subtitles
  // -------------------------------------------------------------------------
  setOcrVersions(fileId: string, versions: OcrVersion[]) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? {
        ...f,
        ocrVersions: [...versions],
        status: versions.length > 0 ? 'completed' as const : f.status,
        progress: undefined,
        error: undefined,
      } : f
    );
  },

  addOcrVersion(fileId: string, version: OcrVersion) {
    videoFiles = videoFiles.map(f => {
      if (f.id !== fileId) {
        return f;
      }

      return {
        ...f,
        ocrVersions: [...f.ocrVersions, version],
        status: 'completed' as const,
        progress: undefined,
        error: undefined,
      };
    });
  },

  // -------------------------------------------------------------------------
  // Actions - Config
  // -------------------------------------------------------------------------
  updateConfig(updates: Partial<OcrConfig>) {
    config = { ...config, ...updates };
  },

  setFrameRate(frameRate: number) {
    config = { ...config, frameRate: Math.max(1, Math.min(30, frameRate)) };
  },

  setLanguage(language: OcrConfig['language']) {
    config = { ...config, language };
  },

  toggleGpu() {
    config = { ...config, useGpu: !config.useGpu };
  },

  setConfidenceThreshold(threshold: number) {
    config = { ...config, confidenceThreshold: Math.max(0, Math.min(1, threshold)) };
  },

  // -------------------------------------------------------------------------
  // Actions - Processing State
  // -------------------------------------------------------------------------
  setProcessingScope(fileIds: string[]) {
    processingScopeFileIds = new Set(fileIds);
  },

  clearProcessingScope() {
    processingScopeFileIds = new Set();
  },

  startProcessing(fileId: string, operationId?: string) {
    isProcessing = true;
    currentProcessingId = fileId;
    currentOperationId = operationId ?? fileId;
    this.addLog('info', 'Starting OCR processing...', fileId);
  },

  stopProcessing() {
    isProcessing = false;
    currentProcessingId = null;
    currentOperationId = null;
    cancelledFileIds = new Set();
    isCancelling = false;
    processingScopeFileIds = new Set();
  },

  cancelProcessing(fileId: string) {
    cancelledFileIds = new Set([...cancelledFileIds, fileId]);
    isCancelling = true;

    // Reset file status
    videoFiles = videoFiles.map(f => {
      if (f.id === fileId && isProcessingStatus(f.status)) {
        return {
          ...f,
          status: f.ocrVersions.length > 0 ? 'completed' as const : 'ready' as const,
          progress: undefined,
          error: undefined
        };
      }
      return f;
    });

    this.addLog('warning', 'Processing cancelled by user', fileId);
  },

  cancelAll() {
    isCancelling = true;

    // Cancel all processing files
    videoFiles = videoFiles.map(f => {
      if (isProcessingStatus(f.status)) {
        cancelledFileIds = new Set([...cancelledFileIds, f.id]);
        return {
          ...f,
          status: f.ocrVersions.length > 0 ? 'completed' as const : 'ready' as const,
          progress: undefined,
          error: undefined
        };
      }
      return f;
    });

    this.addLog('warning', 'All processing cancelled');
  },

  failFile(fileId: string, error: string) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? {
        ...f,
        status: 'error' as const,
        progress: undefined,
        error
      } : f
    );
    this.addLog('error', error, fileId);
  },

  // -------------------------------------------------------------------------
  // Actions - Logs
  // -------------------------------------------------------------------------
  addLog(level: OcrLogEntry['level'], message: string, fileId?: string) {
    const fileName = fileId ? videoFiles.find(f => f.id === fileId)?.name : undefined;
    const logMessage = fileName ? `[${fileName}] ${message}` : message;

    logs = [
      ...logs,
      {
        id: generateLogId(),
        timestamp: new Date(),
        level,
        message: logMessage,
      }
    ];

    // Keep only last 100 logs
    if (logs.length > 100) {
      logs = logs.slice(-100);
    }
  },

  clearLogs() {
    logs = [];
  },

  // -------------------------------------------------------------------------
  // Actions - Models Status
  // -------------------------------------------------------------------------
  setModelsStatus(status: OcrModelsStatus) {
    modelsStatus = status;
    modelsChecked = true;
  },

  clearModelsStatus() {
    modelsStatus = null;
    modelsChecked = false;
  },

  // -------------------------------------------------------------------------
  // Actions - Reset
  // -------------------------------------------------------------------------
  clear() {
    videoFiles = [];
    selectedFileId = null;
    isProcessing = false;
    currentProcessingId = null;
    currentOperationId = null;
    cancelledFileIds = new Set();
    isCancelling = false;
    processingScopeFileIds = new Set();
    logs = [];
  },

  reset() {
    this.clear();
    config = { ...DEFAULT_OCR_CONFIG };
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isProcessingStatus(status: OcrFileStatus): boolean {
  return ['extracting_frames', 'ocr_processing', 'generating_subs'].includes(status);
}
