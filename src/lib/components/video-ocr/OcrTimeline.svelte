<script lang="ts">
  import type { OcrZoneRole, VideoOcrSelection } from '$lib/types';
  import { assignOcrTimelineLanes, cn } from '$lib/utils';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
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

  type TimelineDrag =
    | { type: 'seek'; trackEl: HTMLElement }
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

<Card class="min-h-0 overflow-hidden">
  <CardHeader class="px-4 py-3">
    <div class="flex items-center justify-between gap-3">
      <CardTitle class="text-sm">OCR timeline</CardTitle>
      <div class="flex items-center gap-2">
        <Badge variant="secondary">{segmentCount} segments</Badge>
        <Badge variant="outline">{formatTime(currentTimeMs)}</Badge>
      </div>
    </div>
  </CardHeader>
  <CardContent class="space-y-3 px-4 pb-4">
    {#each roles as roleConfig (roleConfig.role)}
      {@const blocks = assignOcrTimelineLanes(blocksForRole(roleConfig.role))}
      {@const laneCount = Math.max(1, ...blocks.map((block) => block.lane + 1))}
      <section class="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
        <div class="pt-2 text-xs font-medium text-muted-foreground">{roleConfig.label}</div>
        <ScrollArea class="h-24 rounded-md border bg-muted/20" scrollbarYClasses="w-2">
          <div
            class="relative min-w-full"
            data-timeline-track="true"
            role="slider"
            tabindex="0"
            aria-label={`${roleConfig.label} playback position`}
            aria-valuemin="0"
            aria-valuemax={safeDurationMs}
            aria-valuenow={Math.round(Math.max(0, Math.min(safeDurationMs, currentTimeMs)))}
            style={`height: ${Math.max(72, laneCount * 30 + 16)}px`}
            onpointerdown={startSeek}
            onkeydown={handleTrackKeydown}
          >
            <div class="absolute left-0 right-0 top-1/2 h-px bg-border"></div>
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
                      'absolute h-6 overflow-hidden rounded-md border px-2 text-left text-xs font-medium shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      roleConfig.blockClass,
                      selectedSegmentId === block.segmentId && selectedZoneId === block.zoneId
                        && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
                    )}
                    style={`left: ${left}%; width: ${width}%; top: ${8 + block.lane * 30}px;`}
                    title={`${block.label} ${formatTime(block.startTimeMs)}-${formatTime(block.endTimeMs)}`}
                    onclick={() => onSelect?.(block.segmentId, block.zoneId)}
                  >
                    <span
                      data-timeline-control="true"
                      class="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-foreground/15 opacity-0 transition-opacity hover:opacity-100"
                      role="presentation"
                      onpointerdown={(event) => startTrim(event, block, 'start')}
                    ></span>
                    <span class="block truncate">{block.label}</span>
                    <span
                      data-timeline-control="true"
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
              class="pointer-events-none absolute bottom-1 top-1 w-px bg-foreground shadow-sm"
              style={`left: ${percentage(currentTimeMs)}%`}
              aria-label="Current playback position"
            ></div>
            <button
              type="button"
              data-timeline-control="true"
              class="absolute bottom-1 top-1 w-3 -translate-x-1/2 cursor-grab rounded-sm border border-foreground/20 bg-foreground/10 shadow-sm active:cursor-grabbing"
              style={`left: ${percentage(currentTimeMs)}%`}
              aria-label="Drag playback position"
              title="Drag playback position"
              onpointerdown={startSeek}
            ></button>
          </div>
        </ScrollArea>
      </section>
    {/each}
  </CardContent>
</Card>
