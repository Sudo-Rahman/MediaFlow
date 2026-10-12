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
    mediaflowModelCatalogStore,
    subtitleOcrStore,
  } from '$lib/stores';
  import { isSubtitleOcrProgressPhaseStale } from '$lib/stores/subtitle-ocr-progress';
  import {
    isLLMSelectionAvailable,
    type SubtitleOcrCueBitmap,
    type SubtitleOcrConfig,
    type SubtitleOcrProgress,
    type SubtitleOcrLiveCueEvent,
    type SubtitleOcrRetryMode,
    type SubtitleOcrSourceItem,
    type SubtitleOcrStatus,
    type SubtitleOcrTrackMetadata,
    type SubtitleOcrVobSubPair,
  } from '$lib/types';
  import { logAndToast } from '$lib/utils/log-toast';
  import {
    buildSubtitleOcrProgressFromEvent,
    deleteSubtitleOcrRunIdIfCurrent,
    getSubtitleOcrBackendCancelTargets,
    resolveSubtitleOcrExpectedBitmapCount,
    resolveSubtitleOcrEffectiveModelForConfig,
    shouldApplySubtitleOcrProgressEvent,
    summarizeSubtitleOcrItems,
  } from './subtitle-ocr-view-state';
  import {
    createSubtitleOcrImportGenerationCoordinator,
    type SubtitleOcrImportLease,
  } from './subtitle-ocr-import-generation';
  import {
    createSubtitleOcrImportCoordination,
  } from './subtitle-ocr-import-coordination';
  import { createSubtitleOcrPreviewCoordination } from './subtitle-ocr-preview-coordination';
  import { createSubtitleOcrProcessingCoordination } from './subtitle-ocr-processing-coordination';
  import { createSubtitleOcrProcessingSupport } from './subtitle-ocr-processing-support';
  import { createSubtitleOcrCancellationScope } from './subtitle-ocr-cancellation-scope';
  import { cancelSubtitleOcrItem } from './subtitle-ocr-item-cancellation';
  interface SubtitleOcrViewProps {
    onNavigateToSettings?: () => void;
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

  let { onNavigateToSettings }: SubtitleOcrViewProps = $props();

  let trackDialogOpen = $state(false);
  let trackDialogSourcePath = $state('');
  let trackDialogSourceDuration = $state<number | undefined>(undefined);
  let trackDialogTracks = $state.raw<SubtitleOcrTrackMetadata[]>([]);
  let trackDialogLease = $state<SubtitleOcrImportLease | null>(null);
  let resultDialogOpen = $state(false);
  let resultDialogItemId = $state<string | null>(null);
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
  const importGenerationCoordinator = createSubtitleOcrImportGenerationCoordinator();
  let activeImportGeneration = $state<number | null>(null);
  let pendingPreviewRestoreActivity = $state(0);

  const PROGRESS_PHASES = new Set<SubtitleOcrProgress['phase']>([
    'extracting',
    'decoding',
    'ocr',
    'ai_cleaning',
  ]);

  const items = $derived(subtitleOcrStore.itemSummaries);
  const selectedItem = $derived.by(() => {
    const selectedId = subtitleOcrStore.selectedItemId;
    return selectedId ? subtitleOcrStore.getWorkspaceItemSummary(selectedId) ?? null : null;
  });
  const resultDialogItem = $derived.by(() => (
    resultDialogItemId ? subtitleOcrStore.getItemSnapshot(resultDialogItemId) ?? null : null
  ));
  const reviewVersion = $derived(
    selectedItem ? subtitleOcrStore.getReviewVersionSummary(selectedItem.id) ?? null : null,
  );
  const renderedCues = $derived(
    selectedItem ? subtitleOcrStore.getRenderedCues(selectedItem.id) : [],
  );
  const reviewBitmaps = $derived(
    selectedItem ? subtitleOcrStore.getRenderedBitmaps(selectedItem.id) : [],
  );
  const selectedProcessingDraft = $derived(
    selectedItem ? subtitleOcrStore.getProcessingDraftSummary(selectedItem.id) : undefined,
  );
  const activeReviewTargetId = $derived(selectedItem?.reviewTargetId ?? selectedItem?.activeVersionId ?? null);
  const selectedReviewIsReadOnly = $derived(
    selectedItem ? subtitleOcrStore.isProcessingDraftSelected(selectedItem.id) : false,
  );
  const retryDialogItem = $derived(
    retryDialogItemId
      ? subtitleOcrStore.getItemSnapshot(retryDialogItemId) ?? null
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
  const canCancelImportWork = $derived.by(() => {
    pendingPreviewRestoreActivity;
    return activeImportGeneration !== null
      || importCoordination.hasHydrationWork
      || previewCoordination.hasQueued
      || previewCoordination.activeRestoreGenerations.size > 0
      || importCoordination.hasDialogWork;
  });
  const subtitleOcrCancellationActive = $derived(
    subtitleOcrStore.isProcessing || canCancelImportWork,
  );
  const summary = $derived.by(() => summarizeSubtitleOcrItems(
    items.filter((item) => !subtitleOcrStore.isItemHydrating(item.id)),
  ));
  const retryableItemIds = $derived.by(() => (
    items
      .filter((item) => item.versionCount > 0 && !subtitleOcrStore.isItemHydrating(item.id))
      .map((item) => item.id)
  ));
  const aiCleanupRetryableItemIds = $derived.by(() => (
    items
      .filter((item) => item.hasActiveVersion && !subtitleOcrStore.isItemHydrating(item.id))
      .map((item) => item.id)
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
      cancelImportGenerations();
      importCoordination.clear();
      activeRunIdsByItemId.clear();
      backendCancelableRunIdsByItemId.clear();
      previewRestoreRunIdsByItemId.clear();
      previewCoordination.clear();
      pendingPreviewRestoreActivity += 1;
    };
  });

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

  const cancellationScope = createSubtitleOcrCancellationScope({
    setCancelRequested: (value) => { cancelRequested = value; },
    isProcessing: () => subtitleOcrStore.isProcessing,
    setCancelling: subtitleOcrStore.setCancelling,
  });

  function cancelImportGenerations(): void {
    importGenerationCoordinator.cancelAll();
    activeImportGeneration = importGenerationCoordinator.activeGeneration;
    pendingPreviewRestoreActivity += 1;
  }

  function beginImportGeneration(): SubtitleOcrImportLease {
    cancellationScope.prepareForImport();
    const lease = importGenerationCoordinator.begin();
    activeImportGeneration = importGenerationCoordinator.activeGeneration;
    pendingPreviewRestoreActivity += 1;
    return lease;
  }

  function retainImportGeneration(generation: number): SubtitleOcrImportLease | null {
    const lease = importGenerationCoordinator.retain(generation);
    if (lease) {
      activeImportGeneration = importGenerationCoordinator.activeGeneration;
      pendingPreviewRestoreActivity += 1;
    }
    return lease;
  }

  function isImportGenerationCancelled(generation: number): boolean {
    return importGenerationCoordinator.isCancelled(generation);
  }

  function isImportGenerationCurrent(generation: number): boolean {
    return importGenerationCoordinator.isCurrent(generation);
  }

  function isImportGenerationUsable(generation: number): boolean {
    return importGenerationCoordinator.isUsable(generation);
  }

  function releaseImportGeneration(lease: SubtitleOcrImportLease): void {
    const wasActiveGeneration = activeImportGeneration === lease.generation;
    if (!importGenerationCoordinator.release(lease)) {
      return;
    }

    activeImportGeneration = importGenerationCoordinator.activeGeneration;
    pendingPreviewRestoreActivity += 1;
    if (
      wasActiveGeneration
      && activeImportGeneration === null
      && !importGenerationCoordinator.isCancelled(lease.generation)
      && !subtitleOcrStore.isProcessing
    ) {
      cancellationScope.setCancelRequested(false);
      subtitleOcrStore.setCancelling(false);
    }
  }

  function getStoreItem(itemId: string): SubtitleOcrSourceItem | undefined {
    return subtitleOcrStore.getItemSnapshot(itemId);
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

    if (isSubtitleOcrProgressPhaseStale(
      subtitleOcrStore.getItemProgress(payload.itemId),
      payload.phase,
    )) {
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

    subtitleOcrStore.updateRestoredBitmap(payload.itemId, payload.bitmap);
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
  function isCancellationError(error: unknown): boolean { return sanitizeProcessingMessage(error).toLowerCase().includes('cancelled'); }

  function setManualProgress(
    itemId: string,
    phase: SubtitleOcrProgress['phase'],
    percentage = 0,
  ): void {
    subtitleOcrStore.setItemStatus(itemId, statusForProgressPhase(phase));
    subtitleOcrStore.setProgress(itemId, { phase, current: percentage, total: 100, percentage });
  }

  const processingSupport = createSubtitleOcrProcessingSupport({
    persistenceQueues,
    getStoreItem,
    sanitizeProcessingMessage,
  });
  const { createSubtitleOcrRunId, persistItem } = processingSupport;

  const previewCoordination = createSubtitleOcrPreviewCoordination({
    previewRestoreRunIdsByItemId,
    activeRunIdsByItemId,
    backendCancelableRunIdsByItemId,
    getStoreItem,
    createSubtitleOcrRunId,
    preparePipelineSource,
    buildPreviewRestoreArgs,
    setManualProgress,
    persistItem,
    sanitizeProcessingMessage,
    isCancellationError,
    getCancelRequested: () => cancelRequested,
    isImportGenerationUsable,
    isImportGenerationCancelled,
    retainImportGeneration,
    releaseImportGeneration,
    getActiveImportGeneration: () => activeImportGeneration,
    onCancelledRestoreSettled: cancellationScope.clearPreviewIfOwned,
    collectMissingPreviewAssets: processingSupport.collectMissingPreviewAssets,
    onActivity: () => { pendingPreviewRestoreActivity += 1; },
  });

  const importCoordination = createSubtitleOcrImportCoordination({
    beginImportGeneration,
    retainImportGeneration,
    releaseImportGeneration,
    isImportGenerationCurrent,
    isImportGenerationCancelled,
    restoreMissingPreviewAssets: previewCoordination.restoreMissingPreviewAssets,
    requestPendingPreviewRestoreFlush: previewCoordination.requestPendingPreviewRestoreFlush,
    resolveVobSubPair: (path) => invoke<SubtitleOcrVobSubPair>('resolve_subtitle_ocr_vobsub_pair', { path }),
    sanitizeProcessingMessage,
    reportImportError,
    onDialogStateChange: (state) => {
      trackDialogOpen = state.open;
      trackDialogSourcePath = state.sourcePath;
      trackDialogSourceDuration = state.sourceDuration;
      trackDialogTracks = state.tracks;
      trackDialogLease = state.lease;
    },
    onActivity: () => { pendingPreviewRestoreActivity += 1; },
  });

  function requestPendingPreviewRestoreFlush(): void {
    previewCoordination.requestPendingPreviewRestoreFlush();
  }

  export async function handleFileDrop(paths: string[]): Promise<void> {
    await importCoordination.handleFileDrop(paths);
  }

  function handleSelectItem(itemId: string): void {
    subtitleOcrStore.selectItem(itemId);
  }

  function handleOpenVersions(itemId: string): void {
    subtitleOcrStore.selectItem(itemId);
    resultDialogItemId = itemId;
    resultDialogOpen = true;
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
      deleteSubtitleOcrRunIdIfCurrent(backendCancelableRunIdsByItemId, item.id, runId);
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

  const processingCoordination = createSubtitleOcrProcessingCoordination({
    aiCleanupControllers,
    activeRunIdsByItemId,
    backendCancelableRunIdsByItemId,
    getStoreItem,
    preparePipelineSource,
    buildPipelineArgs,
    setManualProgress,
    persistItem,
    requestPendingPreviewRestoreFlush,
    sanitizeProcessingMessage,
    isCancellationError,
    canUseSubtitleOcrAiCleanup,
    warnSubtitleOcrAiCleanupUnavailable,
    getCancelRequested: () => cancelRequested,
    setCancelRequested: cancellationScope.setCancelRequested,
  });

  function handleStart(): void {
    void processingCoordination.runProcessingItems(
      items
        .filter((item) => item.status === 'ready')
        .map((item) => item.id),
    );
  }

  function handleOpenRetryAllDialog(): void {
    if (processingCoordination.getCurrentRetryableItemIds().length === 0) {
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
    if (subtitleOcrStore.isCancelling && !canCancelImportWork) {
      return;
    }

    const processingScopeItemIds = subtitleOcrStore.processingScopeItemIds;
    const backendItemIds = new Set([
      ...processingScopeItemIds,
      ...backendCancelableRunIdsByItemId.keys(),
    ]);
    const backendCancelTargets = getSubtitleOcrBackendCancelTargets(
      backendItemIds,
      backendCancelableRunIdsByItemId,
    );
    subtitleOcrStore.cancelProcessingBatch(backendItemIds);
    const activePreviewGenerations = previewCoordination.activeRestoreGenerations;
    const previewRestoreGeneration = activePreviewGenerations.values().next().value;
    const hasPreviewRestore = activePreviewGenerations.size > 0;
    if (
      activeImportGeneration !== null
      || importCoordination.hasDialogWork
      || importCoordination.hasHydrationWork
      || hasPreviewRestore
    ) {
      cancelImportGenerations();
      previewCoordination.cancel();
      pendingPreviewRestoreActivity += 1;
      importCoordination.cancelQueuedAndCurrent();
      importCoordination.invalidateHydrations();
    }

    const itemIds = Array.from(backendItemIds);
    if (itemIds.length === 0) {
      subtitleOcrStore.stopProcessing();
      cancellationScope.clear();
      subtitleOcrStore.setCancelling(false);
      requestPendingPreviewRestoreFlush();
      return;
    }

    cancellationScope.setCancelRequested(true);
    if (hasPreviewRestore && previewRestoreGeneration !== undefined) {
      cancellationScope.ownPreviewRestore(previewRestoreGeneration);
    } else {
      cancellationScope.ownProcessing();
    }
    subtitleOcrStore.setCancelling(true);
    subtitleOcrStore.addLog(
      'warning',
      itemIds.length === 1 ? 'Cancellation requested' : `Cancellation requested for ${itemIds.length} sources`,
    );
    for (const itemId of itemIds) {
      aiCleanupControllers.get(itemId)?.abort();
    }
    await Promise.allSettled(
      backendCancelTargets.map(({ itemId, runId }) => (
        invoke('cancel_subtitle_ocr_operation', { itemId, runId })
      )),
    );
  }

  async function handleCancelItem(itemId: string): Promise<void> {
    const item = getStoreItem(itemId);
    if (!item) {
      return;
    }

    const result = await cancelSubtitleOcrItem(
      {
        aiCleanupControllers,
        activeRunIdsByItemId,
        backendCancelableRunIdsByItemId,
        previewRestoreRunIdsByItemId,
        getItem: getStoreItem,
        isProcessing: () => subtitleOcrStore.isProcessing,
        isItemCancelled: subtitleOcrStore.isItemCancelled,
        cancelProcessing: (cancelledItemId) => subtitleOcrStore.cancelProcessing(cancelledItemId),
      },
      itemId,
      async ({ itemId: targetItemId, backendRunId }) => {
        await invoke('cancel_subtitle_ocr_operation', {
          itemId: targetItemId,
          runId: backendRunId,
        });
      },
    );
    if (!result?.backendError) {
      return;
    }

    logAndToast.warning({
      source: 'subtitle-ocr',
      title: 'Subtitle OCR cancel request failed',
      details: sanitizeProcessingMessage(result.backendError),
      context: { filePath: item.sourcePath },
      showAction: false,
    });
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
      void processingCoordination.runProcessingItems(
        [itemId],
        new Map([[itemId, config]]),
        new Map([[itemId, versionName]]),
      );
      return;
    }

    void processingCoordination.runAiCleanupRetry(itemId, versionName, config);
  }

  function handleRetryAllDialogConfirm(
    mode: SubtitleOcrRetryMode,
    config: SubtitleOcrConfig,
  ): void {
    if (doesSubtitleOcrConfigRunAi(mode, config) && !canUseSubtitleOcrAiCleanup(config)) {
      warnSubtitleOcrAiCleanupUnavailable();
      return;
    }

    const itemIds = processingCoordination.getCurrentRetryableItemIds();
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
      void processingCoordination.runProcessingItems(
        itemIds,
        new Map(itemIds.map((itemId) => [itemId, config])),
      );
      return;
    }

    const aiCleanupItemIds = processingCoordination.getCurrentAiCleanupRetryableItemIds();
    if (aiCleanupItemIds.length === 0) {
      logAndToast.warning({
        source: 'subtitle-ocr',
        title: 'No active Subtitle OCR versions available for AI cleanup retry',
        details: 'Select or create an active Subtitle OCR version before retrying AI cleanup.',
        showAction: false,
      });
      return;
    }

    void processingCoordination.runAiCleanupRetryItems(aiCleanupItemIds, config);
  }

  function handleRemove(itemId: string): void {
    previewCoordination.discardPendingPreviewRestore(itemId);
    importCoordination.invalidateHydration(itemId);
    subtitleOcrStore.removeItem(itemId);
  }

  function handleClearAll(): void {
    previewCoordination.clear();
    pendingPreviewRestoreActivity += 1;
    importCoordination.clear();
    selectedCueIdsByItemId = {};
    retryAllDialogOpen = false;
    retryDialogOpen = false;
    retryDialogItemId = null;
    resultDialogItemId = null;
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
    isProcessing={subtitleOcrCancellationActive}
    processingScopeItemIds={subtitleOcrStore.processingScopeItemIds}
    {restoringPreviewItemIds}
    onImport={importCoordination.handleImport}
    onImportFolders={importCoordination.handleImportFolders}
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
      isProcessing={subtitleOcrCancellationActive}
      isCancelling={subtitleOcrStore.isCancelling}
      cancelActionKind={
        restoringPreviewItemIds.size > 0 || canCancelImportWork ? 'restore' : 'ocr'
      }
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
  generation={trackDialogLease?.generation ?? 0}
  onOpenChange={importCoordination.handleDialogOpenChange}
  sourcePath={trackDialogSourcePath}
  sourceDuration={trackDialogSourceDuration}
  tracks={trackDialogTracks}
  onImport={importCoordination.handleImportTracks}
/>

<SubtitleOcrResultDialog
  bind:open={resultDialogOpen}
  onOpenChange={(open) => {
    resultDialogOpen = open;
    if (!open) {
      resultDialogItemId = null;
    }
  }}
  item={resultDialogItem}
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
