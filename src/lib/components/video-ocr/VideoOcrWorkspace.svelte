<script lang="ts">
  import type { OcrRegion, OcrVideoFile, OcrZoneFrame, OcrZoneRole } from '$lib/types';
  import type { OcrTimelineApi } from './OcrTimeline.svelte';

  import OcrTimeline from './OcrTimeline.svelte';
  import VideoPreview from './VideoPreview.svelte';

  interface VideoOcrWorkspaceProps {
    file: OcrVideoFile | null;
    liveDetections: OcrZoneFrame[];
    liveDetectionCount: number;
    dialogsOpen: boolean;
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
    liveDetections,
    liveDetectionCount,
    dialogsOpen,
    onAddSegmentFromRegion,
    onUpdateZoneRegion,
    onSetZoneRole,
    onRenameZone,
    onDeleteZone,
    onTrimSegment,
    onPlaybackError,
  }: VideoOcrWorkspaceProps = $props();

  let playbackTime = $state<{ fileId: string | null; timeMs: number }>({ fileId: null, timeMs: 0 });
  let seekRequest = $state<{ fileId: string; timeMs: number; requestId: number; mode?: 'preview' | 'commit' } | null>(null);
  let seekRequestId = $state(0);
  let selectedZone = $state<{ fileId: string; segmentId: string; zoneId: string } | null>(null);
  let timelineRef = $state<OcrTimelineApi | null>(null);

  const durationMs = $derived(Math.round((file?.duration ?? 0) * 1000));
  const currentTimeMs = $derived(playbackTime.fileId === file?.id ? playbackTime.timeMs : 0);
  const selectedSegmentId = $derived(
    selectedZone && selectedZone.fileId === file?.id ? selectedZone.segmentId : null,
  );
  const selectedZoneId = $derived(
    selectedZone && selectedZone.fileId === file?.id ? selectedZone.zoneId : null,
  );
  const workspaceRowsClass = $derived(
    file ? 'grid-rows-[minmax(0,1fr)_minmax(10rem,35vh)]' : 'grid-rows-[minmax(0,1fr)]',
  );

  function handleTimeChange(timeMs: number): void {
    playbackTime = { fileId: file?.id ?? null, timeMs };
    timelineRef?.syncPlaybackTime(timeMs);
  }

  function handlePlaybackFrame(timeMs: number): void {
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

  function requestPlaybackSeek(timeMs: number, mode: 'preview' | 'commit'): void {
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

  function handleTrimSegment(segmentId: string, startTimeMs: number, endTimeMs: number): void {
    if (!file) {
      return;
    }

    void onTrimSegment(file.id, segmentId, startTimeMs, endTimeMs);
  }
</script>

<div class={`flex-1 min-h-0 overflow-hidden p-4 grid gap-2 ${workspaceRowsClass}`}>
  <VideoPreview
    file={file ?? undefined}
    {liveDetections}
    {liveDetectionCount}
    showSubtitles={!dialogsOpen}
    suspendPlayback={dialogsOpen}
    {seekRequest}
    onTimeChange={handleTimeChange}
    onPlaybackFrame={handlePlaybackFrame}
    onAddSegmentFromRegion={handleAddSegmentFromRegion}
    onUpdateZoneRegion={handleUpdateZoneRegion}
    onSetZoneRole={handleSetZoneRole}
    onDeleteZone={handleDeleteZone}
    onPlaybackError={onPlaybackError}
    class="min-h-0"
  />

  {#if file}
    <OcrTimeline
      bind:this={timelineRef}
      selection={file.ocrSelection}
      {durationMs}
      {currentTimeMs}
      {selectedSegmentId}
      {selectedZoneId}
      onSelect={handleSelectZone}
      onPreviewSeek={handlePreviewSeek}
      onSeek={handleSeek}
      onSetRole={handleSetZoneRole}
      onRenameZone={handleRenameZone}
      onDeleteZone={handleDeleteZone}
      onTrimSegment={handleTrimSegment}
    />
  {/if}
</div>
