<script lang="ts" module>
  // Export the handleFileDrop function type
  export interface ExtractViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { open } from '@tauri-apps/plugin-dialog';
  import { FileVideo, Trash2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';

  import { extractionStore, fileListStore, toolImportStore } from '$lib/stores';
  import { scanFiles } from '$lib/services/ffprobe';
  import { extractTrack, buildOutputPath } from '$lib/services/ffmpeg';
  import { logAndToast } from '$lib/utils/log-toast';
  import type { VideoFile, Track, ExtractProgressEvent } from '$lib/types';

  import {
    Button,
    FileList,
    TrackDetails,
    ExtractionPanel,
    BatchTrackSelector
  } from '$lib/components';
  import { ProcessingRemoveDialog, ToolImportButton } from '$lib/components/shared';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';

  const SUPPORTED_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.webm', '.m4v', '.mks', '.mka'] as const;
  const SUPPORTED_FORMATS = SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1).toUpperCase());
  const EXTRACTION_SOURCE_LABEL = 'Extraction';

  interface ExtractedOutputItem {
    key: string;
    path: string;
    name: string;
    kind: 'track_audio' | 'track_subtitle' | 'track_video';
    createdAt: number;
  }

  let extractedOutputItems = $state<ExtractedOutputItem[]>([]);
  let activeExtractionKey: string | null = null;
  let activeExtractionFilePath = $state<string | null>(null);
  let runFileTrackTotals = new Map<string, number>();
  let runFileCompletedTracks = new Map<string, number>();
  let runFileFailedTracks = new Map<string, number>();

  let cancelAllRequested = $state(false);
  let cancelCurrentFilePath = $state<string | null>(null);
  let isCancelling = $state(false);

  let removeDialogOpen = $state(false);
  let removeInProgress = $state(false);
  let removeTarget = $state.raw<{ mode: 'single'; filePath: string } | { mode: 'all' } | null>(null);
  let removeAfterCancelPaths = new Set<string>();
  let clearAllAfterCancel = false;

  function clampProgress(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
  }

  function buildExtractionKey(inputPath: string, trackIndex: number): string {
    return `${inputPath}::${trackIndex}`;
  }

  function clearExtractionRuntimeState() {
    activeExtractionKey = null;
    activeExtractionFilePath = null;
    runFileTrackTotals = new Map();
    runFileCompletedTracks = new Map();
    runFileFailedTracks = new Map();
    cancelAllRequested = false;
    cancelCurrentFilePath = null;
    isCancelling = false;
    removeAfterCancelPaths = new Set();
    clearAllAfterCancel = false;
  }

  function toDurationUs(durationSeconds?: number): number | undefined {
    if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return undefined;
    }
    return Math.round(durationSeconds * 1_000_000);
  }

  onMount(() => {
    let destroyed = false;
    let removeListener: (() => void) | null = null;

    const registerProgressListener = async () => {
      const unlisten = await listen<ExtractProgressEvent>('extract-progress', (event) => {
        if (!extractionStore.isExtracting || !activeExtractionKey) {
          return;
        }

        const { inputPath, trackIndex, progress, speedBytesPerSec } = event.payload;
        const eventKey = buildExtractionKey(inputPath, trackIndex);
        if (eventKey !== activeExtractionKey) {
          return;
        }

        const currentTrackProgress = clampProgress(progress);
        const fileCompletedTracks = runFileCompletedTracks.get(inputPath) ?? 0;
        const fileTotalTracks = Math.max(runFileTrackTotals.get(inputPath) ?? 1, 1);
        const currentFileProgress = clampProgress(
          ((fileCompletedTracks + currentTrackProgress / 100) / fileTotalTracks) * 100,
        );

        extractionStore.setLiveProgress(
          currentTrackProgress,
          currentFileProgress,
          speedBytesPerSec,
        );
        extractionStore.updateFileProgress(inputPath, currentFileProgress, speedBytesPerSec);
      });

      if (destroyed) {
        unlisten();
        return;
      }

      removeListener = unlisten;
    };

    void registerProgressListener();

    return () => {
      destroyed = true;
      removeListener?.();
    };
  });

  function trackTypeToImportKind(type: Track['type']): ExtractedOutputItem['kind'] | null {
    if (type === 'audio') {
      return 'track_audio';
    }
    if (type === 'subtitle') {
      return 'track_subtitle';
    }
    if (type === 'video') {
      return 'track_video';
    }
    return null;
  }

  export async function handleFileDrop(paths: string[]) {
    const videoPaths = paths.filter(p =>
      SUPPORTED_EXTENSIONS.some(ext => p.toLowerCase().endsWith(ext))
    );

    if (videoPaths.length === 0) {
      toast.warning('No valid media files detected');
      return;
    }

    if (extractionStore.progress.status === 'completed' || extractionStore.progress.status === 'cancelled') {
      fileListStore.clear();
      extractionStore.reset();
      extractionStore.clearAllTracks();
    }

    const pendingFiles: VideoFile[] = videoPaths.map(path => ({
      path,
      name: path.split('/').pop() || path.split('\\').pop() || path,
      size: 0,
      tracks: [],
      status: 'scanning' as const
    }));

    fileListStore.addFiles(pendingFiles);

    if (!fileListStore.selectedFilePath && videoPaths.length > 0) {
      fileListStore.selectFile(videoPaths[0]);
    }

    // Scan files in parallel with progress callback
    const scannedFiles = await scanFiles(videoPaths, 3, (completed, total) => {
      // Progress callback - could be used for UI feedback in the future
    });

    // Update the store with scanned results
    for (const scannedFile of scannedFiles) {
      if (scannedFile.status === 'error') {
        fileListStore.updateFile(scannedFile.path, {
          status: 'error',
          error: scannedFile.error
        });
      } else {
        fileListStore.updateFile(scannedFile.path, scannedFile);
      }
    }

    toast.success(`${videoPaths.length} file(s) imported`);
  }

  async function handleImportClick() {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Media files',
          extensions: SUPPORTED_EXTENSIONS.map(ext => ext.slice(1))
        }]
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        await handleFileDrop(paths);
      }
    } catch (error) {
      logAndToast.error({
        source: 'extraction',
        title: 'Error opening file dialog',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleSelectOutputDir() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select output folder'
      });

      if (selected && typeof selected === 'string') {
        extractionStore.setOutputDir(selected);
      }
    } catch (error) {
      console.error('Error selecting output directory:', error);
    }
  }

  function handleToggleTrack(trackId: number) {
    const path = fileListStore.selectedFilePath;
    if (path) {
      extractionStore.toggleTrack(path, trackId);
    }
  }

  function handleSelectAllOfType(type: Track['type']) {
    const file = fileListStore.selectedFile;
    if (!file) return;

    const trackIds = file.tracks
      .filter(t => t.type === type)
      .map(t => t.id);

    extractionStore.selectAllTracksOfType(file.path, trackIds);
  }

  function handleDeselectAllOfType(type: Track['type']) {
    const file = fileListStore.selectedFile;
    if (!file) return;

    const trackIds = file.tracks
      .filter(t => t.type === type)
      .map(t => t.id);

    const currentTracks = extractionStore.getSelectedTracksForFile(file.path);
    const newTracks = currentTracks.filter(id => !trackIds.includes(id));
    extractionStore.setTracksForFile(file.path, newTracks);
  }

  function handleBatchSelect(selection: Map<string, number[]>) {
    for (const [filePath, trackIds] of selection) {
      extractionStore.setTracksForFile(filePath, trackIds);
    }
    for (const file of fileListStore.files) {
      if (!selection.has(file.path)) {
        extractionStore.clearTracksForFile(file.path);
      }
    }
  }

  async function handleExtract() {
    const outputDir = extractionStore.outputDir;
    if (!outputDir) {
      toast.error('Please select an output folder');
      return;
    }

    const files = fileListStore.files.filter(f => f.status === 'ready');
    const selectedTracks = extractionStore.selectedTracks;

    const extractions: { file: VideoFile; track: Track }[] = [];

    for (const file of files) {
      const trackIds = selectedTracks.get(file.path) || [];
      for (const trackId of trackIds) {
        const track = file.tracks.find(t => t.id === trackId);
        if (track) {
          extractions.push({ file, track });
        }
      }
    }

    if (extractions.length === 0) {
      toast.warning('No tracks selected');
      return;
    }

    const fileIndexByPath = new Map<string, number>();
    runFileTrackTotals = new Map();
    runFileCompletedTracks = new Map();
    runFileFailedTracks = new Map();
    removeAfterCancelPaths = new Set();
    clearAllAfterCancel = false;
    cancelAllRequested = false;
    cancelCurrentFilePath = null;
    isCancelling = false;
    const cancelledFiles = new Set<string>();

    for (const { file } of extractions) {
      if (!fileIndexByPath.has(file.path)) {
        fileIndexByPath.set(file.path, fileIndexByPath.size + 1);
      }
      runFileTrackTotals.set(file.path, (runFileTrackTotals.get(file.path) ?? 0) + 1);
    }

    for (const filePath of runFileTrackTotals.keys()) {
      runFileCompletedTracks.set(filePath, 0);
      runFileFailedTracks.set(filePath, 0);
    }

    const runFilePaths = Array.from(runFileTrackTotals.keys());
    extractionStore.initializeFileRunStates(runFilePaths);
    for (const filePath of runFilePaths) {
      extractionStore.setFileQueued(filePath);
    }

    extractionStore.updateProgress({
      status: 'extracting',
      totalFiles: fileIndexByPath.size,
      totalTracks: extractions.length,
      currentFileIndex: 0,
      currentTrack: 0,
      completedTracks: 0,
      currentTrackProgress: 0,
      currentFileProgress: 0,
      currentSpeedBytesPerSec: undefined,
    });

    let successCount = 0;
    let errorCount = 0;
    const extractedOutputs: ExtractedOutputItem[] = [];

    for (let i = 0; i < extractions.length; i++) {
      if (cancelAllRequested) {
        break;
      }

      const { file, track } = extractions[i];
      if (cancelledFiles.has(file.path)) {
        continue;
      }

      const outputPath = buildOutputPath(file.path, track, outputDir);
      const fileCompletedTracks = runFileCompletedTracks.get(file.path) ?? 0;
      const fileTotalTracks = Math.max(runFileTrackTotals.get(file.path) ?? 1, 1);

      extractionStore.setFileProcessing(file.path);
      extractionStore.updateProgress({
        currentFile: file.name,
        currentFileIndex: fileIndexByPath.get(file.path) ?? 1,
        currentTrack: i + 1,
        currentTrackProgress: 0,
        currentFileProgress: clampProgress((fileCompletedTracks / fileTotalTracks) * 100),
        currentSpeedBytesPerSec: undefined,
      });

      activeExtractionKey = buildExtractionKey(file.path, track.index);
      activeExtractionFilePath = file.path;
      const result = await extractTrack({
        inputPath: file.path,
        outputPath,
        trackIndex: track.index,
        trackType: track.type,
        codec: track.codec,
        durationUs: toDurationUs(file.duration),
      });
      activeExtractionKey = null;
      activeExtractionFilePath = null;

      extractionStore.addResult(result);
      extractionStore.markTrackCompleted();

      const updatedCompletedTracks = (runFileCompletedTracks.get(file.path) ?? 0) + 1;
      runFileCompletedTracks.set(file.path, updatedCompletedTracks);

      extractionStore.updateProgress({
        currentFileProgress: clampProgress((updatedCompletedTracks / fileTotalTracks) * 100),
        currentSpeedBytesPerSec: undefined,
      });

      const wasCancelled = cancelAllRequested ||
        cancelCurrentFilePath === file.path ||
        (!!result.error && result.error.toLowerCase().includes('cancel'));

      if (wasCancelled) {
        cancelledFiles.add(file.path);
        extractionStore.setFileCancelled(file.path);
        if (cancelCurrentFilePath === file.path) {
          cancelCurrentFilePath = null;
          if (!cancelAllRequested) {
            isCancelling = false;
          }
        }
        if (cancelAllRequested) {
          break;
        }
        continue;
      }

      if (result.success) {
        successCount++;
        const importKind = trackTypeToImportKind(track.type);
        if (importKind) {
          extractedOutputs.push({
            key: `extract:${file.path}:${track.id}:${outputPath}`,
            path: outputPath,
            name: outputPath.split('/').pop() ?? outputPath,
            kind: importKind,
            createdAt: Date.now(),
          });
        }
      } else {
        errorCount++;
        runFileFailedTracks.set(file.path, (runFileFailedTracks.get(file.path) ?? 0) + 1);
      }

      if (updatedCompletedTracks >= fileTotalTracks) {
        const failedTracks = runFileFailedTracks.get(file.path) ?? 0;
        if (failedTracks > 0) {
          extractionStore.setFileError(file.path, `${failedTracks} track(s) failed`);
        } else {
          extractionStore.setFileCompleted(file.path);
        }
      }
    }

    if (cancelAllRequested) {
      for (const [filePath, totalTracks] of runFileTrackTotals) {
        const completedTracks = runFileCompletedTracks.get(filePath) ?? 0;
        if (completedTracks < totalTracks && !cancelledFiles.has(filePath)) {
          cancelledFiles.add(filePath);
          extractionStore.setFileCancelled(filePath);
        }
      }
    }

    const pendingRemovePaths = new Set(removeAfterCancelPaths);
    const shouldClearAllAfterCancel = clearAllAfterCancel;
    const wasCancelledRun = cancelledFiles.size > 0 || cancelAllRequested;

    extractionStore.updateProgress({
      status: wasCancelledRun ? 'cancelled' : 'completed',
      currentTrackProgress: 0,
      currentFileProgress: wasCancelledRun ? extractionStore.progress.currentFileProgress : 100,
      currentSpeedBytesPerSec: undefined,
    });

    if (extractedOutputs.length > 0) {
      const byPath = new Map(extractedOutputItems.map((item) => [item.path, item]));
      for (const item of extractedOutputs) {
        byPath.set(item.path, item);
      }
      extractedOutputItems = Array.from(byPath.values());
    }

    if (wasCancelledRun) {
      if (shouldClearAllAfterCancel) {
        fileListStore.clear();
        extractionStore.reset();
        extractionStore.clearAllTracks();
        extractedOutputItems = [];
      } else if (pendingRemovePaths.size > 0) {
        for (const filePath of pendingRemovePaths) {
          fileListStore.removeFile(filePath);
          extractionStore.clearTracksForFile(filePath);
          extractionStore.removeFileRunState(filePath);
        }
      }
    }

    const cancelledCount = cancelledFiles.size;
    if (wasCancelledRun) {
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} success`);
      if (errorCount > 0) parts.push(`${errorCount} error`);
      if (cancelledCount > 0) parts.push(`${cancelledCount} cancelled`);
      toast.info(parts.length > 0 ? `Extraction finished: ${parts.join(', ')}` : 'Extraction cancelled');
    } else if (errorCount === 0) {
      toast.success(`${successCount} track(s) extracted successfully`);
    } else {
      toast.warning(`${successCount} success, ${errorCount} error(s)`);
    }

    clearExtractionRuntimeState();
  }

  async function handleCancelFile(filePath: string): Promise<boolean> {
    if (!extractionStore.isExtracting) return false;
    if (isCancelling) return false;
    if (activeExtractionFilePath !== filePath) return false;

    cancelCurrentFilePath = filePath;
    isCancelling = true;

    try {
      await invoke('cancel_extract_file', { inputPath: filePath });
      toast.info('Cancelling current file...');
      return true;
    } catch (error) {
      cancelCurrentFilePath = null;
      isCancelling = false;
      logAndToast.error({
        source: 'extraction',
        title: 'Cancel failed',
        details: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async function handleCancelAll(): Promise<boolean> {
    if (!extractionStore.isExtracting) return false;
    if (isCancelling) return false;

    cancelAllRequested = true;
    isCancelling = true;

    try {
      await invoke('cancel_extract');
      toast.info('Cancelling extraction...');
      return true;
    } catch (error) {
      cancelAllRequested = false;
      isCancelling = false;
      logAndToast.error({
        source: 'extraction',
        title: 'Cancel failed',
        details: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  function handleRequestRemoveFile(filePath: string) {
    if (extractionStore.isExtracting && activeExtractionFilePath === filePath) {
      removeTarget = { mode: 'single', filePath };
      removeDialogOpen = true;
      return;
    }

    if (!extractionStore.isExtracting) {
      fileListStore.removeFile(filePath);
      extractionStore.clearTracksForFile(filePath);
      extractionStore.removeFileRunState(filePath);
    }
  }

  function handleRequestClearAll() {
    if (extractionStore.isExtracting) {
      removeTarget = { mode: 'all' };
      removeDialogOpen = true;
      return;
    }

    handleClearAll();
  }

  async function handleConfirmRemove() {
    const target = removeTarget;
    if (!target) return;

    removeInProgress = true;

    if (target.mode === 'single') {
      removeAfterCancelPaths = new Set([...removeAfterCancelPaths, target.filePath]);
      const cancelled = await handleCancelFile(target.filePath);
      if (!cancelled) {
        removeAfterCancelPaths = new Set(
          Array.from(removeAfterCancelPaths).filter((path) => path !== target.filePath),
        );
        removeInProgress = false;
        return;
      }
    } else {
      clearAllAfterCancel = true;
      const cancelled = await handleCancelAll();
      if (!cancelled) {
        clearAllAfterCancel = false;
        removeInProgress = false;
        return;
      }
    }

    removeDialogOpen = false;
    removeTarget = null;
    removeInProgress = false;
  }

  function handleCancelRemoveDialog() {
    removeDialogOpen = false;
    removeTarget = null;
    removeAfterCancelPaths = new Set();
    clearAllAfterCancel = false;
  }

  async function handleOpenFolder() {
    try {
      await invoke('open_folder', { path: extractionStore.outputDir });
    } catch (error) {
      console.error('Error opening folder:', error);
    }
  }

  function handleClearAll() {
    clearExtractionRuntimeState();
    fileListStore.clear();
    extractionStore.reset();
    extractionStore.clearAllTracks();
    extractedOutputItems = [];
    toast.info('File list cleared');
  }

  function handleExtractAgain() {
    clearExtractionRuntimeState();
    // Reset progress but keep the selected tracks and output dir
    extractionStore.reset();
  }

  const selectedFile = $derived(fileListStore.selectedFile);
  const selectedTrackIds = $derived(
    fileListStore.selectedFilePath
      ? extractionStore.getSelectedTracksForFile(fileListStore.selectedFilePath)
      : []
  );
  const readyFiles = $derived(fileListStore.files.filter(f => f.status === 'ready'));

  $effect(() => {
    toolImportStore.publishPathSource(
      'extraction_outputs',
      'extract',
      EXTRACTION_SOURCE_LABEL,
      extractedOutputItems,
    );
  });

  $effect(() => {
    const mediaItems = fileListStore.files
      .filter((file) => file.status === 'ready')
      .map((file) => ({
        key: `extract-media:${file.path}`,
        path: file.path,
        name: file.name,
        kind: 'media' as const,
        createdAt: Date.now(),
      }));

    toolImportStore.publishPathSource(
      'extraction_media',
      'extract',
      EXTRACTION_SOURCE_LABEL,
      mediaItems,
    );
  });
</script>

<div class="h-full flex overflow-hidden">
  <!-- Left panel: File list -->
  <div class="w-[max(20rem,25vw)] max-w-lg border-r flex flex-col overflow-hidden">
    <div class="p-3 border-b shrink-0 flex items-center justify-between">
      <h2 class="font-semibold">Files ({fileListStore.files.length})</h2>
      <div class="flex items-center gap-1">
        {#if fileListStore.files.length > 0}
          <Button
            variant="ghost"
            size="icon-sm"
            onclick={handleRequestClearAll}
            class="text-muted-foreground hover:text-destructive"
          >
            <Trash2 class="size-4" />
            <span class="sr-only">Clear list</span>
          </Button>
        {/if}
        <ToolImportButton
          targetTool="extract"
          onBrowse={handleImportClick}
        />
      </div>
    </div>

    {#if fileListStore.files.length === 0}
      <div class="flex-1 p-2 overflow-auto">
        <ImportDropZone
          icon={FileVideo}
          title="Drop media files here"
          formats={SUPPORTED_FORMATS}
          onBrowse={handleImportClick}
        />
      </div>
    {:else}
      <div class="flex-1 min-h-0 overflow-auto p-2">
        <FileList
          files={fileListStore.files}
          selectedPath={fileListStore.selectedFilePath}
          fileRunStates={extractionStore.fileRunStates}
          isProcessing={extractionStore.isExtracting}
          currentProcessingPath={activeExtractionFilePath}
          onSelect={(path) => fileListStore.selectFile(path)}
          onRemove={handleRequestRemoveFile}
        />
      </div>
    {/if}
  </div>

  <!-- Center panel: Track details -->
  <div class="flex-1 flex flex-col overflow-hidden">
    {#if readyFiles.length > 0}
      <div class="p-4 border-b shrink-0">
        <BatchTrackSelector
          files={readyFiles}
          selectedTracks={extractionStore.selectedTracks}
          onBatchSelect={handleBatchSelect}
        />
      </div>
    {/if}

    <div class="flex-1 min-h-0 overflow-auto p-4">
      {#if selectedFile}
        <TrackDetails
          file={selectedFile}
          selectedTrackIds={selectedTrackIds}
          onToggleTrack={handleToggleTrack}
          onSelectAll={handleSelectAllOfType}
          onDeselectAll={handleDeselectAllOfType}
        />
      {:else}
        <div class="h-full flex items-center justify-center text-muted-foreground py-20">
          <p>Select a file to view its tracks</p>
        </div>
      {/if}
    </div>
  </div>

  <!-- Right panel: Extraction options -->
  <div class="w-80 border-l p-4 overflow-auto">
    <ExtractionPanel
      outputDir={extractionStore.outputDir}
      selectedCount={extractionStore.getTotalSelectedTracks()}
      progress={extractionStore.progress}
      onSelectOutputDir={handleSelectOutputDir}
      onExtract={handleExtract}
      onExtractAgain={handleExtractAgain}
      onOpenFolder={handleOpenFolder}
      onCancel={handleCancelAll}
      {isCancelling}
    />
  </div>
</div>

<ProcessingRemoveDialog
  bind:open={removeDialogOpen}
  mode={removeTarget?.mode ?? null}
  inProgress={removeInProgress}
  onConfirm={handleConfirmRemove}
  onCancel={handleCancelRemoveDialog}
/>
