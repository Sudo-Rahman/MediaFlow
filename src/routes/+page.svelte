<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { toast } from 'svelte-sonner';

  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Separator } from '$lib/components/ui/separator';
  import { Alert, AlertTitle, AlertDescription, ThemeToggle } from '$lib/components';
  import AppSidebar from '$lib/components/AppSidebar.svelte';
  import { ExtractView, MergeView } from '$lib/components/views';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import { OS } from '$lib/utils';
  import {useSidebar} from "$lib/components/ui/sidebar";

  // Current view state
  let currentView = $state<'extract' | 'merge'>('extract');
  let ffmpegAvailable = $state<boolean | null>(null);
  let unlistenDragDrop: (() => void) | null = null;

  // Reference to ExtractView for drag & drop forwarding
  let extractViewRef: { handleFileDrop: (paths: string[]) => Promise<void> } | undefined = $state();

  const isMacOS = OS() === 'MacOS';

  const viewTitles: Record<string, string> = {
    extract: 'Extraction de pistes',
    merge: 'Merge de pistes'
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
        toast.error('FFmpeg non trouvé', {
          description: 'Veuillez installer FFmpeg pour utiliser cette application.'
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
      }
    });
  }

  function handleNavigate(viewId: string) {
    currentView = viewId as 'extract' | 'merge';
  }

</script>

<Sidebar.Provider>
  <AppSidebar
    currentView={currentView}
    onNavigate={handleNavigate}
  />

  <Sidebar.Inset class="flex flex-col h-screen">
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
      <ThemeToggle />
    </header>

    <!-- FFmpeg warning -->
    {#if ffmpegAvailable === false}
      <Alert variant="destructive" class="m-4 shrink-0">
        <AlertCircle class="size-4" />
        <AlertTitle>FFmpeg non disponible</AlertTitle>
        <AlertDescription>
          Installez FFmpeg pour utiliser cette application. Sur macOS: <code class="bg-muted px-1 rounded">brew install ffmpeg</code>
        </AlertDescription>
      </Alert>
    {/if}

    <!-- Main content -->
    <main class="flex-1 overflow-hidden">
      {#if currentView === 'extract'}
        <ExtractView bind:this={extractViewRef} />
      {:else if currentView === 'merge'}
        <MergeView />
      {/if}
    </main>
  </Sidebar.Inset>
</Sidebar.Provider>

