/**
 * Store for Video OCR subtitle extraction feature
 * Manages video files, OCR configuration, progress, and logs
 */

import type {
  OcrVideoFile,
  OcrFileStatus,
  OcrConfig,
  OcrRegion,
  OcrSegment,
  OcrSubtitle,
  OcrZoneRole,
  OcrVersion,
  OcrProgress,
  OcrPhase,
  OcrLogEntry,
  OcrModelsStatus,
  OcrPreviewSourceIdentity,
  OcrZoneFrame,
  VideoOcrSelection,
} from '$lib/types';
import { DEFAULT_OCR_CONFIG, DEFAULT_OCR_WORKER_COUNT } from '$lib/types';
import { clampRegion, createDefaultVideoOcrSelection, getFileName, normalizeOcrZoneLabels } from '$lib/utils';
import {
  appendOcrVersionFromRenderedSelection,
  branchOcrDraftFromRenderedSelection,
  cloneOcrDraft,
  cloneOcrSegment,
  cloneOcrSelection,
  cloneOcrVersion,
  cloneOcrVersionedFile,
  getRenderedOcrSelection,
  getRenderedOcrSubtitles,
  getRenderedOcrVersion,
  getOcrDraftVersionName,
  hasOcrDraft,
  normalizeActiveOcrVersionId,
  replaceOcrDraftSelection,
  selectOcrVersion as selectOcrVersionState,
  setOcrVersionsForFile,
} from '$lib/components/video-ocr/ocr-version-state';
import { logStore } from './logs.svelte';

// ============================================================================
// STATE
// ============================================================================

// Video files state
let videoFiles = $state.raw<OcrVideoFile[]>([]);
let selectedFileId = $state<string | null>(null);

// OCR configuration
let config = $state<OcrConfig>({ ...DEFAULT_OCR_CONFIG });

// Processing state
let isProcessing = $state(false);
let currentProcessingId = $state<string | null>(null);
let isCancelling = $state(false);
let cancelledFileIds = $state<Set<string>>(new Set());

// Operation tracking for cancellation
let currentOperationId = $state<string | null>(null);
let activeOperationIdsByFileId = $state.raw<Map<string, string>>(new Map());
let liveDetectionsByFileId = $state.raw<Map<string, OcrZoneFrame[]>>(new Map());
let liveDetectionCountsByFileId = $state.raw<Map<string, number>>(new Map());

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

function createEmptyVideoFile(path: string, id?: string): OcrVideoFile {
  const defaultDurationMs = 1;

  return {
    id: id ?? generateId(),
    path,
    name: getFileName(path),
    size: 0,
    status: 'pending',
    ocrSelection: createDefaultVideoOcrSelection(defaultDurationMs),
    ocrVersions: [],
  };
}

function isOcrReadyFile(file: OcrVideoFile): boolean {
  return file.status === 'ready' || file.status === 'completed';
}

function cloneVideoFile(file: OcrVideoFile): OcrVideoFile {
  return cloneOcrVersionedFile(file);
}

function cloneLiveDetection(detection: OcrZoneFrame): OcrZoneFrame {
  return {
    ...detection,
    region: { ...detection.region },
  };
}

function buildSplitZoneLabel(label: string | undefined, suffix: 'A' | 'B'): string {
  const baseLabel = label?.trim() || 'Zone';
  return `${baseLabel} ${suffix}`;
}

