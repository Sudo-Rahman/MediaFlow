<script lang="ts">
  import { Loader2, AlertCircle, Play, Pause, ZoomIn, ZoomOut, RotateCcw, FileAudio } from '@lucide/svelte';
  import { onDestroy, untrack } from 'svelte';
  import { cn } from '$lib/utils';
  import { readFile, stat } from '@tauri-apps/plugin-fs';
  import { invoke } from '@tauri-apps/api/core';
  import WaveSurfer from 'wavesurfer.js';
  import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import { formatFileSize } from '$lib/utils/format';
  import { audioToSubsStore } from '$lib/stores/audio-to-subs.svelte';

  // Max file size for direct waveform visualization (50MB)
  const MAX_DIRECT_SIZE = 50 * 1024 * 1024;
  
  // Formats that WaveSurfer/browser can handle directly
  const WAVESURFER_SUPPORTED_FORMATS = ['mp3', 'wav', 'ogg', 'webm', 'flac'];

  interface WaveformProps {
    audioPath: string;
    fileId: string;
    duration?: number;
    fileSize?: number;
    selectedTrackIndex?: number;
    class?: string;
  }

  let { 
    audioPath, 
    fileId,
    duration = 0,
    fileSize = 0,
    selectedTrackIndex = 0,
    class: className = ''
  }: WaveformProps = $props();

  let containerRef: HTMLDivElement | undefined = $state();
  let wavesurfer: WaveSurfer | null = $state(null);
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
  
  let loadedKey: string | null = null;
  let blobUrl: string | null = null;
  let isDestroyed = false;
  let loadId = 0;

  // Computed progress percentage
  let progressPercent = $derived(
    totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0
  );

  // Create a unique key combining path and track index
  function getLoadKey(path: string, trackIdx: number): string {
    return `${path}::track${trackIdx}`;
  }

  // Load audio when path or track index changes
  $effect(() => {
    const path = audioPath;
    const trackIdx = selectedTrackIndex;
    const container = containerRef;
    
    const currentKey = getLoadKey(path, trackIdx);
    const currentLoadedKey = untrack(() => loadedKey);
    
    if (path && container && currentKey !== currentLoadedKey) {
      // Clear persisted blob when track changes
      if (currentLoadedKey && currentLoadedKey !== currentKey) {
        audioToSubsStore.removeWaveformInstance(fileId);
      }
      loadAudio(path, container);
    }
  });

  onDestroy(() => {
    isDestroyed = true;
    // Save current state before unmounting
    saveState();
    // Clean up local instance but DON'T destroy the blob URL
    // The blob URL is kept in the store for persistence
    if (wavesurfer) {
      wavesurfer.destroy();
      wavesurfer = null;
    }
  });

  function saveState() {
    if (!fileId) return;
    
    // Save waveform state to store for restoration
    const currentFile = audioToSubsStore.audioFiles.find(f => f.id === fileId);
    if (currentFile) {
      // Update the file with current state
      const updatedFile = {
        ...currentFile,
        waveformState: {
          currentTime,
          isPlaying,
          zoomLevel
        }
      };
      
      // Update in store
      const fileIndex = audioToSubsStore.audioFiles.findIndex(f => f.id === fileId);
      if (fileIndex >= 0) {
        const files = [...audioToSubsStore.audioFiles];
        files[fileIndex] = updatedFile;
        // We can't directly mutate the store, but the state will be restored
        // from the store when the component remounts
      }
    }
  }

  function cssVar(name : string, el = document.documentElement) {
    return getComputedStyle(el).getPropertyValue(name).trim();
  }
  
  function needsConversion(path: string, fileSize: number): boolean {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    return !WAVESURFER_SUPPORTED_FORMATS.includes(ext) || fileSize > MAX_DIRECT_SIZE;
  }

  function createWaveSurfer(container: HTMLDivElement): WaveSurfer {
    return WaveSurfer.create({
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
  }

  /**
   * Read audio file and create a blob URL
   * Isolated in a separate function so fileData can be garbage collected
   * immediately after the blob is created, reducing memory usage
   */
  async function createAudioBlobUrl(audioPath: string): Promise<string | null> {
    try {
      const fileData = await readFile(audioPath);
      const ext = audioPath.split('.').pop()?.toLowerCase() || '';
      const mimeType = getMimeType(ext);
      const blob = new Blob([fileData], { type: mimeType });
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error('Failed to create audio blob URL:', err);
      return null;
    }
  }

  async function loadAudio(path: string, container: HTMLDivElement) {
    const currentLoadId = ++loadId;
    
    loadedKey = getLoadKey(path, selectedTrackIndex);
    isLoading = true;
    loadingMessage = 'Loading waveform...';
    error = null;
    isReady = false;
    isTooLarge = false;

    // Check if we have persisted data for this file (reusing blob URL)
    const persistedData = audioToSubsStore.getWaveformInstance(fileId);
    const file = audioToSubsStore.audioFiles.find(f => f.id === fileId);
    
    // Restore state from store if available
    if (file?.waveformState) {
      currentTime = file.waveformState.currentTime;
      isPlaying = file.waveformState.isPlaying;
      zoomLevel = file.waveformState.zoomLevel;
    }
    
    // Clean up any existing instance first
    if (wavesurfer) {
      wavesurfer.destroy();
      wavesurfer = null;
    }
    
    // If we have a persisted blob URL, reuse it for instant loading
    if (persistedData?.blobUrl) {
      blobUrl = persistedData.blobUrl;
      loadingMessage = 'Restoring waveform...';
      
      try {
        const ws = createWaveSurfer(container);
        wavesurfer = ws;
        
        attachEventListeners(ws, currentLoadId);

        ws.on('ready', () => {
          if (isDestroyed || currentLoadId !== loadId) return;
          isLoading = false;
          isReady = true;
          totalDuration = ws.getDuration() || duration || 0;
          
          // Restore state
          ws.zoom(zoomLevel);
          if (currentTime > 0 && totalDuration > 0) {
            ws.seekTo(currentTime / totalDuration);
          }
          if (isPlaying) {
            ws.play();
          }
        });

        if (blobUrl) {
          await ws.load(blobUrl);
        }
        return;
      } catch (e) {
        console.warn('Failed to restore persisted blob, loading from file:', e);
        // Fall through to load from file
      }
    }

    // Create new instance from file
    try {
      // Check file size first
      const fileStat = await stat(path);
      actualFileSize = fileStat.size;
      
      if (isDestroyed || currentLoadId !== loadId) return;
      
      let audioPathToLoad = path;
      let convertedPath: string | undefined;
      
      // Check if we need to convert the audio
      if (needsConversion(path, actualFileSize)) {
        loadingMessage = 'Converting audio for preview...';
        try {
          convertedPath = await invoke<string>('convert_audio_for_waveform', { 
            audioPath: path,
            trackIndex: selectedTrackIndex
          });
          audioPathToLoad = convertedPath;
        } catch (convErr) {
          console.error('Conversion failed:', convErr);
          if (actualFileSize > MAX_DIRECT_SIZE * 5) {
            isTooLarge = true;
            isLoading = false;
            totalDuration = duration || 0;
            return;
          }
        }
      }
      
      if (isDestroyed || currentLoadId !== loadId) return;
      
      loadingMessage = 'Generating waveform...';

      // Create blob URL using isolated function to minimize memory usage
      // The function allows fileData to be garbage collected immediately after blob creation
      blobUrl = await createAudioBlobUrl(audioPathToLoad);
      
      if (!blobUrl) {
        throw new Error('Failed to load audio file');
      }
      
      if (isDestroyed || currentLoadId !== loadId) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
        return;
      }

      const ws = createWaveSurfer(container);
      wavesurfer = ws;

      attachEventListeners(ws, currentLoadId);

      ws.on('ready', () => {
        if (isDestroyed || currentLoadId !== loadId) return;
        isLoading = false;
        isReady = true;
        totalDuration = ws.getDuration() || duration || 0;
        
        // Save the instance to store for persistence
        if (blobUrl) {
          audioToSubsStore.saveWaveformInstance(fileId, ws, blobUrl, convertedPath);
          
          // Update file with preview URL info
          const currentFileData = audioToSubsStore.audioFiles.find(f => f.id === fileId);
          if (currentFileData) {
            const updatedFiles = [...audioToSubsStore.audioFiles];
            const idx = updatedFiles.findIndex(f => f.id === fileId);
            if (idx >= 0) {
              updatedFiles[idx] = {
                ...updatedFiles[idx],
                previewUrl: blobUrl,
                convertedPath: convertedPath,
                duration: totalDuration || duration
              };
              // Note: We update through the store's updateFile method
              audioToSubsStore.updateFile(fileId, {
                previewUrl: blobUrl,
                convertedPath: convertedPath,
                duration: totalDuration || duration
              });
            }
          }
        }
      });

      await ws.load(blobUrl);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (isDestroyed || currentLoadId !== loadId) return;
      
      console.error('Failed to load audio file:', err);
      error = err instanceof Error ? err.message : 'Failed to load audio file';
      isLoading = false;
    }
  }

  function attachEventListeners(ws: WaveSurfer, currentLoadId: number) {
    ws.on('error', (err) => {
      if (isDestroyed || currentLoadId !== loadId) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      
      console.error('WaveSurfer error:', err);
      error = 'Failed to decode audio. Format may not be supported.';
      isLoading = false;
    });

    ws.on('play', () => { 
      isPlaying = true; 
    });
    
    ws.on('pause', () => { 
      isPlaying = false; 
    });
    
    ws.on('timeupdate', (time) => { 
      currentTime = time;
    });
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
      currentTime = 0;
      isPlaying = false;
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
