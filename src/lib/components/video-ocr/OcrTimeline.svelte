<script lang="ts" module>
  export interface OcrTimelineApi {
    syncPlaybackTime: (timeMs: number) => void;
  }

  export type OcrTimelinePointerEndType = 'pointerup' | 'pointercancel';
  export type OcrTimelineDragType = 'seek' | 'move' | 'trim-start' | 'trim-end';

  export interface OcrTimelineDragListeners {
    pointermove: EventListener;
    pointerup: EventListener;
    pointercancel: EventListener;
  }

  export interface OcrTimelineDragListenerTarget {
    addEventListener: (
      type: 'pointermove' | 'pointerup' | 'pointercancel',
      listener: EventListener,
      options?: AddEventListenerOptions,
    ) => void;
    removeEventListener: (
      type: 'pointermove' | 'pointerup' | 'pointercancel',
      listener: EventListener,
    ) => void;
  }

  export function attachOcrTimelineDragListeners(
    target: OcrTimelineDragListenerTarget,
    listeners: OcrTimelineDragListeners,
  ): () => void {
    let isActive = true;
    target.addEventListener('pointermove', listeners.pointermove);
    target.addEventListener('pointerup', listeners.pointerup, { once: true });
    target.addEventListener('pointercancel', listeners.pointercancel, { once: true });

    return () => {
      if (!isActive) {
        return;
      }

      isActive = false;
      target.removeEventListener('pointermove', listeners.pointermove);
      target.removeEventListener('pointerup', listeners.pointerup);
      target.removeEventListener('pointercancel', listeners.pointercancel);
    };
  }

  export function shouldCommitTimelineSeekOnPointerEnd(
    type: OcrTimelinePointerEndType,
    dragType: OcrTimelineDragType | null,
  ): boolean {
    return type === 'pointerup' && dragType === 'seek';
  }

  export function shouldCancelTimelineSeekOnPointerEnd(
    type: OcrTimelinePointerEndType,
    dragType: OcrTimelineDragType | null,
    hasPointerEvent: boolean,
  ): boolean {
    return dragType === 'seek' && (!hasPointerEvent || !shouldCommitTimelineSeekOnPointerEnd(type, dragType));
  }

  export function shouldSyncTimelinePlaybackFromCurrentTime(isSeekDragging: boolean): boolean {
    return !isSeekDragging;
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { OcrZoneRole, VideoOcrSelection } from '$lib/types';
  import type { OcrTimelineViewport } from '$lib/utils';
  import {
    assignOcrTimelineLanes,
    cn,
    createOcrTimelineMinorTicks,
    createOcrTimelineTicks,
    createOcrTimelineViewport,
    getOcrTimelineWheelIntent,
    panOcrTimelineViewport,
    zoomOcrTimelineViewport,
  } from '$lib/utils';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  interface OcrTimelineProps {
    selection: VideoOcrSelection;
    durationMs: number;
    currentTimeMs: number;
    selectedSegmentId?: string | null;
    selectedZoneId?: string | null;
    onSelect?: (segmentId: string, zoneId: string) => void;
    onPreviewSeek?: (timeMs: number) => void;
    onSeek?: (timeMs: number) => void;
    onCancelSeek?: () => void;
    onSetRole?: (segmentId: string, zoneId: string, role: OcrZoneRole) => void;
    onRenameZone?: (segmentId: string, zoneId: string, label: string) => void;
    onDeleteZone?: (segmentId: string, zoneId: string) => void;
    onTrimSegment?: (segmentId: string, startTimeMs: number, endTimeMs: number) => void;
  }

  interface RoleConfig {
    role: OcrZoneRole;
    label: string;
    emptyLabel: string;
    blockClass: string;
  }

  interface RoleBlock {
    id: string;
    segmentId: string;
    zoneId: string;
    label: string;
    startTimeMs: number;
    endTimeMs: number;
  }

  const TIMELINE_LANE_HEIGHT_PX = 28;
  const TIMELINE_LANE_GAP_PX = 10;
  const TIMELINE_TRACK_PAD_PX = 6;
  const TIMELINE_RULER_HEIGHT_PX = 18;

  type TimelineDrag =
    | { type: 'seek'; trackEl: HTMLElement }
    | {
        type: 'move';
        trackEl: HTMLElement;
        segmentId: string;
        durationMs: number;
        offsetMs: number;
      }
    | {
        type: 'trim-start' | 'trim-end';
        trackEl: HTMLElement;
        segmentId: string;
        startTimeMs: number;
        endTimeMs: number;
      };

  let {
    selection,
    durationMs,
    currentTimeMs,
    selectedSegmentId = null,
    selectedZoneId = null,
    onSelect,
    onPreviewSeek,
    onSeek,
    onCancelSeek,
    onSetRole,
    onRenameZone,
    onDeleteZone,
    onTrimSegment,
  }: OcrTimelineProps = $props();

  let activeDrag: TimelineDrag | null = null;
  let cleanupDragListeners: (() => void) | null = null;
  let editingLabel = $state<{ segmentId: string; zoneId: string; value: string } | null>(null);
  let timelineRootEl = $state<HTMLDivElement | null>(null);
  let playbackTimeLabelEl = $state<HTMLSpanElement | null>(null);
  let labelInputEl = $state<HTMLInputElement | null>(null);
  let focusedLabelKey: string | null = null;
  let timelineViewport = $state<OcrTimelineViewport>({ startTimeMs: 0, endTimeMs: 1 });
  let lastDurationMs = 0;
  let latestPlaybackTimeMs = 0;
  let latestPlaybackTimeLabel = '';

  const roles: RoleConfig[] = [
    {
      role: 'main_subtitle',
      label: 'Main subtitle',
      emptyLabel: 'No subtitle zones',
      blockClass: 'border-sky-500/70 bg-sky-500/15 text-sky-950 dark:text-sky-100',
    },
    {
      role: 'on_screen_text',
      label: 'On-screen text',
      emptyLabel: 'No on-screen text zones',
      blockClass: 'border-amber-500/70 bg-amber-500/15 text-amber-950 dark:text-amber-100',
    },
  ];

  const safeDurationMs = $derived(Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1);
  const segmentCount = $derived(selection.segments.length);
  const visibleViewport = $derived(
    createOcrTimelineViewport(
      safeDurationMs,
      timelineViewport.startTimeMs,
      timelineViewport.endTimeMs - timelineViewport.startTimeMs,
    ),
  );
  const viewportWindowMs = $derived(visibleViewport.endTimeMs - visibleViewport.startTimeMs);
  const timelineTicks = $derived(createOcrTimelineTicks(visibleViewport));
  const timelineMinorTicks = $derived(createOcrTimelineMinorTicks(visibleViewport));
  const hasOnScreenTextZones = $derived(
    selection.segments.some((segment) =>
      segment.zones.some((zone) => zone.role === 'on_screen_text'),
    ),
  );
  const visibleRoles = $derived(
    hasOnScreenTextZones
      ? roles
      : roles.filter((roleConfig) => roleConfig.role === 'main_subtitle'),
  );
  const roleGridClass = $derived(hasOnScreenTextZones ? 'grid-rows-2' : 'grid-rows-1');

  $effect(() => {
    if (lastDurationMs === safeDurationMs) {
      return;
    }

    lastDurationMs = safeDurationMs;
    timelineViewport = createOcrTimelineViewport(safeDurationMs);
  });

  $effect(() => {
    if (!shouldSyncTimelinePlaybackFromCurrentTime(activeDrag?.type === 'seek')) {
      return;
    }

    syncTimelinePlaybackDom(currentTimeMs);
  });

  $effect(() => {
    visibleViewport;
    timelineRootEl;
    if (!shouldSyncTimelinePlaybackFromCurrentTime(activeDrag?.type === 'seek')) {
      return;
    }

    syncTimelinePlaybackDom(latestPlaybackTimeMs);
  });

  function blocksForRole(role: OcrZoneRole): RoleBlock[] {
    return selection.segments.flatMap((segment) =>
      segment.zones
        .filter((zone) => zone.role === role)
        .map((zone, zoneIndex) => ({
          id: `${segment.id}:${zone.id}`,
          segmentId: segment.id,
          zoneId: zone.id,
          label: zone.label ?? `Zone ${zoneIndex + 1}`,
          startTimeMs: segment.startTimeMs,
          endTimeMs: segment.endTimeMs,
        })),
    );
  }

  function viewportPercentage(timeMs: number): number {
    return Math.max(0, Math.min(100, ((timeMs - visibleViewport.startTimeMs) / viewportWindowMs) * 100));
  }

  function playbackTimeInViewport(timeMs: number): boolean {
    return timeMs >= visibleViewport.startTimeMs && timeMs <= visibleViewport.endTimeMs;
  }

  function clampPlaybackTimeMs(timeMs: number): number {
    return Number.isFinite(timeMs)
      ? Math.max(0, Math.min(Math.round(timeMs), safeDurationMs))
      : 0;
  }

  function playheadStyle(timeMs: number): string {
    const safeTimeMs = clampPlaybackTimeMs(timeMs);
    const display = playbackTimeInViewport(safeTimeMs) ? '' : 'display: none;';
    return `${display} left: ${viewportPercentage(safeTimeMs)}%;`;
  }

  function syncTimelinePlaybackDom(timeMs: number): void {
    const safeTimeMs = clampPlaybackTimeMs(timeMs);
    const valuemax = String(safeDurationMs);
    const valuenow = String(safeTimeMs);
    const playheadDisplay = playbackTimeInViewport(safeTimeMs) ? '' : 'none';
    const playheadLeft = `${viewportPercentage(safeTimeMs)}%`;
    const nextTimeLabel = formatTime(safeTimeMs);

    latestPlaybackTimeMs = safeTimeMs;
    if (playbackTimeLabelEl && latestPlaybackTimeLabel !== nextTimeLabel) {
      playbackTimeLabelEl.dataset.timeLabel = nextTimeLabel;
      playbackTimeLabelEl.setAttribute('aria-label', nextTimeLabel);
      latestPlaybackTimeLabel = nextTimeLabel;
    }

    const tracks = timelineRootEl?.querySelectorAll<HTMLElement>('[data-timeline-track="true"]') ?? [];
    for (const track of tracks) {
      track.setAttribute('aria-valuemax', valuemax);
      track.setAttribute('aria-valuenow', valuenow);

      const playheads = track.querySelectorAll<HTMLElement>('[data-timeline-playhead="true"]');
      for (const playhead of playheads) {
        playhead.style.display = playheadDisplay;
        playhead.style.left = playheadLeft;
      }
    }
  }

  export function syncPlaybackTime(timeMs: number): void {
    syncTimelinePlaybackDom(timeMs);
  }

  function blockOverlapsViewport(block: RoleBlock): boolean {
    return block.endTimeMs > visibleViewport.startTimeMs && block.startTimeMs < visibleViewport.endTimeMs;
  }

  function blockStartPercentage(block: RoleBlock): number {
    return viewportPercentage(Math.max(block.startTimeMs, visibleViewport.startTimeMs));
  }

  function blockWidthPercentage(block: RoleBlock): number {
    const visibleStartTimeMs = Math.max(block.startTimeMs, visibleViewport.startTimeMs);
    const visibleEndTimeMs = Math.min(block.endTimeMs, visibleViewport.endTimeMs);
    return Math.max(1.5, viewportPercentage(visibleEndTimeMs) - viewportPercentage(visibleStartTimeMs));
  }

  function formatTime(timeMs: number): string {
    const safeTimeMs = Math.max(0, Math.round(timeMs));
    const totalSeconds = Math.floor(safeTimeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function timelineTrackStyle(laneCount: number): string {
    const contentMinHeight =
      TIMELINE_RULER_HEIGHT_PX
      + TIMELINE_TRACK_PAD_PX * 2
      + laneCount * TIMELINE_LANE_HEIGHT_PX
      + Math.max(0, laneCount - 1) * TIMELINE_LANE_GAP_PX;

    return [
      `--lane-count: ${laneCount}`,
      `--timeline-lane-height: ${TIMELINE_LANE_HEIGHT_PX}px`,
      `--timeline-lane-gap: ${TIMELINE_LANE_GAP_PX}px`,
      `--timeline-track-min-height: ${contentMinHeight}px`,
      `--timeline-track-pad: ${TIMELINE_TRACK_PAD_PX}px`,
      `--timeline-ruler-height: ${TIMELINE_RULER_HEIGHT_PX}px`,
    ].join('; ');
  }

  function laneSeparatorIndexes(laneCount: number): number[] {
    return Array.from({ length: Math.max(0, laneCount - 1) }, (_, laneIndex) => laneIndex + 1);
  }

  function startLabelEditing(event: MouseEvent, block: RoleBlock): void {
    event.preventDefault();
    event.stopPropagation();
    activeDrag = null;
    editingLabel = {
      segmentId: block.segmentId,
      zoneId: block.zoneId,
      value: block.label,
    };
    onSelect?.(block.segmentId, block.zoneId);
  }

  function cancelLabelEditing(): void {
    editingLabel = null;
    focusedLabelKey = null;
  }

  function commitLabelEditing(): void {
    if (!editingLabel) {
      return;
    }

    const nextLabel = editingLabel.value.trim();
    if (nextLabel) {
      onRenameZone?.(editingLabel.segmentId, editingLabel.zoneId, nextLabel);
    }
    editingLabel = null;
    focusedLabelKey = null;
  }

  function handleLabelInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitLabelEditing();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelLabelEditing();
    }
  }

  $effect(() => {
    if (!editingLabel || !labelInputEl) {
      return;
    }

    const labelKey = `${editingLabel.segmentId}:${editingLabel.zoneId}`;
    if (focusedLabelKey === labelKey) {
      return;
    }

    focusedLabelKey = labelKey;
    labelInputEl.focus();
    labelInputEl.select();
  });

  function timeFromPointer(event: PointerEvent | WheelEvent, trackEl: HTMLElement): number {
    const rect = trackEl.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    return Math.round(visibleViewport.startTimeMs + Math.max(0, Math.min(1, ratio)) * viewportWindowMs);
  }

  function previewSeek(timeMs: number): void {
    const safeTimeMs = clampPlaybackTimeMs(timeMs);
    syncTimelinePlaybackDom(safeTimeMs);
    (onPreviewSeek ?? onSeek)?.(safeTimeMs);
  }

  function attachActiveDragListeners(): void {
    cleanupActiveDragListeners();
    cleanupDragListeners = attachOcrTimelineDragListeners(window, {
      pointermove: handlePointerMove as EventListener,
      pointerup: commitDrag as EventListener,
      pointercancel: cancelDrag as EventListener,
    });
  }

  function cleanupActiveDragListeners(): void {
    cleanupDragListeners?.();
    cleanupDragListeners = null;
  }

  function handleTimelineWheel(event: WheelEvent): void {
    if (!(event.currentTarget instanceof HTMLElement)) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const intent = getOcrTimelineWheelIntent({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      viewportWindowMs,
      durationMs: safeDurationMs,
      trackWidth: rect.width,
    });

    if (intent.type === 'none') {
      return;
    }

    event.preventDefault();

    if (intent.type === 'pan') {
      timelineViewport = panOcrTimelineViewport(visibleViewport, safeDurationMs, intent.deltaTimeMs);
      return;
    }

    const anchorTimeMs = timeFromPointer(event, event.currentTarget);
    timelineViewport = zoomOcrTimelineViewport(visibleViewport, safeDurationMs, anchorTimeMs, intent.zoomFactor);
  }

  function startSeek(event: PointerEvent): void {
    if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) {
      return;
    }

    const currentEl = event.currentTarget;
    const trackEl = currentEl.matches('[data-timeline-track="true"]')
      ? currentEl
      : currentEl.closest('[data-timeline-track="true"]');
    if (!(trackEl instanceof HTMLElement)) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (currentEl === trackEl && target?.closest('[data-timeline-control="true"]')) {
      return;
    }

    event.preventDefault();
    activeDrag = { type: 'seek', trackEl };
    previewSeek(timeFromPointer(event, trackEl));
    attachActiveDragListeners();
  }

  function startMove(event: PointerEvent, block: RoleBlock): void {
    if (event.button !== 0) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-timeline-handle="true"]')) {
      return;
    }

    const trackEl = event.currentTarget instanceof HTMLElement
      ? event.currentTarget.closest('[data-timeline-track="true"]')
      : null;
    if (!(trackEl instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const pointerTimeMs = timeFromPointer(event, trackEl);
    activeDrag = {
      type: 'move',
      trackEl,
      segmentId: block.segmentId,
      durationMs: Math.max(1, block.endTimeMs - block.startTimeMs),
      offsetMs: pointerTimeMs - block.startTimeMs,
    };
    onSelect?.(block.segmentId, block.zoneId);
    attachActiveDragListeners();
  }

  function startTrim(event: PointerEvent, block: RoleBlock, edge: 'start' | 'end'): void {
    if (event.button !== 0) {
      return;
    }

    const trackEl = event.currentTarget instanceof HTMLElement
      ? event.currentTarget.closest('[data-timeline-track="true"]')
      : null;
    if (!(trackEl instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    activeDrag = {
      type: edge === 'start' ? 'trim-start' : 'trim-end',
      trackEl,
      segmentId: block.segmentId,
      startTimeMs: block.startTimeMs,
      endTimeMs: block.endTimeMs,
    };
    attachActiveDragListeners();
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!activeDrag) {
      return;
    }

    const timeMs = timeFromPointer(event, activeDrag.trackEl);
    if (activeDrag.type === 'seek') {
      previewSeek(timeMs);
      return;
    }

    if (activeDrag.type === 'move') {
      const maxStartTimeMs = Math.max(0, safeDurationMs - activeDrag.durationMs);
      const nextStartTimeMs = Math.max(0, Math.min(timeMs - activeDrag.offsetMs, maxStartTimeMs));
      const nextEndTimeMs = nextStartTimeMs + activeDrag.durationMs;
      onTrimSegment?.(activeDrag.segmentId, nextStartTimeMs, nextEndTimeMs);
      onSeek?.(nextStartTimeMs);
      return;
    }

    if (activeDrag.type === 'trim-start') {
      const nextStartTimeMs = Math.max(0, Math.min(timeMs, activeDrag.endTimeMs - 1));
      onTrimSegment?.(activeDrag.segmentId, nextStartTimeMs, activeDrag.endTimeMs);
      onSeek?.(nextStartTimeMs);
      return;
    }

    const nextEndTimeMs = Math.max(activeDrag.startTimeMs + 1, Math.min(timeMs, safeDurationMs));
    onTrimSegment?.(activeDrag.segmentId, activeDrag.startTimeMs, nextEndTimeMs);
    onSeek?.(nextEndTimeMs);
  }

  function commitDrag(event: PointerEvent): void {
    stopDrag(event, 'pointerup');
  }

  function cancelDrag(event: PointerEvent): void {
    stopDrag(event, 'pointercancel');
  }

  function stopDrag(event: PointerEvent | undefined, type: OcrTimelinePointerEndType): void {
    const finishedDrag = activeDrag;
    activeDrag = null;
    cleanupActiveDragListeners();

    if (finishedDrag?.type !== 'seek') {
      return;
    }

    if (event && shouldCommitTimelineSeekOnPointerEnd(type, finishedDrag.type)) {
      onSeek?.(timeFromPointer(event, finishedDrag.trackEl));
      return;
    }

    if (shouldCancelTimelineSeekOnPointerEnd(type, finishedDrag.type, Boolean(event))) {
      syncTimelinePlaybackDom(currentTimeMs);
      onCancelSeek?.();
    }
  }

  function handleTrackKeydown(event: KeyboardEvent): void {
    if (!onSeek) {
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      onSeek(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      onSeek(safeDurationMs);
      return;
    }

    const stepMs = event.shiftKey ? 5_000 : 1_000;
    const baseTimeMs = latestPlaybackTimeMs;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onSeek(Math.max(0, baseTimeMs - stepMs));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onSeek(Math.min(safeDurationMs, baseTimeMs + stepMs));
    }
  }

  onDestroy(() => stopDrag(undefined, 'pointercancel'));
</script>

<div bind:this={timelineRootEl} class="flex h-full min-h-0 flex-col rounded-xl border bg-background/55 p-2.5">
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div class="flex shrink-0 items-center justify-between gap-2 px-0.5">
      <h3 class="text-sm font-semibold leading-none text-foreground">OCR timeline</h3>
      <div class="flex items-center gap-1.5">
        <Badge variant="secondary" class="h-5 rounded-full px-2 text-[11px]">{segmentCount} segments</Badge>
        <Badge variant="outline" class="h-5 rounded-full px-2 text-[11px]">
          <span
            bind:this={playbackTimeLabelEl}
            class="timeline-time-label"
            data-time-label={formatTime(currentTimeMs)}
            role="timer"
            aria-label={formatTime(currentTimeMs)}
          ></span>
        </Badge>
      </div>
    </div>

    <div class={`grid min-h-0 flex-1 ${roleGridClass} gap-2`}>
      {#each visibleRoles as roleConfig (roleConfig.role)}
        {@const blocks = assignOcrTimelineLanes(blocksForRole(roleConfig.role).filter(blockOverlapsViewport))}
        {@const laneCount = Math.max(1, ...blocks.map((block) => block.lane + 1))}
        <section class="flex min-h-0 flex-col gap-1">
          <div class="shrink-0 text-[11px] font-semibold leading-none text-muted-foreground">{roleConfig.label}</div>
          <ScrollArea class="min-h-0 flex-1 rounded-lg border bg-background/45" scrollbarYClasses="hidden">
            <div
              class="timeline-track relative min-w-full"
              data-timeline-track="true"
              role="slider"
              tabindex="0"
              aria-label={`${roleConfig.label} playback position`}
              aria-valuemin="0"
              aria-valuemax={safeDurationMs}
              aria-valuenow={Math.round(Math.max(0, Math.min(safeDurationMs, currentTimeMs)))}
              style={timelineTrackStyle(laneCount)}
              onpointerdown={startSeek}
              onkeydown={handleTrackKeydown}
              onwheel={handleTimelineWheel}
            >
              <div
                class="timeline-ruler pointer-events-none sticky top-0 z-20 h-[var(--timeline-ruler-height)] border-b bg-background/95 shadow-[0_1px_0_hsl(var(--border)/0.8)]"
              >
                {#each timelineMinorTicks as tick (tick.timeMs)}
                  <div
                    class="absolute bottom-0 h-2.5 w-px bg-border/50"
                    style={`left: ${viewportPercentage(tick.timeMs)}%;`}
                  ></div>
                {/each}
                {#each timelineTicks as tick (tick.timeMs)}
                  <div
                    class="absolute bottom-0 top-1 w-px bg-border/80"
                    style={`left: ${viewportPercentage(tick.timeMs)}%;`}
                  >
                    <span class="absolute left-1 top-0 whitespace-nowrap text-[10px] font-medium leading-none text-muted-foreground">
                      {tick.label}
                    </span>
                  </div>
                {/each}
              </div>
              {#each laneSeparatorIndexes(laneCount) as laneIndex (laneIndex)}
                <div
                  class="timeline-lane-separator pointer-events-none absolute left-0 right-0 h-px bg-border"
                  style={`--lane-separator-index: ${laneIndex};`}
                ></div>
              {/each}
              {#if blocks.length === 0}
                <div
                  class="absolute bottom-0 left-0 right-0 top-[var(--timeline-ruler-height)] flex items-center px-3 text-xs text-muted-foreground"
                >
                  {roleConfig.emptyLabel}
                </div>
              {/if}
              {#each blocks as block (block.id)}
                {@const left = blockStartPercentage(block)}
                {@const width = blockWidthPercentage(block)}
                <ContextMenu.Root>
                  <ContextMenu.Trigger>
                    {#if editingLabel?.segmentId === block.segmentId && editingLabel.zoneId === block.zoneId}
                      <div
                        data-timeline-control="true"
                        class={cn(
                          'timeline-block absolute overflow-hidden rounded-lg border px-2 text-left text-xs font-medium shadow-sm ring-2 ring-ring ring-offset-1 ring-offset-background',
                          roleConfig.blockClass,
                        )}
                        style={`--lane: ${block.lane}; left: ${left}%; width: ${width}%;`}
                      >
                        <Input
                          bind:ref={labelInputEl}
                          data-timeline-control="true"
                          class="h-full min-w-0 border-0 bg-transparent px-0 text-xs font-medium shadow-none focus-visible:ring-0"
                          value={editingLabel.value}
                          oninput={(event) => {
                            editingLabel = editingLabel
                              ? { ...editingLabel, value: event.currentTarget.value }
                              : null;
                          }}
                          onkeydown={handleLabelInputKeydown}
                          onblur={cancelLabelEditing}
                          onclick={(event) => event.stopPropagation()}
                          onpointerdown={(event) => event.stopPropagation()}
                        />
                      </div>
                    {:else}
                      <button
                        type="button"
                        data-timeline-control="true"
                        class={cn(
                          'timeline-block absolute cursor-grab overflow-hidden rounded-lg border px-2 text-left text-xs font-medium shadow-sm transition-colors hover:bg-accent active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          roleConfig.blockClass,
                          selectedSegmentId === block.segmentId && selectedZoneId === block.zoneId
                            && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
                        )}
                        style={`--lane: ${block.lane}; left: ${left}%; width: ${width}%;`}
                        title={`${block.label} ${formatTime(block.startTimeMs)}-${formatTime(block.endTimeMs)}`}
                        onpointerdown={(event) => startMove(event, block)}
                        ondblclick={(event) => startLabelEditing(event, block)}
                        onclick={() => onSelect?.(block.segmentId, block.zoneId)}
                      >
                        <span
                          data-timeline-control="true"
                          data-timeline-handle="true"
                          class="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-foreground/15 opacity-0 transition-opacity hover:opacity-100"
                          role="presentation"
                          onpointerdown={(event) => startTrim(event, block, 'start')}
                        ></span>
                        <span class="block truncate">{block.label}</span>
                        <span
                          data-timeline-control="true"
                          data-timeline-handle="true"
                          class="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-foreground/15 opacity-0 transition-opacity hover:opacity-100"
                          role="presentation"
                          onpointerdown={(event) => startTrim(event, block, 'end')}
                        ></span>
                      </button>
                    {/if}
                  </ContextMenu.Trigger>
                  <ContextMenu.Content>
                    {#if roleConfig.role !== 'main_subtitle'}
                      <ContextMenu.Item onclick={() => onSetRole?.(block.segmentId, block.zoneId, 'main_subtitle')}>
                        Set as Main subtitle
                      </ContextMenu.Item>
                    {/if}
                    {#if roleConfig.role !== 'on_screen_text'}
                      <ContextMenu.Item onclick={() => onSetRole?.(block.segmentId, block.zoneId, 'on_screen_text')}>
                        Set as On-screen text
                      </ContextMenu.Item>
                    {/if}
                    <ContextMenu.Separator />
                    <ContextMenu.Item
                      variant="destructive"
                      onclick={() => onDeleteZone?.(block.segmentId, block.zoneId)}
                    >
                      Delete zone
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Root>
              {/each}
              <div
                data-timeline-playhead="true"
                class="pointer-events-none absolute bottom-[var(--timeline-track-pad)] top-[calc(var(--timeline-ruler-height)+var(--timeline-track-pad))] w-0.5 -translate-x-1/2 rounded-sm bg-foreground shadow-[0_0_0_3px_hsl(var(--foreground)/0.12)]"
                style={playheadStyle(currentTimeMs)}
                aria-label="Current playback position"
              ></div>
              <button
                type="button"
                data-timeline-control="true"
                data-timeline-playhead="true"
                class="absolute bottom-[var(--timeline-track-pad)] top-[calc(var(--timeline-ruler-height)+var(--timeline-track-pad))] w-2 -translate-x-1/2 cursor-grab rounded-xs border border-foreground/15 bg-background/35 shadow-sm active:cursor-grabbing"
                style={playheadStyle(currentTimeMs)}
                aria-label="Drag playback position"
                title="Drag playback position"
                onpointerdown={startSeek}
              ></button>
            </div>
          </ScrollArea>
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .timeline-track {
    --timeline-lane-step: calc(var(--timeline-lane-height) + var(--timeline-lane-gap));
    height: 100%;
    min-height: var(--timeline-track-min-height);
  }

  .timeline-lane-separator {
    top: calc(
      var(--timeline-ruler-height)
      +
      var(--timeline-track-pad)
      + (var(--lane-separator-index) * var(--timeline-lane-step))
      - (var(--timeline-lane-gap) / 2)
    );
  }

  .timeline-block {
    top: calc(
      var(--timeline-ruler-height)
      + var(--timeline-track-pad)
      + (var(--lane) * var(--timeline-lane-step))
    );
    height: var(--timeline-lane-height);
    line-height: var(--timeline-lane-height);
  }

  .timeline-time-label::before {
    content: attr(data-time-label);
  }
</style>
