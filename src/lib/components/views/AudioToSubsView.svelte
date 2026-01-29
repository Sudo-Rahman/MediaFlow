<script lang="ts" module>
  export interface AudioToSubsViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import { toast } from 'svelte-sonner';

  import type { AudioFile, WhisperModel } from '$lib/types';
  import { AUDIO_EXTENSIONS } from '$lib/types';
  import { audioToSubsStore } from '$lib/stores';
  import { recentFilesStore } from '$lib/stores/recentFiles.svelte';
  import { 
    checkWhisperInstalled, 
    getWhisperVersion,
    listDownloadedModels,
    downloadModel,
    probeAudioFile,
    transcribeAudio,
    cancelTranscription
  } from '$lib/services/whisper';
  import { logAndToast } from '$lib/utils/log-toast';

  import { Button } from '$lib/components/ui/button';
  import { 
    AudioDropZone, 
    AudioFileList, 
    AudioDetails,
    TranscriptionPanel,
    TranscriptionResultDialog
  } from '$lib/components/audio-to-subs';
  
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Upload from 'lucide-svelte/icons/upload';
  import Download from 'lucide-svelte/icons/download';
  import X from 'lucide-svelte/icons/x';

  interface AudioToSubsViewProps {
    onNavigateToSettings?: () => void;
  }

  let { onNavigateToSettings }: AudioToSubsViewProps = $props();

  // State for result dialog
  let resultDialogOpen = $state(false);
  let resultDialogFile = $state<AudioFile | null>(null);

  // Initialize on mount
  onMount(async () => {
    await initializeWhisper();
  });

  async function initializeWhisper() {
    // Check if whisper is installed
    const installed = await checkWhisperInstalled();
    const version = installed ? await getWhisperVersion() : null;
    audioToSubsStore.setWhisperInstalled(installed, version);

    // List downloaded models
    if (installed) {
      const models = await listDownloadedModels();
      audioToSubsStore.setDownloadedModels(models as WhisperModel[]);
    }
  }

  // Exposed API for drag & drop
  export async function handleFileDrop(paths: string[]) {
    const audioExtensions = new Set(AUDIO_EXTENSIONS);
    const audioPaths = paths.filter(p => {
      const ext = p.split('.').pop()?.toLowerCase() || '';
      return audioExtensions.has(ext as typeof AUDIO_EXTENSIONS[number]);
    });

    if (audioPaths.length === 0) {
      toast.warning('No audio files found in dropped items');
      return;
    }

    await addFiles(audioPaths);
  }

  async function handleAddFiles() {
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Audio files',
        extensions: [...AUDIO_EXTENSIONS]
      }]
    });

    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await addFiles(paths);
    }
  }

  async function addFiles(paths: string[]) {
    const newFiles = audioToSubsStore.addFilesFromPaths(paths);
    
    // Probe each file for metadata
    for (const file of newFiles) {
      audioToSubsStore.updateFile(file.id, { status: 'scanning' });
      
      try {
        const metadata = await probeAudioFile(file.path);
        audioToSubsStore.updateFile(file.id, { 
          ...metadata, 
          status: 'ready' 
        });
      } catch (error) {
        audioToSubsStore.updateFile(file.id, { 
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to probe file'
        });
      }
    }
  }

  async function handleImportFromExtraction() {
    const audioFiles = recentFilesStore.extractedFiles.filter(f => {
      const ext = f.path.split('.').pop()?.toLowerCase() || '';
      return AUDIO_EXTENSIONS.includes(ext as typeof AUDIO_EXTENSIONS[number]);
    });

    if (audioFiles.length === 0) {
      toast.info('No audio files found in recent extractions');
      return;
    }

    await addFiles(audioFiles.map(f => f.path));
    toast.success(`Imported ${audioFiles.length} audio file(s)`);
  }

  async function handleDownloadModel(model: WhisperModel) {
    audioToSubsStore.startModelDownload(model);
    
    try {
      const result = await downloadModel(model, (progress) => {
        audioToSubsStore.setDownloadProgress(progress);
      });
      
      if (result.success) {
        audioToSubsStore.finishModelDownload(model, true);
        toast.success(`Model ${model} downloaded successfully`);
      } else {
        audioToSubsStore.finishModelDownload(model, false);
        toast.error(`Failed to download model: ${result.error}`);
      }
    } catch (error) {
      audioToSubsStore.finishModelDownload(model, false);
      logAndToast.error({
        source: 'whisper',
        title: 'Download failed',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleTranscribeAll() {
    const readyFiles = audioToSubsStore.readyFiles;
    if (readyFiles.length === 0) return;

    audioToSubsStore.startTranscription();

    let successCount = 0;
    let failCount = 0;
    let cancelledCount = 0;

    for (const file of readyFiles) {
      // Check if this file or all transcription has been cancelled
      if (audioToSubsStore.isCancelling || audioToSubsStore.isFileCancelled(file.id)) {
        audioToSubsStore.updateFile(file.id, { status: 'ready' }); // Reset to ready
        cancelledCount++;
        continue;
      }

      audioToSubsStore.updateFile(file.id, { status: 'transcribing', progress: 0 });

      try {
        const result = await transcribeAudio(
          file.path,
          audioToSubsStore.outputDir,
          audioToSubsStore.config,
          (progress) => {
            audioToSubsStore.setFileProgress(file.id, progress);
          }
        );

        // Check again if cancelled during transcription
        if (audioToSubsStore.isCancelling || audioToSubsStore.isFileCancelled(file.id)) {
          audioToSubsStore.updateFile(file.id, { status: 'error', error: 'Cancelled by user' });
          cancelledCount++;
          continue;
        }

        if (result.success && result.outputPath) {
          audioToSubsStore.completeFile(file.id, result.outputPath);
          successCount++;
          logAndToast.success({
            source: 'whisper',
            title: 'Transcription complete',
            details: `${file.name} → ${result.outputPath.split('/').pop()}`
          });
        } else {
          audioToSubsStore.failFile(file.id, result.error || 'Unknown error');
          failCount++;
          logAndToast.error({
            source: 'whisper',
            title: `Transcription failed: ${file.name}`,
            details: result.error || 'Unknown error'
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Transcription failed';
        audioToSubsStore.failFile(file.id, errorMsg);
        failCount++;
        logAndToast.error({
          source: 'whisper',
          title: `Transcription failed: ${file.name}`,
          details: errorMsg
        });
      }
    }

    audioToSubsStore.stopTranscription();
    
    // Summary toast
    if (cancelledCount > 0 && successCount === 0 && failCount === 0) {
      toast.info('Transcription cancelled');
    } else if (successCount > 0 || failCount > 0) {
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} completed`);
      if (failCount > 0) parts.push(`${failCount} failed`);
      if (cancelledCount > 0) parts.push(`${cancelledCount} cancelled`);
      toast.info(`Transcription finished: ${parts.join(', ')}`);
    }
  }

  function handleCancelFile(id: string) {
    audioToSubsStore.cancelFile(id);
    cancelTranscription(); // Attempt to cancel the current whisper process
    toast.info('Cancelling transcription...');
  }

  function handleCancelAll() {
    audioToSubsStore.cancelAll();
    cancelTranscription(); // Attempt to cancel the current whisper process
    toast.info('Cancelling all transcriptions...');
  }

  function handleViewResult(file: AudioFile) {
    resultDialogFile = file;
    resultDialogOpen = true;
  }

  async function handleOpenOutputFolder() {
    if (audioToSubsStore.outputDir) {
      await invoke('open_folder', { path: audioToSubsStore.outputDir });
    }
  }

  const hasExtractedAudioFiles = $derived(
    recentFilesStore.extractedFiles.some(f => {
      const ext = f.path.split('.').pop()?.toLowerCase() || '';
      return AUDIO_EXTENSIONS.includes(ext as typeof AUDIO_EXTENSIONS[number]);
    })
  );
</script>

<div class="h-full flex overflow-hidden">
  <!-- Left Panel: File List -->
  <div class="w-80 border-r flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="p-3 border-b shrink-0 flex items-center justify-between">
      <h2 class="font-semibold">Audio Files ({audioToSubsStore.audioFiles.length})</h2>
      <div class="flex items-center gap-1">
        {#if audioToSubsStore.isTranscribing}
          <Button
            variant="destructive"
            size="sm"
            onclick={handleCancelAll}
            title="Cancel all transcriptions"
          >
            <X class="size-4 mr-1" />
            Cancel
          </Button>
        {:else}
          {#if audioToSubsStore.audioFiles.length > 0}
            <Button
              variant="ghost"
              size="icon-sm"
              onclick={audioToSubsStore.clear}
              class="text-muted-foreground hover:text-destructive"
            >
              <Trash2 class="size-4" />
              <span class="sr-only">Clear list</span>
            </Button>
          {/if}
          <Button size="sm" onclick={handleAddFiles}>
            <Upload class="size-4 mr-1" />
            Add
          </Button>
        {/if}
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 min-h-0 overflow-auto p-2">
      {#if audioToSubsStore.audioFiles.length === 0}
        <AudioDropZone disabled={audioToSubsStore.isTranscribing} />
      {:else}
        <AudioFileList
          files={audioToSubsStore.audioFiles}
          selectedId={audioToSubsStore.selectedFileId}
          onSelect={(id) => audioToSubsStore.selectFile(id)}
          onRemove={(id) => audioToSubsStore.removeFile(id)}
          onCancel={handleCancelFile}
          onViewResult={handleViewResult}
          disabled={audioToSubsStore.isTranscribing}
        />
      {/if}
    </div>

    <!-- Import from Extraction -->
    {#if hasExtractedAudioFiles}
      <div class="p-2 border-t shrink-0">
        <Button
          variant="outline"
          size="sm"
          class="w-full"
          onclick={handleImportFromExtraction}
          disabled={audioToSubsStore.isTranscribing}
        >
          <Download class="size-4 mr-2" />
          Import from Extraction
        </Button>
      </div>
    {/if}
  </div>

  <!-- Center Panel: File Details -->
  <div class="flex-1 flex flex-col overflow-hidden">
    <AudioDetails 
      file={audioToSubsStore.selectedFile}
      showWaveform={true}
    />
  </div>

  <!-- Right Panel: Transcription Config -->
  <div class="w-80 border-l overflow-hidden">
    <TranscriptionPanel
      config={audioToSubsStore.config}
      outputDir={audioToSubsStore.outputDir}
      downloadedModels={audioToSubsStore.downloadedModels}
      whisperInstalled={audioToSubsStore.whisperInstalled}
      isTranscribing={audioToSubsStore.isTranscribing}
      isDownloadingModel={audioToSubsStore.isDownloadingModel}
      downloadProgress={audioToSubsStore.downloadProgress}
      readyFilesCount={audioToSubsStore.readyFiles.length}
      completedFilesCount={audioToSubsStore.completedFiles.length}
      totalFilesCount={audioToSubsStore.audioFiles.length}
      onConfigChange={(updates) => audioToSubsStore.updateConfig(updates)}
      onOutputDirChange={(dir) => audioToSubsStore.setOutputDir(dir)}
      onTranscribe={handleTranscribeAll}
      onTranscribeAll={handleTranscribeAll}
      onDownloadModel={handleDownloadModel}
      {onNavigateToSettings}
    />
  </div>
</div>

<!-- Result Dialog -->
<TranscriptionResultDialog
  bind:open={resultDialogOpen}
  onOpenChange={(v: boolean) => { resultDialogOpen = v; }}
  outputPath={resultDialogFile?.outputPath ?? null}
  fileName={resultDialogFile?.name ?? ''}
/>
