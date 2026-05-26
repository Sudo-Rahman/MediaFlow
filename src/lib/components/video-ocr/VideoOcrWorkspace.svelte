<script lang="ts">
  import type { OcrRegion, OcrSubtitle, OcrVideoFile, OcrZoneFrame, OcrZoneRole, VideoOcrSelection } from '$lib/types';
  import type { OcrTimelineApi } from './OcrTimeline.svelte';

  import FloatingOcrCuePalette from './FloatingOcrCuePalette.svelte';
  import OcrTimeline from './OcrTimeline.svelte';
  import OcrVersionSelector from './OcrVersionSelector.svelte';
  import VideoPreview from './VideoPreview.svelte';
  import {
    getTopRightFloatingPalettePosition,
    getViewportFloatingPaletteRect,
    type FloatingPalettePosition,
  } from './floating-palette-position';
  import { buildActiveCueSummary } from './preview-cues';

  interface VideoOcrWorkspaceProps {
    file: OcrVideoFile | null;
    activeSelection?: VideoOcrSelection | null;
    activeSubtitles?: OcrSubtitle[];
    liveDetections: OcrZoneFrame[];
    liveDetectionCount: number;
    dialogsOpen: boolean;
    previewExpanded?: boolean;
    hasDraftVersion?: boolean;
    draftVersionName?: string | null;
    onPreviewExpandedChange?: (expanded: boolean) => void;
    onSelectVersion: (fileId: string, versionId: string | null) => void | Promise<void>;
    onAddSegmentFromRegion: (
      fileId: string,
      region: OcrRegion,
      startTimeMs: number,
      endTimeMs: number,
    ) => void | Promise<void>;
    onUpdateZoneRegion: (fileId: string, segmentId: string, zoneId: string, region: OcrRegion) => void | Promise<void>;
    onSetZoneRole: (fileId: string, segmentId: string, zoneId: string, role: OcrZoneRole) => void | Promise<void>;
    onRenameZone: (fileId: string, segmentId: string, zoneId: string, label: string) => void | Promise<void>;
    onDeleteZone: (fileId: string, segmentId: string, zoneId: string) => void | Promise<void>;
    onTrimSegment: (fileId: string, segmentId: string, startTimeMs: number, endTimeMs: number) => void | Promise<void>;
    onPlaybackError: (fileId: string, reason: string) => void | Promise<void>;
  }

  let {
    file,
    activeSelection = null,
    activeSubtitles = [],
    liveDetections,
    liveDetectionCount,
    dialogsOpen,
    previewExpanded = false,
    hasDraftVersion = false,
    draftVersionName = null,
    onPreviewExpandedChange,
    onSelectVersion,
    onAddSegmentFromRegion,
    onUpdateZoneRegion,
    onSetZoneRole,
    onRenameZone,
    onDeleteZone,
    onTrimSegment,
    onPlaybackError,
  }: VideoOcrWorkspaceProps = $props();

  let playbackTime = $state<{ fileId: string | null; timeMs: number }>({ fileId: null, timeMs: 0 });
  let seekRequest = $state<{ fileId: string; timeMs: number; requestId: number; mode?: 'preview' | 'commit' | 'cancel' } | null>(null);
  let seekRequestId = $state(0);
  let selectedZone = $state<{ fileId: string; segmentId: string; zoneId: string } | null>(null);
  let timelineRef = $state<OcrTimelineApi | null>(null);
  let workspaceEl = $state<HTMLDivElement | null>(null);
  let paletteOpen = $state(false);
  let palettePosition = $state<FloatingPalettePosition>({ x: 16, y: 16 });
  let palettePositionInitialized = $state(false);

  const durationMs = $derived(Math.round((file?.duration ?? 0) * 1000));
  const currentTimeMs = $derived(playbackTime.fileId === file?.id ? playbackTime.timeMs : 0);
  const workspaceSelection = $derived(activeSelection ?? file?.ocrSelection ?? { segments: [] });
  const selectedSegmentId = $derived(
    selectedZone && selectedZone.fileId === file?.id ? selectedZone.segmentId : null,
  );
  const selectedZoneId = $derived(
    selectedZone && selectedZone.fileId === file?.id ? selectedZone.zoneId : null,
  );
  const hasOnScreenTextZones = $derived(
    workspaceSelection.segments.some((segment) =>
      segment.zones.some((zone) => zone.role === 'on_screen_text'),
    ),
  );
  const workspaceRowsClass = $derived.by(() => {
    if (previewExpanded) {
      return 'grid-rows-[minmax(0,1fr)]';
    }

    if (!file) {
      return 'grid-rows-[minmax(0,1fr)]';
    }

    return hasOnScreenTextZones
      ? 'grid-rows-[minmax(0,1fr)_minmax(10rem,35vh)]'
      : 'grid-rows-[minmax(0,1fr)_minmax(7rem,22vh)]';
  });
  const activeCueSummary = $derived.by(() => buildActiveCueSummary({
    subtitles: activeSubtitles,
    selection: workspaceSelection,
    timeMs: currentTimeMs,
    selectedZoneId,
  }));

  function handleTimeChange(timeMs: number): void {
    playbackTime = { fileId: file?.id ?? null, timeMs };
    timelineRef?.syncPlaybackTime(timeMs);
  }

  function handlePlaybackFrame(timeMs: number): void {
    playbackTime = { fileId: file?.id ?? null, timeMs };
    timelineRef?.syncPlaybackTime(timeMs);
  }

  function handleSelectZone(segmentId: string, zoneId: string): void {
    if (!file) {
      return;
    }

    selectedZone = { fileId: file.id, segmentId, zoneId };
  }

  function handleAddSegmentFromRegion(region: OcrRegion, startTimeMs: number, endTimeMs: number): void {
    if (!file) {
      return;
    }

    void onAddSegmentFromRegion(file.id, region, startTimeMs, endTimeMs);
  }

  function handleUpdateZoneRegion(segmentId: string, zoneId: string, region: OcrRegion): void {
    if (!file) {
      return;
    }

    void onUpdateZoneRegion(file.id, segmentId, zoneId, region);
  }

  function handleSetZoneRole(segmentId: string, zoneId: string, role: OcrZoneRole): void {
    if (!file) {
      return;
    }

    void onSetZoneRole(file.id, segmentId, zoneId, role);
  }

  function handleRenameZone(segmentId: string, zoneId: string, label: string): void {
    if (!file) {
      return;
    }

    void onRenameZone(file.id, segmentId, zoneId, label);
  }

  function handleDeleteZone(segmentId: string, zoneId: string): void {
    if (!file) {
      return;
    }

    void onDeleteZone(file.id, segmentId, zoneId);
    if (selectedSegmentId === segmentId && selectedZoneId === zoneId) {
      selectedZone = null;
    }
  }

  function requestPlaybackSeek(timeMs: number, mode: 'preview' | 'commit' | 'cancel'): void {
    if (!file) {
      return;
    }

    const safeTimeMs = Math.max(0, Math.min(durationMs, Math.round(timeMs)));
    seekRequestId += 1;

    if (mode === 'commit') {
      playbackTime = { fileId: file.id, timeMs: safeTimeMs };
    }

    seekRequest = { fileId: file.id, timeMs: safeTimeMs, requestId: seekRequestId, mode };
  }

  function handleSeek(timeMs: number): void {
    requestPlaybackSeek(timeMs, 'commit');
  }

  function handlePreviewSeek(timeMs: number): void {
    requestPlaybackSeek(timeMs, 'preview');
  }

  function handleCancelSeek(): void {
    requestPlaybackSeek(currentTimeMs, 'cancel');
  }

  function handleTrimSegment(segmentId: string, startTimeMs: number, endTimeMs: number): void {
    if (!file) {
      return;
    }

    void onTrimSegment(file.id, segmentId, startTimeMs, endTimeMs);
  }

  function getDefaultPalettePosition(): FloatingPalettePosition {
    const workspaceRect = workspaceEl?.getBoundingClientRect() ?? { right: 400, top: 16 };

    return getTopRightFloatingPalettePosition(
      workspaceRect,
      getViewportFloatingPaletteRect(),
      { width: 384, height: 280 },
      16,
    );
  }

  function openCuePalette(): void {
    if (!palettePositionInitialized) {
      palettePosition = getDefaultPalettePosition();
      palettePositionInitialized = true;
    }

    paletteOpen = true;
  }

  function closeCuePalette(): void {
    paletteOpen = false;
  }
