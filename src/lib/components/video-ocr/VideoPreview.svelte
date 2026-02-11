<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { OcrVideoFile, OcrRegion, OcrSubtitle } from '$lib/types';
  import { DEFAULT_OCR_REGION } from '$lib/types';
  import { cn } from '$lib/utils';
  import { convertFileSrc } from '@tauri-apps/api/core';
  import { Button } from '$lib/components/ui/button';
  import { Maximize2, Minimize2, RotateCcw, Frame } from '@lucide/svelte';
  import SubtitleOverlay from './SubtitleOverlay.svelte';
  import RegionSelector from './RegionSelector.svelte';
  import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip';

  interface VideoPreviewProps {
    file?: OcrVideoFile;
    globalRegion?: OcrRegion;
    showSubtitles?: boolean;
    suspendPlayback?: boolean;
    onGlobalRegionChange?: (region: OcrRegion | undefined) => void | Promise<void>;
    onFileRegionChange?: (region: OcrRegion | undefined) => void | Promise<void>;
    onUseGlobalRegion?: () => void;
    class?: string;
  }

  let {
    file,
    globalRegion,
    showSubtitles = true,
    suspendPlayback = false,
    onGlobalRegionChange,
    onFileRegionChange,
    onUseGlobalRegion,
    class: className = '',
  }: VideoPreviewProps = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let containerEl: HTMLDivElement | undefined = $state();
  let currentTime = $state(0);
  let isRegionMode = $state(false);
  let editScope = $state<'all' | 'file'>('all');
  let region = $state<OcrRegion | undefined>(undefined);
  let resumePlayback = $state(false);
  
  // Video bounds within container (for letterboxed videos)
  // These are relative values (0-1) within the container
  let videoBounds = $state({ x: 0, y: 0, width: 1, height: 1 });
  
  // ResizeObserver for container size changes
  let resizeObserver: ResizeObserver | undefined;
  
  onMount(() => {
    // Create ResizeObserver to watch for container size changes
    resizeObserver = new ResizeObserver(() => {
      updateVideoBounds();
    });
  });
  
  onDestroy(() => {
    resizeObserver?.disconnect();
  });
  
  // Watch containerEl and observe it
  $effect(() => {
    if (containerEl && resizeObserver) {
      resizeObserver.observe(containerEl);
      return () => {
        resizeObserver?.unobserve(containerEl!);
      };
    }
  });

  // Pause playback while dialogs are open to reduce background render work
  $effect(() => {
    if (!videoEl) {
      return;
    }

    if (suspendPlayback) {
      resumePlayback = !videoEl.paused;
      if (!videoEl.paused) {
        videoEl.pause();
      }
      return;
    }

    if (!resumePlayback) {
      return;
    }

    resumePlayback = false;
    void videoEl.play().catch(() => {
      // Ignore autoplay restrictions
    });
  });

  // Sync editable region with active editing scope
  $effect(() => {
    if (editScope === 'all') {
      region = globalRegion ? { ...globalRegion } : { ...DEFAULT_OCR_REGION };
      return;
    }

    if (file?.ocrRegion) {
      region = { ...file.ocrRegion };
    } else {
      region = undefined;
    }
  });

  const displayedRegion = $derived.by(() => {
    if (file?.ocrRegionMode === 'global') {
      return file.ocrRegion ?? globalRegion ?? DEFAULT_OCR_REGION;
    }
    return file?.ocrRegion;
  });

  // Get video source URL
  const videoSrc = $derived(
    file?.previewPath ? convertFileSrc(file.previewPath) : undefined
  );

  function findSubtitleAtTime(subtitles: OcrSubtitle[], timeMs: number): OcrSubtitle | undefined {
    let left = 0;
    let right = subtitles.length - 1;

    while (left <= right) {
      const middle = Math.floor((left + right) / 2);
      const subtitle = subtitles[middle];

      if (timeMs < subtitle.startTime) {
        right = middle - 1;
      } else if (timeMs > subtitle.endTime) {
        left = middle + 1;
      } else {
        return subtitle;
      }
    }

    return undefined;
  }

  // Current subtitle based on video time
  const currentSubtitle = $derived.by(() => {
    if (!showSubtitles || !file?.subtitles?.length) return undefined;
    const timeMs = currentTime * 1000;
    return findSubtitleAtTime(file.subtitles, timeMs);
  });

  function handleTimeUpdate() {
    if (!showSubtitles) {
      return;
    }

    if (videoEl) {
      currentTime = videoEl.currentTime;
    }
  }
  
  function updateVideoBounds() {
    if (!videoEl || !containerEl) return;
    
    const containerRect = containerEl.getBoundingClientRect();
    const videoWidth = videoEl.videoWidth;
    const videoHeight = videoEl.videoHeight;
    
    if (videoWidth === 0 || videoHeight === 0 || containerRect.width === 0 || containerRect.height === 0) return;
    
    const videoRatio = videoWidth / videoHeight;
    const containerRatio = containerRect.width / containerRect.height;
    
    let displayWidth: number;
    let displayHeight: number;
    let offsetX: number;
    let offsetY: number;
    
    if (videoRatio > containerRatio) {
      // Video is wider than container - letterbox top/bottom
      displayWidth = containerRect.width;
      displayHeight = containerRect.width / videoRatio;
      offsetX = 0;
      offsetY = (containerRect.height - displayHeight) / 2;
    } else {
      // Video is taller than container - letterbox left/right
      displayHeight = containerRect.height;
      displayWidth = containerRect.height * videoRatio;
      offsetX = (containerRect.width - displayWidth) / 2;
      offsetY = 0;
    }
    
    // Convert to relative values (0-1)
    videoBounds = {
      x: offsetX / containerRect.width,
      y: offsetY / containerRect.height,
      width: displayWidth / containerRect.width,
      height: displayHeight / containerRect.height,
    };
  }

  function toggleRegionMode() {
    isRegionMode = !isRegionMode;
  }

  function handleRegionChange(newRegion: OcrRegion | undefined) {
    if (editScope === 'all') {
      const nextRegion = newRegion ?? { ...DEFAULT_OCR_REGION };
      region = nextRegion;
      onGlobalRegionChange?.(nextRegion);
      return;
    }

    region = newRegion;
    onFileRegionChange?.(newRegion);
  }

  function setDefaultRegion() {
    const defaultRegion = { ...DEFAULT_OCR_REGION };
    handleRegionChange(defaultRegion);
  }

  function clearRegion() {
    if (editScope === 'all') {
      setDefaultRegion();
      return;
    }

    handleRegionChange(undefined);
  }

  function useGlobalRegion() {
    onUseGlobalRegion?.();
    editScope = 'all';
  }
