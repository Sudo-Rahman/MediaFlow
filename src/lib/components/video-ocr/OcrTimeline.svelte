<script lang="ts">
  import type { OcrZoneRole, VideoOcrSelection } from '$lib/types';
  import { assignOcrTimelineLanes, cn } from '$lib/utils';
  import { Badge } from '$lib/components/ui/badge';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  interface OcrTimelineProps {
    selection: VideoOcrSelection;
    durationMs: number;
    currentTimeMs: number;
    selectedSegmentId?: string | null;
    selectedZoneId?: string | null;
    onSelect?: (segmentId: string, zoneId: string) => void;
    onSeek?: (timeMs: number) => void;
    onSetRole?: (segmentId: string, zoneId: string, role: OcrZoneRole) => void;
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
    onSeek,
    onSetRole,
    onDeleteZone,
    onTrimSegment,
  }: OcrTimelineProps = $props();

  let activeDrag: TimelineDrag | null = null;

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

  function percentage(timeMs: number): number {
    return Math.max(0, Math.min(100, (timeMs / safeDurationMs) * 100));
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
      TIMELINE_TRACK_PAD_PX * 2
      + laneCount * TIMELINE_LANE_HEIGHT_PX
      + Math.max(0, laneCount - 1) * TIMELINE_LANE_GAP_PX;

    return [
      `--lane-count: ${laneCount}`,
      `--timeline-lane-height: ${TIMELINE_LANE_HEIGHT_PX}px`,
      `--timeline-lane-gap: ${TIMELINE_LANE_GAP_PX}px`,
      `--timeline-track-min-height: ${contentMinHeight}px`,
      `--timeline-track-pad: ${TIMELINE_TRACK_PAD_PX}px`,
    ].join('; ');
  }

  function laneSeparatorIndexes(laneCount: number): number[] {
    return Array.from({ length: Math.max(0, laneCount - 1) }, (_, laneIndex) => laneIndex + 1);
  }

  function timeFromPointer(event: PointerEvent, trackEl: HTMLElement): number {
    const rect = trackEl.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    return Math.round(Math.max(0, Math.min(1, ratio)) * safeDurationMs);
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
    onSeek?.(timeFromPointer(event, trackEl));
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDrag, { once: true });
    window.addEventListener('pointercancel', stopDrag, { once: true });
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
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDrag, { once: true });
    window.addEventListener('pointercancel', stopDrag, { once: true });
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
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDrag, { once: true });
    window.addEventListener('pointercancel', stopDrag, { once: true });
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!activeDrag) {
      return;
    }

    const timeMs = timeFromPointer(event, activeDrag.trackEl);
    if (activeDrag.type === 'seek') {
      onSeek?.(timeMs);
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

  function stopDrag(): void {
    activeDrag = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointercancel', stopDrag);
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
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onSeek(Math.max(0, currentTimeMs - stepMs));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onSeek(Math.min(safeDurationMs, currentTimeMs + stepMs));
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col border-t bg-muted/20 py-2">
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div class="flex shrink-0 items-center justify-between gap-2 px-0.5">
      <h3 class="text-sm font-semibold leading-none text-foreground">OCR timeline</h3>
      <div class="flex items-center gap-1.5">
        <Badge variant="secondary" class="h-5 rounded-full px-2 text-[11px]">{segmentCount} segments</Badge>
        <Badge variant="outline" class="h-5 rounded-full px-2 text-[11px]">{formatTime(currentTimeMs)}</Badge>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 grid-rows-2 gap-2">
      {#each roles as roleConfig (roleConfig.role)}
        {@const blocks = assignOcrTimelineLanes(blocksForRole(roleConfig.role))}
        {@const laneCount = Math.max(1, ...blocks.map((block) => block.lane + 1))}
        <section class="flex min-h-0 flex-col gap-1">
          <div class="shrink-0 text-[11px] font-semibold leading-none text-muted-foreground">{roleConfig.label}</div>
          <ScrollArea class="min-h-0 flex-1 rounded-md border bg-background/45" scrollbarYClasses="hidden">
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
            >
              {#each laneSeparatorIndexes(laneCount) as laneIndex (laneIndex)}
                <div
                  class="timeline-lane-separator pointer-events-none absolute left-0 right-0 h-px bg-border"
                  style={`--lane-separator-index: ${laneIndex};`}
                ></div>
              {/each}
              {#if blocks.length === 0}
                <div class="absolute inset-0 flex items-center px-3 text-xs text-muted-foreground">
                  {roleConfig.emptyLabel}
                </div>
              {/if}
              {#each blocks as block (block.id)}
                {@const left = percentage(block.startTimeMs)}
                {@const width = Math.max(1.5, percentage(block.endTimeMs) - left)}
                <ContextMenu.Root>
                  <ContextMenu.Trigger>
                    <button
                      type="button"
                      data-timeline-control="true"
                      class={cn(
                        'timeline-block absolute cursor-grab overflow-hidden rounded-md border px-2 text-left text-xs font-medium shadow-sm transition-colors hover:bg-accent active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        roleConfig.blockClass,
                        selectedSegmentId === block.segmentId && selectedZoneId === block.zoneId
                          && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
                      )}
                      style={`--lane: ${block.lane}; left: ${left}%; width: ${width}%;`}
                      title={`${block.label} ${formatTime(block.startTimeMs)}-${formatTime(block.endTimeMs)}`}
                      onpointerdown={(event) => startMove(event, block)}
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
                class="pointer-events-none absolute bottom-1 top-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_0_3px_hsl(var(--foreground)/0.12)]"
                style={`left: ${percentage(currentTimeMs)}%`}
                aria-label="Current playback position"
              ></div>
              <button
                type="button"
                data-timeline-control="true"
                class="absolute bottom-1 top-1 w-2 -translate-x-1/2 cursor-grab rounded-full border border-foreground/15 bg-background/35 shadow-sm active:cursor-grabbing"
                style={`left: ${percentage(currentTimeMs)}%`}
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
      var(--timeline-track-pad)
      + (var(--lane-separator-index) * var(--timeline-lane-step))
      - (var(--timeline-lane-gap) / 2)
    );
  }

  .timeline-block {
    top: calc(var(--timeline-track-pad) + (var(--lane) * var(--timeline-lane-step)));
    height: var(--timeline-lane-height);
    line-height: var(--timeline-lane-height);
  }
</style>
