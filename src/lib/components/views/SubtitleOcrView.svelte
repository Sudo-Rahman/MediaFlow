<script lang="ts" module>
  export interface SubtitleOcrViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { open } from '@tauri-apps/plugin-dialog';

  import {
    SubtitleOcrImportTracksDialog,
    SubtitleOcrOptionsPanel,
    SubtitleOcrResultDialog,
    SubtitleOcrRetryAllDialog,
    SubtitleOcrRetryDialog,
    SubtitleOcrSidebar,
    SubtitleOcrWorkspace,
  } from '$lib/components/subtitle-ocr';
  import {
    buildStandaloneSubtitleOcrItems,
    getSubtitleOcrImportKind,
  } from '$lib/services/subtitle-ocr-import';
  import {
    createSubtitleOcrVersion,
    loadSubtitleOcrData,
    saveSubtitleOcrData,
  } from '$lib/services/subtitle-ocr-storage';
  import { cleanupSubtitleOcrCuesWithAi } from '$lib/services/subtitle-ocr-ai-cleanup';
  import { mediaflowModelCatalogStore, subtitleOcrStore } from '$lib/stores';
  import { isSubtitleOcrProgressPhaseStale } from '$lib/stores/subtitle-ocr-progress';
  import {
    isLLMSelectionAvailable,
    type SubtitleOcrCue,
    type SubtitleOcrCueBitmap,
    type SubtitleOcrConfig,
    type SubtitleOcrPipelineResult,
    type SubtitleOcrProgress,
    type SubtitleOcrLiveCueEvent,
    type SubtitleOcrRetryMode,
    type SubtitleOcrSourceItem,
    type SubtitleOcrStatus,
    type SubtitleOcrMediaInfo,
    type SubtitleOcrTrackMetadata,
    type SubtitleOcrVersion,
    type SubtitleOcrVobSubPair,
  } from '$lib/types';
  import { getFileName } from '$lib/utils/format';
  import { logAndToast } from '$lib/utils/log-toast';

  import {
    buildSubtitleOcrProgressFromEvent,
    buildSubtitleOcrSourceSnapshot,
    collectMissingSubtitleOcrBitmapAssets,
    filterSubtitleOcrPersistenceForItem,
    getSubtitleOcrActiveVersionItemIds,
    getSubtitleOcrBackendCancelTargets,
    getSubtitleOcrVersionedItemIds,
    mergeRestoredSubtitleOcrBitmapAssets,
    mergeSubtitleOcrPersistenceForItem,
    resolveSubtitleOcrExpectedBitmapCount,
    resolveSubtitleOcrEffectiveModelForConfig,
    shouldApplySubtitleOcrProgressEvent,
    summarizeSubtitleOcrItems,
  } from './subtitle-ocr-view-state';

  interface SubtitleOcrViewProps {
    onNavigateToSettings?: () => void;
  }

  interface TrackDialogRequest {
    sourcePath: string;
    sourceDuration?: number;
    tracks: SubtitleOcrTrackMetadata[];
  }

  interface SubtitleOcrProgressEventPayload {
    itemId: string;
    runId?: string;
    phase: string;
    current: number;
    total: number;
    totalKnown?: boolean;
    percentage: number;
  }

  interface SubtitleOcrRestoredBitmapEventPayload {
    itemId: string;
    runId?: string;
    bitmap: SubtitleOcrCueBitmap;
  }

  type ProcessItemResult = 'completed' | 'cancelled' | 'error';
  type ProcessingResultCounts = Record<ProcessItemResult, number>;

  let { onNavigateToSettings }: SubtitleOcrViewProps = $props();

  let trackDialogOpen = $state(false);
  let trackDialogSourcePath = $state('');
  let trackDialogSourceDuration = $state<number | undefined>(undefined);
  let trackDialogTracks = $state.raw<SubtitleOcrTrackMetadata[]>([]);
  let queuedTrackDialogs = $state.raw<TrackDialogRequest[]>([]);
  let resultDialogOpen = $state(false);
  let retryAllDialogOpen = $state(false);
  let retryDialogOpen = $state(false);
  let retryDialogItemId = $state<string | null>(null);
  let selectedCueIdsByItemId = $state.raw<Record<string, string | null>>({});
  let unlistenSubtitleOcrProgress: UnlistenFn | null = null;
  let unlistenSubtitleOcrRestoredBitmap: UnlistenFn | null = null;
  let unlistenSubtitleOcrLiveCue: UnlistenFn | null = null;

  const aiCleanupControllers = new SvelteMap<string, AbortController>();
  const activeRunIdsByItemId = new SvelteMap<string, string>();
  const backendCancelableRunIdsByItemId = new SvelteMap<string, string>();
  const previewRestoreRunIdsByItemId = new SvelteMap<string, string>();
  const persistenceQueues = new SvelteMap<string, Promise<void>>();
  let cancelRequested = false;

  const IMPORT_EXTENSIONS = [
    'mkv',
    'm2ts',
    'mp4',
    'avi',
    'mov',
    'webm',
    'm4v',
    'mks',
    'sup',
    'idx',
    'sub',
  ];
  const PROCESSABLE_STATUSES = new Set<SubtitleOcrStatus>(['ready', 'completed', 'error']);
  const PROGRESS_PHASES = new Set<SubtitleOcrProgress['phase']>([
    'extracting',
    'decoding',
    'ocr',
    'ai_cleaning',
  ]);

  function createProcessingResultCounts(): ProcessingResultCounts {
    return {
      completed: 0,
      cancelled: 0,
      error: 0,
    };
  }

  function recordProcessingResult(counts: ProcessingResultCounts, result: ProcessItemResult): void {
    counts[result] += 1;
  }

  function summarizeProcessingResults(counts: ProcessingResultCounts): string {
    const parts: string[] = [];
    if (counts.completed > 0) parts.push(`${counts.completed} completed`);
    if (counts.error > 0) parts.push(`${counts.error} failed`);
    if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);
    return parts.join(', ');
  }

  function reportProcessingSummary(title: string, counts: ProcessingResultCounts): void {
    const details = summarizeProcessingResults(counts);
    if (!details) {
      return;
    }

    const level = counts.error > 0 ? 'warning' : 'success';
    logAndToast[level]({
      source: 'subtitle-ocr',
      title: `${title}: ${details}`,
      details,
      showAction: false,
    });
  }

  const items = $derived(subtitleOcrStore.items);
  const selectedItem = $derived(subtitleOcrStore.selectedItem ?? null);
  const reviewVersion = $derived(
    selectedItem ? subtitleOcrStore.getReviewVersion(selectedItem.id) ?? null : null,
  );
  const renderedCues = $derived(
    selectedItem ? subtitleOcrStore.getRenderedCues(selectedItem.id) : [],
  );
  const reviewBitmaps = $derived(
    selectedItem ? subtitleOcrStore.getRenderedBitmaps(selectedItem.id) : [],
  );
  const selectedProcessingDraft = $derived(selectedItem?.processingDraft);
  const activeReviewTargetId = $derived(selectedItem?.reviewTargetId ?? selectedItem?.activeVersionId ?? null);
  const selectedReviewIsReadOnly = $derived(
    selectedItem ? subtitleOcrStore.isProcessingDraftSelected(selectedItem.id) : false,
  );
  const retryDialogItem = $derived(
    retryDialogItemId
      ? subtitleOcrStore.items.find((item) => item.id === retryDialogItemId) ?? null
      : null,
  );
  const retryDialogActiveVersion = $derived(
    retryDialogItem ? subtitleOcrStore.getActiveVersion(retryDialogItem.id) ?? null : null,
  );
  const selectedCueId = $derived(
    selectedItem
      ? selectedCueIdsByItemId[selectedItem.id] ?? renderedCues[0]?.id ?? null
      : null,
  );
  const restoringPreviewItemIds = $derived.by(() => (
    new Set(previewRestoreRunIdsByItemId.keys())
  ));
  const summary = $derived.by(() => summarizeSubtitleOcrItems(items));
  const retryableItemIds = $derived.by(() => getSubtitleOcrVersionedItemIds(items));
  const aiCleanupRetryableItemIds = $derived.by(() => (
    getSubtitleOcrActiveVersionItemIds(items)
  ));
  const retryCount = $derived(retryableItemIds.length);
  const aiCleanupRetryCount = $derived(aiCleanupRetryableItemIds.length);
  const aiCleanupModelAvailable = $derived(canUseSubtitleOcrAiCleanup(subtitleOcrStore.config));
  const primaryAction = $derived.by<'start' | 'retry'>(() => {
    if (summary.readyCount > 0) {
      return 'start';
    }

    if (retryCount > 0) {
      return 'retry';
    }

    return 'start';
  });
  const canStart = $derived(
    summary.readyCount > 0
      && !subtitleOcrStore.isProcessing
      && (!subtitleOcrStore.config.aiCleanupEnabled || aiCleanupModelAvailable)
  );
  const canRetryAll = $derived(retryCount > 0 && !subtitleOcrStore.isProcessing);
  const actionHint = $derived.by(() => {
    if (summary.scanningCount > 0) {
      return 'Wait for scanning to complete';
    }

    if (items.length === 0) {
      return 'Add subtitle sources to begin';
    }

    if (summary.readyCount > 0 && subtitleOcrStore.config.aiCleanupEnabled && !aiCleanupModelAvailable) {
      return 'Select an available AI cleanup model';
    }

    return 'No sources ready for OCR';
  });

  function doesSubtitleOcrConfigRunAi(mode: SubtitleOcrRetryMode, config: SubtitleOcrConfig): boolean {
    return mode === 'ai_cleanup_only' || (mode === 'full_ocr' && config.aiCleanupEnabled);
  }

  function canUseSubtitleOcrAiCleanup(config: SubtitleOcrConfig): boolean {
    return isLLMSelectionAvailable(
      config.aiCleanupProvider,
      config.aiCleanupModel,
      import.meta.env.DEV,
      mediaflowModelCatalogStore.chatModels,
    );
  }

  function warnSubtitleOcrAiCleanupUnavailable(): void {
    logAndToast.warning({
      source: 'subtitle-ocr',
      title: 'Subtitle OCR AI cleanup unavailable',
      details: 'Select an available AI cleanup model before running AI cleanup.',
      showAction: false,
    });
  }

  onMount(() => {
    let destroyed = false;

    const setup = async () => {
      const [unlistenProgress, unlistenRestoredBitmap, unlistenLiveCue] = await Promise.all([
        listen<SubtitleOcrProgressEventPayload>(
          'subtitle-ocr-progress',
          (event) => {
            if (destroyed) {
              return;
            }

            handleSubtitleOcrProgress(event.payload);
          },
        ),
        listen<SubtitleOcrRestoredBitmapEventPayload>(
          'subtitle-ocr-restored-bitmap',
          (event) => {
            if (destroyed) {
              return;
            }

            handleSubtitleOcrRestoredBitmap(event.payload);
          },
        ),
        listen<SubtitleOcrLiveCueEvent>(
          'subtitle-ocr-live-cue',
          (event) => {
            if (destroyed) {
              return;
            }

            handleSubtitleOcrLiveCue(event.payload);
          },
        ),
      ]);

      if (destroyed) {
        unlistenProgress();
        unlistenRestoredBitmap();
        unlistenLiveCue();
        return;
      }

      unlistenSubtitleOcrProgress = unlistenProgress;
      unlistenSubtitleOcrRestoredBitmap = unlistenRestoredBitmap;
      unlistenSubtitleOcrLiveCue = unlistenLiveCue;
    };

    void setup();

    return () => {
      destroyed = true;
      unlistenSubtitleOcrProgress?.();
      unlistenSubtitleOcrProgress = null;
      unlistenSubtitleOcrRestoredBitmap?.();
      unlistenSubtitleOcrRestoredBitmap = null;
      unlistenSubtitleOcrLiveCue?.();
      unlistenSubtitleOcrLiveCue = null;
      for (const controller of aiCleanupControllers.values()) {
        controller.abort();
      }
      aiCleanupControllers.clear();
      activeRunIdsByItemId.clear();
      backendCancelableRunIdsByItemId.clear();
      previewRestoreRunIdsByItemId.clear();
    };
  });

  function showImportWarnings(warnings: readonly string[]): void {
    for (const warning of warnings) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'Subtitle OCR import warning',
        details: warning,
        showAction: false,
      });
    }
  }

  function getSanitizedImportErrorDetails(error: unknown): string {
    if (error instanceof Error && error.name.trim()) {
      return `Import failed with ${error.name}.`;
    }

    return 'Import failed before sources could be added.';
  }

  function reportImportError(error: unknown): void {
    logAndToast.error({
      source: 'subtitle-ocr',
      title: 'Subtitle OCR import failed',
      details: getSanitizedImportErrorDetails(error),
    });
  }

  function getStoreItem(itemId: string): SubtitleOcrSourceItem | undefined {
    return subtitleOcrStore.items.find((item) => item.id === itemId);
  }

  function isProgressPhase(value: string): value is SubtitleOcrProgress['phase'] {
    return PROGRESS_PHASES.has(value as SubtitleOcrProgress['phase']);
  }

  function statusForProgressPhase(phase: SubtitleOcrProgress['phase']): SubtitleOcrStatus {
    if (phase === 'ocr') {
      return 'ocr_processing';
    }

    return phase;
  }

  function handleSubtitleOcrProgress(payload: SubtitleOcrProgressEventPayload): void {
    if (!isProgressPhase(payload.phase)) {
      return;
    }

    if (subtitleOcrStore.isItemCancelled(payload.itemId)) {
      return;
    }

    if (!shouldApplySubtitleOcrProgressEvent(
      payload.itemId,
      payload.runId,
      activeRunIdsByItemId,
      cancelRequested,
    )) {
      return;
    }

    const currentItem = getStoreItem(payload.itemId);
    if (isSubtitleOcrProgressPhaseStale(currentItem?.progress, payload.phase)) {
      return;
    }

    subtitleOcrStore.setItemStatus(payload.itemId, statusForProgressPhase(payload.phase));
    subtitleOcrStore.setProgress(
      payload.itemId,
      buildSubtitleOcrProgressFromEvent(
        {
          phase: payload.phase,
          current: payload.current,
          total: payload.total,
          totalKnown: payload.totalKnown,
          percentage: payload.percentage,
        },
        previewRestoreRunIdsByItemId.get(payload.itemId) === payload.runId,
      ),
    );
  }

  function handleSubtitleOcrRestoredBitmap(payload: SubtitleOcrRestoredBitmapEventPayload): void {
    if (subtitleOcrStore.isItemCancelled(payload.itemId)) {
      return;
    }

    if (!shouldApplySubtitleOcrProgressEvent(
      payload.itemId,
      payload.runId,
      activeRunIdsByItemId,
      cancelRequested,
    )) {
      return;
    }

    const currentItem = getStoreItem(payload.itemId);
    if (!currentItem || currentItem.versions.length === 0) {
      return;
    }

    const restoredVersions = mergeRestoredSubtitleOcrBitmapAssets(
      currentItem.versions,
      [payload.bitmap],
    );
    subtitleOcrStore.replaceItemVersions(
      currentItem.id,
      restoredVersions,
      currentItem.activeVersionId,
      {
        preserveProgress: true,
        preserveError: true,
      },
    );
  }

  function handleSubtitleOcrLiveCue(payload: SubtitleOcrLiveCueEvent): void {
    if (subtitleOcrStore.isItemCancelled(payload.itemId)) {
      return;
    }

    if (!shouldApplySubtitleOcrProgressEvent(
      payload.itemId,
      payload.runId,
      activeRunIdsByItemId,
      cancelRequested,
    )) {
      return;
    }

    subtitleOcrStore.appendProcessingDraftCue(payload.itemId, payload.runId, {
      bitmap: payload.bitmap,
      rawCue: payload.rawCue,
      provisionalCue: payload.provisionalCue,
    });
  }

  function sanitizeProcessingMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.replace(/\s+/g, ' ').trim();

    if (!normalized) {
      return 'Subtitle OCR failed.';
    }

    return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized;
  }

  function isCancellationError(error: unknown): boolean {
    return sanitizeProcessingMessage(error).toLowerCase().includes('cancelled');
  }

  async function collectMissingPreviewAssets(
    bitmaps: SubtitleOcrCueBitmap[],
  ): Promise<SubtitleOcrCueBitmap[]> {
    return invoke<SubtitleOcrCueBitmap[]>('collect_missing_subtitle_ocr_bitmap_assets', {
      bitmaps,
    });
  }

  function setManualProgress(
    itemId: string,
    phase: SubtitleOcrProgress['phase'],
    percentage = 0,
  ): void {
    subtitleOcrStore.setItemStatus(itemId, statusForProgressPhase(phase));
    subtitleOcrStore.setProgress(itemId, {
      phase,
      current: percentage,
      total: 100,
      percentage,
    });
  }

  async function hydrateImportedItem(item: SubtitleOcrSourceItem): Promise<void> {
    try {
      const data = await loadSubtitleOcrData(item.sourcePath);
      if (!data) {
        return;
      }

      const matchingData = filterSubtitleOcrPersistenceForItem(item, data);
      if (!matchingData) {
        return;
      }

      subtitleOcrStore.replaceItemVersions(
        item.id,
        matchingData.versions,
        matchingData.activeVersionId,
        { status: 'completed' },
      );
      await restoreMissingPreviewAssets(item.id);
    } catch (error) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'Could not load saved Subtitle OCR versions',
        details: sanitizeProcessingMessage(error),
        showAction: false,
      });
    }
  }

  async function addImportedItems(nextItems: SubtitleOcrSourceItem[]): Promise<void> {
    if (nextItems.length === 0) {
      return;
    }

    const addedItems = subtitleOcrStore.addItems(nextItems);
    if (addedItems.length === 0) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'Subtitle sources are already imported',
        details: 'No new Subtitle OCR sources were added because every selected source is already in the workspace.',
        showAction: false,
      });
    } else if (addedItems.length < nextItems.length) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'Some subtitle sources were already imported',
        details: `${addedItems.length} of ${nextItems.length} selected Subtitle OCR sources were added.`,
        showAction: false,
      });
    } else {
      logAndToast.success({
        source: 'subtitle-ocr',
        title: addedItems.length === 1 ? 'Subtitle source imported' : 'Subtitle sources imported',
        details: `${addedItems.length} Subtitle OCR source${addedItems.length === 1 ? '' : 's'} added.`,
        showAction: false,
      });
    }

    for (const item of addedItems) {
      await hydrateImportedItem(item);
    }
  }

  async function importStandalonePaths(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    const result = await buildStandaloneSubtitleOcrItems(paths, resolveVobSubPair);
    await addImportedItems(result.items);
    showImportWarnings(result.warnings);

    if (result.items.length === 0 && result.warnings.length === 0) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'No complete standalone subtitle sources found',
        details: 'Standalone Subtitle OCR imports must be SUP files or complete IDX/SUB pairs.',
        showAction: false,
      });
    }
  }

  async function resolveVobSubPair(path: string): Promise<SubtitleOcrVobSubPair> {
    return invoke<SubtitleOcrVobSubPair>('resolve_subtitle_ocr_vobsub_pair', { path });
  }

  async function probeContainerPath(path: string): Promise<TrackDialogRequest | null> {
    try {
      const mediaInfo = await invoke<SubtitleOcrMediaInfo>('probe_subtitle_ocr_media', { path });
      const { tracks } = mediaInfo;
      if (tracks.length === 0) {
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: `No bitmap subtitle tracks found in ${getFileName(path)}`,
          details: `MediaFlow could not find PGS or VobSub subtitle tracks in ${path}.`,
          context: { filePath: path },
          showAction: false,
        });
        return null;
      }

      return {
        sourcePath: path,
        sourceDuration: mediaInfo.durationSeconds,
        tracks,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logAndToast.error({
        source: 'subtitle-ocr',
        title: `Could not inspect ${getFileName(path)}`,
        details: sanitizeProcessingMessage(message),
        context: { filePath: path },
      });
      return null;
    }
  }

  async function importContainerPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    const requests: TrackDialogRequest[] = [];
    for (const path of paths) {
      const request = await probeContainerPath(path);
      if (request) {
        requests.push(request);
      }
    }

    enqueueTrackDialogs(requests);
  }

  function enqueueTrackDialogs(requests: TrackDialogRequest[]): void {
    if (requests.length === 0) {
      return;
    }

    if (trackDialogOpen) {
      queuedTrackDialogs = [...queuedTrackDialogs, ...requests];
      return;
    }

    const [nextRequest, ...remainingRequests] = requests;
    if (!nextRequest) {
      return;
    }

    queuedTrackDialogs = [...queuedTrackDialogs, ...remainingRequests];
    openTrackDialog(nextRequest);
  }

  function openTrackDialog(request: TrackDialogRequest): void {
    trackDialogSourcePath = request.sourcePath;
    trackDialogSourceDuration = request.sourceDuration;
    trackDialogTracks = request.tracks;
    trackDialogOpen = true;
  }

  function closeTrackDialog(): void {
    trackDialogOpen = false;
    trackDialogSourcePath = '';
    trackDialogSourceDuration = undefined;
    trackDialogTracks = [];
  }

  function openNextTrackDialog(): void {
    const [nextRequest, ...remainingRequests] = queuedTrackDialogs;
    if (!nextRequest) {
      return;
    }

    queuedTrackDialogs = remainingRequests;
    openTrackDialog(nextRequest);
  }

  function handleTrackDialogOpenChange(open: boolean): void {
    if (open) {
      trackDialogOpen = true;
      return;
    }

    closeTrackDialog();
    if (queuedTrackDialogs.length > 0) {
      queueMicrotask(openNextTrackDialog);
    }
  }

  async function handleImportTracks(importedItems: SubtitleOcrSourceItem[]): Promise<void> {
    await addImportedItems(importedItems);
  }

  async function importPaths(paths: string[]): Promise<void> {
    const standalonePaths: string[] = [];
    const containerPaths: string[] = [];

    for (const path of paths) {
      const kind = getSubtitleOcrImportKind(path);
      if (kind === 'container') {
        containerPaths.push(path);
      } else if (kind === 'standalone_sup' || kind === 'standalone_vobsub_part') {
        standalonePaths.push(path);
      }
    }

    if (standalonePaths.length === 0 && containerPaths.length === 0) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'No supported subtitle OCR sources found',
        details: 'Supported Subtitle OCR sources are containers with bitmap subtitle tracks, SUP files, or IDX/SUB pairs.',
        showAction: false,
      });
      return;
    }

    await importStandalonePaths(standalonePaths);
    await importContainerPaths(containerPaths);
  }

  async function handleImport(): Promise<void> {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Subtitle OCR sources',
          extensions: IMPORT_EXTENSIONS,
        }],
      });

      if (!selected) {
        return;
      }

      await importPaths(Array.isArray(selected) ? selected : [selected]);
    } catch (error) {
      reportImportError(error);
    }
  }

  export async function handleFileDrop(paths: string[]): Promise<void> {
    try {
      await importPaths(paths);
    } catch (error) {
      reportImportError(error);
    }
  }

  function handleSelectItem(itemId: string): void {
    subtitleOcrStore.selectItem(itemId);
  }

  function handleOpenVersions(itemId: string): void {
    subtitleOcrStore.selectItem(itemId);
    resultDialogOpen = true;
  }

  function getProcessableItemIds(itemIds: string[]): string[] {
    const requestedIds = new Set(itemIds);

    return subtitleOcrStore.items
      .filter((item) => requestedIds.has(item.id) && PROCESSABLE_STATUSES.has(item.status))
      .map((item) => item.id);
  }

  function createSubtitleOcrRunId(itemId: string): string {
    const randomSegment = Math.random().toString(36).slice(2, 10);
    return `${itemId}-${Date.now()}-${randomSegment}`;
  }

  async function preparePipelineSource(item: SubtitleOcrSourceItem, runId: string): Promise<string> {
    if (item.sourceKind !== 'container_track') {
      return item.sourcePath;
    }

    setManualProgress(item.id, 'extracting');
    backendCancelableRunIdsByItemId.set(item.id, runId);
    try {
      return await invoke<string>('prepare_subtitle_ocr_track', {
        inputPath: item.sourcePath,
        streamIndex: item.track.streamIndex,
        codec: item.track.codec,
        itemId: item.id,
        runId,
      });
    } finally {
      backendCancelableRunIdsByItemId.delete(item.id);
    }
  }

  function buildPipelineArgs(
    item: SubtitleOcrSourceItem,
    sourcePath: string,
    runId: string,
    config: SubtitleOcrConfig = subtitleOcrStore.config,
  ) {
    const effectiveOcrModel = resolveSubtitleOcrEffectiveModelForConfig(item, config);

    return {
      config,
      effectiveOcrModel,
      args: {
        itemId: item.id,
        runId,
        sourcePath,
        idxPath: item.sourceKind === 'standalone_vobsub' ? item.pair.idxPath : null,
        subPath: item.sourceKind === 'standalone_vobsub' ? item.pair.subPath : null,
        language: effectiveOcrModel,
        useGpu: config.useGpu,
        expectedBitmapCount: resolveSubtitleOcrExpectedBitmapCount(
          subtitleOcrStore.getActiveVersion(item.id),
        ) ?? null,
      },
    };
  }

  function buildPreviewRestoreArgs(
    item: SubtitleOcrSourceItem,
    sourcePath: string,
    runId: string,
    bitmaps: SubtitleOcrCueBitmap[],
  ) {
    return {
      itemId: item.id,
      runId,
      sourcePath,
      idxPath: item.sourceKind === 'standalone_vobsub' ? item.pair.idxPath : null,
      subPath: item.sourceKind === 'standalone_vobsub' ? item.pair.subPath : null,
      bitmaps,
    };
  }

  async function restoreMissingPreviewAssets(itemId: string): Promise<void> {
    const item = getStoreItem(itemId);
    if (!item || item.versions.length === 0) {
      return;
    }

    const missingBitmaps = await collectMissingSubtitleOcrBitmapAssets(
      item.versions,
      collectMissingPreviewAssets,
    );
    if (missingBitmaps.length === 0) {
      return;
    }

    const runId = createSubtitleOcrRunId(`${item.id}-restore`);
    previewRestoreRunIdsByItemId.set(item.id, runId);
    activeRunIdsByItemId.set(item.id, runId);
    subtitleOcrStore.startProcessing([item.id]);
    subtitleOcrStore.addLog('info', `Restoring ${missingBitmaps.length} missing preview asset${missingBitmaps.length === 1 ? '' : 's'}`, item.id);

    try {
      setManualProgress(item.id, 'decoding');
      const sourcePath = await preparePipelineSource(item, runId);
      if (cancelRequested || subtitleOcrStore.isItemCancelled(item.id)) {
        throw new Error('Subtitle OCR operation cancelled');
      }

      backendCancelableRunIdsByItemId.set(item.id, runId);
      const restoredBitmaps = await invoke<SubtitleOcrCueBitmap[]>(
        'restore_subtitle_ocr_bitmap_assets',
        buildPreviewRestoreArgs(item, sourcePath, runId, missingBitmaps),
      );
      backendCancelableRunIdsByItemId.delete(item.id);

      const latestItem = getStoreItem(item.id) ?? item;
      const restoredVersions = mergeRestoredSubtitleOcrBitmapAssets(
        latestItem.versions,
        restoredBitmaps,
      );
      subtitleOcrStore.replaceItemVersions(
        item.id,
        restoredVersions,
        latestItem.activeVersionId,
        {
          status: 'completed',
        },
      );
      await persistItem(item.id);
      subtitleOcrStore.addLog(
        'success',
        `Restored ${restoredBitmaps.length}/${missingBitmaps.length} missing preview assets`,
        item.id,
      );

      if (restoredBitmaps.length < missingBitmaps.length) {
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: 'Some Subtitle OCR previews were not restored',
          details: 'The OCR text remains available, but some cue images could not be regenerated.',
          showAction: false,
        });
      }
    } catch (error) {
      subtitleOcrStore.setItemStatus(item.id, 'completed');
      subtitleOcrStore.setProgress(item.id, undefined);
      if (!isCancellationError(error) && !cancelRequested && !subtitleOcrStore.isItemCancelled(item.id)) {
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: 'Subtitle OCR previews were not restored',
          details: 'The OCR text remains available, but missing cue images could not be regenerated.',
          showAction: false,
        });
      }
    } finally {
      backendCancelableRunIdsByItemId.delete(item.id);
      activeRunIdsByItemId.delete(item.id);
      previewRestoreRunIdsByItemId.delete(item.id);
      subtitleOcrStore.stopProcessing();
      subtitleOcrStore.setItemStatus(item.id, 'completed');
      subtitleOcrStore.setProgress(item.id, undefined);
      cancelRequested = false;
    }
  }

  async function runAiCleanupForItem(
    itemId: string,
    cues: SubtitleOcrCue[],
    config: SubtitleOcrConfig = subtitleOcrStore.config,
  ): Promise<{ cues: SubtitleOcrCue[]; applied: boolean; cancelled: boolean }> {
    const controller = new AbortController();
    aiCleanupControllers.set(itemId, controller);
    setManualProgress(itemId, 'ai_cleaning');
    subtitleOcrStore.addLog('info', 'Running Subtitle OCR AI cleanup', itemId);

    try {
      const result = await cleanupSubtitleOcrCuesWithAi(cues, {
        provider: config.aiCleanupProvider,
        model: config.aiCleanupModel,
        signal: controller.signal,
      });

      if (result.cancelled || controller.signal.aborted) {
        return { cues, applied: false, cancelled: true };
      }

      if (subtitleOcrStore.isItemCancelled(itemId)) {
        return { cues, applied: false, cancelled: true };
      }

      if (!result.success) {
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: 'Subtitle OCR AI cleanup skipped',
          details: result.error ? sanitizeProcessingMessage(result.error) : 'AI cleanup failed.',
          showAction: false,
        });
        return { cues, applied: false, cancelled: false };
      }

      subtitleOcrStore.addLog(
        'success',
        `AI cleanup completed (${cues.length} -> ${result.cues.length} cues)`,
        itemId,
      );
      return { cues: result.cues, applied: true, cancelled: false };
    } finally {
      aiCleanupControllers.delete(itemId);
    }
  }

  async function persistItem(itemId: string): Promise<void> {
    const item = getStoreItem(itemId);
    if (!item) {
      return;
    }

    const sourcePath = item.sourcePath;
    const previous = persistenceQueues.get(sourcePath) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const latestItem = getStoreItem(itemId);
      if (!latestItem || latestItem.sourcePath !== sourcePath) {
        return;
      }

      try {
        const existingData = await loadSubtitleOcrData(sourcePath);
        const saved = await saveSubtitleOcrData(
          sourcePath,
          mergeSubtitleOcrPersistenceForItem(latestItem, existingData, new Date().toISOString()),
        );

        if (!saved) {
          logAndToast.warning({
            source: 'subtitle-ocr',
            title: 'Subtitle OCR versions were not saved',
            details: 'The Subtitle OCR changes could not be written to the MediaFlow sidecar.',
            showAction: false,
          });
        }
      } catch (error) {
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: 'Subtitle OCR versions were not saved',
          details: sanitizeProcessingMessage(error),
          showAction: false,
        });
      }
    });

    persistenceQueues.set(sourcePath, next);
    try {
      await next;
    } finally {
      if (persistenceQueues.get(sourcePath) === next) {
        persistenceQueues.delete(sourcePath);
      }
    }
  }

  function restoreCancelledItemStatus(itemId: string): void {
    const latestItem = getStoreItem(itemId);
    const status: SubtitleOcrStatus = latestItem && latestItem.versions.length > 0
      ? 'completed'
      : 'ready';

    subtitleOcrStore.setItemStatus(itemId, status);
    subtitleOcrStore.setProgress(itemId, undefined);
  }

  async function processItem(
    item: SubtitleOcrSourceItem,
    configOverride?: SubtitleOcrConfig,
    versionNameOverride?: string,
  ): Promise<ProcessItemResult> {
    const runId = createSubtitleOcrRunId(item.id);
    const initialItem = getStoreItem(item.id) ?? item;
    const versionName = versionNameOverride ?? `Version ${initialItem.versions.length + 1}`;
    activeRunIdsByItemId.set(item.id, runId);
    subtitleOcrStore.beginProcessingDraft(item.id, {
      runId,
      name: `${versionName} Draft`,
    });
    subtitleOcrStore.addLog('info', 'Starting Subtitle OCR run', item.id);

    try {
      setManualProgress(
        item.id,
        item.sourceKind === 'container_track' ? 'extracting' : 'decoding',
      );

      const sourcePath = await preparePipelineSource(item, runId);
      if (cancelRequested || subtitleOcrStore.isItemCancelled(item.id)) {
        throw new Error('Subtitle OCR operation cancelled');
      }

      setManualProgress(item.id, 'decoding');
      const { args, config, effectiveOcrModel } = buildPipelineArgs(
        item,
        sourcePath,
        runId,
        configOverride,
      );
      backendCancelableRunIdsByItemId.set(item.id, runId);
      const result = await invoke<SubtitleOcrPipelineResult>('run_subtitle_ocr_pipeline', args);
      backendCancelableRunIdsByItemId.delete(item.id);
      activeRunIdsByItemId.delete(item.id);
      const stats = result.stats;
      subtitleOcrStore.addLog(
        'info',
        `Decoded ${stats.decodedBitmapCount} bitmap cues, skipped ${stats.skippedEmptyBitmapCount} empty, reused ${stats.deduplicatedBitmapCount} duplicates, OCR processed ${stats.ocrProcessedBitmapCount}, kept ${result.rawOcrCues.length} raw cues, stabilized ${result.stabilizedCues.length} cues`,
        item.id,
      );
      if (cancelRequested || subtitleOcrStore.isItemCancelled(item.id)) {
        throw new Error('Subtitle OCR operation cancelled');
      }

      const ocrFinalCues = result.finalCues;
      const cleanup = config.aiCleanupEnabled
        ? await runAiCleanupForItem(item.id, ocrFinalCues, config)
        : { cues: ocrFinalCues, applied: false, cancelled: false };

      if (cleanup.cancelled || cancelRequested || subtitleOcrStore.isItemCancelled(item.id)) {
        throw new Error('Subtitle OCR operation cancelled');
      }

      const latestItem = getStoreItem(item.id) ?? item;
      const version = createSubtitleOcrVersion({
        name: versionName,
        mode: 'full_ocr',
        configSnapshot: config,
        effectiveOcrModel,
        sourceSnapshot: buildSubtitleOcrSourceSnapshot(latestItem),
        bitmaps: result.decodedCues.map((cue) => ({ ...cue })),
        rawOcr: result.rawOcrCues.map((cue) => ({
          ...cue,
          boxes: cue.boxes.map((box) => ({ ...box })),
        })),
        stabilizedCues: result.stabilizedCues.map((cue) => ({
          ...cue,
          sourceCueIds: [...cue.sourceCueIds],
        })),
        finalCues: cleanup.cues.map((cue) => ({
          ...cue,
          sourceCueIds: [...cue.sourceCueIds],
        })),
        aiCleanupApplied: cleanup.applied,
      });

      subtitleOcrStore.completeProcessingDraft(item.id, runId, version);
      await persistItem(item.id);
      subtitleOcrStore.addLog('success', `Generated ${version.finalCues.length} final cues`, item.id);
      return 'completed';
    } catch (error) {
      backendCancelableRunIdsByItemId.delete(item.id);
      activeRunIdsByItemId.delete(item.id);
      subtitleOcrStore.clearProcessingDraft(item.id, runId);
      subtitleOcrStore.setProgress(item.id, undefined);

      if (isCancellationError(error) || cancelRequested || subtitleOcrStore.isItemCancelled(item.id)) {
        restoreCancelledItemStatus(item.id);
        return 'cancelled';
      }

      const details = sanitizeProcessingMessage(error);
      subtitleOcrStore.setItemStatus(item.id, 'error', details);
      logAndToast.error({
        source: 'subtitle-ocr',
        title: 'Subtitle OCR failed',
        details,
      });
      return 'error';
    }
  }

  async function runProcessingItems(
    itemIds: string[],
    configByItemId: ReadonlyMap<string, SubtitleOcrConfig> = new Map(),
    versionNameByItemId: ReadonlyMap<string, string> = new Map(),
  ): Promise<void> {
    const processableItemIds = getProcessableItemIds(itemIds);
    if (processableItemIds.length === 0 || subtitleOcrStore.isProcessing) {
      return;
    }

    const unavailableAiConfig = processableItemIds
      .map((itemId) => configByItemId.get(itemId) ?? subtitleOcrStore.config)
      .find((config) => config.aiCleanupEnabled && !canUseSubtitleOcrAiCleanup(config));
    if (unavailableAiConfig) {
      warnSubtitleOcrAiCleanupUnavailable();
      return;
    }

    cancelRequested = false;
    subtitleOcrStore.startProcessing(processableItemIds);
    const counts = createProcessingResultCounts();

    try {
      for (const itemId of processableItemIds) {
        if (cancelRequested) {
          break;
        }

        if (subtitleOcrStore.isItemCancelled(itemId)) {
          recordProcessingResult(counts, 'cancelled');
          continue;
        }

        const item = getStoreItem(itemId);
        if (!item) {
          continue;
        }

        const result = await processItem(
          item,
          configByItemId.get(itemId),
          versionNameByItemId.get(itemId),
        );
        recordProcessingResult(counts, result);
        if (!cancelRequested) {
          subtitleOcrStore.finishProcessingItem(itemId);
        }
        if (result === 'cancelled' && cancelRequested) {
          break;
        }
      }
    } finally {
      subtitleOcrStore.stopProcessing();
      cancelRequested = false;
    }

    reportProcessingSummary('Subtitle OCR finished', counts);
  }

  function getCurrentRetryableItemIds(): string[] {
    return getSubtitleOcrVersionedItemIds(subtitleOcrStore.items);
  }

  function getCurrentAiCleanupRetryableItemIds(): string[] {
    return getSubtitleOcrActiveVersionItemIds(subtitleOcrStore.items);
  }

  function handleStart(): void {
    void runProcessingItems(
      items
        .filter((item) => item.status === 'ready')
        .map((item) => item.id),
    );
  }

  function handleOpenRetryAllDialog(): void {
    if (getCurrentRetryableItemIds().length === 0) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'No Subtitle OCR versions available for retry',
        details: 'Run Subtitle OCR at least once before retrying existing versions.',
        showAction: false,
      });
      return;
    }

    retryAllDialogOpen = true;
  }

  async function handleCancel(): Promise<void> {
    if (subtitleOcrStore.isCancelling) {
      return;
    }

    const processingScopeItemIds = subtitleOcrStore.processingScopeItemIds;
    const itemIds = Array.from(processingScopeItemIds);
    if (itemIds.length === 0) {
      subtitleOcrStore.stopProcessing();
      return;
    }

    cancelRequested = true;
    subtitleOcrStore.setCancelling(true);
    subtitleOcrStore.addLog(
      'warning',
      itemIds.length === 1 ? 'Cancellation requested' : `Cancellation requested for ${itemIds.length} sources`,
    );
    for (const itemId of itemIds) {
      aiCleanupControllers.get(itemId)?.abort();
    }
    const backendCancelTargets = getSubtitleOcrBackendCancelTargets(
      processingScopeItemIds,
      backendCancelableRunIdsByItemId,
    );
    await Promise.allSettled(
      backendCancelTargets.map(({ itemId, runId }) => (
        invoke('cancel_subtitle_ocr_operation', { itemId, runId })
      )),
    );
  }

  async function handleCancelItem(itemId: string): Promise<void> {
    if (!subtitleOcrStore.isProcessing || subtitleOcrStore.isItemCancelled(itemId)) {
      return;
    }

    const item = getStoreItem(itemId);
    if (!item) {
      return;
    }

    const backendRunId = backendCancelableRunIdsByItemId.get(itemId);
    if (backendRunId) {
      try {
        await invoke('cancel_subtitle_ocr_operation', { itemId, runId: backendRunId });
      } catch (error) {
        logAndToast.warning({
          source: 'subtitle-ocr',
          title: 'Subtitle OCR cancel request failed',
          details: sanitizeProcessingMessage(error),
          context: { filePath: item.sourcePath },
          showAction: false,
        });
        return;
      }

      backendCancelableRunIdsByItemId.delete(itemId);
    }

    aiCleanupControllers.get(itemId)?.abort();
    aiCleanupControllers.delete(itemId);
    activeRunIdsByItemId.delete(itemId);
    previewRestoreRunIdsByItemId.delete(itemId);
    subtitleOcrStore.cancelProcessing(itemId);
  }

  function handleOpenRetryDialog(itemId: string): void {
    if (subtitleOcrStore.isProcessing) {
      return;
    }

    subtitleOcrStore.selectItem(itemId);
    const activeVersion = subtitleOcrStore.getActiveVersion(itemId);
    if (!activeVersion) {
      return;
    }

    retryDialogItemId = itemId;
    retryDialogOpen = true;
  }

  function handleRetryDialogOpenChange(open: boolean): void {
    retryDialogOpen = open;
    if (!open) {
      retryDialogItemId = null;
    }
  }

  function handleRetryDialogConfirm(
    itemId: string,
    versionName: string,
    mode: SubtitleOcrRetryMode,
    config: SubtitleOcrConfig,
  ): void {
    if (doesSubtitleOcrConfigRunAi(mode, config) && !canUseSubtitleOcrAiCleanup(config)) {
      warnSubtitleOcrAiCleanupUnavailable();
      return;
    }

    if (mode === 'full_ocr') {
      void runProcessingItems(
        [itemId],
        new Map([[itemId, config]]),
        new Map([[itemId, versionName]]),
      );
      return;
    }

    void runAiCleanupRetry(itemId, versionName, config);
  }

  function handleRetryAllDialogConfirm(
    mode: SubtitleOcrRetryMode,
    config: SubtitleOcrConfig,
  ): void {
    if (doesSubtitleOcrConfigRunAi(mode, config) && !canUseSubtitleOcrAiCleanup(config)) {
      warnSubtitleOcrAiCleanupUnavailable();
      return;
    }

    const itemIds = getCurrentRetryableItemIds();
    if (itemIds.length === 0) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'No Subtitle OCR versions available for retry',
        details: 'Run Subtitle OCR at least once before retrying existing versions.',
        showAction: false,
      });
      return;
    }

    if (mode === 'full_ocr') {
      void runProcessingItems(
        itemIds,
        new Map(itemIds.map((itemId) => [itemId, config])),
      );
      return;
    }

    const aiCleanupItemIds = getCurrentAiCleanupRetryableItemIds();
    if (aiCleanupItemIds.length === 0) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'No active Subtitle OCR versions available for AI cleanup retry',
        details: 'Select or create an active Subtitle OCR version before retrying AI cleanup.',
        showAction: false,
      });
      return;
    }

    void runAiCleanupRetryItems(aiCleanupItemIds, config);
  }

  async function runAiCleanupRetry(
    itemId: string,
    versionName: string,
    config: SubtitleOcrConfig,
  ): Promise<void> {
    if (subtitleOcrStore.isProcessing) {
      return;
    }

    if (!canUseSubtitleOcrAiCleanup(config)) {
      warnSubtitleOcrAiCleanupUnavailable();
      return;
    }

    cancelRequested = false;
    subtitleOcrStore.startProcessing([itemId]);
    const counts = createProcessingResultCounts();

    try {
      recordProcessingResult(counts, await processAiCleanupRetryItem(itemId, versionName, config));
    } finally {
      subtitleOcrStore.stopProcessing();
      cancelRequested = false;
    }

    reportProcessingSummary('Subtitle OCR AI cleanup retry finished', counts);
  }

  async function runAiCleanupRetryItems(
    itemIds: string[],
    config: SubtitleOcrConfig,
  ): Promise<void> {
    if (itemIds.length === 0 || subtitleOcrStore.isProcessing) {
      return;
    }

    if (!canUseSubtitleOcrAiCleanup(config)) {
      warnSubtitleOcrAiCleanupUnavailable();
      return;
    }

    cancelRequested = false;
    subtitleOcrStore.startProcessing(itemIds);
    const counts = createProcessingResultCounts();

    try {
      for (const itemId of itemIds) {
        if (cancelRequested) {
          break;
        }

        if (subtitleOcrStore.isItemCancelled(itemId)) {
          recordProcessingResult(counts, 'cancelled');
          continue;
        }

        const result = await processAiCleanupRetryItem(itemId, undefined, config);
        recordProcessingResult(counts, result);
        if (!cancelRequested) {
          subtitleOcrStore.finishProcessingItem(itemId);
        }
        if (result === 'cancelled' && cancelRequested) {
          break;
        }
      }
    } finally {
      subtitleOcrStore.stopProcessing();
      cancelRequested = false;
    }

    reportProcessingSummary('Subtitle OCR AI cleanup retry finished', counts);
  }

  async function processAiCleanupRetryItem(
    itemId: string,
    versionName: string | undefined,
    config: SubtitleOcrConfig,
  ): Promise<ProcessItemResult> {
    const item = getStoreItem(itemId);
    const activeVersion = subtitleOcrStore.getActiveVersion(itemId);
    if (!item || !activeVersion) {
      return 'error';
    }

    try {
      const cleanup = await runAiCleanupForItem(itemId, activeVersion.finalCues, config);
      if (cleanup.cancelled || cancelRequested || subtitleOcrStore.isItemCancelled(itemId)) {
        restoreCancelledItemStatus(itemId);
        return 'cancelled';
      }

      if (!cleanup.applied) {
        restoreCancelledItemStatus(itemId);
        return 'error';
      }

      const latestItem = getStoreItem(itemId) ?? item;
      const version: SubtitleOcrVersion = createSubtitleOcrVersion({
        name: versionName || `Version ${latestItem.versions.length + 1}`,
        mode: 'ai_cleanup_only',
        configSnapshot: config,
        effectiveOcrModel: activeVersion.effectiveOcrModel,
        sourceSnapshot: activeVersion.sourceSnapshot,
        bitmaps: activeVersion.bitmaps,
        rawOcr: activeVersion.rawOcr,
        stabilizedCues: activeVersion.stabilizedCues,
        finalCues: cleanup.cues,
        aiCleanupApplied: true,
      });

      subtitleOcrStore.addVersion(itemId, version);
      await persistItem(itemId);
      subtitleOcrStore.addLog('success', `Created ${version.name} with AI cleanup`, itemId);
      return 'completed';
    } catch (error) {
      if (isCancellationError(error) || cancelRequested || subtitleOcrStore.isItemCancelled(itemId)) {
        restoreCancelledItemStatus(itemId);
        return 'cancelled';
      }

      const details = sanitizeProcessingMessage(error);
      subtitleOcrStore.setItemStatus(itemId, 'error', details);
      logAndToast.error({
        source: 'subtitle-ocr',
        title: 'Subtitle OCR AI cleanup retry failed',
        details,
      });
      return 'error';
    }
  }

  function handleRemove(itemId: string): void {
    subtitleOcrStore.removeItem(itemId);
  }

  function handleClearAll(): void {
    selectedCueIdsByItemId = {};
    retryAllDialogOpen = false;
    retryDialogOpen = false;
    retryDialogItemId = null;
    subtitleOcrStore.clearItems();
  }

  async function handleCueTextCommit(itemId: string, cueId: string, text: string): Promise<void> {
    const item = getStoreItem(itemId);
    if (!item) {
      return;
    }

    if (subtitleOcrStore.updateCueText(itemId, cueId, text)) {
      await persistItem(itemId);
    }
  }

  function handleSelectCue(cueId: string): void {
    if (!selectedItem) {
      return;
    }

    selectedCueIdsByItemId = {
      ...selectedCueIdsByItemId,
      [selectedItem.id]: cueId,
    };
  }
