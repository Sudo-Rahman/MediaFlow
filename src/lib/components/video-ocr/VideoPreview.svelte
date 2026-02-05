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
    showSubtitles?: boolean;
    onRegionChange?: (region: OcrRegion | undefined) => void;
    class?: string;
  }

  let {
    file,
    showSubtitles = true,
    onRegionChange,
    class: className = '',
  }: VideoPreviewProps = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let containerEl: HTMLDivElement | undefined = $state();
  let currentTime = $state(0);
  let isRegionMode = $state(false);
  let region = $state<OcrRegion | undefined>(undefined);
  
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

  // Sync region with file's region
  $effect(() => {
    if (file?.ocrRegion) {
      region = file.ocrRegion;
    } else {
      region = undefined;
    }
  });

  // Get video source URL
  const videoSrc = $derived(
    file?.previewPath ? convertFileSrc(file.previewPath) : undefined
  );

  // Current subtitle based on video time
  const currentSubtitle = $derived.by(() => {
    if (!showSubtitles || !file?.subtitles?.length) return undefined;
    const timeMs = currentTime * 1000;
    return file.subtitles.find(
      (sub) => timeMs >= sub.startTime && timeMs <= sub.endTime
    );
  });

  function handleTimeUpdate() {
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
    region = newRegion;
    onRegionChange?.(newRegion);
  }

  function setDefaultRegion() {
    const defaultRegion = { ...DEFAULT_OCR_REGION };
    region = defaultRegion;
    onRegionChange?.(defaultRegion);
  }

  function clearRegion() {
    region = undefined;
    onRegionChange?.(undefined);
  }
</script>

<div class={cn("relative flex flex-col", className)}>
  <!-- Video container - maintains aspect ratio -->
  <div bind:this={containerEl} class="relative bg-black rounded-lg overflow-hidden" style="aspect-ratio: 16/9;">
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
      {#if !isRegionMode && region}
        <div
          class="absolute border-2 border-primary/50 bg-primary/10 pointer-events-none"
          style="
            left: {videoBounds.x * 100 + region.x * videoBounds.width * 100}%;
            top: {videoBounds.y * 100 + region.y * videoBounds.height * 100}%;
            width: {region.width * videoBounds.width * 100}%;
            height: {region.height * videoBounds.height * 100}%;
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
    <div class="flex items-center gap-2 mt-2 px-2">
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
      Tip: Adjust OCR Region to exclude logos/watermarks.
    </p>
  {/if}
</div>
