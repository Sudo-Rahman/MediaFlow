<script lang="ts" module>
  import { Trash2, Upload } from '@lucide/svelte';
  export interface VideoOcrViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { toast } from 'svelte-sonner';

  import type { OcrVideoFile, OcrRegion, OcrProgressEvent, OcrModelsStatus } from '$lib/types';
  import { VIDEO_EXTENSIONS } from '$lib/types';
  import { videoOcrStore } from '$lib/stores';
  import { logAndToast } from '$lib/utils/log-toast';
  import { scanFile } from '$lib/services/ffprobe';

  import { Button } from '$lib/components/ui/button';
  import { 
    VideoDropZone, 
    VideoFileList, 
    VideoPreview,
    OcrOptionsPanel,
    OcrLogPanel,
    OcrResultDialog 
  } from '$lib/components/video-ocr';

  // Constants
  const MAX_CONCURRENT_TRANSCODES = 1; // Sequential for video transcoding

  // State for result dialog
  let resultDialogOpen = $state(false);
  let resultDialogFile = $state<OcrVideoFile | null>(null);

  // Event listener cleanup
  let unlistenOcrProgress: UnlistenFn | null = null;

  // Initialize on mount
  onMount(async () => {
    // Check OCR models status
    if (!videoOcrStore.modelsChecked) {
      try {
        const status = await invoke<OcrModelsStatus>('check_ocr_models');
        videoOcrStore.setModelsStatus(status);
        
        if (!status.installed) {
          toast.warning('OCR models not found. Some languages may not be available.');
        }
      } catch (error) {
        console.error('Failed to check OCR models:', error);
      }
    }

    // Set up event listener for OCR progress (includes transcoding phase)
    unlistenOcrProgress = await listen<OcrProgressEvent>(
      'ocr-progress',
      (event) => {
        const { fileId, phase, current, total, message } = event.payload;
        
        // Handle transcoding phase separately
        if (phase === 'transcoding') {
          videoOcrStore.updateTranscodingProgress(fileId, current);
        } else {
          videoOcrStore.updateProgress(fileId, { 
            phase, 
            current, 
            total, 
            percentage: total > 0 ? Math.round((current / total) * 100) : 0, 
            message 
          });
        }
      }
    );
  });

  // Cleanup on destroy
  onDestroy(() => {
    unlistenOcrProgress?.();
  });

  // Exposed API for drag & drop
  export async function handleFileDrop(paths: string[]) {
    const videoExtensions = new Set(VIDEO_EXTENSIONS);
    const videoPaths = paths.filter(p => {
      const ext = p.split('.').pop()?.toLowerCase() || '';
      return videoExtensions.has(ext as typeof VIDEO_EXTENSIONS[number]);
    });

    if (videoPaths.length === 0) {
      toast.warning('No video files found');
      return;
    }

    await addFiles(videoPaths);
  }

  async function handleAddFiles() {
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Video files',
        extensions: [...VIDEO_EXTENSIONS]
      }]
    });

    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await addFiles(paths);
    }
  }

  async function addFiles(paths: string[]) {
    const newFiles = videoOcrStore.addFilesFromPaths(paths);
    
    // Probe each file and start transcoding
    for (const file of newFiles) {
      try {
        const probeResult = await scanFile(file.path);
        
        // Find video track to get dimensions
        const videoTrack = probeResult.tracks.find(t => t.type === 'video');
        
        // Update file with probe data
        videoOcrStore.updateFile(file.id, {
          duration: probeResult.duration,
          width: videoTrack?.width,
          height: videoTrack?.height,
          size: probeResult.size || file.size,
        });

        // Start transcoding for preview
        await transcodeFileForPreview(file);
      } catch (error) {
        videoOcrStore.setFileStatus(file.id, 'error', error instanceof Error ? error.message : 'Scan failed');
      }
    }
  }

  // Transcode video to 480p preview
  async function transcodeFileForPreview(file: OcrVideoFile): Promise<boolean> {
    try {
      videoOcrStore.startTranscoding(file.id);
      
      const result = await invoke<string>('transcode_for_preview', {
        inputPath: file.path,
        fileId: file.id,
      });
      
      videoOcrStore.finishTranscoding(file.id, result);
      videoOcrStore.addLog('info', 'Preview transcoding complete', file.id);
      
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      videoOcrStore.failTranscoding(file.id, errorMsg);
      
      logAndToast.error({
        source: 'ffmpeg',
        title: `Transcode failed: ${file.name}`,
        details: errorMsg
      });
      return false;
    }
  }

  async function handleStartOcr() {
    if (!videoOcrStore.canStartOcr) return;
    
    const readyFiles = videoOcrStore.readyFiles;
    
    for (const file of readyFiles) {
      if (videoOcrStore.isCancelling) break;
      
      try {
        await processFileOcr(file);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'OCR failed';
        videoOcrStore.failFile(file.id, errorMsg);
        logAndToast.error({
          source: 'system',
          title: `OCR failed: ${file.name}`,
          details: errorMsg
        });
      }
    }
    
    videoOcrStore.stopProcessing();
    
    const completedCount = videoOcrStore.completedFiles.length;
    if (completedCount > 0) {
      toast.success(`OCR completed for ${completedCount} file${completedCount > 1 ? 's' : ''}`);
    }
  }

  async function processFileOcr(file: OcrVideoFile): Promise<void> {
    videoOcrStore.startProcessing(file.id);
    videoOcrStore.setFileStatus(file.id, 'extracting_frames');
    
    let framesDir = '';
    
    try {
      // Extract frames
      videoOcrStore.setPhase(file.id, 'extracting', 0, 100);
      
      const result = await invoke<[string, number]>('extract_ocr_frames', {
        videoPath: file.previewPath || file.path,
        fileId: file.id,
        fps: videoOcrStore.config.frameRate,
        region: file.ocrRegion ?? null,
      });
      [framesDir] = result;
      const frameCount = result[1];
      
      videoOcrStore.addLog('info', `Extracted ${frameCount} frames`, file.id);
      
      // Run OCR on frames
      videoOcrStore.setFileStatus(file.id, 'ocr_processing');
      videoOcrStore.setPhase(file.id, 'ocr', 0, frameCount);
      
      const ocrResults = await invoke<Array<{ frameIndex: number; timeMs: number; text: string; confidence: number }>>('perform_ocr', {
        framesDir,
        fileId: file.id,
        language: videoOcrStore.config.language,
        frameIntervalMs: Math.round(1000 / videoOcrStore.config.frameRate),
        useGpu: videoOcrStore.config.useGpu,
        numWorkers: videoOcrStore.config.threadCount,
      });
      
      videoOcrStore.addLog('info', `OCR processed ${ocrResults.length} frames with text`, file.id);
      
      // Generate subtitles
      videoOcrStore.setFileStatus(file.id, 'generating_subs');
      videoOcrStore.setPhase(file.id, 'generating', 0, 1);
      
      const subtitles = await invoke<Array<{ id: string; text: string; startTime: number; endTime: number; confidence: number }>>('generate_subtitles_from_ocr', {
        fileId: file.id,
        frameResults: ocrResults,
        frameIntervalMs: Math.round(1000 / videoOcrStore.config.frameRate),
        minConfidence: videoOcrStore.config.confidenceThreshold,
      });
      
      videoOcrStore.setSubtitles(file.id, subtitles);
      videoOcrStore.addLog('info', `Generated ${subtitles.length} subtitles`, file.id);
      
      // Clean up frames directory
      await invoke('cleanup_ocr_frames', { framesDir });
      
    } catch (error) {
      // Cleanup on error
      try {
        await invoke('cleanup_ocr_frames', { framesDir });
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  async function handleCancelFile(id: string) {
    const file = videoOcrStore.videoFiles.find(f => f.id === id);
    if (!file) return;

    // Both transcoding and OCR operations use OCR_PROCESS_IDS keyed by fileId
    try {
      await invoke('cancel_ocr_operation', { fileId: id });
    } catch (error) {
      console.error('Failed to cancel operation:', error);
    }

    if (file.status === 'transcoding') {
      videoOcrStore.failTranscoding(id, 'Cancelled');
    } else if (['extracting_frames', 'ocr_processing', 'generating_subs'].includes(file.status)) {
      videoOcrStore.cancelProcessing(id);
    }
    
    toast.info('Cancelled');
  }

  async function handleCancelAll() {
    try {
      await invoke('cancel_transcode');
    } catch (error) {
      console.error('Failed to cancel transcodes:', error);
    }
    
    // Cancel all OCR operations
    for (const file of videoOcrStore.videoFiles) {
      if (['extracting_frames', 'ocr_processing', 'generating_subs'].includes(file.status)) {
        try {
          await invoke('cancel_ocr_operation', { fileId: file.id });
        } catch {
          // Ignore individual cancel errors
        }
      }
    }
    
    videoOcrStore.cancelAll();
    toast.info('Cancelling all...');
  }

  function handleViewResult(file: OcrVideoFile) {
    resultDialogFile = file;
    resultDialogOpen = true;
  }

  async function handleRetryFile(file: OcrVideoFile) {
    // Reset file state
    videoOcrStore.updateFile(file.id, { 
      status: 'pending', 
      error: undefined,
      previewPath: undefined,
      transcodingProgress: 0
    });
    videoOcrStore.clearSubtitles(file.id);
    
    // Restart transcoding
    await transcodeFileForPreview(file);
  }

  function handleReprocessFile(file: OcrVideoFile) {
    // Clear existing subtitles and reprocess
    videoOcrStore.clearSubtitles(file.id);
    videoOcrStore.setFileStatus(file.id, 'ready');
  }

  function handleRegionChange(region: OcrRegion | undefined) {
    if (videoOcrStore.selectedFileId) {
      videoOcrStore.setOcrRegion(videoOcrStore.selectedFileId, region);
    }
  }

  const transcodingCount = $derived(videoOcrStore.videoFiles.filter(f => f.status === 'transcoding').length);
</script>

<div class="h-full flex overflow-hidden">
  <!-- Left Panel: File List -->
  <div class="w-[max(20rem,25vw)] max-w-[32rem] border-r flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="p-3 border-b shrink-0 flex items-center justify-between">
      <h2 class="font-semibold">Video Files ({videoOcrStore.videoFiles.length})</h2>
      <div class="flex items-center gap-1">
        {#if videoOcrStore.videoFiles.length > 0}
          <Button
            variant="ghost"
            size="icon-sm"
            onclick={() => videoOcrStore.clear()}
            class="text-muted-foreground hover:text-destructive"
            disabled={videoOcrStore.isProcessing}
          >
            <Trash2 class="size-4" />
            <span class="sr-only">Clear list</span>
          </Button>
        {/if}
        <Button size="sm" onclick={handleAddFiles} disabled={videoOcrStore.isProcessing}>
          <Upload class="size-4 mr-1" />
          Add
        </Button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 min-h-0 overflow-auto p-2">
      {#if videoOcrStore.videoFiles.length === 0}
        <VideoDropZone disabled={videoOcrStore.isProcessing} />
      {:else}
        <VideoFileList
          files={videoOcrStore.videoFiles}
          selectedId={videoOcrStore.selectedFileId}
          onSelect={(id) => videoOcrStore.selectFile(id)}
          onRemove={(id) => videoOcrStore.removeFile(id)}
          onCancel={handleCancelFile}
          onViewResult={handleViewResult}
          onReprocess={handleReprocessFile}
          onRetry={handleRetryFile}
          disabled={videoOcrStore.isProcessing}
        />
      {/if}
    </div>

    <!-- Transcoding status -->
    {#if transcodingCount > 0}
      <div class="p-2 border-t shrink-0">
        <p class="text-xs text-muted-foreground text-center">
          Transcoding {transcodingCount} video{transcodingCount > 1 ? 's' : ''}...
        </p>
      </div>
    {/if}
  </div>

  <!-- Center Panel: Video Preview -->
  <div class="flex-1 flex flex-col overflow-hidden p-4">
    <VideoPreview 
      file={videoOcrStore.selectedFile}
      onRegionChange={handleRegionChange}
      class="shrink-0"
    />
    
    <!-- Log Panel at bottom of center -->
    <div class="pt-4 flex-1 min-h-36 flex flex-col overflow-hidden">
      <OcrLogPanel 
        logs={videoOcrStore.logs}
        onClear={() => videoOcrStore.clearLogs()}
        class="flex-1 flex flex-col"
      />
    </div>
  </div>

  <!-- Right Panel: OCR Options -->
  <div class="w-80 border-l overflow-auto flex flex-col p-4">
    <OcrOptionsPanel
      config={videoOcrStore.config}
      canStart={videoOcrStore.canStartOcr}
      isProcessing={videoOcrStore.isProcessing}
      allCompleted={videoOcrStore.allCompleted}
      filesWithSubtitles={videoOcrStore.filesWithSubtitles}
      totalSubtitles={videoOcrStore.totalSubtitles}
      availableLanguages={videoOcrStore.availableLanguages}
      onConfigChange={(updates) => videoOcrStore.updateConfig(updates)}
      onStart={handleStartOcr}
      onCancel={handleCancelAll}
    />
  </div>
</div>

<!-- Result Dialog -->
<OcrResultDialog
  open={resultDialogOpen}
  subtitles={resultDialogFile?.subtitles ?? []}
  videoName={resultDialogFile?.name}
  onClose={() => { resultDialogOpen = false; resultDialogFile = null; }}
/>
