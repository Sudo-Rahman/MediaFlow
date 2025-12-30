<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { toast } from 'svelte-sonner';

  import { mergeStore } from '$lib/stores';
  import { scanFile } from '$lib/services/ffprobe';
  import type { MergeSourceFile, MergeTrack, MergeTrackConfig } from '$lib/types';

  import {
    MergeFileList,
    MergeTrackEditor,
    MergeTrackSettings,
    MergeOutputPanel
  } from '$lib/components/merge';
  import { Button } from '$lib/components/ui/button';
  import Trash2 from 'lucide-svelte/icons/trash-2';

  // Track settings dialog state
  let settingsOpen = $state(false);
  let editingTrackId = $state<string | null>(null);

  const editingTrack = $derived(() => {
    if (!editingTrackId) return null;
    return mergeStore.allTracks.find(t => t.id === editingTrackId) || null;
  });

  const editingConfig = $derived(() => {
    if (!editingTrackId) return null;
    return mergeStore.getTrackConfig(editingTrackId) || null;
  });

  async function handleAddFiles() {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Fichiers vidéo',
          extensions: ['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v']
        }]
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        await addFiles(paths);
      }
    } catch (error) {
      console.error('Error opening file dialog:', error);
      toast.error('Erreur lors de l\'ouverture du dialogue');
    }
  }

  async function addFiles(paths: string[]) {
    // Reset if completed
    if (mergeStore.status === 'completed') {
      mergeStore.reset();
    }

    for (const path of paths) {
      const name = path.split('/').pop() || path.split('\\').pop() || path;

      // Add file with pending status
      const fileId = mergeStore.addFile({
        path,
        name,
        size: 0,
        tracks: [],
        status: 'scanning'
      });

      try {
        // Scan file
        const scannedFile = await scanFile(path);

        // Convert tracks to MergeTrack format
        const mergeTracks: MergeTrack[] = scannedFile.tracks.map(t => ({
          id: `${fileId}-track-${t.id}`,
          sourceFileId: fileId,
          originalIndex: t.index,
          type: t.type,
          codec: t.codec,
          codecLong: t.codecLong,
          language: t.language,
          title: t.title,
          bitrate: t.bitrate,
          width: t.width,
          height: t.height,
          frameRate: t.frameRate,
          channels: t.channels,
          sampleRate: t.sampleRate,
          forced: t.forced,
          default: t.default,
        }));

        mergeStore.updateFile(fileId, {
          size: scannedFile.size,
          duration: scannedFile.duration,
          tracks: mergeTracks,
          status: 'ready'
        });

        // Initialize track configs
        for (const track of mergeTracks) {
          mergeStore.initTrackConfig(track);
        }

      } catch (error) {
        mergeStore.updateFile(fileId, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    toast.success(`${paths.length} fichier(s) ajouté(s)`);
  }

  async function handleSelectOutputDir() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Sélectionner le dossier de destination'
      });

      if (selected && typeof selected === 'string') {
        mergeStore.setOutputPath(selected);
      }
    } catch (error) {
      console.error('Error selecting output directory:', error);
    }
  }

  function handleEditTrack(trackId: string) {
    editingTrackId = trackId;
    settingsOpen = true;
  }

  function handleSaveTrackSettings(updates: Partial<MergeTrackConfig>) {
    if (editingTrackId) {
      mergeStore.updateTrackConfig(editingTrackId, updates);
    }
  }

  function handleCloseSettings() {
    settingsOpen = false;
    editingTrackId = null;
  }

  async function handleMerge() {
    const outputPath = mergeStore.outputConfig.outputPath;
    const outputName = mergeStore.outputConfig.outputName;

    if (!outputPath || !outputName) {
      toast.error('Veuillez configurer le fichier de sortie');
      return;
    }

    const enabledTracks = mergeStore.enabledTracks;
    if (enabledTracks.length === 0) {
      toast.warning('Aucune piste sélectionnée');
      return;
    }

    mergeStore.setStatus('processing');
    mergeStore.setProgress(0);

    try {
      // Build merge command arguments
      const fullOutputPath = `${outputPath}/${outputName}.mkv`;

      // Collect all source files and their tracks
      const trackArgs: {
        inputPath: string;
        trackIndex: number;
        config: MergeTrackConfig;
      }[] = [];

      for (const trackConfig of enabledTracks) {
        const track = mergeStore.allTracks.find(t => t.id === trackConfig.trackId);
        if (track) {
          const sourceFile = mergeStore.sourceFiles.find(f => f.id === track.sourceFileId);
          if (sourceFile) {
            trackArgs.push({
              inputPath: sourceFile.path,
              trackIndex: track.originalIndex,
              config: trackConfig
            });
          }
        }
      }

      // Call Tauri command for merge
      await invoke('merge_tracks', {
        tracks: trackArgs,
        outputPath: fullOutputPath,
        title: mergeStore.outputConfig.title
      });

      mergeStore.setProgress(100);
      mergeStore.setStatus('completed');
      toast.success('Merge terminé avec succès !');

    } catch (error) {
      mergeStore.setError(error instanceof Error ? error.message : String(error));
      toast.error('Erreur lors du merge');
    }
  }

  async function handleOpenFolder() {
    try {
      await invoke('open_folder', { path: mergeStore.outputConfig.outputPath });
    } catch (error) {
      console.error('Error opening folder:', error);
    }
  }

  function handleClearAll() {
    mergeStore.clearFiles();
    toast.info('Liste vidée');
  }

  // Selected file tracks
  const selectedFileTracks = $derived(() => {
    const file = mergeStore.selectedFile;
    return file?.tracks || [];
  });
