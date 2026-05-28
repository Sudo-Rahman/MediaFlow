<script lang="ts" module>
  export interface OcrTimelineApi {
    syncPlaybackTime: (timeMs: number) => void;
  }

  export type OcrTimelinePointerEndType = 'pointerup' | 'pointercancel';
  export type OcrTimelineDragType = 'seek' | 'move' | 'trim-start' | 'trim-end';

  export type OcrTimelineSegmentEditDrag =
    | {
        type: 'move';
        segmentId: string;
        startTimeMs: number;
        endTimeMs: number;
        durationMs: number;
        offsetMs: number;
      }
    | {
        type: 'trim-start' | 'trim-end';
        segmentId: string;
        startTimeMs: number;
        endTimeMs: number;
      };

  export interface OcrTimelineSegmentEdit {
    segmentId: string;
    startTimeMs: number;
    endTimeMs: number;
    seekTimeMs: number;
  }

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

  export interface OcrTimelineAutoPanInput {
    pointerClientX: number;
    trackLeft: number;
    trackWidth: number;
    viewportWindowMs: number;
    durationMs: number;
  }

  export interface OcrTimelineAutoPanIntent {
    direction: -1 | 0 | 1;
    pressure: number;
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

  export function getOcrTimelineSegmentEditForPointerTime(
    drag: OcrTimelineSegmentEditDrag,
    pointerTimeMs: number,
    durationMs: number,
  ): OcrTimelineSegmentEdit {
    const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 1;
    const safePointerTimeMs = Number.isFinite(pointerTimeMs)
      ? Math.max(0, Math.min(Math.round(pointerTimeMs), safeDurationMs))
      : 0;

    if (drag.type === 'move') {
      const safeSegmentDurationMs = Number.isFinite(drag.durationMs)
        ? Math.max(1, Math.min(Math.round(drag.durationMs), safeDurationMs))
        : 1;
      const safeOffsetMs = Number.isFinite(drag.offsetMs) ? Math.round(drag.offsetMs) : 0;
      const maxStartTimeMs = Math.max(0, safeDurationMs - safeSegmentDurationMs);
      const startTimeMs = Math.max(0, Math.min(safePointerTimeMs - safeOffsetMs, maxStartTimeMs));

      return {
        segmentId: drag.segmentId,
        startTimeMs,
        endTimeMs: startTimeMs + safeSegmentDurationMs,
        seekTimeMs: startTimeMs,
      };
    }

    const safeStartTimeMs = Number.isFinite(drag.startTimeMs)
      ? Math.max(0, Math.min(Math.round(drag.startTimeMs), safeDurationMs - 1))
      : 0;
    const safeEndTimeMs = Number.isFinite(drag.endTimeMs)
      ? Math.max(safeStartTimeMs + 1, Math.min(Math.round(drag.endTimeMs), safeDurationMs))
      : safeStartTimeMs + 1;

    if (drag.type === 'trim-start') {
      const startTimeMs = Math.max(0, Math.min(safePointerTimeMs, safeEndTimeMs - 1));

      return {
        segmentId: drag.segmentId,
        startTimeMs,
        endTimeMs: safeEndTimeMs,
        seekTimeMs: startTimeMs,
      };
    }

    const endTimeMs = Math.max(safeStartTimeMs + 1, Math.min(safePointerTimeMs, safeDurationMs));

    return {
      segmentId: drag.segmentId,
      startTimeMs: safeStartTimeMs,
      endTimeMs,
      seekTimeMs: endTimeMs,
    };
  }

  export function shouldCommitTimelineSegmentEditOnPointerEnd(
    type: OcrTimelinePointerEndType,
    dragType: OcrTimelineDragType | null,
    hasPointerEvent: boolean,
    hasPreviewEdit: boolean,
  ): boolean {
    return (
      type === 'pointerup'
      && hasPointerEvent
      && hasPreviewEdit
      && (dragType === 'move' || dragType === 'trim-start' || dragType === 'trim-end')
    );
  }

  export function shouldRollbackTimelineSegmentEditOnPointerEnd(
    type: OcrTimelinePointerEndType,
    dragType: OcrTimelineDragType | null,
    hasPreviewEdit: boolean,
  ): boolean {
    return (
      type === 'pointercancel'
      && hasPreviewEdit
      && (dragType === 'move' || dragType === 'trim-start' || dragType === 'trim-end')
    );
  }

  export function getOcrTimelineRollbackSegmentEdit(
    drag: OcrTimelineSegmentEditDrag,
  ): OcrTimelineSegmentEdit {
    return {
      segmentId: drag.segmentId,
      startTimeMs: drag.startTimeMs,
      endTimeMs: drag.endTimeMs,
      seekTimeMs: drag.type === 'trim-end' ? drag.endTimeMs : drag.startTimeMs,
    };
  }

  export function shouldSyncTimelinePlaybackFromCurrentTime(isSeekDragging: boolean): boolean {
    return !isSeekDragging;
  }

  export function getOcrTimelineAutoPanEdgeWidth(trackWidthPx: number): number {
    const safeTrackWidthPx = Number.isFinite(trackWidthPx) ? Math.max(0, trackWidthPx) : 0;
    return Math.max(60, Math.min(150, safeTrackWidthPx * 0.12));
  }

  export function getOcrTimelineAutoPanIntent(input: OcrTimelineAutoPanInput): OcrTimelineAutoPanIntent {
    const trackWidth = Number.isFinite(input.trackWidth) ? Math.max(0, input.trackWidth) : 0;
    const viewportWindowMs = Number.isFinite(input.viewportWindowMs) ? Math.max(1, input.viewportWindowMs) : 1;
    const durationMs = Number.isFinite(input.durationMs) ? Math.max(1, input.durationMs) : 1;

    if (trackWidth <= 0 || viewportWindowMs >= durationMs) {
      return { direction: 0, pressure: 0 };
    }

    const edgeWidth = Math.min(getOcrTimelineAutoPanEdgeWidth(trackWidth), trackWidth / 2);
    const pointerX = Number.isFinite(input.pointerClientX) ? input.pointerClientX : input.trackLeft;
    const localX = pointerX - input.trackLeft;

    if (localX < edgeWidth) {
      return {
        direction: -1,
        pressure: Math.max(0, Math.min(1, (edgeWidth - localX) / edgeWidth)),
      };
    }

    if (localX > trackWidth - edgeWidth) {
      return {
        direction: 1,
        pressure: Math.max(0, Math.min(1, (localX - (trackWidth - edgeWidth)) / edgeWidth)),
      };
    }

    return { direction: 0, pressure: 0 };
  }

  export function formatOcrTimelinePreciseTime(timeMs: number): string {
    const safeTimeMs = Number.isFinite(timeMs) ? Math.max(0, Math.round(timeMs)) : 0;
    const totalSeconds = Math.floor(safeTimeMs / 1000);
    const milliseconds = safeTimeMs % 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    }

    return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }

  export function isValidOcrTimelineCutTime(cutTimeMs: number, startTimeMs: number, endTimeMs: number): boolean {
    if (!Number.isFinite(cutTimeMs) || !Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) {
      return false;
    }

    const safeCutTimeMs = Math.round(cutTimeMs);
    return safeCutTimeMs > Math.round(startTimeMs) && safeCutTimeMs < Math.round(endTimeMs);
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { OcrZoneRole, VideoOcrSelection } from '$lib/types';
  import { assignOcrTimelineRenderedLanes } from '$lib/utils/ocr-selection';
  import type { OcrTimelineViewport } from '$lib/utils';
  import {
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
    onCutZone?: (segmentId: string, zoneId: string, cutTimeMs: number) => void;
    onPreviewTrimSegment?: (segmentId: string, startTimeMs: number, endTimeMs: number) => void;
    onCommitTrimSegment?: (segmentId: string, startTimeMs: number, endTimeMs: number) => void;
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

  interface PendingCutTarget {
    segmentId: string;
    zoneId: string;
    label: string;
    startTimeMs: number;
    endTimeMs: number;
    trackEl: HTMLElement | null;
    pointerTimeMs: number;
    pointerTrackY: number;
  }

  const TIMELINE_LANE_HEIGHT_PX = 28;
  const TIMELINE_LANE_GAP_PX = 10;
  const TIMELINE_TRACK_PAD_PX = 6;
  const TIMELINE_RULER_HEIGHT_PX = 18;
  const TIMELINE_BLOCK_MIN_WIDTH_PERCENT = 1.5;

  type TimelineDrag =
    | { type: 'seek'; trackEl: HTMLElement }
    | (OcrTimelineSegmentEditDrag & { trackEl: HTMLElement });

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
    onCutZone,
    onPreviewTrimSegment,
    onCommitTrimSegment,
  }: OcrTimelineProps = $props();

  let activeDrag: TimelineDrag | null = null;
  let cleanupDragListeners: (() => void) | null = null;
  let latestPointerEvent: PointerEvent | null = null;
  let autoPanAnimationFrame: number | null = null;
  let lastAutoPanFrameTimeMs: number | null = null;
  let lastPreviewSegmentEdit: OcrTimelineSegmentEdit | null = null;
  let editingLabel = $state<{ segmentId: string; zoneId: string; value: string } | null>(null);
  let pendingCutTarget = $state<PendingCutTarget | null>(null);
  let suppressNextCutContextMenu = false;
  let timelineRootEl = $state<HTMLDivElement | null>(null);
  let timelineTrackWidthPx = $state(0);
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
    const rootEl = timelineRootEl;
    if (!rootEl) {
      return;
    }

    updateTimelineTrackWidth();
    const resizeObserver = new ResizeObserver(updateTimelineTrackWidth);
    resizeObserver.observe(rootEl);

    return () => {
      resizeObserver.disconnect();
    };
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

  function updateTimelineTrackWidth(): void {
    const trackEl = timelineRootEl?.querySelector<HTMLElement>('[data-timeline-track="true"]') ?? null;
    const nextWidth = trackEl?.getBoundingClientRect().width ?? 0;
    timelineTrackWidthPx = Number.isFinite(nextWidth) ? Math.max(0, Math.round(nextWidth)) : 0;
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
    return Math.max(
      TIMELINE_BLOCK_MIN_WIDTH_PERCENT,
      viewportPercentage(visibleEndTimeMs) - viewportPercentage(visibleStartTimeMs),
    );
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

  function startPreciseCut(block: RoleBlock): void {
    stopDrag(undefined, 'pointercancel');
    cancelLabelEditing();
    suppressNextCutContextMenu = false;
    onSelect?.(block.segmentId, block.zoneId);

    pendingCutTarget = {
      segmentId: block.segmentId,
      zoneId: block.zoneId,
      label: block.label,
      startTimeMs: block.startTimeMs,
      endTimeMs: block.endTimeMs,
      trackEl: null,
      pointerTimeMs: Math.round((block.startTimeMs + block.endTimeMs) / 2),
      pointerTrackY: TIMELINE_RULER_HEIGHT_PX + TIMELINE_TRACK_PAD_PX,
    };
  }

  function cancelPreciseCut(): void {
    pendingCutTarget = null;
  }

  function hasVisiblePendingCutTarget(target: PendingCutTarget): boolean {
    return selection.segments.some((segment) =>
      segment.id === target.segmentId
      && segment.startTimeMs === target.startTimeMs
      && segment.endTimeMs === target.endTimeMs
      && blockOverlapsViewport({
        id: `${target.segmentId}:${target.zoneId}`,
        segmentId: target.segmentId,
        zoneId: target.zoneId,
        label: target.label,
        startTimeMs: segment.startTimeMs,
        endTimeMs: segment.endTimeMs,
      })
      && segment.zones.some((zone) => zone.id === target.zoneId),
    );
  }

  function updatePreciseCutPointer(event: PointerEvent, trackEl: HTMLElement): void {
    if (!pendingCutTarget) {
      return;
    }

    const rect = trackEl.getBoundingClientRect();
    const pointerTrackY = Number.isFinite(event.clientY)
      ? Math.max(0, Math.min(event.clientY - rect.top, rect.height))
      : pendingCutTarget.pointerTrackY;

    pendingCutTarget = {
      ...pendingCutTarget,
      trackEl,
      pointerTimeMs: timeFromPointer(event, trackEl),
      pointerTrackY,
    };
  }

  function confirmPreciseCut(event?: PointerEvent): void {
    const target = pendingCutTarget;
    if (!target) {
      return;
    }

    if (!hasVisiblePendingCutTarget(target)) {
      cancelPreciseCut();
      return;
    }

    const trackEl = event?.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : target.trackEl;
    const cutTimeMs = trackEl && event
      ? timeFromPointer(event, trackEl)
      : target.pointerTimeMs;

    cancelPreciseCut();
    if (!isValidOcrTimelineCutTime(cutTimeMs, target.startTimeMs, target.endTimeMs)) {
      return;
    }

    onCutZone?.(target.segmentId, target.zoneId, cutTimeMs);
    onSeek?.(cutTimeMs);
  }

  function cutTooltipStyle(target: PendingCutTarget): string {
    const left = viewportPercentage(target.pointerTimeMs);
    const top = Math.max(TIMELINE_RULER_HEIGHT_PX + 4, target.pointerTrackY + 10);

    return `left: ${left}%; top: ${top}px;`;
  }

  function handlePreciseCutPointerMove(event: PointerEvent): void {
    if (!pendingCutTarget || !(event.currentTarget instanceof HTMLElement)) {
      return;
    }

    updatePreciseCutPointer(event, event.currentTarget);
  }

  function handlePreciseCutPointerDown(event: PointerEvent): void {
    if (!pendingCutTarget || !(event.currentTarget instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      suppressNextCutContextMenu = true;
      cancelPreciseCut();
      return;
    }

    if (!hasVisiblePendingCutTarget(pendingCutTarget)) {
      cancelPreciseCut();
      return;
    }

    updatePreciseCutPointer(event, event.currentTarget);
    confirmPreciseCut(event);
  }

  function handlePreciseCutContextMenu(event: MouseEvent): void {
    if (!pendingCutTarget && !suppressNextCutContextMenu) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressNextCutContextMenu = false;
    cancelPreciseCut();
  }

  $effect(() => {
    const target = pendingCutTarget;
    if (!target || hasVisiblePendingCutTarget(target)) {
      return;
    }

    cancelPreciseCut();
  });

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
    startTimelineAutoPan();
  }

  function cleanupActiveDragListeners(): void {
    cleanupDragListeners?.();
    cleanupDragListeners = null;
    stopTimelineAutoPan();
    latestPointerEvent = null;
  }

  function startTimelineAutoPan(): void {
    stopTimelineAutoPan();
    lastAutoPanFrameTimeMs = null;
    autoPanAnimationFrame = requestAnimationFrame(runTimelineAutoPan);
  }

  function stopTimelineAutoPan(): void {
    if (autoPanAnimationFrame !== null) {
      cancelAnimationFrame(autoPanAnimationFrame);
    }
    autoPanAnimationFrame = null;
    lastAutoPanFrameTimeMs = null;
  }

  function runTimelineAutoPan(frameTimeMs: number): void {
    autoPanAnimationFrame = null;
    if (!activeDrag || !latestPointerEvent) {
      return;
    }

    const rect = activeDrag.trackEl.getBoundingClientRect();
    const intent = getOcrTimelineAutoPanIntent({
      pointerClientX: latestPointerEvent.clientX,
      trackLeft: rect.left,
      trackWidth: rect.width,
      viewportWindowMs,
      durationMs: safeDurationMs,
    });

    if (intent.direction !== 0) {
      const elapsedMs = lastAutoPanFrameTimeMs === null ? 16 : Math.max(0, frameTimeMs - lastAutoPanFrameTimeMs);
      const panSpeedMsPerSecond = viewportWindowMs * 0.9;
      const deltaTimeMs = intent.direction * intent.pressure * panSpeedMsPerSecond * (elapsedMs / 1000);
      const nextViewport = panOcrTimelineViewport(visibleViewport, safeDurationMs, deltaTimeMs);

      if (
        nextViewport.startTimeMs !== visibleViewport.startTimeMs
        || nextViewport.endTimeMs !== visibleViewport.endTimeMs
      ) {
        timelineViewport = nextViewport;
        updateActiveDragPreview(latestPointerEvent);
      }
    }

    lastAutoPanFrameTimeMs = frameTimeMs;
    autoPanAnimationFrame = requestAnimationFrame(runTimelineAutoPan);
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
    if (pendingCutTarget) {
      return;
    }

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
    lastPreviewSegmentEdit = null;
    previewSeek(timeFromPointer(event, trackEl));
    attachActiveDragListeners();
    latestPointerEvent = event;
  }

  function startMove(event: PointerEvent, block: RoleBlock): void {
    if (pendingCutTarget) {
      return;
    }

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
      startTimeMs: block.startTimeMs,
      endTimeMs: block.endTimeMs,
      durationMs: Math.max(1, block.endTimeMs - block.startTimeMs),
      offsetMs: pointerTimeMs - block.startTimeMs,
    };
    lastPreviewSegmentEdit = null;
    onSelect?.(block.segmentId, block.zoneId);
    attachActiveDragListeners();
    latestPointerEvent = event;
  }

  function startTrim(event: PointerEvent, block: RoleBlock, edge: 'start' | 'end'): void {
    if (pendingCutTarget) {
      return;
    }

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
    lastPreviewSegmentEdit = null;
    attachActiveDragListeners();
    latestPointerEvent = event;
  }

  function previewSegmentEdit(edit: OcrTimelineSegmentEdit): void {
    lastPreviewSegmentEdit = edit;
    onPreviewTrimSegment?.(edit.segmentId, edit.startTimeMs, edit.endTimeMs);
    onSeek?.(edit.seekTimeMs);
  }

  function updateActiveDragPreview(event: PointerEvent): void {
    if (!activeDrag) {
      return;
    }

    const timeMs = timeFromPointer(event, activeDrag.trackEl);
    if (activeDrag.type === 'seek') {
      previewSeek(timeMs);
      return;
    }

    previewSegmentEdit(getOcrTimelineSegmentEditForPointerTime(activeDrag, timeMs, safeDurationMs));
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!activeDrag) {
      return;
    }

    latestPointerEvent = event;
    updateActiveDragPreview(event);
  }

  function commitDrag(event: PointerEvent): void {
    stopDrag(event, 'pointerup');
  }

  function cancelDrag(event: PointerEvent): void {
    stopDrag(event, 'pointercancel');
  }

  function stopDrag(event: PointerEvent | undefined, type: OcrTimelinePointerEndType): void {
    const finishedDrag = activeDrag;
    const hadPreviewSegmentEdit = lastPreviewSegmentEdit !== null;
    activeDrag = null;
    lastPreviewSegmentEdit = null;
    cleanupActiveDragListeners();

    if (!finishedDrag) {
      return;
    }

    if (finishedDrag.type !== 'seek') {
      if (event && shouldCommitTimelineSegmentEditOnPointerEnd(type, finishedDrag.type, true, hadPreviewSegmentEdit)) {
        const finalEdit = getOcrTimelineSegmentEditForPointerTime(
          finishedDrag,
          timeFromPointer(event, finishedDrag.trackEl),
          safeDurationMs,
        );
        onCommitTrimSegment?.(finalEdit.segmentId, finalEdit.startTimeMs, finalEdit.endTimeMs);
        onSeek?.(finalEdit.seekTimeMs);
      }
      if (shouldRollbackTimelineSegmentEditOnPointerEnd(type, finishedDrag.type, hadPreviewSegmentEdit)) {
        const rollbackEdit = getOcrTimelineRollbackSegmentEdit(finishedDrag);
        onPreviewTrimSegment?.(rollbackEdit.segmentId, rollbackEdit.startTimeMs, rollbackEdit.endTimeMs);
      }
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
    if (event.key === 'Escape' && pendingCutTarget) {
      event.preventDefault();
      cancelPreciseCut();
      return;
    }

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

  onDestroy(() => {
    cancelPreciseCut();
    stopDrag(undefined, 'pointercancel');
  });
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
        {@const blocks = assignOcrTimelineRenderedLanes(
          blocksForRole(roleConfig.role).filter(blockOverlapsViewport),
          {
            viewport: visibleViewport,
            trackWidthPx: timelineTrackWidthPx,
            minWidthPercent: TIMELINE_BLOCK_MIN_WIDTH_PERCENT,
          },
        )}
        {@const laneCount = Math.max(1, ...blocks.map((block) => block.lane + 1))}
        {@const isCutTrack = Boolean(
          pendingCutTarget
            && blocks.some((block) =>
              block.segmentId === pendingCutTarget?.segmentId && block.zoneId === pendingCutTarget.zoneId,
            ),
        )}
        <section class="flex min-h-0 flex-col gap-1">
          <div class="shrink-0 text-[11px] font-semibold leading-none text-muted-foreground">{roleConfig.label}</div>
          <ScrollArea class="min-h-0 flex-1 rounded-lg border bg-background/45" scrollbarYClasses="hidden">
            <div
              class={cn('timeline-track relative min-w-full', isCutTrack && 'cursor-col-resize')}
              data-timeline-track="true"
              role="slider"
              tabindex="0"
              aria-label={`${roleConfig.label} playback position`}
              aria-valuemin="0"
              aria-valuemax={safeDurationMs}
              aria-valuenow={Math.round(Math.max(0, Math.min(safeDurationMs, currentTimeMs)))}
              style={timelineTrackStyle(laneCount)}
              onpointerdown={(event) => pendingCutTarget ? handlePreciseCutPointerDown(event) : startSeek(event)}
              onpointermove={handlePreciseCutPointerMove}
              onpointercancel={cancelPreciseCut}
              onkeydown={handleTrackKeydown}
              onwheel={handleTimelineWheel}
              oncontextmenu={handlePreciseCutContextMenu}
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
              {#if pendingCutTarget && isCutTrack}
                <div
                  class="pointer-events-none absolute bottom-[var(--timeline-track-pad)] top-[calc(var(--timeline-ruler-height)+var(--timeline-track-pad))] z-30 w-0.5 -translate-x-1/2 bg-foreground shadow-[0_0_0_3px_hsl(var(--foreground)/0.12)]"
                  style={`left: ${viewportPercentage(pendingCutTarget.pointerTimeMs)}%;`}
                ></div>
                <div
                  class="pointer-events-none absolute z-40 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground shadow-md"
                  style={cutTooltipStyle(pendingCutTarget)}
                >
                  {formatOcrTimelinePreciseTime(pendingCutTarget.pointerTimeMs)}
                </div>
              {/if}
              {#each blocks as block (block.id)}
                {@const left = blockStartPercentage(block)}
                {@const width = blockWidthPercentage(block)}
                {@const isPendingCutBlock = pendingCutTarget?.segmentId === block.segmentId && pendingCutTarget.zoneId === block.zoneId}
                <ContextMenu.Root>
                  <ContextMenu.Trigger>
                    {#if editingLabel && editingLabel.segmentId === block.segmentId && editingLabel.zoneId === block.zoneId}
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
                          'timeline-block absolute overflow-hidden rounded-lg border px-2 text-left text-xs font-medium shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          pendingCutTarget ? 'cursor-col-resize' : 'cursor-grab active:cursor-grabbing',
                          roleConfig.blockClass,
                          ((selectedSegmentId === block.segmentId && selectedZoneId === block.zoneId) || isPendingCutBlock)
                            && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
                        )}
                        style={`--lane: ${block.lane}; left: ${left}%; width: ${width}%;`}
                        title={`${block.label} ${formatTime(block.startTimeMs)}-${formatTime(block.endTimeMs)}`}
                        onpointerdown={(event) => startMove(event, block)}
                        oncontextmenu={handlePreciseCutContextMenu}
                        ondblclick={(event) => startLabelEditing(event, block)}
                        onclick={() => onSelect?.(block.segmentId, block.zoneId)}
                      >
                        <span
                          data-timeline-control="true"
                          data-timeline-handle="true"
                          class={cn(
                            'absolute inset-y-0 left-0 w-2 bg-foreground/15 opacity-0 transition-opacity hover:opacity-100',
                            pendingCutTarget ? 'cursor-col-resize' : 'cursor-ew-resize',
                          )}
                          role="presentation"
                          onpointerdown={(event) => startTrim(event, block, 'start')}
                        ></span>
                        <span class="block truncate">{block.label}</span>
                        <span
                          data-timeline-control="true"
                          data-timeline-handle="true"
                          class={cn(
                            'absolute inset-y-0 right-0 w-2 bg-foreground/15 opacity-0 transition-opacity hover:opacity-100',
                            pendingCutTarget ? 'cursor-col-resize' : 'cursor-ew-resize',
                          )}
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
                    <ContextMenu.Item onclick={() => startPreciseCut(block)}>
                      Cut
                    </ContextMenu.Item>
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
