<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';

  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Separator } from '$lib/components/ui/separator';
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import { Alert, AlertTitle, AlertDescription } from '$lib/components';
  import * as HoverCard from '$lib/components/ui/hover-card';
  import AppSidebar from '$lib/components/AppSidebar.svelte';
  import { ExtractView, MergeView, SettingsView, InfoView, TranslationView, RenameView, AudioToSubsView, VideoOcrView } from '$lib/components/views';
  import { TranslationExportDialog } from '$lib/components/translation';
  import { LogsSheet } from '$lib/components/logs';
  import { AlertCircle, ScrollText, Home, LayoutGrid, Table, Download, AudioLines, ScanText, Languages, FileOutput, GitMerge, PenLine } from '@lucide/svelte';
  import { OS } from '$lib/utils';
  import { useSidebar } from "$lib/components/ui/sidebar";
  import { logStore } from '$lib/stores/logs.svelte';
  import { audioToSubsStore, videoOcrStore, translationStore, extractionStore, mergeStore, renameStore } from '$lib/stores';
  import { logAndToast } from '$lib/utils/log-toast';

  // Current view state
  let currentView = $state<'extract' | 'merge' | 'translate' | 'rename' | 'audio-to-subs' | 'video-ocr' | 'info' | 'settings'>('extract');
  let ffmpegAvailable = $state<boolean | null>(null);
  let unlistenDragDrop: (() => void) | null = null;

  // Merge view mode state (only applicable when currentView === 'merge')
  let mergeViewMode = $state<'home' | 'groups' | 'table'>('home');
  let translationExportDialogOpen = $state(false);

  // References to views for drag & drop forwarding
  let extractViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let mergeViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let infoViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let translateViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let renameViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let audioToSubsViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let videoOcrViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();

  const isMacOS = OS() === 'MacOS';

  interface ToolProgressMetric {
    toolId: 'audio-to-subs' | 'video-ocr' | 'translate' | 'extract' | 'merge' | 'rename';
    label: string;
    doneUnits: number;
    totalUnits: number;
    percentage: number;
    active: boolean;
    detailText: string;
    icon: typeof AudioLines;
  }

  function clampPercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
  }

  function ratioToPercentage(doneUnits: number, totalUnits: number): number {
    if (totalUnits <= 0) return 0;
    return clampPercentage((doneUnits / totalUnits) * 100);
  }

  let mergeRunTotalFiles = $state(0);
  let previousMergeProcessing = false;

  $effect(() => {
    const isProcessing = mergeStore.isProcessing;
    if (isProcessing && !previousMergeProcessing) {
      mergeRunTotalFiles = Math.max(mergeStore.videosReadyForMerge.length, 1);
    } else if (!isProcessing && previousMergeProcessing) {
      mergeRunTotalFiles = 0;
    }
    previousMergeProcessing = isProcessing;
  });

  const audioMetric = $derived.by((): ToolProgressMetric => {
    const transcriptionScopeIds = Array.from(audioToSubsStore.transcriptionScopeFileIds);
    const transcodingScopeIds = Array.from(audioToSubsStore.transcodingScopeFileIds);

    let transcriptionDoneUnits = 0;
    let transcriptionSettledCount = 0;
    for (const fileId of transcriptionScopeIds) {
      const file = audioToSubsStore.audioFiles.find((item) => item.id === fileId);
      if (!file || audioToSubsStore.cancelledFileIds.has(fileId)) {
        transcriptionDoneUnits += 1;
        transcriptionSettledCount += 1;
        continue;
      }

      if (file.status === 'completed' || file.status === 'error') {
        transcriptionDoneUnits += 1;
        transcriptionSettledCount += 1;
      } else if (file.status === 'transcribing') {
        transcriptionDoneUnits += clampPercentage(file.progress ?? 0) / 100;
      } else if (!audioToSubsStore.isTranscribing) {
        transcriptionDoneUnits += 1;
        transcriptionSettledCount += 1;
      }
    }

    let transcodingDoneUnits = 0;
    let transcodingSettledCount = 0;
    for (const fileId of transcodingScopeIds) {
      const file = audioToSubsStore.audioFiles.find((item) => item.id === fileId);
      if (!file) {
        transcodingDoneUnits += 1;
        transcodingSettledCount += 1;
        continue;
      }

      if (file.status === 'ready' || file.status === 'completed' || file.status === 'error') {
        transcodingDoneUnits += 1;
        transcodingSettledCount += 1;
      } else if (file.status === 'transcoding') {
        transcodingDoneUnits += clampPercentage(file.transcodingProgress ?? 0) / 100;
      } else if (!audioToSubsStore.isTranscoding) {
        transcodingDoneUnits += 1;
        transcodingSettledCount += 1;
      }
    }

    const totalUnits = transcriptionScopeIds.length + transcodingScopeIds.length;
    const doneUnits = transcriptionDoneUnits + transcodingDoneUnits;
    const active =
      (audioToSubsStore.isTranscribing || audioToSubsStore.isTranscoding) &&
      totalUnits > 0;

    let detailText = '';
    if (transcriptionScopeIds.length > 0 && transcodingScopeIds.length > 0) {
      detailText = `Transcribe ${transcriptionSettledCount}/${transcriptionScopeIds.length} · Convert ${transcodingSettledCount}/${transcodingScopeIds.length}`;
    } else if (transcriptionScopeIds.length > 0) {
      detailText = `${transcriptionSettledCount}/${transcriptionScopeIds.length} files`;
    } else {
      detailText = `${transcodingSettledCount}/${transcodingScopeIds.length} files`;
    }

    return {
      toolId: 'audio-to-subs',
      label: 'Audio to Subs',
      doneUnits,
      totalUnits,
      percentage: ratioToPercentage(doneUnits, totalUnits),
      active,
      detailText,
      icon: AudioLines,
    };
  });

  const videoOcrMetric = $derived.by((): ToolProgressMetric => {
    const scopeIds = Array.from(videoOcrStore.processingScopeFileIds);
    let doneUnits = 0;
    let settledCount = 0;

    for (const fileId of scopeIds) {
      const file = videoOcrStore.videoFiles.find((item) => item.id === fileId);
      if (!file || videoOcrStore.cancelledFileIds.has(fileId)) {
        doneUnits += 1;
        settledCount += 1;
        continue;
      }

      if (file.status === 'completed' || file.status === 'error') {
        doneUnits += 1;
        settledCount += 1;
      } else if (file.status === 'transcoding') {
        doneUnits += clampPercentage(file.transcodingProgress ?? 0) / 100;
      } else if (file.status === 'extracting_frames' || file.status === 'ocr_processing' || file.status === 'generating_subs') {
        doneUnits += clampPercentage(file.progress?.percentage ?? 0) / 100;
      } else if (!videoOcrStore.isProcessing) {
        doneUnits += 1;
        settledCount += 1;
      }
    }

    const totalUnits = scopeIds.length;
    return {
      toolId: 'video-ocr',
      label: 'Video OCR',
      doneUnits,
      totalUnits,
      percentage: ratioToPercentage(doneUnits, totalUnits),
      active: videoOcrStore.isProcessing && totalUnits > 0,
      detailText: `${settledCount}/${totalUnits} files`,
      icon: ScanText,
    };
  });

  const translationMetric = $derived.by((): ToolProgressMetric => {
    const scopeJobIds = Array.from(translationStore.activeScopeJobIds);
    let doneUnits = 0;
    let settledCount = 0;

    for (const jobId of scopeJobIds) {
      const job = translationStore.jobs.find((item) => item.id === jobId);
      if (!job) {
        doneUnits += 1;
        settledCount += 1;
        continue;
      }

      if (job.status === 'completed' || job.status === 'error' || job.status === 'cancelled') {
        doneUnits += 1;
        settledCount += 1;
      } else if (job.status === 'translating') {
        doneUnits += clampPercentage(job.progress) / 100;
      }
    }

    const totalUnits = scopeJobIds.length;
    return {
      toolId: 'translate',
      label: 'AI Translation',
      doneUnits,
      totalUnits,
      percentage: ratioToPercentage(doneUnits, totalUnits),
      active: translationStore.isTranslating && totalUnits > 0,
      detailText: `${settledCount}/${totalUnits} jobs`,
      icon: Languages,
    };
  });

  const extractionMetric = $derived.by((): ToolProgressMetric => {
    const progress = extractionStore.progress;
    const totalUnits = progress.totalTracks;
    const doneUnits = Math.min(Math.max(progress.currentTrack, 0), totalUnits);
    return {
      toolId: 'extract',
      label: 'Extraction',
      doneUnits,
      totalUnits,
      percentage: ratioToPercentage(doneUnits, totalUnits),
      active: extractionStore.isExtracting && totalUnits > 0,
      detailText: `${Math.round(doneUnits)}/${totalUnits} tracks`,
      icon: FileOutput,
    };
  });

  const mergeMetric = $derived.by((): ToolProgressMetric => {
    const totalUnits = mergeRunTotalFiles;
    const doneUnits = (clampPercentage(mergeStore.progress) / 100) * totalUnits;
    return {
      toolId: 'merge',
      label: 'Merge',
      doneUnits,
      totalUnits,
      percentage: ratioToPercentage(doneUnits, totalUnits),
      active: mergeStore.isProcessing && totalUnits > 0,
      detailText: `${Math.min(Math.round(doneUnits), totalUnits)}/${totalUnits} files`,
      icon: GitMerge,
    };
  });

  const renameMetric = $derived.by((): ToolProgressMetric => {
    const progress = renameStore.progress;
    const totalUnits = progress.total;
    const doneUnits = Math.min(Math.max(progress.current, 0), totalUnits);
    return {
      toolId: 'rename',
      label: 'Batch Rename',
      doneUnits,
      totalUnits,
      percentage: ratioToPercentage(doneUnits, totalUnits),
      active: renameStore.isProcessing && totalUnits > 0,
      detailText: `${Math.round(doneUnits)}/${totalUnits} files`,
      icon: PenLine,
    };
  });

  const activeToolMetrics = $derived.by(() => {
    return [audioMetric, videoOcrMetric, translationMetric, extractionMetric, mergeMetric, renameMetric]
      .filter((metric) => metric.active);
  });

  const globalToolProgress = $derived.by(() => {
    const totalUnits = activeToolMetrics.reduce((sum, metric) => sum + metric.totalUnits, 0);
    const doneUnits = activeToolMetrics.reduce((sum, metric) => sum + metric.doneUnits, 0);

    return {
      active: activeToolMetrics.length > 0,
      percentage: ratioToPercentage(doneUnits, totalUnits),
      tools: activeToolMetrics,
    };
  });

  const hasTranslationExportableData = $derived.by(() => {
    return translationStore.jobs.some((job) => {
      if (job.translationVersions.length > 0) return true;
      const content = job.result?.translatedContent;
      return !!content && content.trim().length > 0;
    });
  });

  const viewTitles: Record<string, string> = {
    extract: 'Track Extraction',
    merge: 'Track Merge',
    'audio-to-subs': 'Audio to Subs',
    'video-ocr': 'Video OCR',
    translate: 'AI Translation',
    rename: 'Batch Rename',
    info: 'File Information',
    settings: 'Settings'
  };

  onMount(() => {
    initApp();

    return () => {
      if (unlistenDragDrop) {
        unlistenDragDrop();
      }
    };
  });

  async function initApp() {
    // Check if FFmpeg is available
    try {
      ffmpegAvailable = await invoke<boolean>('check_ffmpeg');
      if (!ffmpegAvailable) {
        logAndToast.error({
          source: 'system',
          title: 'FFmpeg not found',
          details: 'FFmpeg is not installed or not found in PATH. Please install FFmpeg to use this application.'
        });
      }
    } catch (e) {
      ffmpegAvailable = false;
      logAndToast.error({
        source: 'system',
        title: 'Error checking FFmpeg',
        details: e instanceof Error ? e.message : String(e)
      });
    }

    // Listen for drag & drop events from Tauri
    unlistenDragDrop = await listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
      // Forward to the appropriate view based on current view
      if (currentView === 'extract' && extractViewRef) {
        await extractViewRef.handleFileDrop(event.payload.paths);
      } else if (currentView === 'merge' && mergeViewRef) {
        await mergeViewRef.handleFileDrop(event.payload.paths);
      } else if (currentView === 'info' && infoViewRef) {
        await infoViewRef.handleFileDrop(event.payload.paths);
      } else if (currentView === 'translate' && translateViewRef) {
        await translateViewRef.handleFileDrop(event.payload.paths);
      } else if (currentView === 'rename' && renameViewRef) {
        await renameViewRef.handleFileDrop(event.payload.paths);
      } else if (currentView === 'audio-to-subs' && audioToSubsViewRef) {
        await audioToSubsViewRef.handleFileDrop(event.payload.paths);
      } else if (currentView === 'video-ocr' && videoOcrViewRef) {
        await videoOcrViewRef.handleFileDrop(event.payload.paths);
      }
    });
  }

  function handleNavigate(viewId: string) {
    currentView = viewId as 'extract' | 'merge' | 'translate' | 'rename' | 'audio-to-subs' | 'video-ocr' | 'info' | 'settings';
    if (currentView !== 'translate') {
      translationExportDialogOpen = false;
    }
  }
