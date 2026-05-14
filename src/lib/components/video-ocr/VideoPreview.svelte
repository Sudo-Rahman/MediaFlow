<script lang="ts">
  import { convertFileSrc } from '@tauri-apps/api/core';

  import type { OcrRegion, OcrSubtitle, OcrVideoFile, OcrZoneRole } from '$lib/types';
  import { cn } from '$lib/utils';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip';
  import SubtitleOverlay from './SubtitleOverlay.svelte';
  import RegionSelector from './RegionSelector.svelte';
  import OcrZoneContextMenu from './OcrZoneContextMenu.svelte';

  interface VideoPreviewProps {
    file?: OcrVideoFile;
    showSubtitles?: boolean;
    suspendPlayback?: boolean;
    onTimeChange?: (timeMs: number) => void;
    onAddSegmentFromRegion?: (region: OcrRegion, startTimeMs: number, endTimeMs: number) => void | Promise<void>;
    onSetZoneRole?: (segmentId: string, zoneId: string, role: OcrZoneRole) => void | Promise<void>;
    onDeleteZone?: (segmentId: string, zoneId: string) => void | Promise<void>;
    onPlaybackError?: (fileId: string, reason: string) => void | Promise<void>;
    class?: string;
  }

  let {
    file,
    showSubtitles = true,
    suspendPlayback = false,
    onTimeChange,
    onAddSegmentFromRegion,
    onSetZoneRole,
    onDeleteZone,
    onPlaybackError,
    class: className = '',
  }: VideoPreviewProps = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let containerEl: HTMLElement | undefined = $state();
  let currentTimesByFileId = $state.raw<Record<string, number>>({});
  let isDrawingZone = $state(false);
  let drawingStartTimeMs = $state(0);
  let drawingRegion = $state<OcrRegion | undefined>();
  let resumePlayback = $state(false);
  
  // Video bounds within container (for letterboxed videos)
  // These are relative values (0-1) within the container
  let videoBounds = $state({ x: 0, y: 0, width: 1, height: 1 });
  
  // Watch containerEl and observe it
  $effect(() => {
    if (!containerEl) {
      return;
    }

    const observedElement = containerEl;
    const observer = new ResizeObserver(() => {
      updateVideoBounds();
    });

    observer.observe(observedElement);
    updateVideoBounds();

    return () => {
      observer.unobserve(observedElement);
      observer.disconnect();
    };
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

  const currentTime = $derived(file ? currentTimesByFileId[file.id] ?? 0 : 0);

  // Get video source URL
  const videoSrc = $derived(
    file?.previewPath ? convertFileSrc(file.previewPath) : undefined
  );
  const latestSubtitles = $derived(file?.ocrVersions.at(-1)?.finalSubtitles ?? []);
  const visibleZoneEntries = $derived.by(() => {
    if (!file) {
      return [];
    }

    const timeMs = Math.round(currentTime * 1000);
    return file.ocrSelection.segments.flatMap((segment) => {
      if (timeMs < segment.startTimeMs || timeMs > segment.endTimeMs) {
        return [];
      }

      return segment.zones.map((zone, zoneIndex) => ({
        segmentId: segment.id,
        zoneId: zone.id,
        role: zone.role,
        region: zone.region,
        label: zone.label ?? `Zone ${zoneIndex + 1}`,
      }));
    });
  });
  const shouldShowZoneHint = $derived(!!file && !isDrawingZone);

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
    if (!showSubtitles || latestSubtitles.length === 0) return undefined;
    const timeMs = currentTime * 1000;
    return findSubtitleAtTime(latestSubtitles, timeMs);
  });

  function handleTimeUpdate() {
    if (videoEl) {
      const nextTime = videoEl.currentTime;
      if (file) {
        currentTimesByFileId = { ...currentTimesByFileId, [file.id]: nextTime };
      }
      onTimeChange?.(Math.round(nextTime * 1000));
    }
  }

  function describeVideoPlaybackError(error: MediaError | null): string {
    if (!error) {
      return 'Unknown media error';
    }

    switch (error.code) {
      case 1:
        return 'Playback aborted';
      case 2:
        return 'Network error while loading media';
      case 3:
        return 'Media decoding failed';
      case 4:
        return 'Unsupported media format';
      default:
        return `Media error code ${error.code}`;
    }
  }

  function handleVideoError() {
    if (!file || !onPlaybackError) {
      return;
    }

    const reason = describeVideoPlaybackError(videoEl?.error ?? null);
    void onPlaybackError(file.id, reason);
  }

  function getVideoDurationMs(): number {
    const durationSeconds = Number.isFinite(videoEl?.duration) && videoEl?.duration
      ? videoEl.duration
      : file?.duration;

    return Math.max(1, Math.round((durationSeconds ?? 0) * 1000));
  }

  function beginZoneDrawing(): void {
    if (!file || !videoEl) {
      return;
    }

    drawingStartTimeMs = Math.round(videoEl.currentTime * 1000);
    drawingRegion = undefined;
    isDrawingZone = true;

    if (!videoEl.paused) {
      videoEl.pause();
    }
  }

  function handleDrawingCommit(region: OcrRegion): void {
    if (!file || !onAddSegmentFromRegion) {
      isDrawingZone = false;
      drawingRegion = undefined;
      return;
    }

    const endTimeMs = getVideoDurationMs();
    void onAddSegmentFromRegion(region, drawingStartTimeMs, endTimeMs);
    isDrawingZone = false;
    drawingRegion = undefined;
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

  function handleZoneRole(segmentId: string, zoneId: string, role: OcrZoneRole): void {
    void onSetZoneRole?.(segmentId, zoneId, role);
  }

  function handleDeleteZone(segmentId: string, zoneId: string): void {
    void onDeleteZone?.(segmentId, zoneId);
  }

  function regionToContainerStyle(region: OcrRegion): string {
    const left = videoBounds.x * 100 + region.x * videoBounds.width * 100;
    const top = videoBounds.y * 100 + region.y * videoBounds.height * 100;
    const width = region.width * videoBounds.width * 100;
    const height = region.height * videoBounds.height * 100;

    return `left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%;`;
  }

  function zoneClass(role: OcrZoneRole): string {
    return cn(
      'absolute rounded-sm border-2 text-left shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      role === 'main_subtitle'
        ? 'border-sky-400/80 bg-sky-500/15 hover:bg-sky-500/20'
        : 'border-amber-400/80 bg-amber-500/15 hover:bg-amber-500/20',
    );
  }

  function roleLabel(role: OcrZoneRole): string {
    return role === 'main_subtitle' ? 'Main subtitle' : 'On-screen text';
  }
</script>

<div class={cn("relative flex flex-col min-h-0 h-full", className)}>
  <!-- Video container - scales to available space -->
  {#if videoSrc}
    <ContextMenu.Root>
      <ContextMenu.Trigger
        bind:ref={containerEl}
        class="relative bg-black rounded-lg overflow-hidden flex-1 min-h-0"
      >
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoEl}
        src={videoSrc}
        class="w-full h-full object-contain"
        controls={!isDrawingZone}
        ontimeupdate={handleTimeUpdate}
        onloadedmetadata={updateVideoBounds}
        onresize={updateVideoBounds}
        onerror={handleVideoError}
      >
      </video>

      <!-- Subtitle overlay - hidden while drawing a zone -->
      {#if showSubtitles && currentSubtitle && !isDrawingZone}
        <SubtitleOverlay subtitle={currentSubtitle} />
      {/if}

      {#if !isDrawingZone}
        {#each visibleZoneEntries as entry (`${entry.segmentId}:${entry.zoneId}`)}
          <OcrZoneContextMenu
            segmentId={entry.segmentId}
            zoneId={entry.zoneId}
            role={entry.role}
            onSetRole={handleZoneRole}
            onDeleteZone={handleDeleteZone}
          >
            <button
              type="button"
              class={zoneClass(entry.role)}
              style={regionToContainerStyle(entry.region)}
              aria-label={`${roleLabel(entry.role)} OCR zone`}
              title={`${roleLabel(entry.role)}: ${entry.label}`}
            >
              <span class="absolute left-1 top-1 rounded-sm bg-background/85 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
                {roleLabel(entry.role)}
              </span>
            </button>
          </OcrZoneContextMenu>
        {/each}
      {/if}

      {#if shouldShowZoneHint}
        <Tooltip>
          <TooltipTrigger>
            <span class="absolute bottom-3 left-3 rounded bg-black/70 px-2 py-1 text-xs text-white shadow-sm">
              Right-click to add OCR zones
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Use the current playback time as the segment start.</p>
          </TooltipContent>
        </Tooltip>
      {/if}

      <!-- Region selector overlay -->
      {#if isDrawingZone}
        <RegionSelector
          region={drawingRegion}
          {videoBounds}
          onchange={(region) => {
            drawingRegion = region;
          }}
          oncommit={handleDrawingCommit}
        />
      {/if}
      </ContextMenu.Trigger>
      <ContextMenu.Content class="w-64">
        <ContextMenu.Item onclick={beginZoneDrawing}>
          Add OCR zone from current time
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  {:else if file}
    <div class="relative bg-black rounded-lg overflow-hidden flex-1 min-h-0">
      <div class="w-full h-full flex items-center justify-center">
        <div class="text-center text-muted-foreground">
          {#if file.status === 'transcoding'}
            <p class="text-sm">Transcoding video for preview...</p>
            <p class="text-xs mt-1">This may take a moment</p>
          {:else if file.status === 'scanning'}
            <p class="text-sm">Scanning video...</p>
            <p class="text-xs mt-1">Reading media details</p>
          {:else if file.status === 'pending'}
            <p class="text-sm">Loading video...</p>
          {:else}
            <p class="text-sm">Video preview not available</p>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <div class="relative bg-black rounded-lg overflow-hidden flex-1 min-h-0">
      <div class="w-full h-full flex items-center justify-center">
        <p class="text-muted-foreground text-sm">Select a video to preview</p>
      </div>
    </div>
  {/if}
</div>