</script>

<div class="grid h-full overflow-hidden grid-cols-[auto_minmax(0,1fr)_20rem]">
  <SubtitleOcrSidebar
    {items}
    selectedItemId={selectedItem?.id ?? null}
    isProcessing={subtitleOcrStore.isProcessing}
    processingScopeItemIds={subtitleOcrStore.processingScopeItemIds}
    {restoringPreviewItemIds}
    onImport={handleImport}
    onSelectItem={handleSelectItem}
    onOpenVersions={handleOpenVersions}
    onRetry={handleOpenRetryDialog}
    onCancelItem={handleCancelItem}
    onRemove={handleRemove}
    onClearAll={handleClearAll}
  />

  <div class="min-w-0 overflow-hidden">
    <SubtitleOcrWorkspace
      item={selectedItem}
      {reviewVersion}
      {reviewBitmaps}
      {renderedCues}
      {selectedCueId}
      {activeReviewTargetId}
      processingDraft={selectedProcessingDraft}
      isReadOnly={selectedReviewIsReadOnly}
      onSelectCue={handleSelectCue}
      onSelectVersion={subtitleOcrStore.selectVersion}
      onCueTextCommit={(itemId, cueId, text) => void handleCueTextCommit(itemId, cueId, text)}
    />
  </div>

  <aside class="border-l p-4 overflow-auto">
    <SubtitleOcrOptionsPanel
      config={subtitleOcrStore.config}
      {canStart}
      {canRetryAll}
      isProcessing={subtitleOcrStore.isProcessing}
      isCancelling={subtitleOcrStore.isCancelling}
      cancelActionKind={restoringPreviewItemIds.size > 0 ? 'restore' : 'ocr'}
      readyCount={summary.readyCount}
      {retryCount}
      {actionHint}
      {primaryAction}
      onConfigChange={subtitleOcrStore.updateConfig}
      onStart={handleStart}
      onRetryAll={handleOpenRetryAllDialog}
      onCancel={() => void handleCancel()}
      {onNavigateToSettings}
    />
  </aside>
