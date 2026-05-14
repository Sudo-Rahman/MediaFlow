<script lang="ts">
  import type { OcrLogEntry, OcrVideoFile, OcrZoneRole } from '$lib/types';

  import OcrLogPanel from './OcrLogPanel.svelte';
  import OcrTimeline from './OcrTimeline.svelte';
  import VideoPreview from './VideoPreview.svelte';

  interface VideoOcrWorkspaceProps {
    file: OcrVideoFile | null;
    logs: OcrLogEntry[];
    dialogsOpen: boolean;
    onSetZoneRole: (fileId: string, segmentId: string, zoneId: string, role: OcrZoneRole) => void | Promise<void>;
    onPlaybackError: (fileId: string, reason: string) => void | Promise<void>;
    onClearLogs: () => void;
  }

  let {
    file,
    logs,
    dialogsOpen,
    onSetZoneRole,
    onPlaybackError,
    onClearLogs,
  }: VideoOcrWorkspaceProps = $props();

  let currentTimeMs = $state(0);

  const durationMs = $derived(Math.round((file?.duration ?? 0) * 1000));

  function handleSetZoneRole(segmentId: string, zoneId: string, role: OcrZoneRole): void {
    if (!file) {
      return;
    }

    void onSetZoneRole(file.id, segmentId, zoneId, role);
  }
</script>

<div class="flex-1 min-h-0 overflow-hidden p-4 grid grid-rows-[minmax(0,2fr)_auto_minmax(0,1fr)] gap-4">
  <VideoPreview
    file={file ?? undefined}
    showSubtitles={!dialogsOpen}
    suspendPlayback={dialogsOpen}
    onTimeChange={(timeMs) => currentTimeMs = timeMs}
    onPlaybackError={onPlaybackError}
    class="min-h-0"
  />

  {#if file}
    <OcrTimeline
      selection={file.ocrSelection}
      {durationMs}
      {currentTimeMs}
      onSetRole={handleSetZoneRole}
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