</script>

<div class={cn("relative flex flex-col min-h-0 h-full", className)}>
  <!-- Video container - scales to available space -->
  <div bind:this={containerEl} class="relative bg-black rounded-lg overflow-hidden flex-1 min-h-0">
    {#if videoSrc}
      <video
        bind:this={videoEl}
        src={videoSrc}
        class="w-full h-full object-contain"
        controls={!isRegionMode}
        ontimeupdate={handleTimeUpdate}
        onloadedmetadata={updateVideoBounds}
        onresize={updateVideoBounds}
      >
      </video>

      <!-- Subtitle overlay - hidden in region mode -->
      {#if showSubtitles && currentSubtitle && !isRegionMode}
        <SubtitleOverlay subtitle={currentSubtitle} />
      {/if}

      <!-- Region selector overlay -->
      {#if isRegionMode}
        <RegionSelector
          {region}
          {videoBounds}
          onchange={handleRegionChange}
        />
      {/if}

      <!-- Region indicator when not in edit mode -->
      {#if !isRegionMode && displayedRegion}
        <div
          class="absolute border-2 border-primary/50 bg-primary/10 pointer-events-none"
          style="
            left: {videoBounds.x * 100 + displayedRegion.x * videoBounds.width * 100}%;
            top: {videoBounds.y * 100 + displayedRegion.y * videoBounds.height * 100}%;
            width: {displayedRegion.width * videoBounds.width * 100}%;
            height: {displayedRegion.height * videoBounds.height * 100}%;
          "
        />
      {/if}
    {:else if file}
      <div class="w-full h-full flex items-center justify-center">
        <div class="text-center text-muted-foreground">
          {#if file.status === 'transcoding'}
            <p class="text-sm">Transcoding video for preview...</p>
            <p class="text-xs mt-1">This may take a moment</p>
          {:else if file.status === 'pending'}
            <p class="text-sm">Loading video...</p>
          {:else}
            <p class="text-sm">Video preview not available</p>
          {/if}
        </div>
      </div>
    {:else}
      <div class="w-full h-full flex items-center justify-center">
        <p class="text-muted-foreground text-sm">Select a video to preview</p>
      </div>
    {/if}
  </div>

  <!-- Region controls -->
  {#if file?.previewPath}
    <div class="flex flex-wrap items-center gap-2 mt-2 px-2">
      <Button
        variant={isRegionMode ? "default" : "outline"}
        size="sm"
        onclick={toggleRegionMode}
      >
        {#if isRegionMode}
          <Minimize2 class="size-4 mr-2" />
          Done
        {:else}
          <Maximize2 class="size-4 mr-2" />
          Set OCR Region
        {/if}
      </Button>

      <div class="flex items-center gap-1 rounded-md border p-1">
        <Button
          variant={editScope === 'all' ? 'secondary' : 'ghost'}
          size="sm"
          class="h-7 px-2 text-xs"
          onclick={() => editScope = 'all'}
        >
          All files
        </Button>
        <Button
          variant={editScope === 'file' ? 'secondary' : 'ghost'}
          size="sm"
          class="h-7 px-2 text-xs"
          onclick={() => editScope = 'file'}
          disabled={!file}
        >
          This file
        </Button>
      </div>

      {#if file?.ocrRegionMode === 'custom'}
        <Button variant="ghost" size="sm" class="text-xs" onclick={useGlobalRegion}>
          Use global region
        </Button>
      {/if}

      {#if region}
        <Button
          variant="ghost"
          size="sm"
          onclick={clearRegion}
        >
          <RotateCcw class="size-4 mr-2" />
          Clear Region
        </Button>
      {:else}
        <Tooltip>
          <TooltipTrigger>
            <Button
              variant="ghost"
              size="sm"
              onclick={setDefaultRegion}
            >
              <Frame class="size-4 mr-2" />
              Default
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Use default region (bottom 25%)</p>
          </TooltipContent>
        </Tooltip>
      {/if}
    </div>
    <p class="text-xs text-muted-foreground mt-2 px-2">
      Tip: Use All files for a shared default region, or This file for an override.
    </p>
  {/if}
</div>
