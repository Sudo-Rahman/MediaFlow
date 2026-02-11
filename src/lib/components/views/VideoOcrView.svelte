<script lang="ts" module>
  import { Trash2, Upload, Video } from '@lucide/svelte';
  export interface VideoOcrViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { exists } from '@tauri-apps/plugin-fs';
  import { toast } from 'svelte-sonner';

  import type {
    OcrConfig,
    OcrModelsStatus,
    OcrProgressEvent,
    OcrRawFrame,
    OcrRegion,
    OcrRetryMode,
    OcrSubtitle,
    OcrVideoFile,
    OcrVersion,
    VideoOcrPersistenceData,
  } from '$lib/types';
  import type { OcrSubtitleLike } from '$lib/utils';
  import { VIDEO_EXTENSIONS } from '$lib/types';
  import { settingsStore, videoOcrStore } from '$lib/stores';
  import { cleanupOcrSubtitlesWithAi } from '$lib/services/ocr-ai-cleanup';
  import { createOcrVersion, generateOcrVersionName, loadOcrData, saveOcrData } from '$lib/services/ocr-storage';
  import { analyzeOcrSubtitles, formatOcrSubtitleAnalysis, normalizeOcrSubtitles, toRustOcrFrames } from '$lib/utils';
  import { logAndToast } from '$lib/utils/log-toast';
  import { scanFile } from '$lib/services/ffprobe';

  import { Button } from '$lib/components/ui/button';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import {
    VideoFileList,
    VideoPreview,
    OcrOptionsPanel,
    OcrLogPanel,
    OcrResultDialog,
    OcrRetryDialog,
  } from '$lib/components/video-ocr';

  const VIDEO_FORMATS = 'MP4, MKV, AVI, MOV';

  interface VideoOcrViewProps {
    onNavigateToSettings?: () => void;
  }

  interface ProcessFileResult {
    success: boolean;
    effectiveMode: OcrRetryMode;
  }

  let { onNavigateToSettings }: VideoOcrViewProps = $props();

  let resultDialogOpen = $state(false);
  let resultDialogFile = $state.raw<OcrVideoFile | null>(null);

  let retryDialogOpen = $state(false);
  let retryDialogFile = $state.raw<OcrVideoFile | null>(null);

  let unlistenOcrProgress: UnlistenFn | null = null;
  const aiCleanupControllers = new Map<string, AbortController>();

  onMount(async () => {
    if (!settingsStore.isLoaded) {
      try {
        await settingsStore.load();
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    }

    videoOcrStore.setGlobalRegion(settingsStore.getVideoOcrGlobalRegion());

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

    unlistenOcrProgress = await listen<OcrProgressEvent>('ocr-progress', (event) => {
      const { fileId, phase, current, total, message } = event.payload;

      if (phase === 'transcoding') {
        videoOcrStore.updateTranscodingProgress(fileId, current);
        return;
      }

      videoOcrStore.updateProgress(fileId, {
        phase,
        current,
        total,
        percentage: total > 0 ? Math.round((current / total) * 100) : 0,
        message,
      });
    });
  });

  onDestroy(() => {
    for (const controller of aiCleanupControllers.values()) {
      controller.abort();
    }
    aiCleanupControllers.clear();
    unlistenOcrProgress?.();
  });

  function getFreshFile(fileId: string): OcrVideoFile | undefined {
    return videoOcrStore.videoFiles.find((file) => file.id === fileId);
  }

  function getLatestRawVersion(file: OcrVideoFile): OcrVersion | null {
    for (let i = file.ocrVersions.length - 1; i >= 0; i -= 1) {
      const version = file.ocrVersions[i];
      if (version.rawOcr.length > 0) {
        return version;
      }
    }
    return null;
  }

  function buildCleanupOptions(config: OcrConfig, disableCleanup: boolean) {
    if (disableCleanup) {
      return {
        mergeSimilar: false,
        similarityThreshold: config.similarityThreshold,
        maxGapMs: 0,
        minCueDurationMs: 0,
        filterUrlLike: false,
      };
    }

    return {
      mergeSimilar: config.mergeSimilar,
      similarityThreshold: config.similarityThreshold,
      maxGapMs: config.maxGapMs,
      minCueDurationMs: config.minCueDurationMs,
      filterUrlLike: config.filterUrlLike,
    };
  }

  async function persistFileData(fileId: string): Promise<boolean> {
    const file = getFreshFile(fileId);
    if (!file) {
      return false;
    }

    const existingData = await loadOcrData(file.path);
    const now = new Date().toISOString();

    const payload: VideoOcrPersistenceData = {
      version: 1,
      videoPath: file.path,
      previewPath: file.previewPath,
      ocrRegion: file.ocrRegion,
      ocrRegionMode: file.ocrRegionMode,
      ocrVersions: file.ocrVersions,
      createdAt: existingData?.createdAt ?? now,
      updatedAt: now,
    };

    return saveOcrData(file.path, payload);
  }

  async function persistGlobalRegionForLinkedFiles(): Promise<void> {
    const persistPromises = videoOcrStore.videoFiles
      .filter((file) => file.ocrRegionMode === 'global')
      .map((file) => persistFileData(file.id));

    await Promise.all(persistPromises);
  }

  async function runAiCleanup(fileId: string, subtitles: OcrSubtitle[], config: OcrConfig): Promise<OcrSubtitle[]> {
    const controller = new AbortController();
    aiCleanupControllers.set(fileId, controller);
    videoOcrStore.addLog('info', 'Running AI subtitle cleanup...', fileId);

    try {
      const cleanupResult = await cleanupOcrSubtitlesWithAi(subtitles, {
        provider: config.aiCleanupProvider,
        model: config.aiCleanupModel,
        maxGapMs: config.maxGapMs,
        signal: controller.signal,
      });

      if (cleanupResult.cancelled || controller.signal.aborted || videoOcrStore.isFileCancelled(fileId)) {
        throw new Error('OCR cancelled');
      }

      if (cleanupResult.success) {
        videoOcrStore.addLog(
          'info',
          `AI cleanup completed (${cleanupResult.batchesProcessed}/${cleanupResult.totalBatches} batches, ${subtitles.length} -> ${cleanupResult.subtitles.length} subtitles)`,
          fileId,
        );
        return cleanupResult.subtitles;
      }

      videoOcrStore.addLog(
        'warning',
        `AI cleanup failed, using non-AI subtitles: ${cleanupResult.error ?? 'Unknown error'}`,
        fileId,
      );
      return subtitles;
    } finally {
      aiCleanupControllers.delete(fileId);
    }
  }

  async function runFromRaw(
    file: OcrVideoFile,
    rawOcr: OcrRawFrame[],
    mode: OcrRetryMode,
    config: OcrConfig,
  ): Promise<OcrSubtitle[]> {
    const disableCleanup = mode === 'ai_only';
    const shouldRunAi = mode === 'cleanup_and_ai'
      || mode === 'ai_only'
      || (mode === 'full_pipeline' && config.aiCleanupEnabled);

    videoOcrStore.setFileStatus(file.id, 'generating_subs');
    videoOcrStore.setPhase(file.id, 'generating', 0, 1);

    const rawSubtitles = await invoke<OcrSubtitleLike[]>('generate_subtitles_from_ocr', {
      fileId: file.id,
      frameResults: toRustOcrFrames(rawOcr),
      fps: config.frameRate,
      minConfidence: config.confidenceThreshold,
      cleanup: buildCleanupOptions(config, disableCleanup),
    });

    const subtitles = normalizeOcrSubtitles(rawSubtitles);
    if (rawSubtitles.length > 0 && subtitles.length === 0) {
      throw new Error('Failed to parse OCR subtitle timing data');
    }
    if (subtitles.length !== rawSubtitles.length) {
      videoOcrStore.addLog(
        'warning',
        `Dropped ${rawSubtitles.length - subtitles.length} subtitle(s) with invalid timing`,
        file.id,
      );
    }

    let finalSubtitles = subtitles;
    if (shouldRunAi) {
      finalSubtitles = await runAiCleanup(file.id, subtitles, config);
    }

    return finalSubtitles;
  }

  async function runFullPipeline(
    file: OcrVideoFile,
    config: OcrConfig,
  ): Promise<{ rawOcr: OcrRawFrame[]; finalSubtitles: OcrSubtitle[] }> {
    let framesDir: string | null = null;

    try {
      let current = getFreshFile(file.id) ?? file;
      if (!current.previewPath) {
        const transcodeOk = await transcodeFileForPreview(current);
        if (!transcodeOk) {
          throw new Error('Preview transcoding failed');
        }
      }

      current = getFreshFile(file.id) ?? current;

      videoOcrStore.setFileStatus(file.id, 'extracting_frames');
      videoOcrStore.setPhase(file.id, 'extracting', 0, 100);

      const [extractedFramesDir, frameCount] = await invoke<[string, number]>('extract_ocr_frames', {
        videoPath: current.previewPath || current.path,
        fileId: file.id,
        fps: config.frameRate,
        region: current.ocrRegion ?? null,
      });
      framesDir = extractedFramesDir;
      videoOcrStore.addLog('info', `Extracted ${frameCount} frames`, file.id);

      videoOcrStore.setFileStatus(file.id, 'ocr_processing');
      videoOcrStore.setPhase(file.id, 'ocr', 0, frameCount);

      const rawOcr = await invoke<OcrRawFrame[]>('perform_ocr', {
        framesDir: extractedFramesDir,
        fileId: file.id,
        language: config.language,
        fps: config.frameRate,
        useGpu: config.useGpu,
        numWorkers: config.threadCount,
      });
      videoOcrStore.addLog('info', `OCR processed ${rawOcr.length} frames with text`, file.id);

      const finalSubtitles = await runFromRaw(file, rawOcr, 'full_pipeline', config);
      return { rawOcr, finalSubtitles };
    } finally {
      if (framesDir) {
        try {
          await invoke('cleanup_ocr_frames', { framesDir });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  async function processFileOcr(
    file: OcrVideoFile,
    versionName: string,
    mode: OcrRetryMode,
    config: OcrConfig,
  ): Promise<ProcessFileResult> {
    let effectiveMode = mode;
    let rawSource: OcrRawFrame[] = [];

    const freshFile = getFreshFile(file.id) ?? file;
    if (mode !== 'full_pipeline') {
      const sourceVersion = getLatestRawVersion(freshFile);
      if (!sourceVersion) {
        effectiveMode = 'full_pipeline';
        videoOcrStore.addLog('warning', 'Raw OCR not found. Falling back to full pipeline.', file.id);
        toast.info('Raw OCR not found for partial retry. Running full pipeline.');
      } else {
        rawSource = sourceVersion.rawOcr;
      }
    }

    try {
      let rawOcr: OcrRawFrame[];
      let finalSubtitles: OcrSubtitle[];

      if (effectiveMode === 'full_pipeline') {
        const result = await runFullPipeline(file, config);
        rawOcr = result.rawOcr;
        finalSubtitles = result.finalSubtitles;
      } else {
        rawOcr = rawSource;
        finalSubtitles = await runFromRaw(file, rawOcr, effectiveMode, config);
      }

      const version = createOcrVersion(
        versionName,
        effectiveMode,
        config,
        rawOcr,
        finalSubtitles,
      );

      videoOcrStore.addOcrVersion(file.id, version);
      const saved = await persistFileData(file.id);
      if (!saved) {
        videoOcrStore.addLog('warning', 'Failed to persist OCR version to rsext file', file.id);
      }

      videoOcrStore.addLog('info', `Generated ${finalSubtitles.length} subtitles`, file.id);
      const analysis = analyzeOcrSubtitles(finalSubtitles);
      videoOcrStore.addLog('info', formatOcrSubtitleAnalysis(analysis), file.id);

      return { success: true, effectiveMode };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'OCR failed';
      const cancelled = videoOcrStore.isFileCancelled(file.id) || errorMsg.toLowerCase().includes('cancel');

      if (cancelled) {
        const latestFile = getFreshFile(file.id);
        videoOcrStore.updateFile(file.id, {
          status: (latestFile?.ocrVersions.length ?? 0) > 0 ? 'completed' : 'ready',
          progress: undefined,
          error: undefined,
        });
      } else {
        videoOcrStore.failFile(file.id, errorMsg);
        logAndToast.error({
          source: 'system',
          title: `OCR failed: ${file.name}`,
          details: errorMsg,
        });
      }

      return { success: false, effectiveMode };
    }
  }

  export async function handleFileDrop(paths: string[]) {
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

  async function handleAddFiles() {
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

    const paths = Array.isArray(selected) ? selected : [selected];
    await addFiles(paths);
  }

  async function addFiles(paths: string[]) {
    const newFiles = videoOcrStore.addFilesFromPaths(paths);

    for (const file of newFiles) {
      try {
        const probeResult = await scanFile(file.path);
        const videoTrack = probeResult.tracks.find((track) => track.type === 'video');

        videoOcrStore.updateFile(file.id, {
          duration: probeResult.duration,
          width: videoTrack?.width,
          height: videoTrack?.height,
          size: probeResult.size || file.size,
        });

        const persisted = await loadOcrData(file.path);
        if (persisted) {
          const persistedRegionMode = persisted.ocrRegionMode ?? 'custom';
          videoOcrStore.updateFile(file.id, {
            ocrRegionMode: persistedRegionMode,
            ocrRegion: persistedRegionMode === 'global'
              ? videoOcrStore.globalRegion
              : persisted.ocrRegion ?? file.ocrRegion,
          });

          if (persisted.ocrVersions.length > 0) {
            videoOcrStore.setOcrVersions(file.id, persisted.ocrVersions);
          }
        }

        let hasCachedPreview = false;
        if (persisted?.previewPath) {
          const previewExists = await exists(persisted.previewPath);
          if (previewExists) {
            videoOcrStore.updateFile(file.id, {
              previewPath: persisted.previewPath,
              status: (persisted.ocrVersions.length > 0) ? 'completed' : 'ready',
            });
            hasCachedPreview = true;
            videoOcrStore.addLog('info', 'Loaded cached preview video', file.id);
          }
        }

        if (!hasCachedPreview) {
          const fresh = getFreshFile(file.id) ?? file;
          await transcodeFileForPreview(fresh);
        }
      } catch (error) {
        videoOcrStore.setFileStatus(
          file.id,
          'error',
          error instanceof Error ? error.message : 'Scan failed',
        );
      }
    }
  }

  async function transcodeFileForPreview(file: OcrVideoFile): Promise<boolean> {
    try {
      videoOcrStore.startTranscoding(file.id);

      const outputPath = await invoke<string>('transcode_for_preview', {
        inputPath: file.path,
        fileId: file.id,
      });

      videoOcrStore.finishTranscoding(file.id, outputPath);
      videoOcrStore.addLog('info', 'Preview transcoding complete', file.id);
      await persistFileData(file.id);
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      videoOcrStore.failTranscoding(file.id, errorMsg);
      logAndToast.error({
        source: 'ffmpeg',
        title: `Transcode failed: ${file.name}`,
        details: errorMsg,
      });
      return false;
    }
  }

  async function handleStartOcr() {
    if (!videoOcrStore.canStartOcr) {
      return;
    }

    const readyFiles = videoOcrStore.readyFiles;
    let successCount = 0;
    let failCount = 0;
    let cancelledCount = 0;

    for (const entry of readyFiles) {
      if (videoOcrStore.isCancelling) {
        break;
      }

      const file = getFreshFile(entry.id) ?? entry;
      const versionName = generateOcrVersionName(file.ocrVersions);

      videoOcrStore.startProcessing(file.id);
      const result = await processFileOcr(file, versionName, 'full_pipeline', { ...videoOcrStore.config });

      if (result.success) {
        successCount += 1;
      } else if (videoOcrStore.isFileCancelled(file.id)) {
        cancelledCount += 1;
      } else {
        failCount += 1;
      }
    }

    videoOcrStore.stopProcessing();

    if (successCount > 0 || failCount > 0 || cancelledCount > 0) {
      const parts: string[] = [];
      if (successCount > 0) parts.push(`${successCount} completed`);
      if (failCount > 0) parts.push(`${failCount} failed`);
      if (cancelledCount > 0) parts.push(`${cancelledCount} cancelled`);
      toast.success(`OCR finished: ${parts.join(', ')}`);
    }
  }

  async function handleRetryConfirm(fileId: string, versionName: string, mode: OcrRetryMode, config: OcrConfig) {
    const file = getFreshFile(fileId);
    if (!file) {
      return;
    }

    videoOcrStore.startProcessing(file.id);
    const result = await processFileOcr(file, versionName, mode, config);
    videoOcrStore.stopProcessing();

    if (result.success) {
      toast.success(`Created ${versionName} (${result.effectiveMode.replaceAll('_', ' ')})`);
    }
  }

  async function handleCancelFile(id: string) {
    const file = videoOcrStore.videoFiles.find((entry) => entry.id === id);
    if (!file) {
      return;
    }

    aiCleanupControllers.get(id)?.abort();
    aiCleanupControllers.delete(id);

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
    for (const controller of aiCleanupControllers.values()) {
      controller.abort();
    }
    aiCleanupControllers.clear();

    try {
      await invoke('cancel_transcode');
    } catch (error) {
      console.error('Failed to cancel transcodes:', error);
    }

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

  function handleRetryFile(file: OcrVideoFile) {
    retryDialogFile = file;
    retryDialogOpen = true;
  }

  function handleFileRegionChange(region: OcrRegion | undefined) {
    if (!videoOcrStore.selectedFileId) {
      return;
    }

    videoOcrStore.setFileRegionCustom(videoOcrStore.selectedFileId, region);
    void persistFileData(videoOcrStore.selectedFileId);
  }

  function handleUseGlobalRegion() {
    if (!videoOcrStore.selectedFileId) {
      return;
    }

    videoOcrStore.setFileRegionMode(videoOcrStore.selectedFileId, 'global');
    void persistFileData(videoOcrStore.selectedFileId);
  }

  async function handleGlobalRegionChange(region: OcrRegion | undefined) {
    if (!region) {
      return;
    }

    try {
      videoOcrStore.setGlobalRegion(region);
      await settingsStore.setVideoOcrGlobalRegion(region);
      await persistGlobalRegionForLinkedFiles();
    } catch (error) {
      console.error('Failed to update global OCR region:', error);
      toast.error('Failed to save global OCR region');
    }
  }

  const transcodingCount = $derived(videoOcrStore.videoFiles.filter((file) => file.status === 'transcoding').length);
</script>

<div class="h-full flex overflow-hidden">
  <div class="w-[max(20rem,25vw)] max-w-[32rem] border-r flex flex-col overflow-hidden">
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

    <div class="flex-1 min-h-0 overflow-auto p-2">
      {#if videoOcrStore.videoFiles.length === 0}
        <ImportDropZone
          icon={Video}
          title="Drop video files here"
          formats={VIDEO_FORMATS}
          onBrowse={handleAddFiles}
          disabled={videoOcrStore.isProcessing}
        />
      {:else}
        <VideoFileList
          files={videoOcrStore.videoFiles}
          selectedId={videoOcrStore.selectedFileId}
          onSelect={(id) => videoOcrStore.selectFile(id)}
          onRemove={(id) => videoOcrStore.removeFile(id)}
          onCancel={handleCancelFile}
          onViewResult={handleViewResult}
          onRetry={handleRetryFile}
          disabled={videoOcrStore.isProcessing}
        />
      {/if}
    </div>

    {#if transcodingCount > 0}
      <div class="p-2 border-t shrink-0">
        <p class="text-xs text-muted-foreground text-center">
          Transcoding {transcodingCount} video{transcodingCount > 1 ? 's' : ''}...
        </p>
      </div>
    {/if}
  </div>

  <div class="flex-1 min-h-0 overflow-hidden p-4 grid grid-rows-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
    <VideoPreview
      file={videoOcrStore.selectedFile}
      globalRegion={videoOcrStore.globalRegion}
      showSubtitles={!resultDialogOpen && !retryDialogOpen}
      suspendPlayback={resultDialogOpen || retryDialogOpen}
      onGlobalRegionChange={handleGlobalRegionChange}
      onFileRegionChange={handleFileRegionChange}
      onUseGlobalRegion={handleUseGlobalRegion}
      class="min-h-0"
    />

    <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
      <OcrLogPanel
        logs={videoOcrStore.logs}
        onClear={() => videoOcrStore.clearLogs()}
        class="flex-1 flex flex-col"
      />
    </div>
  </div>

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
      onNavigateToSettings={onNavigateToSettings}
    />
  </div>
</div>

<OcrResultDialog
  bind:open={resultDialogOpen}
  onOpenChange={(open) => {
    resultDialogOpen = open;
    if (!open) {
      resultDialogFile = null;
    }
  }}
  file={resultDialogFile}
/>

<OcrRetryDialog
  bind:open={retryDialogOpen}
  onOpenChange={(open) => {
    retryDialogOpen = open;
    if (!open) {
      retryDialogFile = null;
    }
  }}
  file={retryDialogFile}
  baseConfig={videoOcrStore.config}
  onConfirm={handleRetryConfirm}
/>
