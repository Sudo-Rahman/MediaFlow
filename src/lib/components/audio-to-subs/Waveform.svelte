<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { cn } from '$lib/utils';
  import { readFile, stat } from '@tauri-apps/plugin-fs';
  import { invoke } from '@tauri-apps/api/core';
  import WaveSurfer from 'wavesurfer.js';
  import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import Play from 'lucide-svelte/icons/play';
  import Pause from 'lucide-svelte/icons/pause';
  import ZoomIn from 'lucide-svelte/icons/zoom-in';
  import ZoomOut from 'lucide-svelte/icons/zoom-out';
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
  import FileAudio from 'lucide-svelte/icons/file-audio';
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import { formatFileSize } from '$lib/utils/format';

  // Max file size for direct waveform visualization (50MB)
  // Larger files or unsupported formats will be converted first
  const MAX_DIRECT_SIZE = 50 * 1024 * 1024;
  
  // Formats that WaveSurfer/browser can handle directly
  const WAVESURFER_SUPPORTED_FORMATS = ['mp3', 'wav', 'ogg', 'webm', 'flac'];

  interface WaveformProps {
    audioPath: string;
    duration?: number;
    fileSize?: number;
    class?: string;
  }

  let { 
    audioPath, 
    duration = 0,
    fileSize = 0,
    class: className = ''
  }: WaveformProps = $props();

  let containerRef: HTMLDivElement | undefined = $state();
  let wavesurfer: WaveSurfer | null = null;
  let isLoading = $state(true);
  let loadingMessage = $state('Loading waveform...');
  let error = $state<string | null>(null);
  let isPlaying = $state(false);
  let currentTime = $state(0);
  let totalDuration = $state(0);
  let zoomLevel = $state(50);
  let isReady = $state(false);
  let isTooLarge = $state(false);
  let actualFileSize = $state(0);
  
  // Track loaded path to prevent duplicate loads
  let loadedPath: string | null = null;
  let blobUrl: string | null = null;
  let isDestroyed = false;
  let loadId = 0;

  // Computed progress percentage
  let progressPercent = $derived(
    totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0
  );

  // Load audio when path changes
  $effect(() => {
    const path = audioPath;
    const container = containerRef;
    
    const currentLoadedPath = untrack(() => loadedPath);
    
    if (path && container && path !== currentLoadedPath) {
      loadAudio(path, container);
    }
  });

  onDestroy(() => {
    isDestroyed = true;
    cleanup();
  });

  function cleanup() {
    if (wavesurfer) {
      try {
        wavesurfer.destroy();
      } catch {
        // Ignore cleanup errors
      }
      wavesurfer = null;
    }
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
    isReady = false;
  }

  function cssVar(name : string, el = document.documentElement) {
    return getComputedStyle(el).getPropertyValue(name).trim();
  }
  
  function needsConversion(path: string, fileSize: number): boolean {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    // Convert if format not directly supported or file too large
    return !WAVESURFER_SUPPORTED_FORMATS.includes(ext) || fileSize > MAX_DIRECT_SIZE;
  }

  async function loadAudio(path: string, container: HTMLDivElement) {
    const currentLoadId = ++loadId;
    
    loadedPath = path;
    isLoading = true;
    loadingMessage = 'Loading waveform...';
    error = null;
    isReady = false;
    isTooLarge = false;

    cleanup();

    try {
      // Check file size first
      const fileStat = await stat(path);
      actualFileSize = fileStat.size;
      
      if (isDestroyed || currentLoadId !== loadId) return;
      
      let audioPathToLoad = path;
      
      // Check if we need to convert the audio
      if (needsConversion(path, actualFileSize)) {
        loadingMessage = 'Converting audio for preview...';
        try {
          // Use Rust backend to convert to lightweight MP3
          audioPathToLoad = await invoke<string>('convert_audio_for_waveform', { 
            audioPath: path 
          });
        } catch (convErr) {
          console.error('Conversion failed:', convErr);
          // If conversion fails and file is too large, show placeholder
          if (actualFileSize > MAX_DIRECT_SIZE * 5) { // 250MB+
            isTooLarge = true;
            isLoading = false;
            totalDuration = duration || 0;
            return;
          }
          // Otherwise try to load the original file anyway
        }
      }
      
      if (isDestroyed || currentLoadId !== loadId) return;
      
      loadingMessage = 'Generating waveform...';

      // Read file using Tauri fs plugin
      const fileData = await readFile(audioPathToLoad);
      
      if (isDestroyed || currentLoadId !== loadId) return;
      
      const ext = audioPathToLoad.split('.').pop()?.toLowerCase() || '';
      const mimeType = getMimeType(ext);
      
      const blob = new Blob([fileData], { type: mimeType });
      blobUrl = URL.createObjectURL(blob);
      
      if (isDestroyed || currentLoadId !== loadId) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
        return;
      }


      const ws = WaveSurfer.create({
        container,
        waveColor: `${cssVar('--muted-foreground')}`,
        progressColor: `${cssVar('--primary')}`,
        cursorColor: `${cssVar('--accent-foreground')}`,
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 100,
        normalize: true,
        hideScrollbar: false,
        minPxPerSec: zoomLevel,
        plugins: [
          TimelinePlugin.create({
            height: 20,
            timeInterval: 1,
            primaryLabelInterval: 5,
            style: {
              fontSize: '10px',
              color: `${cssVar('--muted-foreground')}`
            }
          })
        ]
      });

      wavesurfer = ws;

      ws.on('ready', () => {
        if (isDestroyed || currentLoadId !== loadId) return;
        isLoading = false;
        isReady = true;
        totalDuration = ws.getDuration() || duration || 0;
      });

      ws.on('error', (err) => {
        if (isDestroyed || currentLoadId !== loadId) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        
        console.error('WaveSurfer error:', err);
        error = 'Failed to decode audio. Format may not be supported.';
        isLoading = false;
      });

      ws.on('play', () => { isPlaying = true; });
      ws.on('pause', () => { isPlaying = false; });
      ws.on('timeupdate', (time) => { currentTime = time; });

      await ws.load(blobUrl);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (isDestroyed || currentLoadId !== loadId) return;
      
      console.error('Failed to load audio file:', err);
      error = err instanceof Error ? err.message : 'Failed to load audio file';
      isLoading = false;
    }
  }

  function getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'opus': 'audio/opus',
      'flac': 'audio/flac',
      'm4a': 'audio/mp4',
      'aac': 'audio/aac',
      'wma': 'audio/x-ms-wma',
      'webm': 'audio/webm',
    };
    return mimeTypes[ext] || 'audio/mpeg';
  }

  function togglePlayPause() {
    if (wavesurfer && isReady) {
      wavesurfer.playPause();
    }
  }

  function resetPlayback() {
    if (wavesurfer && isReady) {
      wavesurfer.seekTo(0);
      wavesurfer.pause();
    }
  }

  function handleZoom(delta: number) {
    const newZoom = Math.max(10, Math.min(200, zoomLevel + delta));
    zoomLevel = newZoom;
    if (wavesurfer && isReady) {
      wavesurfer.zoom(newZoom);
    }
  }

  function handleWheel(event: WheelEvent) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -10 : 10;
      handleZoom(delta);
    }
  }

  function handleSeek(event: MouseEvent) {
    if (!wavesurfer || !isReady) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    wavesurfer.seekTo(Math.max(0, Math.min(1, percent)));
  }

  function formatTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
