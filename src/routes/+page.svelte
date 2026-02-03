<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';

  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Separator } from '$lib/components/ui/separator';
  import { Button } from '$lib/components/ui/button';
  import { Alert, AlertTitle, AlertDescription, ThemeToggle } from '$lib/components';
  import AppSidebar from '$lib/components/AppSidebar.svelte';
  import { ExtractView, MergeView, SettingsView, InfoView, TranslationView, RenameView, AudioToSubsView } from '$lib/components/views';
  import { LogsSheet } from '$lib/components/logs';
  import { AlertCircle, ScrollText, Home, LayoutGrid, Table } from '@lucide/svelte';
  import { OS } from '$lib/utils';
  import { useSidebar } from "$lib/components/ui/sidebar";
  import { logStore } from '$lib/stores/logs.svelte';
  import { logAndToast } from '$lib/utils/log-toast';

  // Current view state
  let currentView = $state<'extract' | 'merge' | 'translate' | 'rename' | 'audio-to-subs' | 'info' | 'settings'>('extract');
  let ffmpegAvailable = $state<boolean | null>(null);
  let unlistenDragDrop: (() => void) | null = null;

  // Merge view mode state (only applicable when currentView === 'merge')
  let mergeViewMode = $state<'home' | 'groups' | 'table'>('home');

  // References to views for drag & drop forwarding
  let extractViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let mergeViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let infoViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let translateViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let renameViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let audioToSubsViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();

  const isMacOS = OS() === 'MacOS';

  const viewTitles: Record<string, string> = {
    extract: 'Track Extraction',
    merge: 'Track Merge',
    'audio-to-subs': 'Audio to Subs',
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
      }
    });
  }

  function handleNavigate(viewId: string) {
    currentView = viewId as 'extract' | 'merge' | 'translate' | 'rename' | 'audio-to-subs' | 'info' | 'settings';
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
      <div class="flex-1" data-tauri-drag-region={isMacOS}>
        <h1 data-tauri-drag-region={isMacOS} class="text-lg font-semibold">{viewTitles[currentView]}</h1>
      </div>

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
          <span class="absolute -top-1 -right-1 size-4 bg-destructive text-destructive-foreground rounded-full text-[10px] font-medium flex items-center justify-center">
            {logStore.unreadErrorCount > 9 ? '9+' : logStore.unreadErrorCount}
          </span>
        {/if}
      </Button>
    </header>

    <!-- FFmpeg warning -->
    {#if ffmpegAvailable === false && currentView !== 'settings'}
      <Alert variant="destructive" class="m-4 shrink-0">
        <AlertCircle class="size-4" />
        <AlertTitle>FFmpeg not available</AlertTitle>
        <AlertDescription>
          Install FFmpeg to use this application.
        </AlertDescription>
      </Alert>
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

<!-- Logs Sheet (global overlay) -->
<LogsSheet />

