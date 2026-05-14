<script lang="ts">
  import type { OcrLogEntry, OcrRegion, OcrVideoFile, OcrZoneRole } from '$lib/types';

  import OcrLogPanel from './OcrLogPanel.svelte';
  import OcrTimeline from './OcrTimeline.svelte';
  import VideoPreview from './VideoPreview.svelte';

  interface VideoOcrWorkspaceProps {
    file: OcrVideoFile | null;
    logs: OcrLogEntry[];
    dialogsOpen: boolean;
    onAddSegmentFromRegion: (
      fileId: string,
      region: OcrRegion,
      startTimeMs: number,
      endTimeMs: number,
    ) => void | Promise<void>;
    onSetZoneRole: (fileId: string, segmentId: string, zoneId: string, role: OcrZoneRole) => void | Promise<void>;
    onDeleteZone: (fileId: string, segmentId: string, zoneId: string) => void | Promise<void>;
    onPlaybackError: (fileId: string, reason: string) => void | Promise<void>;
    onClearLogs: () => void;
  }

  let {
    file,
    logs,
    dialogsOpen,
    onAddSegmentFromRegion,
    onSetZoneRole,
    onDeleteZone,
    onPlaybackError,
    onClearLogs,
  }: VideoOcrWorkspaceProps = $props();

  let playbackTime = $state<{ fileId: string | null; timeMs: number }>({ fileId: null, timeMs: 0 });
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
</script>

<div class="flex-1 min-h-0 overflow-hidden p-4 grid grid-rows-[minmax(0,2fr)_auto_minmax(0,1fr)] gap-4">
  <VideoPreview
    file={file ?? undefined}
    showSubtitles={!dialogsOpen}
    suspendPlayback={dialogsOpen}
    onTimeChange={handleTimeChange}
    onAddSegmentFromRegion={handleAddSegmentFromRegion}
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
      onSetRole={handleSetZoneRole}
      onDeleteZone={handleDeleteZone}
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