</script>

<div class={cn("flex flex-col gap-2", className)}>
  <!-- Waveform container or large file placeholder -->
  {#if isTooLarge}
    <!-- Large file - show simple UI without waveform -->
    <div class="relative w-full min-h-[120px] bg-muted/30 rounded-lg overflow-hidden flex flex-col items-center justify-center gap-3 p-4">
      <FileAudio class="size-10 text-muted-foreground/50" />
      <div class="text-center">
        <p class="text-sm text-muted-foreground">File too large for waveform preview</p>
        <p class="text-xs text-muted-foreground/70">
          {formatFileSize(actualFileSize)} (conversion failed)
        </p>
      </div>
      
      <!-- Simple progress bar for large files -->
      {#if totalDuration > 0}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div 
          class="w-full mt-2 cursor-pointer"
          onclick={handleSeek}
        >
          <Progress value={progressPercent} class="h-2" />
        </div>
      {/if}
    </div>
  {:else}
    <!-- Normal waveform container -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
      bind:this={containerRef}
      class="relative w-full min-h-[120px] bg-muted/30 rounded-lg overflow-hidden"
      onwheel={handleWheel}
    >
      {#if isLoading}
        <div class="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
          <div class="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 class="size-6 animate-spin" />
            <span class="text-xs">{loadingMessage}</span>
          </div>
        </div>
      {/if}
      
      {#if error}
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="flex flex-col items-center gap-2 text-muted-foreground">
            <AlertCircle class="size-6 text-destructive/50" />
            <span class="text-xs text-center px-4">{error}</span>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Progress bar (below waveform, always visible when ready) -->
  {#if isReady && !error && !isTooLarge}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div 
      class="px-2 cursor-pointer group"
      onclick={handleSeek}
      title="Click to seek"
    >
      <div class="relative h-1.5 bg-muted rounded-full overflow-hidden">
        <div 
          class="absolute inset-y-0 left-0 bg-primary rounded-full transition-all"
          style="width: {progressPercent}%"
        ></div>
      </div>
    </div>
  {/if}

  <!-- Controls -->
  {#if (isReady && !error) || isTooLarge}
    <div class="flex items-center gap-3 px-2">
      <!-- Play/Pause (disabled for large files without wavesurfer) -->
      <div class="flex items-center gap-1">
        <Button 
          variant="ghost" 
          size="icon" 
          class="size-8" 
          onclick={togglePlayPause}
          disabled={isTooLarge}
          title={isTooLarge ? "Playback not available for large files" : ""}
        >
          {#if isPlaying}
            <Pause class="size-4" />
          {:else}
            <Play class="size-4" />
          {/if}
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          class="size-8" 
          onclick={resetPlayback}
          disabled={isTooLarge}
        >
          <RotateCcw class="size-4" />
        </Button>
      </div>

      <!-- Time display -->
      <div class="text-xs text-muted-foreground font-mono min-w-[100px]">
        {formatTime(currentTime)} / {formatTime(totalDuration)}
      </div>

      <!-- Zoom controls (only for normal waveform) -->
      {#if !isTooLarge}
        <div class="flex items-center gap-1 ml-auto">
          <Button 
            variant="ghost" 
            size="icon" 
            class="size-7" 
            onclick={() => handleZoom(-20)}
            disabled={zoomLevel <= 10}
            title="Zoom out"
          >
            <ZoomOut class="size-3.5" />
          </Button>
          <span class="text-xs text-muted-foreground w-10 text-center">{zoomLevel}%</span>
          <Button 
            variant="ghost" 
            size="icon" 
            class="size-7" 
            onclick={() => handleZoom(20)}
            disabled={zoomLevel >= 200}
            title="Zoom in"
          >
            <ZoomIn class="size-3.5" />
          </Button>
        </div>
      {/if}
    </div>
  {/if}
</div>