</script>

<Sidebar.Provider>
  <AppSidebar
    currentView={currentView}
    onNavigate={handleNavigate}
  />

  <Sidebar.Inset class="flex flex-col h-screen overflow-hidden w-[calc(100%-var(--sidebar-width))]">
    <!-- Header -->
    <header
      class="flex h-14 shrink-0 items-center gap-2 border-b px-4"
      data-tauri-drag-region={isMacOS}
    >
      <Sidebar.Trigger class="{!useSidebar().open && isMacOS ? 'ml-20' : '-ml-1'} transition-all duration-300" />
      <Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4" />
      <div class="flex-1 flex items-center" data-tauri-drag-region={isMacOS}>
        <h1 data-tauri-drag-region={isMacOS} class="text-lg font-semibold">{viewTitles[currentView]}</h1>
      </div>
      {#if globalToolProgress.active}
        <HoverCard.Root openDelay={150} closeDelay={100}>
          <HoverCard.Trigger
            class="block w-48 rounded-md border bg-muted/40 px-2 py-1.5 transition-colors hover:bg-muted/60"
            title={`Global progress: ${Math.round(globalToolProgress.percentage)}%`}
          >
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-muted-foreground whitespace-nowrap">Global</span>
              <Progress value={globalToolProgress.percentage} class="h-2 flex-1" />
              <span class="text-[11px] font-medium tabular-nums">{Math.round(globalToolProgress.percentage)}%</span>
            </div>
          </HoverCard.Trigger>
          <HoverCard.Content align="end" class="w-80 p-3">
            <div class="mb-2 border-b pb-2">
              <div class="mb-2 flex items-center justify-between">
                <p class="text-[11px] uppercase tracking-wide text-muted-foreground">Global Progress</p>
                <p class="text-sm font-medium">{Math.round(globalToolProgress.percentage)}%</p>
              </div>
              <Progress value={globalToolProgress.percentage} class="h-2" />
              <p class="mt-1 text-[11px] text-muted-foreground">{globalToolProgress.tools.length} tools active</p>
            </div>
            <div class="space-y-2">
              {#each globalToolProgress.tools as metric (metric.toolId)}
                {@const ToolIcon = metric.icon}
                <div class="rounded-md border bg-muted/30 px-2 py-1.5">
                  <div class="mb-1 flex items-center gap-2">
                    <ToolIcon class="size-4 text-muted-foreground" />
                    <p class="truncate text-xs font-medium flex-1">{metric.label}</p>
                    <p class="text-[11px] font-medium tabular-nums">{Math.round(metric.percentage)}%</p>
                  </div>
                  <Progress value={metric.percentage} class="h-1.5" />
                  <p class="mt-1 truncate text-[11px] text-muted-foreground">{metric.detailText}</p>
                </div>
              {/each}
            </div>
          </HoverCard.Content>
        </HoverCard.Root>
      {/if}

      <!-- Merge view mode buttons (only visible in merge view) -->
      {#if currentView === 'merge'}
        <div class="flex items-center gap-1 mr-2">
          <Button
            variant={mergeViewMode === 'home' ? 'secondary' : 'ghost'}
            size="sm"
            onclick={() => mergeViewMode = 'home'}
            title="Home view"
          >
            <Home class="size-4 mr-1" />
            Home
          </Button>
          <Button
            variant={mergeViewMode === 'groups' ? 'secondary' : 'ghost'}
            size="sm"
            onclick={() => mergeViewMode = 'groups'}
            title="Groups view"
          >
            <LayoutGrid class="size-4 mr-1" />
            Groups
          </Button>
          <Button
            variant={mergeViewMode === 'table' ? 'secondary' : 'ghost'}
            size="sm"
            onclick={() => mergeViewMode = 'table'}
            title="Table view"
          >
            <Table class="size-4 mr-1" />
            Table
          </Button>
        </div>
        <Separator orientation="vertical" class="h-6 mr-2" />
      {/if}

      {#if currentView === 'translate'}
        <Button
          variant="outline"
          size="sm"
          onclick={() => { translationExportDialogOpen = true; }}
          disabled={!hasTranslationExportableData}
          title="Export translated subtitles"
        >
          <Download class="size-4 mr-2" />
          Export
        </Button>
      {/if}

      <!-- Logs button -->
      <Button
        variant="ghost"
        size="icon"
        onclick={() => logStore.open()}
        class="relative"
        title="View logs"
      >
        <ScrollText class="size-4" />
        {#if logStore.unreadErrorCount > 0}
          <span class="absolute -top-1 -right-1 size-4 bg-destructive text-white rounded-full text-[10px] font-medium flex items-center justify-center">
            {logStore.unreadErrorCount > 9 ? '9+' : logStore.unreadErrorCount}
          </span>
        {/if}
      </Button>
    </header>

    <!-- FFmpeg warning -->
    {#if ffmpegAvailable === false && currentView !== 'settings'}
      <div class="p-4">
        <Alert variant="destructive">
          <AlertCircle class="size-4" />
          <AlertTitle>FFmpeg not available</AlertTitle>
          <AlertDescription>
            Install FFmpeg to use this application.
          </AlertDescription>
        </Alert>
      </div>
    {/if}

    <!-- Main content - all views mounted but hidden with display:none for persistence -->
    <main class="flex-1 overflow-hidden relative">
      <!-- Extract View -->
      <div class="absolute inset-0" style="display: {currentView === 'extract' ? 'block' : 'none'}">
        <ExtractView bind:this={extractViewRef} />
      </div>
      
      <!-- Merge View -->
      <div class="absolute inset-0" style="display: {currentView === 'merge' ? 'block' : 'none'}">
        <MergeView bind:this={mergeViewRef} viewMode={mergeViewMode} />
      </div>
      
      <!-- Audio to Subs View - persists when switching views -->
      <div class="absolute inset-0" style="display: {currentView === 'audio-to-subs' ? 'block' : 'none'}">
        <AudioToSubsView bind:this={audioToSubsViewRef} onNavigateToSettings={() => handleNavigate('settings')} />
      </div>
      
      <!-- Video OCR View - persists when switching views -->
      <div class="absolute inset-0" style="display: {currentView === 'video-ocr' ? 'block' : 'none'}">
        <VideoOcrView bind:this={videoOcrViewRef} onNavigateToSettings={() => handleNavigate('settings')} />
      </div>
      
      <!-- Translation View -->
      <div class="absolute inset-0" style="display: {currentView === 'translate' ? 'block' : 'none'}">
        <TranslationView bind:this={translateViewRef} onNavigateToSettings={() => handleNavigate('settings')} />
      </div>
      
      <!-- Rename View -->
      <div class="absolute inset-0" style="display: {currentView === 'rename' ? 'block' : 'none'}">
        <RenameView bind:this={renameViewRef} />
      </div>
      
      <!-- Info View -->
      <div class="absolute inset-0" style="display: {currentView === 'info' ? 'block' : 'none'}">
        <InfoView bind:this={infoViewRef} />
      </div>
      
      <!-- Settings View -->
      <div class="absolute inset-0" style="display: {currentView === 'settings' ? 'block' : 'none'}">
        <SettingsView />
      </div>
    </main>
  </Sidebar.Inset>
</Sidebar.Provider>

<TranslationExportDialog
  open={translationExportDialogOpen}
  onOpenChange={(open) => {
    translationExportDialogOpen = open;
  }}
  jobs={translationStore.jobs}
/>

<!-- Logs Sheet (global overlay) -->
<LogsSheet />
