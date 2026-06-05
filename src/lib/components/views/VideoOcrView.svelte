<script lang="ts" module>
  export interface VideoOcrViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }

  export interface VideoOcrLayoutState {
    rootClass: string;
    optionsWidth: string;
    showFileSidebar: boolean;
    showOptionsPanel: boolean;
  }

  export function getVideoOcrLayoutState(
    optionsPanelWidth: string,
    previewExpanded: boolean,
    previewAvailable: boolean,
  ): VideoOcrLayoutState {
    if (previewExpanded && previewAvailable) {
      return {
        rootClass: 'grid h-full overflow-hidden grid-cols-[minmax(0,1fr)]',
        optionsWidth: '0rem',
        showFileSidebar: false,
        showOptionsPanel: false,
      };
    }

    return {
      rootClass: 'grid h-full overflow-hidden grid-cols-[auto_minmax(0,1fr)_var(--ocr-options-width)] transition-[grid-template-columns] duration-220 ease-out',
      optionsWidth: optionsPanelWidth,
      showFileSidebar: true,
      showOptionsPanel: true,
    };
  }
</script>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { open } from '@tauri-apps/plugin-dialog';
  import { toast } from 'svelte-sonner';

  import * as Sheet from '$lib/components/ui/sheet';
  import type {
    OcrConfig,
    OcrLiveDetectionEvent,
    OcrModelsStatus,
    OcrProgressEvent,
    OcrRegion,
    OcrRetryMode,
    OcrVideoFile,
    OcrVersion,
    OcrZoneRole,
    VideoOcrSelection,
    VideoOcrPersistenceData,
  } from '$lib/types';
  import { isLLMSelectionAvailable, VIDEO_EXTENSIONS } from '$lib/types';
  import { createAsyncTaskQueue } from '$lib/services/async-task-queue';
  import { scanFile } from '$lib/services/ffprobe';
  import {
    generateOcrVersionName,
    isUnsupportedOcrPersistenceError,
    loadOcrData,
    saveOcrData,
  } from '$lib/services/ocr-storage';
  import {
    cancelOcrPreview,
    getReusableOcrPreview,
    invalidateOcrPreview,
    prepareOcrPreview,
  } from '$lib/services/ocr-preview';
  import { mediaflowModelCatalogStore, settingsStore, toolImportStore, videoOcrStore } from '$lib/stores';
  import {
    OcrOptionsPanel,
    VideoOcrDialogs,
    VideoOcrSidebar,
    VideoOcrWorkspace,
  } from '$lib/components/video-ocr';
  import {
    isOcrActiveStatus,
    processVideoOcrFile,
    summarizeOcrFiles,
  } from '$lib/components/video-ocr/video-ocr-processing';
  import {
    buildOcrVersionKey,
    createOcrVersionedImportItems,
  } from '$lib/components/video-ocr/ocr-versioned-export';
  import type { ProcessVideoOcrFileResult } from '$lib/components/video-ocr/video-ocr-processing';
  import { createOcrSegmentFromZone } from '$lib/utils';
  import { logAndToast } from '$lib/utils/log-toast';

  const VIDEO_FORMATS = VIDEO_EXTENSIONS.map((ext) => ext.toUpperCase()).join(', ');
  const FILE_PREPARATION_CONCURRENCY = 1;
  const OPTIONS_PANEL_BREAKPOINT_PX = 1280;

  interface VideoOcrViewProps {
    onNavigateToSettings?: () => void;
    optionsSheetOpen?: boolean;
    optionsPanelCompact?: boolean;
    isActive?: boolean;
  }

  type RemoveTarget = { mode: 'single'; fileId: string } | { mode: 'all' } | null;

  let {
    onNavigateToSettings,
    optionsSheetOpen = $bindable(false),
    optionsPanelCompact = $bindable(true),
    isActive = true,
  }: VideoOcrViewProps = $props();

  let viewContainerEl = $state<HTMLDivElement | null>(null);
  let resultDialogOpen = $state(false);
  let resultDialogFileId = $state<string | null>(null);
  let retryDialogOpen = $state(false);
  let retryDialogFileId = $state<string | null>(null);
  let retryAllDialogOpen = $state(false);
  let unsupportedDataDialogOpen = $state(false);
  let unsupportedDataFileName = $state('');
  let unsupportedDataMessage = $state('');
  let removeDialogOpen = $state(false);
  let removeTarget = $state.raw<RemoveTarget>(null);
  let persistedOcrVersionKeys = $state<Set<string>>(new Set());
  let previewExpanded = $state(false);
  let unlistenOcrProgress: UnlistenFn | null = null;
  let unlistenOcrLiveDetection: UnlistenFn | null = null;
  let pendingOptionsLayoutFrame: number | null = null;
  let isDestroyed = false;

  const aiCleanupControllers = new Map<string, AbortController>();
  const activePreviewFileIds = new Set<string>();
  const cancelledPreviewFileIds = new Set<string>();
  const previewPlaybackFallbackFileIds = new Set<string>();
  const filePreparationQueue = createAsyncTaskQueue(FILE_PREPARATION_CONCURRENCY);
  const persistenceQueues = new Map<string, Promise<void>>();

  const selectedFile = $derived(videoOcrStore.selectedFile ?? null);
  const selectedActiveSelection = $derived(
    selectedFile ? videoOcrStore.getActiveOcrSelection(selectedFile.id) : null,
  );
  const selectedActiveSubtitles = $derived(
    selectedFile ? videoOcrStore.getActiveOcrSubtitles(selectedFile.id) : [],
  );
  const selectedHasDraftVersion = $derived(
    selectedFile ? videoOcrStore.hasDraftOcrVersion(selectedFile.id) : false,
  );
  const selectedDraftVersionName = $derived(
    selectedFile ? videoOcrStore.getDraftOcrVersionName(selectedFile.id) : null,
  );
  const selectedLiveDetections = $derived(
    selectedFile ? videoOcrStore.getLiveDetections(selectedFile.id) : [],
  );
  const selectedLiveDetectionCount = $derived(
    selectedFile ? videoOcrStore.getLiveDetectionCount(selectedFile.id) : 0,
  );
  const optionsPanelWidth = $derived(optionsPanelCompact ? '0rem' : '20rem');
  const previewMediaAvailable = $derived(Boolean(selectedFile?.previewPath));
  const effectivePreviewExpanded = $derived(previewExpanded && previewMediaAvailable);
  const videoOcrLayout = $derived(
    getVideoOcrLayoutState(optionsPanelWidth, previewExpanded, previewMediaAvailable),
  );
  const optionsPanelClass = $derived(
    optionsPanelCompact
      ? 'pointer-events-none translate-x-3 border-transparent opacity-0'
      : 'translate-x-0 border-border opacity-100',
  );
  const resultDialogFile = $derived(
    resultDialogFileId
      ? videoOcrStore.videoFiles.find((file) => file.id === resultDialogFileId) ?? null
      : null,
  );
  const retryDialogFile = $derived(
    retryDialogFileId
      ? videoOcrStore.videoFiles.find((file) => file.id === retryDialogFileId) ?? null
      : null,
  );
  const dialogsOpen = $derived(
    resultDialogOpen || retryDialogOpen || retryAllDialogOpen || unsupportedDataDialogOpen,
  );
  const fileSummary = $derived.by(() => summarizeOcrFiles(videoOcrStore.videoFiles));
  const startCount = $derived(fileSummary.startTargets.length);
  const retryCount = $derived(fileSummary.retryTargets.length);
  const aiCleanupModelAvailable = $derived(canUseVideoOcrAiCleanup(videoOcrStore.config));
  const primaryAction = $derived.by<'start' | 'retry'>(() => {
    if (startCount > 0) {
      return 'start';
    }

    if (retryCount > 0) {
      return 'retry';
    }

    return 'start';
  });
  const canStart = $derived(
    startCount > 0
      && !videoOcrStore.isProcessing
      && (!videoOcrStore.config.aiCleanupEnabled || aiCleanupModelAvailable)
  );
  const canRetryAll = $derived(retryCount > 0 && !videoOcrStore.isProcessing);
  const actionHint = $derived.by(() => {
    if (fileSummary.scanningCount > 0) {
      return 'Wait for scanning to complete';
    }

    if (fileSummary.transcodingCount > 0) {
      return 'Wait for preview transcoding to complete';
    }

    if (videoOcrStore.videoFiles.length === 0) {
      return 'Add videos to begin';
    }

    if (startCount > 0 && videoOcrStore.config.aiCleanupEnabled && !aiCleanupModelAvailable) {
      return 'Select an available AI cleanup model';
    }

    return 'No files ready for OCR';
  });

  function doesVideoOcrConfigRunAi(mode: OcrRetryMode, config: OcrConfig): boolean {
    return mode === 'cleanup_and_ai'
      || mode === 'ai_only'
      || (mode === 'full_pipeline' && config.aiCleanupEnabled);
  }

  function canUseVideoOcrAiCleanup(config: OcrConfig): boolean {
    return isLLMSelectionAvailable(
      config.aiCleanupProvider,
      config.aiCleanupModel,
      import.meta.env.DEV,
      mediaflowModelCatalogStore.chatModels,
    );
  }

  function warnAiCleanupUnavailable(): void {
    toast.warning('Selected AI cleanup model is unavailable.');
  }

  function getFreshFile(fileId: string): OcrVideoFile | undefined {
    return videoOcrStore.videoFiles.find((file) => file.id === fileId);
  }

  function getObservedInlineSize(entry: ResizeObserverEntry): number {
    const borderBoxSize = entry.borderBoxSize as
      | ResizeObserverSize
      | readonly ResizeObserverSize[]
      | undefined;

    if (Array.isArray(borderBoxSize)) {
      return borderBoxSize[0]?.inlineSize ?? entry.contentRect.width;
    }

    if (borderBoxSize && 'inlineSize' in borderBoxSize) {
      return borderBoxSize.inlineSize;
    }

    return entry.contentRect.width;
  }

  function reportOptionsPanelLayout(width: number): void {
    const nextCompact = width < OPTIONS_PANEL_BREAKPOINT_PX;
    if (optionsPanelCompact !== nextCompact) {
      optionsPanelCompact = nextCompact;
    }

    if (!nextCompact && optionsSheetOpen) {
      optionsSheetOpen = false;
    }
  }

  function scheduleOptionsPanelLayoutReport(width: number): void {
    if (pendingOptionsLayoutFrame !== null) {
      cancelAnimationFrame(pendingOptionsLayoutFrame);
    }

    pendingOptionsLayoutFrame = requestAnimationFrame(() => {
      pendingOptionsLayoutFrame = null;
      reportOptionsPanelLayout(width);
    });
  }

  function createOcrOperationId(fileId: string): string {
    return `${fileId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function markPersistedOcrVersions(videoPath: string, versions: OcrVersion[]): void {
    if (versions.length === 0) {
      return;
    }

    const next = new Set(persistedOcrVersionKeys);
    for (const version of versions) {
      next.add(buildOcrVersionKey(videoPath, version.id));
    }
    persistedOcrVersionKeys = next;
  }

  function clearPersistedOcrVersionsForPath(videoPath: string): void {
    const prefix = `${videoPath}::`;
    persistedOcrVersionKeys = new Set(
      Array.from(persistedOcrVersionKeys).filter((key) => !key.startsWith(prefix)),
    );
  }

  function closeResultDialog(): void {
    resultDialogOpen = false;
    resultDialogFileId = null;
  }

  function closeRetryDialog(): void {
    retryDialogOpen = false;
    retryDialogFileId = null;
  }

  function closeRetryAllDialog(): void {
    retryAllDialogOpen = false;
  }

  function closeUnsupportedDataDialog(): void {
    unsupportedDataDialogOpen = false;
    unsupportedDataFileName = '';
    unsupportedDataMessage = '';
  }

  function showUnsupportedDataDialog(file: OcrVideoFile, error: unknown): void {
    unsupportedDataFileName = file.name;
    unsupportedDataMessage = error instanceof Error
      ? error.message
      : 'This Video OCR data is not compatible with this MediaFlow version.';
    unsupportedDataDialogOpen = true;
  }

  function handleRemoveDialogOpenChange(open: boolean): void {
    removeDialogOpen = open;
    if (!open) {
      removeTarget = null;
    }
  }

  function resetDialogsForFile(fileId: string): void {
    if (resultDialogFileId === fileId) {
      closeResultDialog();
    }

    if (retryDialogFileId === fileId) {
      closeRetryDialog();
    }
  }

  function resetAllDialogs(): void {
    closeResultDialog();
    closeRetryDialog();
    closeRetryAllDialog();
    closeUnsupportedDataDialog();
    handleRemoveDialogOpenChange(false);
  }

  async function initializeView(): Promise<void> {
    if (!settingsStore.isLoaded) {
      try {
        await settingsStore.load();
        if (isDestroyed) {
          return;
        }
      } catch (error) {
        if (isDestroyed) {
          return;
        }
        console.error('Failed to load settings:', error);
      }
    }

    if (isDestroyed) {
      return;
    }

    if (!videoOcrStore.modelsChecked) {
      try {
        const status = await invoke<OcrModelsStatus>('check_ocr_models');
        if (isDestroyed) {
          return;
        }

        videoOcrStore.setModelsStatus(status);

        if (!status.installed) {
          toast.warning('OCR models not found. Some languages may not be available.');
        }
      } catch (error) {
        if (isDestroyed) {
          return;
        }
        console.error('Failed to check OCR models:', error);
      }
    }

    if (isDestroyed) {
      return;
    }

    const unlistenProgress = await listen<OcrProgressEvent>('ocr-progress', (event) => {
      const {
        fileId,
        operationId,
        phase,
        current,
        total,
        overallPercentage,
        message,
        transcodingCodec,
      } = event.payload;

      if (phase === 'transcoding') {
        videoOcrStore.updateTranscodingProgress(fileId, current);
        if (transcodingCodec) {
          videoOcrStore.setTranscodingCodec(fileId, transcodingCodec);
        }
        return;
      }

      videoOcrStore.updateProgressForOperation(fileId, operationId, {
        phase,
        current,
        total,
        percentage: total > 0 ? Math.round((current / total) * 100) : 0,
        overallPercentage,
        message,
      });
    });

    if (isDestroyed) {
      unlistenProgress();
      return;
    }

    const unlistenLiveDetection = await listen<OcrLiveDetectionEvent>('ocr-live-detection', (event) => {
      const { fileId, operationId, detection } = event.payload;
      videoOcrStore.addLiveDetection(fileId, operationId, detection);
    });

    if (isDestroyed) {
      unlistenProgress();
      unlistenLiveDetection();
      return;
    }

    unlistenOcrProgress = unlistenProgress;
    unlistenOcrLiveDetection = unlistenLiveDetection;
  }

  onMount(() => {
    void initializeView();
  });

  onDestroy(() => {
    isDestroyed = true;

    filePreparationQueue.clear();
    for (const file of videoOcrStore.videoFiles) {
      if (file.status === 'scanning') {
        videoOcrStore.cancelFilePreparation(file.id);
      }
    }

    for (const fileId of activePreviewFileIds) {
      videoOcrStore.cancelFilePreparation(fileId);
      void cancelOcrPreview(fileId).catch((error: unknown) => {
        console.error('Failed to cancel preview during view teardown:', error);
      });
    }
    activePreviewFileIds.clear();
    previewPlaybackFallbackFileIds.clear();

    for (const controller of aiCleanupControllers.values()) {
      controller.abort();
    }
    aiCleanupControllers.clear();
    unlistenOcrProgress?.();
    unlistenOcrLiveDetection?.();
  });

  async function persistFileData(fileId: string): Promise<boolean> {
    const initialFile = getFreshFile(fileId);
    if (!initialFile) {
      return false;
    }

    const videoPath = initialFile.path;
    let saved = false;
    const previous = persistenceQueues.get(videoPath) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      let existingData: VideoOcrPersistenceData | null = null;
      try {
        existingData = await loadOcrData(videoPath);
      } catch (error) {
        const latestFile = getFreshFile(fileId);
        if (latestFile && isUnsupportedOcrPersistenceError(error)) {
          showUnsupportedDataDialog(latestFile, error);
          videoOcrStore.setFileStatus(latestFile.id, 'error', error.message);
          saved = false;
          return;
        }

        throw error;
      }

      const latestFile = getFreshFile(fileId);
      if (!latestFile || latestFile.path !== videoPath) {
        saved = false;
        return;
      }

      const now = new Date().toISOString();
      const payload: VideoOcrPersistenceData = {
        version: 2,
        videoPath,
        previewPath: latestFile.previewPath,
        previewSourceIdentity: latestFile.previewSourceIdentity,
        previewVersion: latestFile.previewVersion,
        ocrSelection: latestFile.ocrSelection,
        activeOcrVersionId: latestFile.activeOcrVersionId,
        draft: latestFile.draft,
        ocrVersions: latestFile.ocrVersions,
        createdAt: existingData?.createdAt ?? now,
        updatedAt: now,
      };

      saved = await saveOcrData(videoPath, payload);
    });

    persistenceQueues.set(videoPath, next);
    try {
      await next;
      return saved;
    } finally {
      if (persistenceQueues.get(videoPath) === next) {
        persistenceQueues.delete(videoPath);
      }
    }
  }

  function applyPersistedFileState(
    file: OcrVideoFile,
    persisted: VideoOcrPersistenceData | null,
  ): void {
    if (!persisted) {
      return;
    }

    videoOcrStore.updateFile(file.id, {
      ocrSelection: persisted.ocrSelection,
      ocrVersions: persisted.ocrVersions,
      activeOcrVersionId: persisted.activeOcrVersionId,
      draft: persisted.draft,
    });

    if (persisted.ocrVersions.length > 0) {
      markPersistedOcrVersions(file.path, persisted.ocrVersions);
    }
  }

  async function restoreCachedPreview(
    file: OcrVideoFile,
    persisted: VideoOcrPersistenceData | null,
  ): Promise<boolean> {
    let cachedPreview: Awaited<ReturnType<typeof getReusableOcrPreview>>;
    try {
      cachedPreview = await getReusableOcrPreview(file.path, persisted);
    } catch (error) {
      if (isDestroyed || !getFreshFile(file.id)) {
        return false;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      videoOcrStore.addLog('warning', `Failed to check cached preview: ${errorMsg}`, file.id);
      return false;
    }

    if (isDestroyed || !getFreshFile(file.id)) {
      return false;
    }

    if (!cachedPreview) {
      return false;
    }

    videoOcrStore.updateFile(file.id, {
      previewPath: cachedPreview.path,
      previewSourceIdentity: cachedPreview.sourceIdentity,
      previewVersion: cachedPreview.previewVersion,
      previewError: undefined,
      isTranscoding: false,
      transcodingProgress: 100,
      transcodingCodec: undefined,
      status: (persisted?.ocrVersions.length ?? 0) > 0 ? 'completed' : 'ready',
    });
    videoOcrStore.addLog('info', 'Loaded cached preview video', file.id);
    return true;
  }

  async function ensurePreviewReady(file: OcrVideoFile): Promise<void> {
    const current = getFreshFile(file.id);
    if (!current || current.previewPath || current.status === 'error') {
      return;
    }

    videoOcrStore.addLog(
      'info',
      'Preparing local preview video',
      file.id,
    );
    await preparePreviewForFile(current);
  }

  async function initializeAddedFile(file: OcrVideoFile): Promise<void> {
    try {
      videoOcrStore.updateFile(file.id, {
        status: 'scanning',
        error: undefined,
      });

      const probeResult = await scanFile(file.path);
      if (isDestroyed || !getFreshFile(file.id)) {
        return;
      }

      if (probeResult.status === 'error') {
        videoOcrStore.setFileStatus(file.id, 'error', probeResult.error ?? 'Scan failed');
        return;
      }

      const videoTrack = probeResult.tracks.find((track) => track.type === 'video');

      videoOcrStore.updateFile(file.id, {
        duration: probeResult.duration,
        width: videoTrack?.width,
        height: videoTrack?.height,
        size: probeResult.size || file.size,
      });

      const persisted = await loadOcrData(file.path);
      if (isDestroyed || !getFreshFile(file.id)) {
        return;
      }

      applyPersistedFileState(file, persisted);

      const hasCachedPreview = await restoreCachedPreview(file, persisted);
      if (isDestroyed || !getFreshFile(file.id)) {
        return;
      }

      if (!hasCachedPreview) {
        await ensurePreviewReady(file);
      }
    } catch (error) {
      if (isDestroyed || !getFreshFile(file.id)) {
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'Scan failed';
      videoOcrStore.setFileStatus(file.id, 'error', errorMessage);
      if (isUnsupportedOcrPersistenceError(error)) {
        showUnsupportedDataDialog(file, error);
      }
    }
  }

  export async function handleFileDrop(paths: string[]): Promise<void> {
    const videoExtensions = new Set(VIDEO_EXTENSIONS);
    const videoPaths = paths.filter((path) => {
      const ext = path.split('.').pop()?.toLowerCase() || '';
      return videoExtensions.has(ext as typeof VIDEO_EXTENSIONS[number]);
    });

    if (videoPaths.length === 0) {
      toast.warning('No video files found');
      return;
    }

    await addFiles(videoPaths);
  }

  async function handleAddFiles(): Promise<void> {
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Video files',
        extensions: [...VIDEO_EXTENSIONS],
      }],
    });

    if (!selected) {
      return;
    }

    await addFiles(Array.isArray(selected) ? selected : [selected]);
  }

  async function addFiles(paths: string[]): Promise<void> {
    const newFiles = videoOcrStore.addFilesFromPaths(paths);
    for (const file of newFiles) {
      queueFileInitialization(file);
    }
  }

  function queueFileInitialization(file: OcrVideoFile): void {
    filePreparationQueue.enqueue(async () => {
      if (isDestroyed || !getFreshFile(file.id)) {
        return;
      }

      await initializeAddedFile(file);
    });
  }

  async function preparePreviewForFile(
    file: OcrVideoFile,
    options: { forceFullTranscode?: boolean } = {},
  ): Promise<boolean> {
    if (activePreviewFileIds.has(file.id)) {
      return false;
    }

    try {
      if (isDestroyed || !getFreshFile(file.id)) {
        return false;
      }

      videoOcrStore.startTranscoding(file.id);
      activePreviewFileIds.add(file.id);

      const preview = await prepareOcrPreview(file.path, file.id, {
        forceFullTranscode: options.forceFullTranscode,
      });
      if (cancelledPreviewFileIds.delete(file.id)) {
        await invalidateOcrPreview(file.path).catch((error: unknown) => {
          console.error('Failed to invalidate cancelled preview:', error);
        });
        return false;
      }

      if (preview.path === file.path) {
        throw new Error('Preview generation returned the source file path');
      }

      if (isDestroyed || !getFreshFile(file.id)) {
        return false;
      }

      videoOcrStore.finishTranscoding(
        file.id,
        preview.path,
        preview.sourceIdentity,
        preview.previewVersion,
      );
      videoOcrStore.addLog(
        'info',
        options.forceFullTranscode
          ? 'Fallback preview transcoding complete'
          : 'Preview transcoding complete',
        file.id,
      );

      const saved = await persistFileData(file.id);
      if (!saved) {
        videoOcrStore.addLog('warning', 'Failed to persist transcoded preview path to .mediaflow.json file', file.id);
      }

      return true;
    } catch (error) {
      const current = getFreshFile(file.id);
      if (isDestroyed || !current) {
        return false;
      }

      if (cancelledPreviewFileIds.delete(file.id)) {
        return false;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      videoOcrStore.failPreviewTranscoding(file.id, errorMsg);
      await persistFileData(file.id);
      logAndToast.warning({
        source: 'ffmpeg',
        title: `Preview transcode failed: ${file.name}`,
        details: errorMsg,
      });
      return false;
    } finally {
      activePreviewFileIds.delete(file.id);
    }
  }

  async function handlePreviewPlaybackError(fileId: string, reason: string): Promise<void> {
    const file = getFreshFile(fileId);
    if (!file?.previewPath) {
      return;
    }

    if (previewPlaybackFallbackFileIds.has(file.id)) {
      return;
    }
    previewPlaybackFallbackFileIds.add(file.id);

    try {
      await invalidateOcrPreview(file.path);
    } catch (error) {
      if (isDestroyed || !getFreshFile(file.id)) {
        return;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      videoOcrStore.addLog('warning', `Failed to invalidate preview cache: ${errorMsg}`, file.id);
    }

    if (isDestroyed || !getFreshFile(file.id)) {
      return;
    }

    videoOcrStore.updateFile(file.id, {
      previewPath: undefined,
      previewSourceIdentity: undefined,
      previewVersion: undefined,
      previewError: reason,
      status: file.ocrVersions.length > 0 ? 'completed' : 'ready',
    });
    videoOcrStore.addLog('warning', `Generated preview playback error: ${reason}`, file.id);
    await persistFileData(file.id);

    const current = getFreshFile(file.id);
    if (!current) {
      return;
    }

    videoOcrStore.addLog('info', 'Retrying preview with full transcode fallback', file.id);
    await preparePreviewForFile(current, { forceFullTranscode: true });
  }

  async function handleStartOcr(): Promise<void> {
    const startTargets = [...fileSummary.startTargets];
    if (startTargets.length === 0) {
      toast.warning('No ready files to process');
      return;
    }

    if (videoOcrStore.config.aiCleanupEnabled && !canUseVideoOcrAiCleanup(videoOcrStore.config)) {
      warnAiCleanupUnavailable();
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let cancelledCount = 0;

    videoOcrStore.setProcessingScope(startTargets.map((file) => file.id));

    try {
      for (const entry of startTargets) {
        if (videoOcrStore.isCancelling) {
          break;
        }

        const file = getFreshFile(entry.id) ?? entry;
        const versionName = generateOcrVersionName(file.ocrVersions);
        const operationId = createOcrOperationId(file.id);

        videoOcrStore.startProcessing(file.id, operationId);
        const result = await processVideoOcrFile({
          file,
          operationId,
          versionName,
          mode: 'full_pipeline',
          config: { ...videoOcrStore.config },
          aiCleanupControllers,
          getFreshFile,
          persistFileData,
          markPersistedVersions: markPersistedOcrVersions,
        });

        if (result.success) {
          successCount += 1;
        } else if (videoOcrStore.isFileCancelled(file.id)) {
          cancelledCount += 1;
        } else {
          failCount += 1;
        }
      }
    } finally {
      videoOcrStore.stopProcessing();
    }

    if (successCount > 0 || failCount > 0 || cancelledCount > 0) {
      const parts: string[] = [];
      if (successCount > 0) parts.push(`${successCount} completed`);
      if (failCount > 0) parts.push(`${failCount} failed`);
      if (cancelledCount > 0) parts.push(`${cancelledCount} cancelled`);
      toast.success(`OCR finished: ${parts.join(', ')}`);
    }
  }

  function handleOpenRetryAllDialog(): void {
    if (fileSummary.retryTargets.length === 0) {
      toast.warning('No files with OCR versions available for retry');
      return;
    }

    retryAllDialogOpen = true;
  }

  async function handleRetryConfirm(
    fileId: string,
    versionName: string,
    mode: OcrRetryMode,
    config: OcrConfig,
  ): Promise<void> {
    const file = getFreshFile(fileId);
    if (!file) {
      return;
    }

    if (doesVideoOcrConfigRunAi(mode, config) && !canUseVideoOcrAiCleanup(config)) {
      warnAiCleanupUnavailable();
      return;
    }

    videoOcrStore.updateFile(file.id, {
      status: 'ready',
      progress: undefined,
      error: undefined,
    });

    videoOcrStore.setProcessingScope([file.id]);
    const operationId = createOcrOperationId(file.id);
    videoOcrStore.startProcessing(file.id, operationId);

    let result: ProcessVideoOcrFileResult;
    try {
      result = await processVideoOcrFile({
        file,
        operationId,
        versionName,
        mode,
        config,
        aiCleanupControllers,
        getFreshFile,
        persistFileData,
        markPersistedVersions: markPersistedOcrVersions,
      });
    } finally {
      videoOcrStore.stopProcessing();
    }

    if (result.success) {
      toast.success(`Created ${versionName} (${result.effectiveMode.replaceAll('_', ' ')})`);
    }
  }

  async function handleRetryAllConfirm(mode: OcrRetryMode, config: OcrConfig): Promise<void> {
    const retryTargets = [...fileSummary.retryTargets];
    if (retryTargets.length === 0) {
      return;
    }

    if (doesVideoOcrConfigRunAi(mode, config) && !canUseVideoOcrAiCleanup(config)) {
      warnAiCleanupUnavailable();
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let cancelledCount = 0;
    let fallbackCount = 0;

    for (const target of retryTargets) {
      videoOcrStore.updateFile(target.id, {
        status: 'ready',
        progress: undefined,
        error: undefined,
      });
    }

    videoOcrStore.setProcessingScope(retryTargets.map((file) => file.id));

    try {
      for (const entry of retryTargets) {
        if (videoOcrStore.isCancelling) {
          break;
        }

        const file = getFreshFile(entry.id) ?? entry;
        const versionName = generateOcrVersionName(file.ocrVersions);
        const operationId = createOcrOperationId(file.id);

        videoOcrStore.startProcessing(file.id, operationId);
        const result = await processVideoOcrFile({
          file,
          operationId,
          versionName,
          mode,
          config,
          aiCleanupControllers,
          getFreshFile,
          persistFileData,
          markPersistedVersions: markPersistedOcrVersions,
          suppressFallbackToast: true,
        });

        if (mode !== 'full_pipeline' && result.effectiveMode === 'full_pipeline') {
          fallbackCount += 1;
        }

        if (result.success) {
          successCount += 1;
        } else if (videoOcrStore.isFileCancelled(file.id)) {
          cancelledCount += 1;
        } else {
          failCount += 1;
        }
      }
    } finally {
      videoOcrStore.stopProcessing();
    }

    if (successCount > 0 || failCount > 0 || cancelledCount > 0 || fallbackCount > 0) {
      const parts: string[] = [];
      if (successCount > 0) parts.push(`${successCount} completed`);
      if (failCount > 0) parts.push(`${failCount} failed`);
      if (cancelledCount > 0) parts.push(`${cancelledCount} cancelled`);
      if (fallbackCount > 0) parts.push(`${fallbackCount} fallback to full pipeline`);
      toast.success(`Retry all finished: ${parts.join(', ')}`);
    }
  }

  async function cancelBackendOperation(file: OcrVideoFile): Promise<void> {
    if (file.status === 'transcoding') {
      cancelledPreviewFileIds.add(file.id);
      await cancelOcrPreview(file.id);
      return;
    }

    await invoke('cancel_ocr_operation', { fileId: file.id });
  }

  async function handleCancelFile(fileId: string): Promise<void> {
    const file = getFreshFile(fileId);
    if (!file) {
      return;
    }

    aiCleanupControllers.get(fileId)?.abort();
    aiCleanupControllers.delete(fileId);

    try {
      await cancelBackendOperation(file);
    } catch (error) {
      console.error('Failed to cancel operation:', error);
    }

    if (file.status === 'transcoding') {
      videoOcrStore.cancelPreviewTranscoding(fileId);
    } else if (['extracting_frames', 'ocr_processing', 'generating_subs'].includes(file.status)) {
      videoOcrStore.cancelProcessing(fileId);
    }

    toast.info('Cancelled');
  }

  async function handleCancelAll(): Promise<void> {
    for (const controller of aiCleanupControllers.values()) {
      controller.abort();
    }
    aiCleanupControllers.clear();

    for (const file of videoOcrStore.videoFiles) {
      if (isOcrActiveStatus(file.status)) {
        try {
          await cancelBackendOperation(file);
        } catch {
          // Ignore individual cancel errors.
        }
      }
    }

    videoOcrStore.cancelAll();
    toast.info('Cancelling all...');
  }

  function collapsePreviewForRemovedFile(fileId: string): void {
    if (videoOcrStore.selectedFileId === fileId) {
      previewExpanded = false;
    }
  }

  async function handleRequestRemoveFile(fileId: string): Promise<void> {
    const file = getFreshFile(fileId);
    if (!file) {
      return;
    }

    if (!isOcrActiveStatus(file.status)) {
      resetDialogsForFile(fileId);
      clearPersistedOcrVersionsForPath(file.path);
      collapsePreviewForRemovedFile(fileId);
      videoOcrStore.removeFile(fileId);
      return;
    }

    removeTarget = { mode: 'single', fileId };
    removeDialogOpen = true;
  }

  function handleRequestRemoveAll(): void {
    const hasActiveFile = videoOcrStore.videoFiles.some((file) => isOcrActiveStatus(file.status));
    if (!hasActiveFile) {
      persistedOcrVersionKeys = new Set();
      resetAllDialogs();
      previewExpanded = false;
      videoOcrStore.clear();
      return;
    }

    removeTarget = { mode: 'all' };
    removeDialogOpen = true;
  }

  async function handleConfirmRemove(): Promise<void> {
    const target = removeTarget;
    if (!target) {
      return;
    }

    removeDialogOpen = false;

    if (target.mode === 'single') {
      const file = getFreshFile(target.fileId);
      if (!file) {
        removeTarget = null;
        return;
      }

      aiCleanupControllers.get(file.id)?.abort();
      aiCleanupControllers.delete(file.id);

      try {
        await cancelBackendOperation(file);
      } catch (error) {
        console.error('Failed to cancel OCR operation before removal:', error);
      }

      resetDialogsForFile(file.id);
      clearPersistedOcrVersionsForPath(file.path);
      collapsePreviewForRemovedFile(file.id);
      videoOcrStore.removeFile(file.id);
      removeTarget = null;
      return;
    }

    for (const controller of aiCleanupControllers.values()) {
      controller.abort();
    }
    aiCleanupControllers.clear();

    const files = [...videoOcrStore.videoFiles];
    for (const file of files) {
      if (isOcrActiveStatus(file.status)) {
        try {
          await cancelBackendOperation(file);
        } catch (error) {
          console.error('Failed to cancel OCR operation before clearing list:', error);
        }
      }
    }

    persistedOcrVersionKeys = new Set();
    resetAllDialogs();
    previewExpanded = false;
    videoOcrStore.clear();
  }

  function handleViewResult(file: OcrVideoFile): void {
    resultDialogFileId = file.id;
    resultDialogOpen = true;
  }

  function handleSelectOcrVersion(fileId: string, versionId: string | null): void {
    videoOcrStore.selectOcrVersion(fileId, versionId);
    void persistFileData(fileId);
  }

  function handleRetryFile(file: OcrVideoFile): void {
    retryDialogFileId = file.id;
    retryDialogOpen = true;
  }

  function handleAddSegmentFromRegion(
    fileId: string,
    region: OcrRegion,
    startTimeMs: number,
    endTimeMs: number,
  ): void {
    const file = getFreshFile(fileId) ?? selectedFile;
    if (!file) {
      return;
    }

    const durationMs = Math.max(1, Math.round((file.duration ?? 0) * 1000));
    const requestedEndTimeMs = endTimeMs > startTimeMs ? endTimeMs : durationMs;
    const segmentEndTimeMs = Math.max(1, Math.min(durationMs, requestedEndTimeMs));
    const segmentStartTimeMs = Math.min(
      Math.max(0, startTimeMs),
      Math.max(0, segmentEndTimeMs - 1),
    );
    const segment = createOcrSegmentFromZone(
      segmentStartTimeMs,
      segmentEndTimeMs,
      region,
      'main_subtitle',
    );

    videoOcrStore.addOcrSegment(file.id, segment);
    void persistFileData(file.id);
  }

  function handleSetZoneRole(fileId: string, segmentId: string, zoneId: string, role: OcrZoneRole): void {
    videoOcrStore.setOcrZoneRole(fileId, segmentId, zoneId, role);
    void persistFileData(fileId);
  }

  function handleRenameZone(fileId: string, segmentId: string, zoneId: string, label: string): void {
    videoOcrStore.setOcrZoneLabel(fileId, segmentId, zoneId, label);
    void persistFileData(fileId);
  }

  function handleUpdateZoneRegion(fileId: string, segmentId: string, zoneId: string, region: OcrRegion): void {
    videoOcrStore.setOcrZoneRegion(fileId, segmentId, zoneId, region);
    void persistFileData(fileId);
  }

  function applyTrimSegment(fileId: string, segmentId: string, startTimeMs: number, endTimeMs: number): boolean {
    const file = getFreshFile(fileId);
    if (!file) {
      return false;
    }

    videoOcrStore.trimOcrSegment(fileId, segmentId, startTimeMs, endTimeMs, Math.round((file.duration ?? 0) * 1000));

    return true;
  }

  function handlePreviewTrimSegment(fileId: string, segmentId: string, startTimeMs: number, endTimeMs: number): void {
    applyTrimSegment(fileId, segmentId, startTimeMs, endTimeMs);
  }

  function handleCommitTrimSegment(fileId: string, segmentId: string, startTimeMs: number, endTimeMs: number): void {
    if (!applyTrimSegment(fileId, segmentId, startTimeMs, endTimeMs)) {
      return;
    }

    void persistFileData(fileId);
  }

  function handleCutZone(fileId: string, segmentId: string, zoneId: string, cutTimeMs: number): void {
    const file = getFreshFile(fileId);
    if (!file) {
      return;
    }

    const didCut = videoOcrStore.cutOcrZone(
      fileId,
      segmentId,
      zoneId,
      cutTimeMs,
      Math.round((file.duration ?? 0) * 1000),
    );
    if (didCut) {
      void persistFileData(fileId);
    }
  }

  function handleDeleteZone(fileId: string, segmentId: string, zoneId: string): void {
    const file = getFreshFile(fileId);
    if (!file) {
      return;
    }

    const activeSelection = videoOcrStore.getActiveOcrSelection(fileId);
    const totalZones = activeSelection.segments.reduce(
      (count, segment) => count + segment.zones.length,
      0,
    );
    if (totalZones <= 1) {
      toast.warning('At least one OCR zone is required.');
      return;
    }

    const nextSelection: VideoOcrSelection = {
      segments: activeSelection.segments
        .map((segment) => ({
          ...segment,
          zones: segment.id === segmentId
            ? segment.zones.filter((zone) => zone.id !== zoneId)
            : segment.zones.map((zone) => ({ ...zone, region: { ...zone.region } })),
        }))
        .filter((segment) => segment.zones.length > 0),
    };

    videoOcrStore.setOcrSelection(fileId, nextSelection);
    void persistFileData(fileId);
  }

  $effect(() => {
    const versionedItems = createOcrVersionedImportItems(videoOcrStore.videoFiles, persistedOcrVersionKeys);

    toolImportStore.publishVersionedSource('ocr_versions', 'video-ocr', 'OCR', versionedItems);
  });

  $effect(() => {
    if (!isActive || !viewContainerEl) {
      return;
    }

    const observedElement = viewContainerEl;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      scheduleOptionsPanelLayoutReport(getObservedInlineSize(entry));
    });

    observer.observe(observedElement);
    scheduleOptionsPanelLayoutReport(observedElement.getBoundingClientRect().width);

    return () => {
      observer.disconnect();
      if (pendingOptionsLayoutFrame !== null) {
        cancelAnimationFrame(pendingOptionsLayoutFrame);
        pendingOptionsLayoutFrame = null;
      }
    };
  });

</script>

{#snippet ocrOptionsPanel()}
  <OcrOptionsPanel
    config={videoOcrStore.config}
    {canStart}
    {canRetryAll}
    isProcessing={videoOcrStore.isProcessing}
    {startCount}
    {retryCount}
    {actionHint}
    {primaryAction}
    availableLanguages={videoOcrStore.availableLanguages}
    onConfigChange={(updates) => videoOcrStore.updateConfig(updates)}
    onStart={handleStartOcr}
    onRetryAll={handleOpenRetryAllDialog}
    onCancel={handleCancelAll}
    {onNavigateToSettings}
  />
{/snippet}

<div bind:this={viewContainerEl} class="@container/video-ocr h-full overflow-hidden">
  <div
    class={videoOcrLayout.rootClass}
    style:--ocr-options-width={videoOcrLayout.optionsWidth}
  >
    {#if videoOcrLayout.showFileSidebar}
      <VideoOcrSidebar
        files={videoOcrStore.videoFiles}
        selectedFileId={videoOcrStore.selectedFileId}
        supportedFormats={VIDEO_FORMATS}
        isProcessing={videoOcrStore.isProcessing}
        transcodingCount={fileSummary.transcodingCount}
        onSelectFile={(fileId) => videoOcrStore.selectFile(fileId)}
        onRequestRemoveFile={handleRequestRemoveFile}
        onCancelFile={handleCancelFile}
        onViewResult={handleViewResult}
        onRetryFile={handleRetryFile}
        onAddFiles={handleAddFiles}
        onClearAll={handleRequestRemoveAll}
      />
    {/if}

    <div class="h-full min-w-0 min-h-0 overflow-hidden">
      <VideoOcrWorkspace
        file={selectedFile}
        activeSelection={selectedActiveSelection}
        activeSubtitles={selectedActiveSubtitles}
        liveDetections={selectedLiveDetections}
        liveDetectionCount={selectedLiveDetectionCount}
        {dialogsOpen}
        previewExpanded={effectivePreviewExpanded}
        hasDraftVersion={selectedHasDraftVersion}
        draftVersionName={selectedDraftVersionName}
        onPreviewExpandedChange={(expanded) => {
          previewExpanded = expanded && previewMediaAvailable;
        }}
        onSelectVersion={handleSelectOcrVersion}
        onAddSegmentFromRegion={handleAddSegmentFromRegion}
        onUpdateZoneRegion={handleUpdateZoneRegion}
        onSetZoneRole={handleSetZoneRole}
        onRenameZone={handleRenameZone}
        onDeleteZone={handleDeleteZone}
        onCutZone={handleCutZone}
        onPreviewTrimSegment={handlePreviewTrimSegment}
        onCommitTrimSegment={handleCommitTrimSegment}
        onPlaybackError={handlePreviewPlaybackError}
      />
    </div>

    {#if videoOcrLayout.showOptionsPanel}
      <aside
        class={`min-w-0 overflow-hidden border-l transition-[opacity,transform,border-color] duration-200 ease-out ${optionsPanelClass}`}
        aria-hidden={optionsPanelCompact}
        inert={optionsPanelCompact ? true : undefined}
      >
        <div class="h-full w-80 overflow-auto p-4">
          {@render ocrOptionsPanel()}
        </div>
      </aside>
    {/if}
  </div>
</div>

<Sheet.Root open={optionsSheetOpen} onOpenChange={(open) => optionsSheetOpen = open}>
  <Sheet.Content side="right" class="w-full sm:max-w-sm">
    <Sheet.Header class="sr-only">
      <Sheet.Title>OCR Options</Sheet.Title>
      <Sheet.Description>
        Adjust OCR language, timing, cleanup, and processing actions.
      </Sheet.Description>
    </Sheet.Header>
    <div class="min-h-0 flex-1 overflow-auto p-4 pt-6">
      {@render ocrOptionsPanel()}
    </div>
  </Sheet.Content>
</Sheet.Root>

<VideoOcrDialogs
  {resultDialogOpen}
  {resultDialogFile}
  {retryDialogOpen}
  {retryDialogFile}
  {retryAllDialogOpen}
  {unsupportedDataDialogOpen}
  {unsupportedDataFileName}
  {unsupportedDataMessage}
  {retryCount}
  retryAllMissingRawCount={fileSummary.retryAllMissingRawCount}
  baseConfig={videoOcrStore.config}
  {removeDialogOpen}
  {removeTarget}
  onResultDialogOpenChange={(open) => {
    if (!open) {
      closeResultDialog();
      return;
    }

    resultDialogOpen = true;
  }}
  onRetryDialogOpenChange={(open) => {
    if (!open) {
      closeRetryDialog();
      return;
    }

    retryDialogOpen = true;
  }}
  onRetryAllDialogOpenChange={(open) => {
    retryAllDialogOpen = open;
  }}
  onUnsupportedDataDialogOpenChange={(open) => {
    if (!open) {
      closeUnsupportedDataDialog();
      return;
    }

    unsupportedDataDialogOpen = true;
  }}
  onRetryConfirm={handleRetryConfirm}
  onRetryAllConfirm={handleRetryAllConfirm}
  onRemoveDialogOpenChange={handleRemoveDialogOpenChange}
  onConfirmRemove={handleConfirmRemove}
/>