</div>

<SubtitleOcrImportTracksDialog
  bind:open={trackDialogOpen}
  onOpenChange={handleTrackDialogOpenChange}
  sourcePath={trackDialogSourcePath}
  sourceDuration={trackDialogSourceDuration}
  tracks={trackDialogTracks}
  onImport={handleImportTracks}
/>

<SubtitleOcrResultDialog
  bind:open={resultDialogOpen}
  onOpenChange={(open) => { resultDialogOpen = open; }}
  item={selectedItem}
/>

<SubtitleOcrRetryDialog
  bind:open={retryDialogOpen}
  onOpenChange={handleRetryDialogOpenChange}
  item={retryDialogItem}
  activeVersion={retryDialogActiveVersion}
  baseConfig={subtitleOcrStore.config}
  isProcessing={subtitleOcrStore.isProcessing}
  onConfirm={handleRetryDialogConfirm}
  {onNavigateToSettings}
/>

<SubtitleOcrRetryAllDialog
  bind:open={retryAllDialogOpen}
  onOpenChange={(open) => { retryAllDialogOpen = open; }}
  targetCount={retryCount}
  {aiCleanupRetryCount}
  baseConfig={subtitleOcrStore.config}
  isProcessing={subtitleOcrStore.isProcessing}
  onConfirm={handleRetryAllDialogConfirm}
  {onNavigateToSettings}
/>
