<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { toast } from 'svelte-sonner';

  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Separator } from '$lib/components/ui/separator';
  import { Alert, AlertTitle, AlertDescription, ThemeToggle } from '$lib/components';
  import AppSidebar from '$lib/components/AppSidebar.svelte';
  import { ExtractView, MergeView, SettingsView, InfoView, TranslationView, RenameView } from '$lib/components/views';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import { OS } from '$lib/utils';
  import {useSidebar} from "$lib/components/ui/sidebar";

  // Current view state
  let currentView = $state<'extract' | 'merge' | 'translate' | 'rename' | 'info' | 'settings'>('extract');
  let ffmpegAvailable = $state<boolean | null>(null);
  let unlistenDragDrop: (() => void) | null = null;

  // References to views for drag & drop forwarding
  let extractViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let mergeViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let infoViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let translateViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();
  let renameViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();

  const isMacOS = OS() === 'MacOS';

  const viewTitles: Record<string, string> = {
    extract: 'Track Extraction',
    merge: 'Track Merge',
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
        toast.error('FFmpeg not found', {
          description: 'Please install FFmpeg to use this application.'
        });
      }
    } catch (e) {
      ffmpegAvailable = false;
      console.error('Error checking FFmpeg:', e);
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
      }
    });
  }

  function handleNavigate(viewId: string) {
    currentView = viewId as 'extract' | 'merge' | 'translate' | 'rename' | 'info' | 'settings';
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

    <!-- Main content -->
    <main class="flex-1 overflow-hidden">
      {#if currentView === 'extract'}
        <ExtractView bind:this={extractViewRef} />
      {:else if currentView === 'merge'}
        <MergeView bind:this={mergeViewRef} />
      {:else if currentView === 'translate'}
        <TranslationView bind:this={translateViewRef} onNavigateToSettings={() => handleNavigate('settings')} />
      {:else if currentView === 'rename'}
        <RenameView bind:this={renameViewRef} />
      {:else if currentView === 'info'}
        <InfoView bind:this={infoViewRef} />
      {:else if currentView === 'settings'}
        <SettingsView />
      {/if}
    </main>
  </Sidebar.Inset>
</Sidebar.Provider>

