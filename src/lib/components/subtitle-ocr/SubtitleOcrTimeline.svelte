<script lang="ts">
  import { Minus, Plus } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { SubtitleOcrCue } from '$lib/types';
  import { cn } from '$lib/utils';
  import {
    clampTimelineViewport,
    type TimelineViewport,
  } from './subtitle-ocr-review-state';

  interface SubtitleOcrTimelineProps {
    cues: SubtitleOcrCue[];
    durationMs: number;
    viewportStartMs: number;
    viewportEndMs: number;
    selectedCueStartMs?: number;
    onViewportChange: (startMs: number, endMs: number, source: 'timeline') => void;
  }

  interface DragState {
    pointerId: number;
    startClientX: number;
    trackWidth: number;
    viewportStartMs: number;
    viewportEndMs: number;
  }

  let {
    cues,
    durationMs,
    viewportStartMs,
    viewportEndMs,
    selectedCueStartMs,
    onViewportChange,
  }: SubtitleOcrTimelineProps = $props();

  let trackElement = $state<HTMLDivElement | null>(null);
  let dragState = $state<DragState | null>(null);
  let pendingViewport: TimelineViewport | null = null;
  let viewportFrameId: number | null = null;

  const safeDurationMs = $derived(Math.max(0, Math.round(durationMs)));
  const viewport = $derived(clampTimelineViewport(viewportStartMs, viewportEndMs, safeDurationMs));
  const viewportSpanMs = $derived(Math.max(0, viewport.endMs - viewport.startMs));
  const zoomPercent = $derived(
    safeDurationMs > 0 ? Math.round((viewportSpanMs / safeDurationMs) * 100) : 100,
  );

  $effect(() => {
    return () => {
      if (viewportFrameId !== null) {
        cancelAnimationFrame(viewportFrameId);
      }
    };
  });

  function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
  }

  function toPercent(timeMs: number): number {
    if (safeDurationMs <= 0) {
      return 0;
    }

    return clampPercent((timeMs / safeDurationMs) * 100);
  }

  function getCueWidthPercent(cue: SubtitleOcrCue): number {
    if (safeDurationMs <= 0) {
      return 0;
    }

    const durationPercent = ((cue.endTimeMs - cue.startTimeMs) / safeDurationMs) * 100;
    return Math.max(0.15, durationPercent);
  }

  function formatTime(ms: number): string {
    const safeMs = Math.max(0, Math.round(ms));
    const totalSeconds = Math.floor(safeMs / 1_000);
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function queueViewportChange(startMs: number, endMs: number): void {
    if (safeDurationMs <= 0) {
      return;
    }

    pendingViewport = clampTimelineViewport(startMs, endMs, safeDurationMs);

    if (viewportFrameId !== null) {
      return;
    }

    viewportFrameId = requestAnimationFrame(() => {
      viewportFrameId = null;
      const nextViewport = pendingViewport;
      pendingViewport = null;

      if (!nextViewport) {
        return;
      }

      onViewportChange(nextViewport.startMs, nextViewport.endMs, 'timeline');
    });
  }

  function zoomViewport(factor: number, anchorRatio = 0.5): void {
    if (safeDurationMs <= 0 || viewportSpanMs <= 0) {
      return;
    }

    const safeAnchorRatio = Math.min(1, Math.max(0, anchorRatio));
    const nextSpanMs = viewportSpanMs * factor;
    const anchorMs = viewport.startMs + viewportSpanMs * safeAnchorRatio;
    const nextStartMs = anchorMs - nextSpanMs * safeAnchorRatio;

    queueViewportChange(nextStartMs, nextStartMs + nextSpanMs);
  }

  function panViewport(direction: -1 | 1, distanceRatio: number): void {
    if (safeDurationMs <= 0 || viewportSpanMs <= 0) {
      return;
    }

    const deltaMs = Math.max(250, viewportSpanMs * distanceRatio) * direction;
    queueViewportChange(viewport.startMs + deltaMs, viewport.endMs + deltaMs);
  }

  function handleWheel(event: WheelEvent): void {
    if (safeDurationMs <= 0) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget instanceof HTMLElement
      ? event.currentTarget.getBoundingClientRect()
      : null;
    const anchorRatio = rect && rect.width > 0
      ? (event.clientX - rect.left) / rect.width
      : 0.5;

    zoomViewport(event.deltaY > 0 ? 1.18 : 0.82, anchorRatio);
  }

  function handleViewportPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !trackElement || safeDurationMs <= 0) {
      return;
    }

    event.preventDefault();
    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
      target.setPointerCapture(event.pointerId);
    }

    dragState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      trackWidth: trackElement.clientWidth,
      viewportStartMs: viewport.startMs,
      viewportEndMs: viewport.endMs,
    };
  }

  function handleViewportPointerMove(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId || dragState.trackWidth <= 0) {
      return;
    }

    const deltaMs = ((event.clientX - dragState.startClientX) / dragState.trackWidth) * safeDurationMs;
    queueViewportChange(
      dragState.viewportStartMs + deltaMs,
      dragState.viewportEndMs + deltaMs,
    );
  }

  function handleViewportPointerUp(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    dragState = null;
  }

  function handleViewportKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        panViewport(-1, event.shiftKey ? 0.25 : 0.1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        panViewport(1, event.shiftKey ? 0.25 : 0.1);
        break;
      case 'ArrowUp':
      case '+':
      case '=':
        event.preventDefault();
        zoomViewport(0.8);
        break;
      case 'ArrowDown':
      case '-':
      case '_':
        event.preventDefault();
        zoomViewport(1.25);
        break;
      case 'Home':
        event.preventDefault();
        queueViewportChange(0, viewportSpanMs);
        break;
      case 'End':
        event.preventDefault();
        queueViewportChange(safeDurationMs - viewportSpanMs, safeDurationMs);
        break;
    }
  }
