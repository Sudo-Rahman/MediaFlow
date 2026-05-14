<script lang="ts">
  import type { OcrLogEntry, OcrRegion, OcrVideoFile, OcrZoneFrame, OcrZoneRole } from '$lib/types';

  import OcrLogPanel from './OcrLogPanel.svelte';
  import OcrTimeline from './OcrTimeline.svelte';
  import VideoPreview from './VideoPreview.svelte';

  interface VideoOcrWorkspaceProps {
    file: OcrVideoFile | null;
    liveDetections: OcrZoneFrame[];
    logs: OcrLogEntry[];
    dialogsOpen: boolean;
    onAddSegmentFromRegion: (
      fileId: string,
      region: OcrRegion,
      startTimeMs: number,
      endTimeMs: number,
    ) => void | Promise<void>;
    onUpdateZoneRegion: (fileId: string, segmentId: string, zoneId: string, region: OcrRegion) => void | Promise<void>;
    onSetZoneRole: (fileId: string, segmentId: string, zoneId: string, role: OcrZoneRole) => void | Promise<void>;
    onDeleteZone: (fileId: string, segmentId: string, zoneId: string) => void | Promise<void>;
    onTrimSegment: (fileId: string, segmentId: string, startTimeMs: number, endTimeMs: number) => void | Promise<void>;
    onPlaybackError: (fileId: string, reason: string) => void | Promise<void>;
    onClearLogs: () => void;
  }

  let {
    file,
    liveDetections,
    logs,
    dialogsOpen,
    onAddSegmentFromRegion,
    onUpdateZoneRegion,
    onSetZoneRole,
    onDeleteZone,
    onTrimSegment,
    onPlaybackError,
    onClearLogs,
  }: VideoOcrWorkspaceProps = $props();

  let playbackTime = $state<{ fileId: string | null; timeMs: number }>({ fileId: null, timeMs: 0 });
  let seekRequest = $state<{ fileId: string; timeMs: number; requestId: number } | null>(null);
  let seekRequestId = $state(0);
  let selectedZone = $state<{ fileId: string; segmentId: string; zoneId: string } | null>(null);

  const durationMs = $derived(Math.round((file?.duration ?? 0) * 1000));
  const currentTimeMs = $derived(playbackTime.fileId === file?.id ? playbackTime.timeMs : 0);
  const selectedSegmentId = $derived(
    selectedZone && selectedZone.fileId === file?.id ? selectedZone.segmentId : null,
  );
  const selectedZoneId = $derived(
    selectedZone && selectedZone.fileId === file?.id ? selectedZone.zoneId : null,
  );

  function handleTimeChange(timeMs: number): void {
    playbackTime = { fileId: file?.id ?? null, timeMs };
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

  function handleDeleteZone(segmentId: string, zoneId: string): void {
    if (!file) {
      return;
    }

    void onDeleteZone(file.id, segmentId, zoneId);
    if (selectedSegmentId === segmentId && selectedZoneId === zoneId) {
      selectedZone = null;
    }
  }

  function handleSeek(timeMs: number): void {
    if (!file) {
      return;
    }

    const safeTimeMs = Math.max(0, Math.min(durationMs, Math.round(timeMs)));
    seekRequestId += 1;
    playbackTime = { fileId: file.id, timeMs: safeTimeMs };
    seekRequest = { fileId: file.id, timeMs: safeTimeMs, requestId: seekRequestId };
  }

  function handleTrimSegment(segmentId: string, startTimeMs: number, endTimeMs: number): void {
    if (!file) {
      return;
    }

    void onTrimSegment(file.id, segmentId, startTimeMs, endTimeMs);
  }
</script>

<div class="flex-1 min-h-0 overflow-hidden p-4 grid grid-rows-[minmax(0,2fr)_auto_minmax(0,1fr)] gap-4">
  <VideoPreview
    file={file ?? undefined}
    {liveDetections}
    showSubtitles={!dialogsOpen}
    suspendPlayback={dialogsOpen}
    {seekRequest}
    onTimeChange={handleTimeChange}
    onAddSegmentFromRegion={handleAddSegmentFromRegion}
    onUpdateZoneRegion={handleUpdateZoneRegion}
    onSetZoneRole={handleSetZoneRole}
    onDeleteZone={handleDeleteZone}
    onPlaybackError={onPlaybackError}
    class="min-h-0"
  />

  {#if file}
    <OcrTimeline
      selection={file.ocrSelection}
      {durationMs}
      {currentTimeMs}
      {selectedSegmentId}
      {selectedZoneId}
      onSelect={handleSelectZone}
      onSeek={handleSeek}
      onSetRole={handleSetZoneRole}
      onDeleteZone={handleDeleteZone}
      onTrimSegment={handleTrimSegment}
    />
  {/if}

  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    <OcrLogPanel
      {logs}
      onClear={onClearLogs}
      class="flex-1 flex flex-col"
    />
  </div>
</div>
