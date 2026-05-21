<script lang="ts">
  import { convertFileSrc } from '@tauri-apps/api/core';

  import type { OcrRegion, OcrVideoFile, OcrZoneFrame, OcrZoneRole } from '$lib/types';
  import { cn } from '$lib/utils';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import ActiveCueSummary from './ActiveCueSummary.svelte';
  import PreviewPlayerControls from './PreviewPlayerControls.svelte';
  import PreviewToolbar from './PreviewToolbar.svelte';
  import RegionSelector from './RegionSelector.svelte';
  import LiveOcrHoverCard from './LiveOcrHoverCard.svelte';
  import { buildActiveCueSummary } from './preview-cues';

  interface VideoSeekRequest {
    fileId: string;
    timeMs: number;
    requestId: number;
  }

  interface VideoPreviewProps {
    file?: OcrVideoFile;
    liveDetections?: OcrZoneFrame[];
    liveDetectionCount?: number;
    showSubtitles?: boolean;
    suspendPlayback?: boolean;
    seekRequest?: VideoSeekRequest | null;
    onTimeChange?: (timeMs: number) => void;
    onAddSegmentFromRegion?: (region: OcrRegion, startTimeMs: number, endTimeMs: number) => void | Promise<void>;
    onUpdateZoneRegion?: (segmentId: string, zoneId: string, region: OcrRegion) => void | Promise<void>;
    onSetZoneRole?: (segmentId: string, zoneId: string, role: OcrZoneRole) => void | Promise<void>;
    onDeleteZone?: (segmentId: string, zoneId: string) => void | Promise<void>;
    onPlaybackError?: (fileId: string, reason: string) => void | Promise<void>;
    class?: string;
  }

  interface VisibleZoneEntry {
    segmentId: string;
    zoneId: string;
    role: OcrZoneRole;
    region: OcrRegion;
    label: string;
  }

  let {
    file,
    liveDetections = [],
    liveDetectionCount = 0,
    showSubtitles = true,
    suspendPlayback = false,
    seekRequest = null,
    onTimeChange,
    onAddSegmentFromRegion,
    onUpdateZoneRegion,
    onSetZoneRole,
    onDeleteZone,
    onPlaybackError,
    class: className = '',
  }: VideoPreviewProps = $props();

  let videoEl = $state<HTMLVideoElement | null>(null);
  let previewContainerEl = $state<HTMLDivElement | null>(null);
  let containerEl = $state<HTMLElement | null>(null);
  let currentTimesByFileId = $state.raw<Record<string, number>>({});
  let isDrawingZone = $state(false);
  let isPaused = $state(true);
  let isMuted = $state(false);
  let volume = $state(1);
  let duration = $state(0);
  let drawingStartTimeMs = $state(0);
  let drawingRegion = $state<OcrRegion | undefined>();
  let editingZone = $state<{ segmentId: string; zoneId: string } | null>(null);
  let editingRegion = $state<OcrRegion | undefined>();
  let contextZone = $state<VisibleZoneEntry | undefined>();
  let contextMenuOpen = $state(false);
  let resumePlayback = $state(false);
  let lastAppliedSeekRequestId = $state<number | null>(null);
  let isPointerInsidePreview = $state(false);
  let liveDetectionsHoverOpen = $state(false);
  
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
  const isEditingZone = $derived(editingZone !== null);
  const selectedZoneId = $derived(editingZone?.zoneId ?? null);
  const activeRegion = $derived(isEditingZone ? editingRegion : drawingRegion);

  // Get video source URL
  const videoSrc = $derived(
    file?.previewPath ? convertFileSrc(file.previewPath) : undefined
  );
  const latestSubtitles = $derived(file?.ocrVersions.at(-1)?.finalSubtitles ?? []);
  const activeCueSummary = $derived.by(() => buildActiveCueSummary({
    subtitles: latestSubtitles,
    selection: file?.ocrSelection ?? { segments: [] },
    timeMs: Math.round(currentTime * 1000),
    selectedZoneId,
  }));
  const previewTitle = $derived(
    isEditingZone ? 'Editing OCR zone' : isDrawingZone ? 'Drawing OCR zone' : 'Video preview',
  );
  const previewDescription = $derived(
    isEditingZone
      ? 'Drag the region or resize it with handles.'
      : isDrawingZone
        ? 'Drag over the video image to select an OCR region.'
        : 'Right-click the video image to add or modify OCR zones.',
  );
  const visibleZoneEntries = $derived.by(() => {
    if (!file) {
      return [];
    }

    const timeMs = Math.round(currentTime * 1000);
    return file.ocrSelection.segments.flatMap((segment) => {
      if (timeMs < segment.startTimeMs || timeMs >= segment.endTimeMs) {
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
  const hasLiveDetections = $derived(liveDetections.length > 0);
  const shouldShowZoneHint = $derived(
    !!file
      && !isDrawingZone
      && !isEditingZone
      && visibleZoneEntries.length === 0
      && !isPointerInsidePreview
      && (!hasLiveDetections || !liveDetectionsHoverOpen),
  );

  $effect(() => {
    if (!videoEl || !file || !seekRequest || seekRequest.fileId !== file.id) {
      return;
    }

    if (seekRequest.requestId === lastAppliedSeekRequestId) {
      return;
    }

    lastAppliedSeekRequestId = seekRequest.requestId;
    seekToSeconds(seekRequest.timeMs / 1000);
  });

  $effect(() => {
    file;
    videoEl;
    duration = getVideoDurationSeconds();
  });

  function handleTimeUpdate() {
    if (videoEl) {
      const nextTime = videoEl.currentTime;
      updateCurrentTimeState(nextTime);
      syncPlaybackState();
    }
  }

  function updateCurrentTimeState(nextTimeSeconds: number): void {
    if (file) {
      currentTimesByFileId = { ...currentTimesByFileId, [file.id]: nextTimeSeconds };
    }
    onTimeChange?.(Math.round(nextTimeSeconds * 1000));
  }

  function syncPlaybackState(): void {
    if (!videoEl) {
      isPaused = true;
      duration = getVideoDurationSeconds();
      return;
    }

    isPaused = videoEl.paused;
    isMuted = videoEl.muted;
    volume = Number.isFinite(videoEl.volume) ? videoEl.volume : 1;
    duration = getVideoDurationSeconds();
  }

  function getVideoDurationSeconds(): number {
    const durationSeconds = Number.isFinite(videoEl?.duration) && videoEl?.duration
      ? videoEl.duration
      : file?.duration;

    return Math.max(0, durationSeconds ?? 0);
  }

  function reconcileLoadedMetadataTime(): void {
    if (!videoEl) {
      return;
    }

    const storedTimeSeconds = file ? currentTimesByFileId[file.id] : undefined;
    const actualTimeSeconds = Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0;
    const durationSeconds = getVideoDurationSeconds();
    const hasValidStoredTime = storedTimeSeconds !== undefined
      && Number.isFinite(storedTimeSeconds)
      && storedTimeSeconds >= 0
      && durationSeconds > 0
      && storedTimeSeconds <= durationSeconds;

    if (hasValidStoredTime) {
      videoEl.currentTime = storedTimeSeconds;
      updateCurrentTimeState(storedTimeSeconds);
      return;
    }

    updateCurrentTimeState(actualTimeSeconds);
  }

  function handleLoadedMetadata(): void {
    updateVideoBounds();
    syncPlaybackState();
    reconcileLoadedMetadataTime();
    syncPlaybackState();
  }

  function seekToSeconds(timeSeconds: number): void {
    if (!videoEl) {
      return;
    }

    const maxTimeSeconds = getVideoDurationSeconds();
    const requestedTimeSeconds = Number.isFinite(timeSeconds) ? timeSeconds : 0;
    const nextTimeSeconds = Math.min(Math.max(0, requestedTimeSeconds), maxTimeSeconds);

    videoEl.currentTime = nextTimeSeconds;
    updateCurrentTimeState(nextTimeSeconds);
  }

  function skipBySeconds(deltaSeconds: number): void {
    seekToSeconds(currentTime + deltaSeconds);
  }

  function togglePlayback(): void {
    if (!videoEl) {
      return;
    }

    if (videoEl.paused) {
      void videoEl.play()
        .then(syncPlaybackState)
        .catch(syncPlaybackState);
      return;
    }

    videoEl.pause();
    syncPlaybackState();
  }

  function toggleMute(): void {
    if (!videoEl) {
      return;
    }

    videoEl.muted = !videoEl.muted;
    syncPlaybackState();
  }

  function setVolume(nextVolume: number): void {
    if (!videoEl) {
      return;
    }

    const nextClampedVolume = Math.min(Math.max(Number.isFinite(nextVolume) ? nextVolume : 0, 0), 1);
    videoEl.volume = nextClampedVolume;
    if (nextClampedVolume > 0) {
      videoEl.muted = false;
    }
    syncPlaybackState();
  }

  function enterFullscreen(): void {
    void (previewContainerEl ?? containerEl)?.requestFullscreen?.();
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
    return Math.max(1, Math.round(getVideoDurationSeconds() * 1000));
  }

  function beginZoneDrawing(): void {
    if (!file || !videoEl) {
      return;
    }

    contextMenuOpen = false;
    contextZone = undefined;
    drawingStartTimeMs = Math.round(videoEl.currentTime * 1000);
    drawingRegion = undefined;
    editingZone = null;
    editingRegion = undefined;
    isDrawingZone = true;

    if (!videoEl.paused) {
      videoEl.pause();
    }
  }

  function beginZoneEditing(entry: VisibleZoneEntry): void {
    if (!file || !videoEl) {
      return;
    }

    contextMenuOpen = false;
    contextZone = undefined;
    isDrawingZone = false;
    drawingRegion = undefined;
    editingZone = { segmentId: entry.segmentId, zoneId: entry.zoneId };
    editingRegion = { ...entry.region };

    if (!videoEl.paused) {
      videoEl.pause();
    }
  }

  function handleRegionCommit(region: OcrRegion): void {
    if (editingZone) {
      editingRegion = region;
      return;
    }

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

  function saveZoneEditing(): void {
    if (!editingZone || !editingRegion) {
      return;
    }

    void onUpdateZoneRegion?.(editingZone.segmentId, editingZone.zoneId, editingRegion);
    editingZone = null;
    editingRegion = undefined;
  }

  function cancelRegionSelection(): void {
    isDrawingZone = false;
    drawingRegion = undefined;
    editingZone = null;
    editingRegion = undefined;
    contextZone = undefined;
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
    if (editingZone?.segmentId === segmentId && editingZone.zoneId === zoneId) {
      editingZone = null;
      editingRegion = undefined;
    }
  }

  function videoPointFromEvent(event: MouseEvent): { x: number; y: number } | null {
    if (!containerEl) {
      return null;
    }

    const rect = containerEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || videoBounds.width <= 0 || videoBounds.height <= 0) {
      return null;
    }

    const containerX = (event.clientX - rect.left) / rect.width;
    const containerY = (event.clientY - rect.top) / rect.height;
    if (
      containerX < videoBounds.x
      || containerX > videoBounds.x + videoBounds.width
      || containerY < videoBounds.y
      || containerY > videoBounds.y + videoBounds.height
    ) {
      return null;
    }

    return {
      x: (containerX - videoBounds.x) / videoBounds.width,
      y: (containerY - videoBounds.y) / videoBounds.height,
    };
  }

  function findZoneAtEvent(event: MouseEvent): VisibleZoneEntry | undefined {
    const point = videoPointFromEvent(event);
    if (!point) {
      return undefined;
    }

    return [...visibleZoneEntries].reverse().find((entry) => (
      point.x >= entry.region.x
      && point.x <= entry.region.x + entry.region.width
      && point.y >= entry.region.y
      && point.y <= entry.region.y + entry.region.height
    ));
  }

  function handlePreviewContextMenu(event: MouseEvent): void {
    if (isDrawingZone || isEditingZone) {
      event.preventDefault();
      event.stopPropagation();
      contextMenuOpen = false;
      contextZone = undefined;
      return;
    }

    contextZone = findZoneAtEvent(event);
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
      'pointer-events-none absolute rounded-sm border-2 text-left shadow-sm outline-none transition-colors',
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
    <div bind:this={previewContainerEl} class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background">
      <PreviewToolbar
        title={previewTitle}
        description={previewDescription}
        showCancel={isDrawingZone || isEditingZone}
        showSave={isEditingZone}
        saveDisabled={!editingRegion}
        oncancel={cancelRegionSelection}
        onsave={saveZoneEditing}
      />

      <ContextMenu.Root bind:open={contextMenuOpen}>
        <ContextMenu.Trigger
          bind:ref={containerEl}
          class="relative min-h-0 flex-1 overflow-hidden bg-black"
          oncontextmenu={handlePreviewContextMenu}
          onpointerenter={() => {
            isPointerInsidePreview = true;
          }}
          onpointerleave={() => {
            isPointerInsidePreview = false;
          }}
        >
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            bind:this={videoEl}
            src={videoSrc}
            class="h-full w-full object-contain"
            ontimeupdate={handleTimeUpdate}
            onplay={syncPlaybackState}
            onpause={syncPlaybackState}
            onvolumechange={syncPlaybackState}
            onloadedmetadata={handleLoadedMetadata}
            onresize={updateVideoBounds}
            onerror={handleVideoError}
          >
          </video>

          {#if !isDrawingZone && !isEditingZone}
            {#each visibleZoneEntries as entry (`${entry.segmentId}:${entry.zoneId}`)}
              <div
                class={zoneClass(entry.role)}
                style={regionToContainerStyle(entry.region)}
                aria-hidden="true"
              >
                <span class="absolute left-1 top-1 rounded-sm bg-background/85 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
                  {roleLabel(entry.role)}
                </span>
              </div>
            {/each}
          {/if}

          <div class="absolute left-3 top-3 flex flex-col items-start gap-2">
            {#if file && hasLiveDetections && !isDrawingZone}
              <LiveOcrHoverCard
                detections={liveDetections}
                detectionCount={liveDetectionCount}
                selection={file.ocrSelection}
                onOpenChange={(open) => {
                  liveDetectionsHoverOpen = open;
                }}
              />
            {/if}

            {#if shouldShowZoneHint}
              <span class="pointer-events-none rounded bg-black/70 px-2 py-1 text-xs text-white shadow-sm">
                Right-click to add OCR zones
              </span>
            {/if}
          </div>

          <!-- Region selector overlay -->
          {#if isDrawingZone || isEditingZone}
            <RegionSelector
              region={activeRegion}
              {videoBounds}
              allowCreate={isDrawingZone}
              onchange={(region) => {
                if (isEditingZone) {
                  editingRegion = region;
                } else {
                  drawingRegion = region;
                }
              }}
              oncommit={handleRegionCommit}
              oncancel={cancelRegionSelection}
            />
          {/if}
        </ContextMenu.Trigger>
        {#if !isDrawingZone && !isEditingZone}
          <ContextMenu.Content class="w-64">
            {#if contextZone}
              {@const menuZone = contextZone}
              <ContextMenu.Item onclick={() => beginZoneEditing(menuZone)}>
                Modify zone
              </ContextMenu.Item>
              {#if menuZone.role !== 'main_subtitle'}
                <ContextMenu.Item onclick={() => handleZoneRole(menuZone.segmentId, menuZone.zoneId, 'main_subtitle')}>
                  Set as Main subtitle
                </ContextMenu.Item>
              {/if}
              {#if menuZone.role !== 'on_screen_text'}
                <ContextMenu.Item onclick={() => handleZoneRole(menuZone.segmentId, menuZone.zoneId, 'on_screen_text')}>
                  Set as On-screen text
                </ContextMenu.Item>
              {/if}
              <ContextMenu.Separator />
              <ContextMenu.Item
                variant="destructive"
                onclick={() => handleDeleteZone(menuZone.segmentId, menuZone.zoneId)}
              >
                Delete zone
              </ContextMenu.Item>
            {:else}
              <ContextMenu.Item onclick={beginZoneDrawing}>
                Add OCR zone from current time
              </ContextMenu.Item>
            {/if}
          </ContextMenu.Content>
        {/if}
      </ContextMenu.Root>

      {#if showSubtitles}
        <ActiveCueSummary summary={activeCueSummary} />
      {/if}
      <PreviewPlayerControls
        {currentTime}
        {duration}
        paused={isPaused}
        muted={isMuted}
        {volume}
        disabled={isDrawingZone || isEditingZone}
        onseek={seekToSeconds}
        ontoggleplay={togglePlayback}
        onskip={skipBySeconds}
        ontogglemute={toggleMute}
        onvolumechange={setVolume}
        onfullscreen={enterFullscreen}
      />
    </div>
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