</script>

<section class="flex flex-col gap-3 px-4 py-3" aria-label="Subtitle OCR timeline">
  <div class="flex items-center justify-between gap-3">
    <div class="min-w-0">
      <h3 class="text-sm font-medium">Timeline</h3>
      <p class="truncate text-xs text-muted-foreground">
        {formatTime(viewport.startMs)} - {formatTime(viewport.endMs)} ({zoomPercent}% visible)
      </p>
    </div>

    <Tooltip.Provider delayDuration={150}>
      <div class="flex shrink-0 items-center gap-1">
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Zoom out timeline"
                disabled={safeDurationMs <= 0 || viewportSpanMs >= safeDurationMs}
                onclick={() => zoomViewport(1.25)}
              >
                <Minus class="size-4" aria-hidden="true" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Zoom out</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Zoom in timeline"
                disabled={safeDurationMs <= 0 || viewportSpanMs <= 1_000}
                onclick={() => zoomViewport(0.8)}
              >
                <Plus class="size-4" aria-hidden="true" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Zoom in</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </Tooltip.Provider>
  </div>

  <div
    bind:this={trackElement}
    class="relative h-16 overflow-hidden rounded-xl border bg-muted/30"
    role="presentation"
    onwheel={handleWheel}
  >
    <div class="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true"></div>

    {#each cues as cue (cue.id)}
      <div
        class="absolute top-3 h-10 rounded-sm bg-primary/35"
        style={`left: ${toPercent(cue.startTimeMs)}%; width: ${getCueWidthPercent(cue)}%;`}
        aria-hidden="true"
      ></div>
    {/each}

    {#if selectedCueStartMs !== undefined}
      <div
        class="absolute top-2 bottom-2 w-0.5 bg-primary"
        style={`left: ${toPercent(selectedCueStartMs)}%;`}
        aria-hidden="true"
      ></div>
    {/if}

    <button
      type="button"
      class={cn(
        'absolute top-1 bottom-1 rounded-lg border border-primary bg-primary/15 shadow-none outline-none transition-colors',
        'focus-visible:ring-ring/30 focus-visible:ring-3',
        dragState ? 'cursor-grabbing' : 'cursor-grab',
      )}
      style={`left: ${toPercent(viewport.startMs)}%; width: ${Math.max(0.4, toPercent(viewport.endMs) - toPercent(viewport.startMs))}%;`}
      aria-label="Move timeline viewport"
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
      onpointerdown={handleViewportPointerDown}
      onpointermove={handleViewportPointerMove}
      onpointerup={handleViewportPointerUp}
      onpointercancel={handleViewportPointerUp}
      onkeydown={handleViewportKeydown}
    >
      <span class="sr-only">
        Viewport from {formatTime(viewport.startMs)} to {formatTime(viewport.endMs)}
      </span>
    </button>
  </div>
</section>