</script>

<div class="h-full flex overflow-hidden">
  <!-- Left panel: Source files -->
  <div class="w-72 border-r flex flex-col overflow-hidden bg-muted/20">
    <div class="flex items-center justify-between p-3 border-b bg-background">
      <span class="text-sm font-semibold">Sources ({mergeStore.sourceFiles.length})</span>
      {#if mergeStore.sourceFiles.length > 0}
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={handleClearAll}
          class="text-muted-foreground hover:text-destructive"
        >
          <Trash2 class="size-4" />
          <span class="sr-only">Vider</span>
        </Button>
      {/if}
    </div>
    <MergeFileList
      files={mergeStore.sourceFiles}
      selectedId={mergeStore.selectedFileId}
      onSelect={(id) => mergeStore.selectFile(id)}
      onRemove={(id) => mergeStore.removeFile(id)}
      onAddFiles={handleAddFiles}
      class="flex-1"
    />
  </div>

  <!-- Center panel: Track editor -->
  <div class="flex-1 flex flex-col overflow-hidden">
    <div class="p-3 border-b bg-background">
      <h2 class="text-sm font-semibold">
        {#if mergeStore.selectedFile}
          Pistes de {mergeStore.selectedFile.name}
        {:else}
          Pistes
        {/if}
      </h2>
    </div>
    <div class="flex-1 min-h-0 overflow-auto p-4">
      <MergeTrackEditor
        tracks={selectedFileTracks()}
        trackConfigs={mergeStore.trackConfigs}
        onToggleTrack={(id) => mergeStore.toggleTrack(id)}
        onEditTrack={handleEditTrack}
        onReorderTrack={(id, order) => mergeStore.reorderTrack(id, order)}
      />
    </div>
  </div>

  <!-- Right panel: Output configuration -->
  <div class="w-80 border-l p-4 overflow-auto">
    <MergeOutputPanel
      outputConfig={mergeStore.outputConfig}
      enabledTracksCount={mergeStore.enabledTracks.length}
      status={mergeStore.status}
      progress={mergeStore.progress}
      error={mergeStore.error}
      onSelectOutputDir={handleSelectOutputDir}
      onOutputNameChange={(name) => mergeStore.setOutputName(name)}
      onMerge={handleMerge}
      onOpenFolder={handleOpenFolder}
    />
  </div>

  <!-- Track settings dialog -->
  <MergeTrackSettings
    open={settingsOpen}
    track={editingTrack()}
    config={editingConfig()}
    onClose={handleCloseSettings}
    onSave={handleSaveTrackSettings}
  />
</div>

