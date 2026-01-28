<script lang="ts" module>
  // Export the handleFileDrop function type
  export interface ExtractViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { toast } from 'svelte-sonner';

  import { fileListStore } from '$lib/stores/files.svelte';
  import { extractionStore } from '$lib/stores/extraction.svelte';
  import { recentFilesStore } from '$lib/stores/recentFiles.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { scanFiles } from '$lib/services/ffprobe';
  import { extractTrack, buildOutputPath } from '$lib/services/ffmpeg';
  import { logAndToast, log } from '$lib/utils/log-toast';
  import type { VideoFile, Track } from '$lib/types';

  import {
    Button,
    DropZone,
    FileList,
    TrackDetails,
    ExtractionPanel,
    BatchTrackSelector
  } from '$lib/components';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Upload from 'lucide-svelte/icons/upload';

  export async function handleFileDrop(paths: string[]) {
    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.webm', '.m4v', '.mks', '.mka'];
    const videoPaths = paths.filter(p =>
      videoExtensions.some(ext => p.toLowerCase().endsWith(ext))
    );

    if (videoPaths.length === 0) {
      toast.warning('No valid media files detected');
      return;
    }

    if (extractionStore.progress.status === 'completed') {
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
          extensions: ['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v', 'mks', 'mka']
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
        title: 'Sélectionner le dossier de destination'
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
      toast.error('Veuillez sélectionner un dossier de destination');
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
      toast.warning('Aucune piste sélectionnée');
      return;
    }

    extractionStore.updateProgress({
      status: 'extracting',
      totalFiles: files.length,
      totalTracks: extractions.length,
      currentFileIndex: 0,
      currentTrack: 0
    });

    let successCount = 0;
    let errorCount = 0;
    const extractedPaths: string[] = [];

    for (let i = 0; i < extractions.length; i++) {
      const { file, track } = extractions[i];
      const outputPath = buildOutputPath(file.path, track, outputDir);

      extractionStore.updateProgress({
        currentFile: file.name,
        currentFileIndex: Math.floor(i / extractions.length * files.length) + 1,
        currentTrack: i + 1
      });

      const result = await extractTrack({
        inputPath: file.path,
        outputPath,
        trackIndex: track.index,
        trackType: track.type,
        codec: track.codec
      });

      extractionStore.addResult(result);

      if (result.success) {
        successCount++;
        extractedPaths.push(outputPath);
      } else {
        errorCount++;
      }
    }

    extractionStore.updateProgress({ status: 'completed' });

    // Add extracted files to recent files store for potential import in Rename tool
    if (extractedPaths.length > 0) {
      recentFilesStore.addExtractedFiles(extractedPaths);
    }

    if (errorCount === 0) {
      toast.success(`${successCount} track(s) extracted successfully`);
    } else {
      toast.warning(`${successCount} success, ${errorCount} error(s)`);
    }
  }

  async function handleOpenFolder() {
    try {
      await invoke('open_folder', { path: extractionStore.outputDir });
    } catch (error) {
      console.error('Error opening folder:', error);
    }
  }

  function handleClearAll() {
    fileListStore.clear();
    extractionStore.reset();
    extractionStore.clearAllTracks();
    toast.info('File list cleared');
  }

  function handleExtractAgain() {
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
</script>

<div class="h-full flex overflow-hidden">
  <!-- Left panel: File list -->
  <div class="w-80 border-r flex flex-col overflow-hidden">
    <div class="p-3 border-b shrink-0 flex items-center justify-between">
      <h2 class="font-semibold">Fichiers ({fileListStore.files.length})</h2>
      <div class="flex items-center gap-1">
        {#if fileListStore.files.length > 0}
          <Button
            variant="ghost"
            size="icon-sm"
            onclick={handleClearAll}
            class="text-muted-foreground hover:text-destructive"
          >
            <Trash2 class="size-4" />
            <span class="sr-only">Clear list</span>
          </Button>
        {/if}
        <Button size="sm" onclick={handleImportClick}>
          <Upload class="size-4 mr-1" />
          Add
        </Button>
      </div>
    </div>

    {#if fileListStore.files.length === 0}
      <div class="flex-1 p-4 overflow-auto">
        <DropZone isDragging={uiStore.isDragging} />
      </div>
    {:else}
      <div class="flex-1 min-h-0 overflow-auto p-2">
        <FileList
          files={fileListStore.files}
          selectedPath={fileListStore.selectedFilePath}
          onSelect={(path) => fileListStore.selectFile(path)}
          onRemove={(path) => fileListStore.removeFile(path)}
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
    />
  </div>
</div>

