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
  import { exists as pathExists } from '@tauri-apps/plugin-fs';
  import { toast } from 'svelte-sonner';

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
  import { subtitleOcrStore } from '$lib/stores';
  import {
    type SubtitleOcrCue,
    type SubtitleOcrConfig,
    type SubtitleOcrPipelineResult,
    type SubtitleOcrProgress,
    type SubtitleOcrRetryMode,
    type SubtitleOcrSourceItem,
    type SubtitleOcrStatus,
    type SubtitleOcrTrackMetadata,
    type SubtitleOcrVersion,
  } from '$lib/types';
  import { getFileName } from '$lib/utils/format';
  import { logAndToast } from '$lib/utils/log-toast';

  import {
    buildSubtitleOcrDraftVersionInput,
    buildSubtitleOcrSourceSnapshot,
    filterSubtitleOcrPersistenceForItem,
    getSubtitleOcrActiveVersionItemIds,
    getSubtitleOcrBackendCancelTargets,
    getSubtitleOcrVersionedItemIds,
    mergeSubtitleOcrPersistenceForItem,
    resolveSubtitleOcrEffectiveModelForConfig,
    shouldApplySubtitleOcrProgressEvent,
    summarizeSubtitleOcrItems,
  } from './subtitle-ocr-view-state';

  interface SubtitleOcrViewProps {
    onNavigateToSettings?: () => void;
  }

  interface TrackDialogRequest {
    sourcePath: string;
    tracks: SubtitleOcrTrackMetadata[];
  }

  interface SubtitleOcrProgressEventPayload {
    itemId: string;
    runId?: string;
    phase: string;
    current: number;
    total: number;
    percentage: number;
    message?: string;
  }

  type ProcessItemResult = 'completed' | 'cancelled' | 'error';

  let { onNavigateToSettings }: SubtitleOcrViewProps = $props();

  let trackDialogOpen = $state(false);
  let trackDialogSourcePath = $state('');
  let trackDialogTracks = $state.raw<SubtitleOcrTrackMetadata[]>([]);
  let queuedTrackDialogs = $state.raw<TrackDialogRequest[]>([]);
  let resultDialogOpen = $state(false);
  let retryAllDialogOpen = $state(false);
  let retryDialogOpen = $state(false);
  let retryDialogItemId = $state<string | null>(null);
  let selectedCueIdsByItemId = $state.raw<Record<string, string | null>>({});
  let unlistenSubtitleOcrProgress: UnlistenFn | null = null;

  const aiCleanupControllers = new SvelteMap<string, AbortController>();
  const activeRunIdsByItemId = new SvelteMap<string, string>();
  const backendCancelableRunIdsByItemId = new SvelteMap<string, string>();
  let cancelRequested = false;

  const IMPORT_EXTENSIONS = [
    'mkv',
    'm2ts',
    'vob',
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

  const items = $derived(subtitleOcrStore.items);
  const selectedItem = $derived(subtitleOcrStore.selectedItem ?? null);
  const activeVersion = $derived(
    selectedItem ? subtitleOcrStore.getActiveVersion(selectedItem.id) ?? null : null,
  );
  const renderedCues = $derived(
    selectedItem ? subtitleOcrStore.getRenderedCues(selectedItem.id) : [],
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
  const summary = $derived.by(() => summarizeSubtitleOcrItems(items));
  const retryableItemIds = $derived.by(() => getSubtitleOcrVersionedItemIds(items));
  const aiCleanupRetryableItemIds = $derived.by(() => (
    getSubtitleOcrActiveVersionItemIds(items)
  ));
  const retryCount = $derived(retryableItemIds.length);
  const aiCleanupRetryCount = $derived(aiCleanupRetryableItemIds.length);
  const primaryAction = $derived.by<'start' | 'retry'>(() => {
    if (summary.readyCount > 0) {
      return 'start';
    }

    if (retryCount > 0) {
      return 'retry';
    }

    return 'start';
  });
  const canStart = $derived(summary.readyCount > 0 && !subtitleOcrStore.isProcessing);
  const canRetryAll = $derived(retryCount > 0 && !subtitleOcrStore.isProcessing);
  const actionHint = $derived.by(() => {
    if (summary.scanningCount > 0) {
      return 'Wait for scanning to complete';
    }

    if (items.length === 0) {
      return 'Add subtitle sources to begin';
    }

    return 'No sources ready for OCR';
  });

  onMount(() => {
    let destroyed = false;

    const setup = async () => {
      const unlisten = await listen<SubtitleOcrProgressEventPayload>(
        'subtitle-ocr-progress',
        (event) => {
          if (destroyed) {
            return;
          }

          handleSubtitleOcrProgress(event.payload);
        },
      );

      if (destroyed) {
        unlisten();
        return;
      }

      unlistenSubtitleOcrProgress = unlisten;
    };

    void setup();

    return () => {
      destroyed = true;
      unlistenSubtitleOcrProgress?.();
      unlistenSubtitleOcrProgress = null;
      for (const controller of aiCleanupControllers.values()) {
        controller.abort();
      }
      aiCleanupControllers.clear();
      activeRunIdsByItemId.clear();
      backendCancelableRunIdsByItemId.clear();
    };
  });

  function showImportWarnings(warnings: readonly string[]): void {
    for (const warning of warnings) {
      toast.warning(warning);
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
      source: 'system',
      title: 'Subtitle OCR import failed',
      details: getSanitizedImportErrorDetails(error),
      showAction: false,
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

    if (!shouldApplySubtitleOcrProgressEvent(
      payload.itemId,
      payload.runId,
      activeRunIdsByItemId,
      cancelRequested,
    )) {
      return;
    }

    subtitleOcrStore.setItemStatus(payload.itemId, statusForProgressPhase(payload.phase));
    subtitleOcrStore.setProgress(payload.itemId, {
      phase: payload.phase,
      current: payload.current,
      total: payload.total,
      percentage: payload.percentage,
      message: payload.message,
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

  function setManualProgress(
    itemId: string,
    phase: SubtitleOcrProgress['phase'],
    message: string,
    percentage = 0,
  ): void {
    subtitleOcrStore.setItemStatus(itemId, statusForProgressPhase(phase));
    subtitleOcrStore.setProgress(itemId, {
      phase,
      current: percentage,
      total: 100,
      percentage,
      message,
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
    } catch (error) {
      logAndToast.warning({
        source: 'system',
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
      toast.warning('Subtitle sources are already imported');
    } else if (addedItems.length < nextItems.length) {
      toast.warning('Some subtitle sources were already imported');
    }

    for (const item of addedItems) {
      await hydrateImportedItem(item);
    }
  }

  async function importStandalonePaths(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    const result = await buildStandaloneSubtitleOcrItems(paths, pathExists);
    await addImportedItems(result.items);
    showImportWarnings(result.warnings);

    if (result.items.length === 0 && result.warnings.length === 0) {
      toast.warning('No complete standalone subtitle sources found');
    }
  }

  async function probeContainerPath(path: string): Promise<TrackDialogRequest | null> {
    try {
      const tracks = await invoke<SubtitleOcrTrackMetadata[]>('probe_subtitle_ocr_tracks', { path });
      if (tracks.length === 0) {
        toast.warning(`No bitmap subtitle tracks found in ${getFileName(path)}`);
        return null;
      }

      return { sourcePath: path, tracks };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Could not inspect ${getFileName(path)}: ${message}`);
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
    trackDialogTracks = request.tracks;
    trackDialogOpen = true;
  }

  function closeTrackDialog(): void {
    trackDialogOpen = false;
    trackDialogSourcePath = '';
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
      toast.warning('No supported subtitle OCR sources found');
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

    setManualProgress(item.id, 'extracting', 'Extracting subtitle track...');
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
      },
    };
  }

  async function runAiCleanupForItem(
    itemId: string,
    cues: SubtitleOcrCue[],
    config: SubtitleOcrConfig = subtitleOcrStore.config,
  ): Promise<{ cues: SubtitleOcrCue[]; applied: boolean; cancelled: boolean }> {
    const controller = new AbortController();
    aiCleanupControllers.set(itemId, controller);
    setManualProgress(itemId, 'ai_cleaning', 'Cleaning subtitles with AI...');

    try {
      const result = await cleanupSubtitleOcrCuesWithAi(cues, {
        provider: config.aiCleanupProvider,
        model: config.aiCleanupModel,
        signal: controller.signal,
      });

      if (result.cancelled || controller.signal.aborted) {
        return { cues, applied: false, cancelled: true };
      }

      if (!result.success) {
        logAndToast.warning({
          source: 'system',
          title: 'Subtitle OCR AI cleanup skipped',
          details: result.error ? sanitizeProcessingMessage(result.error) : 'AI cleanup failed.',
          showAction: false,
        });
        return { cues, applied: false, cancelled: false };
      }

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

    try {
      const existingData = await loadSubtitleOcrData(item.sourcePath);
      const saved = await saveSubtitleOcrData(
        item.sourcePath,
        mergeSubtitleOcrPersistenceForItem(item, existingData, new Date().toISOString()),
      );

      if (!saved) {
        logAndToast.warning({
          source: 'system',
          title: 'Subtitle OCR versions were not saved',
          details: 'The generated version could not be written to the MediaFlow sidecar.',
          showAction: false,
        });
      }
    } catch (error) {
      logAndToast.warning({
        source: 'system',
        title: 'Subtitle OCR versions were not saved',
        details: sanitizeProcessingMessage(error),
        showAction: false,
      });
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
    activeRunIdsByItemId.set(item.id, runId);

    try {
      setManualProgress(
        item.id,
        item.sourceKind === 'container_track' ? 'extracting' : 'decoding',
        item.sourceKind === 'container_track'
          ? 'Extracting subtitle track...'
          : 'Decoding subtitle bitmaps...',
      );

      const sourcePath = await preparePipelineSource(item, runId);
      if (cancelRequested) {
        throw new Error('Subtitle OCR operation cancelled');
      }

      setManualProgress(item.id, 'decoding', 'Decoding subtitle bitmaps...');
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
      if (cancelRequested) {
        throw new Error('Subtitle OCR operation cancelled');
      }

      const ocrFinalCues = result.finalCues;
      const cleanup = config.aiCleanupEnabled
        ? await runAiCleanupForItem(item.id, ocrFinalCues, config)
        : { cues: ocrFinalCues, applied: false, cancelled: false };

      if (cleanup.cancelled || cancelRequested) {
        throw new Error('Subtitle OCR operation cancelled');
      }

      const latestItem = getStoreItem(item.id) ?? item;
      const version = createSubtitleOcrVersion({
        name: versionNameOverride ?? `Version ${latestItem.versions.length + 1}`,
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

      subtitleOcrStore.addVersion(item.id, version);
      await persistItem(item.id);
      return 'completed';
    } catch (error) {
      backendCancelableRunIdsByItemId.delete(item.id);
      activeRunIdsByItemId.delete(item.id);
      subtitleOcrStore.setProgress(item.id, undefined);

      if (isCancellationError(error) || cancelRequested) {
        restoreCancelledItemStatus(item.id);
        return 'cancelled';
      }

      const details = sanitizeProcessingMessage(error);
      subtitleOcrStore.setItemStatus(item.id, 'error', details);
      logAndToast.error({
        source: 'system',
        title: 'Subtitle OCR failed',
        details,
        showAction: false,
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

    cancelRequested = false;
    subtitleOcrStore.startProcessing(processableItemIds);

    try {
      for (const itemId of processableItemIds) {
        if (cancelRequested) {
          break;
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
        if (result === 'cancelled') {
          break;
        }
      }
    } finally {
      subtitleOcrStore.stopProcessing();
      cancelRequested = false;
    }
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
      toast.warning('No Subtitle OCR versions available for retry');
      return;
    }

    retryAllDialogOpen = true;
  }

  async function handleCancel(): Promise<void> {
    const processingScopeItemIds = subtitleOcrStore.processingScopeItemIds;
    const itemIds = Array.from(processingScopeItemIds);
    if (itemIds.length === 0) {
      subtitleOcrStore.stopProcessing();
      return;
    }

    cancelRequested = true;
    subtitleOcrStore.setCancelling(true);
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
    const itemIds = getCurrentRetryableItemIds();
    if (itemIds.length === 0) {
      toast.warning('No Subtitle OCR versions available for retry');
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
      toast.warning('No active Subtitle OCR versions available for AI cleanup retry');
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

    cancelRequested = false;
    subtitleOcrStore.startProcessing([itemId]);

    try {
      await processAiCleanupRetryItem(itemId, versionName, config);
    } finally {
      subtitleOcrStore.stopProcessing();
      cancelRequested = false;
    }
  }

  async function runAiCleanupRetryItems(
    itemIds: string[],
    config: SubtitleOcrConfig,
  ): Promise<void> {
    if (itemIds.length === 0 || subtitleOcrStore.isProcessing) {
      return;
    }

    cancelRequested = false;
    subtitleOcrStore.startProcessing(itemIds);

    try {
      for (const itemId of itemIds) {
        if (cancelRequested) {
          break;
        }

        const result = await processAiCleanupRetryItem(itemId, undefined, config);
        if (result === 'cancelled') {
          break;
        }
      }
    } finally {
      subtitleOcrStore.stopProcessing();
      cancelRequested = false;
    }
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
      if (cleanup.cancelled || cancelRequested) {
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
      return 'completed';
    } catch (error) {
      const details = sanitizeProcessingMessage(error);
      subtitleOcrStore.setItemStatus(itemId, 'error', details);
      logAndToast.error({
        source: 'system',
        title: 'Subtitle OCR AI cleanup retry failed',
        details,
        showAction: false,
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

  async function handleSaveDraftVersion(itemId: string): Promise<void> {
    const item = getStoreItem(itemId);
    const activeVersion = subtitleOcrStore.getActiveVersion(itemId);
    if (!item || !activeVersion) {
      return;
    }

    const input = buildSubtitleOcrDraftVersionInput(item, activeVersion);
    if (!input) {
      return;
    }

    const latestItem = getStoreItem(itemId) ?? item;
    const version = createSubtitleOcrVersion({
      name: `Version ${latestItem.versions.length + 1}`,
      ...input,
    });

    subtitleOcrStore.addVersion(itemId, version);
    await persistItem(itemId);
    toast.success('Saved draft as a new Subtitle OCR version');
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
    onImport={handleImport}
    onSelectItem={handleSelectItem}
    onOpenVersions={handleOpenVersions}
    onRetry={handleOpenRetryDialog}
    onRemove={handleRemove}
    onClearAll={handleClearAll}
  />

  <div class="min-w-0 overflow-hidden">
    <SubtitleOcrWorkspace
      item={selectedItem}
      {activeVersion}
      {renderedCues}
      {selectedCueId}
      onSelectCue={handleSelectCue}
      onSelectVersion={subtitleOcrStore.selectVersion}
      onCueTextChange={subtitleOcrStore.updateCueText}
      onSaveDraftVersion={(itemId) => void handleSaveDraftVersion(itemId)}
      isProcessing={subtitleOcrStore.isProcessing}
    />
  </div>

  <aside class="border-l p-4 overflow-auto">
    <SubtitleOcrOptionsPanel
      config={subtitleOcrStore.config}
      {canStart}
      {canRetryAll}
      isProcessing={subtitleOcrStore.isProcessing}
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