function cloneSplitSegment(
  segment: OcrSegment,
  zoneIndex: number,
  startTimeMs: number,
  endTimeMs: number,
  suffix: 'A' | 'B',
): OcrSegment {
  const zone = segment.zones[zoneIndex];

  return {
    ...cloneOcrSegment(segment),
    id: `${segment.id}-${suffix.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    startTimeMs,
    endTimeMs,
    zones: [
      {
        ...zone,
        id: `${zone.id}-${suffix.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        label: buildSplitZoneLabel(zone.label, suffix),
        region: { ...zone.region },
      },
    ],
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

  get activeSelectedOcrVersion(): OcrVersion | null {
    const file = this.selectedFile;
    return file ? getRenderedOcrVersion(file) : null;
  },

  getActiveOcrVersion(fileId: string): OcrVersion | null {
    const file = videoFiles.find((entry) => entry.id === fileId);
    return file ? getRenderedOcrVersion(file) : null;
  },

  getActiveOcrSelection(fileId: string): VideoOcrSelection {
    const file = videoFiles.find((entry) => entry.id === fileId);
    return file ? getRenderedOcrSelection(file) : { segments: [] };
  },

  getActiveOcrSubtitles(fileId: string): OcrSubtitle[] {
    const file = videoFiles.find((entry) => entry.id === fileId);
    return file ? getRenderedOcrSubtitles(file) : [];
  },

  hasDraftOcrVersion(fileId: string): boolean {
    const file = videoFiles.find((entry) => entry.id === fileId);
    return file ? hasOcrDraft(file) : false;
  },

  getDraftOcrVersionName(fileId: string): string {
    const file = videoFiles.find((entry) => entry.id === fileId);
    return file ? getOcrDraftVersionName(file) : 'Draft Version 1';
  },

  get readyFiles(): OcrVideoFile[] {
    return videoFiles.filter(isOcrReadyFile);
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
    return videoFiles.some(isOcrReadyFile) && !isProcessing;
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
  addFiles(files: OcrVideoFile[]): OcrVideoFile[] {
    const existingPaths = new Set(videoFiles.map(f => f.path));
    const newFiles = files
      .filter((file) => {
        if (existingPaths.has(file.path)) {
          return false;
        }

        existingPaths.add(file.path);
        return true;
      })
      .map((file) => {
        const ocrVersions = (file.ocrVersions ?? []).map(cloneOcrVersion);
        const draft = file.draft ? cloneOcrDraft(file.draft) : undefined;
        return {
          ...file,
          ocrVersions,
          draft,
          activeOcrVersionId: normalizeActiveOcrVersionId(ocrVersions, file.activeOcrVersionId, draft),
          ocrSelection: file.ocrSelection
            ? cloneOcrSelection(file.ocrSelection)
            : createDefaultVideoOcrSelection(file.duration ? Math.round(file.duration * 1000) : 1),
        };
      });
    videoFiles = [...videoFiles, ...newFiles];

    if (!selectedFileId && newFiles.length > 0) {
      selectedFileId = newFiles[0].id;
    }

    return newFiles.map(cloneVideoFile);
  },

  addFilesFromPaths(paths: string[]): OcrVideoFile[] {
    const newFiles: OcrVideoFile[] = paths.map(path => createEmptyVideoFile(path));
    return this.addFiles(newFiles);
  },

  removeFile(id: string) {
    videoFiles = videoFiles.filter(f => f.id !== id);
    this.clearLiveDetections(id);
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

  selectOcrVersion(fileId: string, versionId: string | null) {
    videoFiles = videoFiles.map((file) => {
      if (file.id !== fileId) {
        return file;
      }

      return selectOcrVersionState(file, versionId);
    });
  },

  updateFile(id: string, updates: Partial<OcrVideoFile>) {
    videoFiles = videoFiles.map(f => {
      if (f.id !== id) {
        return f;
      }

      const hasOcrSelectionUpdate = Object.prototype.hasOwnProperty.call(updates, 'ocrSelection');
      const hasOcrVersionsUpdate = Object.prototype.hasOwnProperty.call(updates, 'ocrVersions');
      const hasActiveVersionUpdate = Object.prototype.hasOwnProperty.call(updates, 'activeOcrVersionId');
      const hasDraftUpdate = Object.prototype.hasOwnProperty.call(updates, 'draft');
      const { ocrSelection, ...updatesWithoutSelection } = updates;
      const durationMs = updates.duration ? Math.round(updates.duration * 1000) : undefined;
      const { ocrVersions, activeOcrVersionId, draft, ...remainingUpdates } = updatesWithoutSelection;
      const nextVersions = !hasOcrVersionsUpdate || ocrVersions === undefined
        ? f.ocrVersions
        : ocrVersions.map(cloneOcrVersion);
      const nextDraft = hasDraftUpdate
        ? draft ? cloneOcrDraft(draft) : undefined
        : f.draft;
      const nextActiveOcrVersionId = hasActiveVersionUpdate
        ? normalizeActiveOcrVersionId(nextVersions, activeOcrVersionId, nextDraft)
        : normalizeActiveOcrVersionId(nextVersions, f.activeOcrVersionId, nextDraft);
      const nextFile: OcrVideoFile = {
        ...f,
        ...remainingUpdates,
        ocrVersions: nextVersions,
        activeOcrVersionId: nextActiveOcrVersionId,
        draft: nextDraft,
        ocrSelection: hasOcrSelectionUpdate
          ? ocrSelection !== undefined
            ? cloneOcrSelection(ocrSelection)
            : cloneOcrSelection(f.ocrSelection)
          : f.ocrSelection,
      };
      if (
        !hasOcrSelectionUpdate
        && durationMs
        && f.ocrSelection.segments.length === 1
        && f.ocrSelection.segments[0].endTimeMs === 1
      ) {
        return { ...nextFile, ocrSelection: createDefaultVideoOcrSelection(durationMs) };
      }

      return nextFile;
    });
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
        previewError: undefined,
        error: undefined,
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

  finishTranscoding(
    fileId: string,
    previewPath: string,
    previewSourceIdentity: OcrPreviewSourceIdentity,
    previewVersion: string,
  ) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? {
        ...f,
        status: f.ocrVersions.length > 0 ? 'completed' as const : 'ready' as const,
        isTranscoding: false,
        transcodingProgress: 100,
        previewPath,
        previewSourceIdentity,
        previewVersion,
        previewError: undefined,
        error: undefined,
        transcodingCodec: undefined,
      } : f
    );
  },

  failPreviewTranscoding(fileId: string, error: string) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? {
        ...f,
        status: f.ocrVersions.length > 0 ? 'completed' as const : 'ready' as const,
        isTranscoding: false,
        previewPath: undefined,
        previewSourceIdentity: undefined,
        previewVersion: undefined,
        previewError: error,
        error: undefined,
        transcodingCodec: undefined,
      } : f
    );
    this.addLog('warning', `Preview transcoding failed: ${error}`, fileId);
  },

  cancelPreviewTranscoding(fileId: string) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId ? {
        ...f,
        status: f.ocrVersions.length > 0 ? 'completed' as const : 'ready' as const,
        isTranscoding: false,
        transcodingProgress: 0,
        transcodingCodec: undefined,
        error: undefined,
      } : f
    );
    this.addLog('info', 'Preview preparation cancelled', fileId);
  },

  cancelFilePreparation(fileId: string) {
    let didCancel = false;
    videoFiles = videoFiles.map(f => {
      if (f.id !== fileId || (f.status !== 'scanning' && f.status !== 'transcoding')) {
        return f;
      }

      didCancel = true;
      return {
        ...f,
        status: getPreparedFileStatus(f),
        isTranscoding: false,
        transcodingProgress: f.status === 'transcoding' ? 0 : f.transcodingProgress,
        transcodingCodec: undefined,
        progress: undefined,
        error: undefined,
      };
    });

    if (didCancel) {
      this.addLog('info', 'File preparation cancelled', fileId);
    }
  },

  // -------------------------------------------------------------------------
  // Actions - OCR Selection
  // -------------------------------------------------------------------------
  setOcrSelection(fileId: string, selection: VideoOcrSelection) {
    videoFiles = videoFiles.map(f =>
      f.id === fileId
        ? replaceOcrDraftSelection(f, selection)
        : f
    );
  },

  addOcrSegment(fileId: string, segment: OcrSegment) {
    videoFiles = videoFiles.map(f => {
      if (f.id !== fileId) {
        return f;
      }

      const draftFile = branchOcrDraftFromRenderedSelection(f);
      return replaceOcrDraftSelection(draftFile, normalizeOcrZoneLabels({
        segments: [
          ...draftFile.ocrSelection.segments.map(cloneOcrSegment),
          cloneOcrSegment(segment),
        ],
      }));
    });
  },

  setOcrZoneRole(fileId: string, segmentId: string, zoneId: string, role: OcrZoneRole) {
    videoFiles = videoFiles.map(f => {
      if (f.id !== fileId) {
        return f;
      }

      const draftFile = branchOcrDraftFromRenderedSelection(f);
      return replaceOcrDraftSelection(draftFile, {
        segments: draftFile.ocrSelection.segments.map((segment) => {
          if (segment.id !== segmentId) {
            return cloneOcrSegment(segment);
          }

          return {
            ...segment,
            zones: segment.zones.map((zone) => ({
              ...zone,
              role: zone.id === zoneId ? role : zone.role,
              region: { ...zone.region },
            })),
          };
        }),
      });
    });
  },

  setOcrZoneRegion(fileId: string, segmentId: string, zoneId: string, region: OcrRegion) {
    const nextRegion = clampRegion(region);
    videoFiles = videoFiles.map(f => {
      if (f.id !== fileId) {
        return f;
      }

      const draftFile = branchOcrDraftFromRenderedSelection(f);
      return replaceOcrDraftSelection(draftFile, {
        segments: draftFile.ocrSelection.segments.map((segment) => {
          if (segment.id !== segmentId) {
            return cloneOcrSegment(segment);
          }

          return {
            ...segment,
            zones: segment.zones.map((zone) => ({
              ...zone,
              region: zone.id === zoneId ? { ...nextRegion } : { ...zone.region },
            })),
          };
        }),
      });
    });
  },

  setOcrZoneLabel(fileId: string, segmentId: string, zoneId: string, label: string) {
    const nextLabel = label.trim();

    videoFiles = videoFiles.map(f => {
      if (f.id !== fileId) {
        return f;
      }

      const draftFile = branchOcrDraftFromRenderedSelection(f);
      return replaceOcrDraftSelection(draftFile, normalizeOcrZoneLabels({
        segments: draftFile.ocrSelection.segments.map((segment) => {
          if (segment.id !== segmentId) {
            return cloneOcrSegment(segment);
          }

          return {
            ...segment,
            zones: segment.zones.map((zone) => ({
              ...zone,
              label: zone.id === zoneId ? nextLabel || undefined : zone.label,
              region: { ...zone.region },
            })),
          };
        }),
      }));
    });
  },

  trimOcrSegment(fileId: string, segmentId: string, startTimeMs: number, endTimeMs: number, durationMs: number) {
    const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 1;
    const safeStartTimeMs = Number.isFinite(startTimeMs)
      ? Math.max(0, Math.min(Math.round(startTimeMs), safeDurationMs - 1))
      : 0;
    const safeEndTimeMs = Number.isFinite(endTimeMs)
      ? Math.max(safeStartTimeMs + 1, Math.min(Math.round(endTimeMs), safeDurationMs))
      : safeStartTimeMs + 1;

    videoFiles = videoFiles.map(f => {
      if (f.id !== fileId) {
        return f;
      }

      const draftFile = branchOcrDraftFromRenderedSelection(f);
      return replaceOcrDraftSelection(draftFile, {
        segments: draftFile.ocrSelection.segments.map((segment) => (
          segment.id === segmentId
            ? {
                ...segment,
                startTimeMs: safeStartTimeMs,
                endTimeMs: safeEndTimeMs,
                zones: segment.zones.map((zone) => ({ ...zone, region: { ...zone.region } })),
              }
            : cloneOcrSegment(segment)
        )),
      });
    });
  },

  cutOcrZone(fileId: string, segmentId: string, zoneId: string, cutTimeMs: number, durationMs: number): boolean {
    const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 1;
    const safeCutTimeMs = Number.isFinite(cutTimeMs)
      ? Math.max(0, Math.min(Math.round(cutTimeMs), safeDurationMs))
      : 0;
    const file = videoFiles.find((entry) => entry.id === fileId);

    if (!file) {
      return false;
    }

    const renderedSelection = getRenderedOcrSelection(file);
    const sourceSegment = renderedSelection.segments.find((segment) => segment.id === segmentId);
    const zoneIndex = sourceSegment?.zones.findIndex((zone) => zone.id === zoneId) ?? -1;

    if (!sourceSegment || zoneIndex === -1) {
      return false;
    }
    if (safeCutTimeMs <= sourceSegment.startTimeMs || safeCutTimeMs >= sourceSegment.endTimeMs) {
      return false;
    }

    const draftFile = branchOcrDraftFromRenderedSelection(file);
    const leftSegment = cloneSplitSegment(sourceSegment, zoneIndex, sourceSegment.startTimeMs, safeCutTimeMs, 'A');
    const rightSegment = cloneSplitSegment(sourceSegment, zoneIndex, safeCutTimeMs, sourceSegment.endTimeMs, 'B');
    const nextSegments = renderedSelection.segments.flatMap((segment) => {
      if (segment.id !== segmentId) {
        return [cloneOcrSegment(segment)];
      }

      const remainingZones = segment.zones
        .filter((zone) => zone.id !== zoneId)
        .map((zone) => ({ ...zone, region: { ...zone.region } }));

      if (remainingZones.length === 0) {
        return [leftSegment, rightSegment];
      }

      return [
        {
          ...segment,
          zones: remainingZones,
        },
        leftSegment,
        rightSegment,
      ];
    });
    const nextFile = replaceOcrDraftSelection(draftFile, { segments: nextSegments });

    videoFiles = videoFiles.map(f => f.id === fileId ? nextFile : f);

    return true;
  },

  // -------------------------------------------------------------------------
  // Actions - OCR Progress
  // -------------------------------------------------------------------------
  updateProgress(fileId: string, progress: OcrProgress) {
    if (cancelledFileIds.has(fileId)) {
      return;
    }

    videoFiles = videoFiles.map(f =>
      f.id === fileId
        ? mergeFileProgress(f, progress)
        : f
    );
  },

  updateProgressForOperation(fileId: string, operationId: string | null | undefined, progress: OcrProgress) {
    if (cancelledFileIds.has(fileId)) {
      return;
    }

    const activeOperationId = activeOperationIdsByFileId.get(fileId);

    if (operationId && activeOperationId !== operationId) {
      return;
    }

    this.updateProgress(fileId, progress);
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
  // Actions - Live OCR Detections
  // -------------------------------------------------------------------------
  addLiveDetection(fileId: string, operationId: string | null | undefined, detection: OcrZoneFrame) {
    if (cancelledFileIds.has(fileId)) {
      return;
    }

    const activeOperationId = activeOperationIdsByFileId.get(fileId);

    if (!activeOperationId || operationId !== activeOperationId) {
      return;
    }

    const existing = liveDetectionsByFileId.get(fileId) ?? [];
    const next = [...existing, cloneLiveDetection(detection)].slice(-100);
    liveDetectionsByFileId = new Map(liveDetectionsByFileId).set(fileId, next);
    liveDetectionCountsByFileId = new Map(liveDetectionCountsByFileId).set(
      fileId,
      (liveDetectionCountsByFileId.get(fileId) ?? 0) + 1,
    );
  },

  getLiveDetections(fileId: string): OcrZoneFrame[] {
    return (liveDetectionsByFileId.get(fileId) ?? []).map(cloneLiveDetection);
  },

  getLiveDetectionCount(fileId: string): number {
    return liveDetectionCountsByFileId.get(fileId) ?? 0;
  },

  clearLiveDetections(fileId: string) {
    if (!liveDetectionsByFileId.has(fileId) && !liveDetectionCountsByFileId.has(fileId)) {
      return;
    }

    const next = new Map(liveDetectionsByFileId);
    next.delete(fileId);
    liveDetectionsByFileId = next;

    const nextCounts = new Map(liveDetectionCountsByFileId);
    nextCounts.delete(fileId);
    liveDetectionCountsByFileId = nextCounts;
  },

  // -------------------------------------------------------------------------
  // Actions - Subtitles
  // -------------------------------------------------------------------------
  setOcrVersions(fileId: string, versions: OcrVersion[]) {
    this.clearLiveDetections(fileId);
    videoFiles = videoFiles.map(f =>
      f.id === fileId
        ? {
            ...setOcrVersionsForFile(f, versions),
            status: versions.length > 0 ? 'completed' as const : f.status,
            progress: undefined,
            error: undefined,
          }
        : f
    );
  },

  addOcrVersion(fileId: string, version: OcrVersion) {
    this.clearLiveDetections(fileId);
    videoFiles = videoFiles.map(f => {
      if (f.id !== fileId) {
        return f;
      }

      return {
        ...appendOcrVersionFromRenderedSelection(f, version),
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
    config = { ...config, ...updates, threadCount: DEFAULT_OCR_WORKER_COUNT };
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
    const nextOperationId = operationId ?? fileId;
    isProcessing = true;
    currentProcessingId = fileId;
    currentOperationId = nextOperationId;
    activeOperationIdsByFileId = new Map(activeOperationIdsByFileId).set(fileId, nextOperationId);
    this.clearLiveDetections(fileId);
    this.addLog('info', 'Starting OCR processing...', fileId);
  },

  stopProcessing() {
    isProcessing = false;
    currentProcessingId = null;
    currentOperationId = null;
    activeOperationIdsByFileId = new Map();
    liveDetectionsByFileId = new Map();
    liveDetectionCountsByFileId = new Map();
    cancelledFileIds = new Set();
    isCancelling = false;
    processingScopeFileIds = new Set();
  },

  cancelProcessing(fileId: string) {
    cancelledFileIds = new Set([...cancelledFileIds, fileId]);
    const nextActiveOperationIds = new Map(activeOperationIdsByFileId);
    nextActiveOperationIds.delete(fileId);
    activeOperationIdsByFileId = nextActiveOperationIds;
    this.clearLiveDetections(fileId);

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
    liveDetectionsByFileId = new Map();
    liveDetectionCountsByFileId = new Map();

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
    const file = fileId ? videoFiles.find(f => f.id === fileId) : undefined;
    const logMessage = file ? `[${file.name}] ${message}` : message;

    logStore.addLog({
      level,
      source: 'video-ocr',
      title: message,
      details: logMessage,
      context: file ? { filePath: file.path } : undefined,
    });

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
    activeOperationIdsByFileId = new Map();
    liveDetectionsByFileId = new Map();
    liveDetectionCountsByFileId = new Map();
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
  return ['transcoding', 'extracting_frames', 'ocr_processing', 'generating_subs'].includes(status);
}

function getPreparedFileStatus(file: OcrVideoFile): OcrFileStatus {
  return file.ocrVersions.length > 0 ? 'completed' : 'ready';
}

function getStatusForProgressPhase(phase: OcrPhase): OcrFileStatus {
  switch (phase) {
    case 'extracting':
      return 'extracting_frames';
    case 'ocr':
      return 'ocr_processing';
    case 'generating':
      return 'generating_subs';
    case 'transcoding':
      return 'transcoding';
  }
}

const OCR_PHASE_ORDER: Record<OcrPhase, number> = {
  transcoding: 0,
  extracting: 1,
  ocr: 2,
  generating: 3,
};

const OCR_PHASE_PROGRESS_RANGES: Record<Exclude<OcrPhase, 'transcoding'>, { start: number; end: number }> = {
  extracting: { start: 0, end: 25 },
  ocr: { start: 25, end: 95 },
  generating: { start: 95, end: 100 },
};

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function getPhaseOrder(phase: OcrPhase): number {
  return OCR_PHASE_ORDER[phase] ?? 0;
}

function getOverallPercentage(progress: OcrProgress): number {
  if (typeof progress.overallPercentage === 'number') {
    return clampPercentage(progress.overallPercentage);
  }

  if (progress.phase === 'transcoding') {
    return clampPercentage(progress.percentage);
  }

  const range = OCR_PHASE_PROGRESS_RANGES[progress.phase];
  const phasePercentage = clampPercentage(progress.percentage);
  return clampPercentage(range.start + ((range.end - range.start) * phasePercentage) / 100);
}

function mergeProgress(previous: OcrProgress | undefined, incoming: OcrProgress): OcrProgress {
  const normalizedIncoming: OcrProgress = {
    ...incoming,
    current: Math.max(0, Math.round(incoming.current)),
    total: Math.max(0, Math.round(incoming.total)),
    percentage: clampPercentage(incoming.percentage),
  };

  if (!previous) {
    return {
      ...normalizedIncoming,
      overallPercentage: getOverallPercentage(normalizedIncoming),
    };
  }

  const previousOrder = getPhaseOrder(previous.phase);
  const incomingOrder = getPhaseOrder(normalizedIncoming.phase);

  if (incomingOrder < previousOrder) {
    return previous;
  }

  if (incomingOrder > previousOrder && previous.percentage < 100 && previous.phase !== 'extracting') {
    return previous;
  }

  const merged =
    incomingOrder === previousOrder
      ? {
          ...normalizedIncoming,
          current: Math.max(previous.current, normalizedIncoming.current),
          total: normalizedIncoming.total > 0 ? normalizedIncoming.total : previous.total,
          percentage: Math.max(previous.percentage, normalizedIncoming.percentage),
          message: normalizedIncoming.message ?? previous.message,
        }
      : normalizedIncoming;

  return {
    ...merged,
    overallPercentage: getOverallPercentage(merged),
  };
}

function mergeFileProgress(file: OcrVideoFile, incomingProgress: OcrProgress): OcrVideoFile {
  const progress = mergeProgress(file.progress, incomingProgress);

  return {
    ...file,
    status: getStatusForProgressPhase(progress.phase),
    progress,
  };
}