</script>

{#snippet versionSelector(renderPopoverInline: boolean)}
  {#if file}
    <OcrVersionSelector
      versions={file.ocrVersions}
      activeVersionId={file.activeOcrVersionId}
      showDraft={hasDraftVersion}
      draftName={draftVersionName ?? `Draft Version ${file.ocrVersions.length + 1}`}
      {renderPopoverInline}
      onSelectVersion={(versionId) => onSelectVersion(file.id, versionId)}
    />
  {/if}
{/snippet}

{#snippet activeCuePalette()}
  {#if file && paletteOpen}
    <FloatingOcrCuePalette
      summary={activeCueSummary}
      position={palettePosition}
      onPositionChange={(position) => {
        palettePosition = position;
      }}
      onClose={closeCuePalette}
    />
  {/if}
{/snippet}

<div
  bind:this={workspaceEl}
  class={`relative h-full min-w-0 min-h-0 overflow-hidden p-4 grid gap-2 ${workspaceRowsClass}`}
>
  <VideoPreview
    file={file ?? undefined}
    selection={workspaceSelection}
    subtitles={activeSubtitles}
    {liveDetections}
    {liveDetectionCount}
    showSubtitles={!dialogsOpen}
    suspendPlayback={dialogsOpen}
    {seekRequest}
    {activeCueSummary}
    {paletteOpen}
    expanded={previewExpanded}
    toolbarAccessory={versionSelector}
    expandedOverlay={activeCuePalette}
    onTimeChange={handleTimeChange}
    onPlaybackFrame={handlePlaybackFrame}
    onOpenCuePalette={openCuePalette}
    onExpandedChange={onPreviewExpandedChange}
    onAddSegmentFromRegion={handleAddSegmentFromRegion}
    onUpdateZoneRegion={handleUpdateZoneRegion}
    onSetZoneRole={handleSetZoneRole}
    onDeleteZone={handleDeleteZone}
    onPlaybackError={onPlaybackError}
    class="min-h-0"
  />

  {#if file && !previewExpanded}
    <OcrTimeline
      bind:this={timelineRef}
      selection={workspaceSelection}
      {durationMs}
      {currentTimeMs}
      {selectedSegmentId}
      {selectedZoneId}
      onSelect={handleSelectZone}
      onPreviewSeek={handlePreviewSeek}
      onSeek={handleSeek}
      onCancelSeek={handleCancelSeek}
      onSetRole={handleSetZoneRole}
      onRenameZone={handleRenameZone}
      onDeleteZone={handleDeleteZone}
      onTrimSegment={handleTrimSegment}
    />
  {/if}

  {#if !previewExpanded}
    {@render activeCuePalette()}
  {/if}
</div>
