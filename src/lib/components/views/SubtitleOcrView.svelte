<script lang="ts" module>
  export interface SubtitleOcrViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { exists as pathExists } from '@tauri-apps/plugin-fs';
  import { toast } from 'svelte-sonner';

  import {
    SubtitleOcrImportTracksDialog,
    SubtitleOcrOptionsPanel,
    SubtitleOcrSidebar,
    SubtitleOcrWorkspace,
  } from '$lib/components/subtitle-ocr';
  import {
    buildStandaloneSubtitleOcrItems,
    getSubtitleOcrImportKind,
  } from '$lib/services/subtitle-ocr-import';
  import { subtitleOcrStore } from '$lib/stores';
  import type { SubtitleOcrSourceItem, SubtitleOcrTrackMetadata } from '$lib/types';
  import { getFileName } from '$lib/utils/format';

  import { summarizeSubtitleOcrItems } from './subtitle-ocr-view-state';

  interface SubtitleOcrViewProps {
    onNavigateToSettings?: () => void;
  }

  interface TrackDialogRequest {
    sourcePath: string;
    tracks: SubtitleOcrTrackMetadata[];
  }

  let { onNavigateToSettings }: SubtitleOcrViewProps = $props();

  let trackDialogOpen = $state(false);
  let trackDialogSourcePath = $state('');
  let trackDialogTracks = $state.raw<SubtitleOcrTrackMetadata[]>([]);
  let queuedTrackDialogs = $state.raw<TrackDialogRequest[]>([]);
  let selectedCueIdsByItemId = $state.raw<Record<string, string | null>>({});

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

  const items = $derived(subtitleOcrStore.items);
  const selectedItem = $derived(subtitleOcrStore.selectedItem ?? null);
  const activeVersion = $derived(
    selectedItem ? subtitleOcrStore.getActiveVersion(selectedItem.id) ?? null : null,
  );
  const renderedCues = $derived(
    selectedItem ? subtitleOcrStore.getRenderedCues(selectedItem.id) : [],
  );
  const selectedCueId = $derived(
    selectedItem
      ? selectedCueIdsByItemId[selectedItem.id] ?? renderedCues[0]?.id ?? null
      : null,
  );
  const summary = $derived.by(() => summarizeSubtitleOcrItems(items));
  const canStart = $derived(summary.readyCount > 0 && !subtitleOcrStore.isProcessing);
  const actionHint = $derived.by(() => {
    if (summary.scanningCount > 0) {
      return 'Wait for scanning to complete';
    }

    if (items.length === 0) {
      return 'Add subtitle sources to begin';
    }

    if (summary.retryableCount > 0) {
      return 'Use Retry on a source to run OCR again';
    }

    return 'No sources ready for OCR';
  });

  function showImportWarnings(warnings: readonly string[]): void {
    for (const warning of warnings) {
      toast.warning(warning);
    }
  }

  function addImportedItems(nextItems: SubtitleOcrSourceItem[]): void {
    if (nextItems.length === 0) {
      return;
    }

    const addedItems = subtitleOcrStore.addItems(nextItems);
    if (addedItems.length === 0) {
      toast.warning('Subtitle sources are already imported');
    } else if (addedItems.length < nextItems.length) {
      toast.warning('Some subtitle sources were already imported');
    }
  }

  async function importStandalonePaths(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    const result = await buildStandaloneSubtitleOcrItems(paths, pathExists);
    addImportedItems(result.items);
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

  function handleImportTracks(importedItems: SubtitleOcrSourceItem[]): void {
    addImportedItems(importedItems);
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
  }

  export async function handleFileDrop(paths: string[]): Promise<void> {
    await importPaths(paths);
  }

  function handleSelectItem(itemId: string): void {
    subtitleOcrStore.selectItem(itemId);
  }

  function handleOpenVersions(itemId: string): void {
    subtitleOcrStore.selectItem(itemId);
  }

  function startPlaceholderRun(itemIds: string[]): void {
    const activeItemIds = itemIds.filter((itemId) => items.some((item) => item.id === itemId));
    if (activeItemIds.length === 0 || subtitleOcrStore.isProcessing) {
      return;
    }

    subtitleOcrStore.startProcessing(activeItemIds);
    // TODO(task 14): call prepare_subtitle_ocr_track/run_subtitle_ocr_pipeline and add real versions.
    toast.info('Subtitle OCR run flow is not connected yet');
  }

  function handleStart(): void {
    startPlaceholderRun(
      items
        .filter((item) => item.status === 'ready')
        .map((item) => item.id),
    );
  }

  async function handleCancel(): Promise<void> {
    const itemIds = Array.from(subtitleOcrStore.processingScopeItemIds);
    if (itemIds.length === 0) {
      subtitleOcrStore.stopProcessing();
      return;
    }

    subtitleOcrStore.setCancelling(true);
    await Promise.allSettled(
      itemIds.map((itemId) => invoke('cancel_subtitle_ocr_operation', { itemId })),
    );
    subtitleOcrStore.stopProcessing();
  }

  function handleRetry(itemId: string): void {
    subtitleOcrStore.selectItem(itemId);
    startPlaceholderRun([itemId]);
  }

  function handleRemove(_itemId: string): void {
    toast.info('Remove is not available in this shell yet');
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
    onRetry={handleRetry}
    onRemove={handleRemove}
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
    />
  </div>

  <aside class="border-l p-4 overflow-auto">
    <SubtitleOcrOptionsPanel
      config={subtitleOcrStore.config}
      {canStart}
      isProcessing={subtitleOcrStore.isProcessing}
      readyCount={summary.readyCount}
      {actionHint}
      onConfigChange={subtitleOcrStore.updateConfig}
      onStart={handleStart}
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
