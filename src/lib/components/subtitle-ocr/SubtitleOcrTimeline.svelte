<script lang="ts">
  import { tick } from 'svelte';
  import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import type { SubtitleOcrCue } from '$lib/types';
  import { cn } from '$lib/utils';
  import {
    buildTimelineCueZones,
    clampTimelineScale,
    clampTimelineScaleWindow,
    getTimelineAutoScrollIntent,
    getTimelineContentWidthPx,
    getTimelineWheelIntent,
    timelineMsToPx,
    timelinePxToMs,
    zoomTimelineScaleWindow,
    type TimelineCueZone,
    type TimelineViewport,
  } from './subtitle-ocr-review-state';

  type TimelineViewportChangeSource = 'timeline-window' | 'timeline-zone' | 'timeline-zoom';

  interface SubtitleOcrTimelineProps {
    cues: SubtitleOcrCue[];
    durationMs: number;
    viewportStartMs: number;
    viewportEndMs: number;
    selectedCueId?: string | null;
    selectedCueStartMs?: number;
    onSelectCue?: (cueId: string) => void;
    onViewportChange: (
      startMs: number,
      endMs: number,
      source: TimelineViewportChangeSource,
    ) => void;
  }

  interface WindowDragState {
    pointerId: number;
    grabOffsetPx: number;
    pointerClientX: number;
  }

  interface TimelineTick {
    id: string;
    timeMs: number;
    label: string;
    leftPx: number;
  }

  let {
    cues,
    durationMs,
    viewportStartMs,
    viewportEndMs,
    selectedCueId = null,
    selectedCueStartMs,
    onSelectCue = () => {},
    onViewportChange,
  }: SubtitleOcrTimelineProps = $props();

  const WHEEL_ZOOM_IN_FACTOR = 1.18;
  const WHEEL_ZOOM_OUT_FACTOR = 0.82;
  const PAN_RATIO = 0.25;
  const WINDOW_KEYBOARD_PAN_RATIO = 0.08;
  const AUTO_SCROLL_BASE_PX = 8;
  const AUTO_SCROLL_PRESSURE_PX = 24;

  let viewportElement = $state<HTMLDivElement | null>(null);
  let timelineWidthPx = $state(0);
  let timelineScale = $state(1);
  let dragState = $state<WindowDragState | null>(null);
  let localWindow = $state<TimelineViewport | null>(null);
  let pendingWindow: TimelineViewport | null = null;
  let pendingWindowSource: TimelineViewportChangeSource = 'timeline-window';
  let viewportFrameId: number | null = null;
  let autoScrollFrameId: number | null = null;
  let lastPropWindowKey = '';

  const safeDurationMs = $derived(Math.max(0, Math.round(durationMs)));
  const safeScale = $derived(clampTimelineScale(timelineScale));
  const propWindow = $derived({ startMs: viewportStartMs, endMs: viewportEndMs });
  const renderedWindow = $derived.by(() => clampTimelineScaleWindow({
    window: localWindow ?? propWindow,
    durationMs: safeDurationMs,
    viewportWidthPx: timelineWidthPx,
    scale: safeScale,
  }));
  const contentWidthPx = $derived(getTimelineContentWidthPx(safeDurationMs, timelineWidthPx, safeScale));
  const cueZones = $derived.by((): TimelineCueZone<SubtitleOcrCue>[] => (
    buildTimelineCueZones(cues, {
      durationMs: safeDurationMs,
      viewportWidthPx: timelineWidthPx,
      scale: safeScale,
    })
  ));
  const timelineTicks = $derived.by(() => buildTimelineTicks(safeDurationMs, timelineWidthPx, safeScale));
  const selectedMarkerLeftPx = $derived(getSelectedMarkerLeftPx());
  const windowLeftPx = $derived(timelineMsToPx(renderedWindow.startMs, safeDurationMs, timelineWidthPx, safeScale));
  const windowWidthPx = $derived(Math.max(
    1,
    timelineMsToPx(renderedWindow.endMs, safeDurationMs, timelineWidthPx, safeScale) - windowLeftPx,
  ));

  $effect(() => {
    const element = viewportElement;
    if (!element) {
      timelineWidthPx = 0;
      return;
    }

    timelineWidthPx = Math.round(element.clientWidth);

    const resizeObserver = new ResizeObserver(([entry]) => {
      timelineWidthPx = Math.round(entry.contentRect.width);
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  });

  $effect(() => {
    const startMs = viewportStartMs;
    const endMs = viewportEndMs;
    const propWindowKey = `${startMs}:${endMs}`;
    const propChanged = propWindowKey !== lastPropWindowKey;
    lastPropWindowKey = propWindowKey;

    if (propChanged && !dragState && localWindow) {
      localWindow = null;
    }
  });

  $effect(() => {
    return () => {
      if (viewportFrameId !== null) {
        cancelAnimationFrame(viewportFrameId);
      }

      stopAutoScroll();
    };
  });

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

  function buildTimelineTicks(totalDurationMs: number, viewportWidthPx: number, scale: number): TimelineTick[] {
    if (totalDurationMs <= 0 || viewportWidthPx <= 0) {
      return [];
    }

    const contentWidth = getTimelineContentWidthPx(totalDurationMs, viewportWidthPx, scale);
    const targetTickCount = Math.max(2, Math.min(10, Math.floor(contentWidth / 180)));
    const rawStepMs = totalDurationMs / targetTickCount;
    const stepMs = chooseTickStepMs(rawStepMs);
    const ticks: TimelineTick[] = [];

    for (let timeMs = 0; timeMs <= totalDurationMs; timeMs += stepMs) {
      ticks.push({
        id: `tick:${timeMs}`,
        timeMs,
        label: formatTime(timeMs),
        leftPx: timelineMsToPx(timeMs, totalDurationMs, viewportWidthPx, scale),
      });
    }

    if (ticks[ticks.length - 1]?.timeMs !== totalDurationMs) {
      ticks.push({
        id: `tick:${totalDurationMs}`,
        timeMs: totalDurationMs,
        label: formatTime(totalDurationMs),
        leftPx: timelineMsToPx(totalDurationMs, totalDurationMs, viewportWidthPx, scale),
      });
    }

    return ticks;
  }

  function chooseTickStepMs(rawStepMs: number): number {
    const steps = [
      1_000,
      2_000,
      5_000,
      10_000,
      15_000,
      30_000,
      60_000,
      120_000,
      300_000,
      600_000,
      900_000,
      1_800_000,
      3_600_000,
    ];

    return steps.find((step) => step >= rawStepMs) ?? steps[steps.length - 1];
  }

  function getSelectedMarkerLeftPx(): number | null {
    if (selectedCueStartMs === undefined || safeDurationMs <= 0 || timelineWidthPx <= 0) {
      return null;
    }

    return timelineMsToPx(selectedCueStartMs, safeDurationMs, timelineWidthPx, safeScale);
  }

  function getZoneLabel(zone: TimelineCueZone<SubtitleOcrCue>, index: number): string {
    return `Select cue ${index + 1}, ${formatTime(zone.cue.startTimeMs)} to ${formatTime(zone.cue.endTimeMs)}`;
  }

  function getWindowLabel(): string {
    return `Filmstrip window, ${formatTime(renderedWindow.startMs)} to ${formatTime(renderedWindow.endMs)}`;
  }

  function queueWindowChange(
    nextWindow: TimelineViewport,
    source: TimelineViewportChangeSource,
  ): void {
    if (safeDurationMs <= 0 || timelineWidthPx <= 0) {
      return;
    }

    pendingWindow = clampTimelineScaleWindow({
      window: nextWindow,
      durationMs: safeDurationMs,
      viewportWidthPx: timelineWidthPx,
      scale: safeScale,
    });
    pendingWindowSource = source;
    localWindow = pendingWindow;

    if (viewportFrameId !== null) {
      return;
    }

    viewportFrameId = requestAnimationFrame(() => {
      viewportFrameId = null;
      const queuedWindow = pendingWindow;
      const queuedSource = pendingWindowSource;
      pendingWindow = null;

      if (!queuedWindow) {
        return;
      }

      onViewportChange(queuedWindow.startMs, queuedWindow.endMs, queuedSource);
    });
  }

  function scrollTimelineToTime(timeMs: number, anchorRatio = 0.5, behavior: ScrollBehavior = 'smooth'): void {
    const element = viewportElement;
    if (!element || safeDurationMs <= 0) {
      return;
    }

    void tick().then(() => {
      const leftPx = timelineMsToPx(timeMs, safeDurationMs, timelineWidthPx, safeScale)
        - element.clientWidth * anchorRatio;
      element.scrollTo({
        left: Math.max(0, leftPx),
        behavior,
      });
    });
  }

  function handleWheel(event: WheelEvent): void {
    if (safeDurationMs <= 0 || timelineWidthPx <= 0 || !viewportElement) {
      return;
    }

    const wheelIntent = getTimelineWheelIntent({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
    if (wheelIntent === 'native-scroll') {
      return;
    }

    event.preventDefault();
    const rect = viewportElement.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const anchorTimeMs = timelinePxToMs(
      viewportElement.scrollLeft + pointerX,
      safeDurationMs,
      timelineWidthPx,
      safeScale,
    );
    const factor = wheelIntent === 'zoom-out' ? WHEEL_ZOOM_OUT_FACTOR : WHEEL_ZOOM_IN_FACTOR;
    const result = zoomTimelineScaleWindow({
      window: renderedWindow,
      durationMs: safeDurationMs,
      viewportWidthPx: timelineWidthPx,
      scale: safeScale,
      factor,
    });

    timelineScale = result.scale;
    queueWindowChange(result.window, 'timeline-zoom');

    void tick().then(() => {
      if (!viewportElement) {
        return;
      }

      viewportElement.scrollLeft = Math.max(
        0,
        timelineMsToPx(anchorTimeMs, safeDurationMs, timelineWidthPx, result.scale) - pointerX,
      );
    });
  }

  function zoomByButton(factor: number): void {
    if (safeDurationMs <= 0 || timelineWidthPx <= 0) {
      return;
    }

    const centerMs = renderedWindow.startMs + (renderedWindow.endMs - renderedWindow.startMs) / 2;
    const result = zoomTimelineScaleWindow({
      window: renderedWindow,
      durationMs: safeDurationMs,
      viewportWidthPx: timelineWidthPx,
      scale: safeScale,
      factor,
    });

    timelineScale = result.scale;
    queueWindowChange(result.window, 'timeline-zoom');
    scrollTimelineToTime(centerMs);
  }

  function panTimeline(direction: -1 | 1): void {
    const element = viewportElement;
    if (!element) {
      return;
    }

    element.scrollBy({
      left: element.clientWidth * PAN_RATIO * direction,
      behavior: 'smooth',
    });
  }

  function selectZone(zone: TimelineCueZone<SubtitleOcrCue>): void {
    const cueCenterMs = zone.cue.startTimeMs + (zone.cue.endTimeMs - zone.cue.startTimeMs) / 2;
    const windowSpanMs = renderedWindow.endMs - renderedWindow.startMs;

    onSelectCue(zone.cue.id);
    queueWindowChange({
      startMs: cueCenterMs - windowSpanMs / 2,
      endMs: cueCenterMs + windowSpanMs / 2,
    }, 'timeline-zone');
    scrollTimelineToTime(cueCenterMs);
  }

  function moveWindowByRatio(direction: -1 | 1, ratio: number): void {
    const spanMs = renderedWindow.endMs - renderedWindow.startMs;
    const deltaMs = spanMs * ratio * direction;

    queueWindowChange({
      startMs: renderedWindow.startMs + deltaMs,
      endMs: renderedWindow.endMs + deltaMs,
    }, 'timeline-window');
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveWindowByRatio(-1, WINDOW_KEYBOARD_PAN_RATIO);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveWindowByRatio(1, WINDOW_KEYBOARD_PAN_RATIO);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomByButton(WHEEL_ZOOM_IN_FACTOR);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomByButton(WHEEL_ZOOM_OUT_FACTOR);
    }
  }

  function handleWindowPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !viewportElement || safeDurationMs <= 0) {
      return;
    }

    const rect = viewportElement.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      pointerClientX: event.clientX,
      grabOffsetPx: event.clientX - rect.left + viewportElement.scrollLeft - windowLeftPx,
    };

    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
      target.setPointerCapture(event.pointerId);
    }

    startAutoScroll();
  }

  function handleWindowPointerMove(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    dragState = { ...dragState, pointerClientX: event.clientX };
    updateWindowFromPointer(event.clientX);
  }

  function handleWindowPointerUp(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    dragState = null;
    stopAutoScroll();

    requestAnimationFrame(() => {
      if (!dragState) {
        localWindow = null;
      }
    });
  }

  function updateWindowFromPointer(pointerClientX: number): void {
    const element = viewportElement;
    const drag = dragState;
    if (!element || !drag || safeDurationMs <= 0) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const localX = pointerClientX - rect.left + element.scrollLeft;
    const startMs = timelinePxToMs(localX - drag.grabOffsetPx, safeDurationMs, timelineWidthPx, safeScale);
    const spanMs = renderedWindow.endMs - renderedWindow.startMs;

    queueWindowChange({
      startMs,
      endMs: startMs + spanMs,
    }, 'timeline-window');
  }

  function startAutoScroll(): void {
    if (autoScrollFrameId !== null) {
      return;
    }

    const step = () => {
      autoScrollFrameId = null;
      const element = viewportElement;
      const drag = dragState;
      if (!element || !drag) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const intent = getTimelineAutoScrollIntent({
        pointerClientX: drag.pointerClientX,
        viewportLeft: rect.left,
        viewportWidth: rect.width,
        scrollLeft: element.scrollLeft,
        maxScrollLeft: Math.max(0, element.scrollWidth - element.clientWidth),
      });

      if (intent.direction !== 0) {
        element.scrollLeft += intent.direction * (AUTO_SCROLL_BASE_PX + AUTO_SCROLL_PRESSURE_PX * intent.pressure);
        updateWindowFromPointer(drag.pointerClientX);
      }

      autoScrollFrameId = requestAnimationFrame(step);
    };

    autoScrollFrameId = requestAnimationFrame(step);
  }

  function stopAutoScroll(): void {
    if (autoScrollFrameId !== null) {
      cancelAnimationFrame(autoScrollFrameId);
      autoScrollFrameId = null;
    }
  }
</script>

<section class="flex flex-col gap-3 px-4 py-3" aria-label="Subtitle OCR timeline">
  <div class="flex min-w-0 items-center justify-between gap-3">
    <div class="min-w-0">
      <h3 class="text-sm font-medium">Timeline</h3>
      <p class="truncate text-xs text-muted-foreground">
        {formatTime(renderedWindow.startMs)} - {formatTime(renderedWindow.endMs)}
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-1" role="group" aria-label="Timeline controls">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              type="button"
              variant="outline"
              size="icon"
              class="size-8"
              aria-label="Pan timeline left"
              onclick={() => panTimeline(-1)}
            >
              <ChevronLeft class="size-4" aria-hidden="true" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Pan left</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              type="button"
              variant="outline"
              size="icon"
              class="size-8"
              aria-label="Pan timeline right"
              onclick={() => panTimeline(1)}
            >
              <ChevronRight class="size-4" aria-hidden="true" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Pan right</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              type="button"
              variant="outline"
              size="icon"
              class="size-8"
              aria-label="Zoom timeline in"
              onclick={() => zoomByButton(WHEEL_ZOOM_IN_FACTOR)}
            >
              <ZoomIn class="size-4" aria-hidden="true" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Zoom in</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              type="button"
              variant="outline"
              size="icon"
              class="size-8"
              aria-label="Zoom timeline out"
              onclick={() => zoomByButton(WHEEL_ZOOM_OUT_FACTOR)}
            >
              <ZoomOut class="size-4" aria-hidden="true" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Zoom out</Tooltip.Content>
      </Tooltip.Root>
    </div>
  </div>

  <div
    bind:this={viewportElement}
    class="relative h-28 overflow-x-auto overflow-y-hidden rounded-2xl border bg-muted/30 outline-none"
    aria-label="Timeline cue zones"
    onwheel={handleWheel}
  >
    <div
      class="relative h-full min-w-full"
      style={`width: ${contentWidthPx}px;`}
    >
      <div
        class="pointer-events-none absolute inset-0"
        style="background-image: linear-gradient(to right, color-mix(in oklab, var(--foreground) 12%, transparent) 1px, transparent 1px); background-size: 72px 100%;"
        aria-hidden="true"
      ></div>

      {#each timelineTicks as tick (tick.id)}
        <span
          class="pointer-events-none absolute top-2 -translate-x-1/2 text-[11px] tabular-nums text-muted-foreground"
          style={`left: ${tick.leftPx}px;`}
        >
          {tick.label}
        </span>
      {/each}

      {#if cueZones.length === 0}
        <div class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          No cues
        </div>
      {:else}
        {#each cueZones as zone, index (zone.id)}
          <button
            type="button"
            class={cn(
              'absolute top-12 h-6 rounded-full border bg-primary/20 outline-none transition-colors',
              'focus-visible:ring-ring/30 focus-visible:ring-3',
              zone.cue.id === selectedCueId
                ? 'z-10 border-primary bg-primary/30 shadow-sm'
                : 'border-primary/30 hover:border-primary/70 hover:bg-primary/25',
            )}
            style={`left: ${zone.leftPx}px; width: ${zone.widthPx}px;`}
            aria-label={getZoneLabel(zone, index)}
            aria-current={zone.cue.id === selectedCueId ? 'true' : undefined}
            title={getZoneLabel(zone, index)}
            onclick={() => selectZone(zone)}
          ></button>
        {/each}

        {#if selectedMarkerLeftPx !== null}
          <div
            class="pointer-events-none absolute top-8 bottom-3 z-20 w-0.5 bg-primary shadow-sm"
            style={`left: ${selectedMarkerLeftPx}px;`}
            aria-hidden="true"
          ></div>
        {/if}
      {/if}

      <div
        role="slider"
        tabindex="0"
        class={cn(
          'absolute top-5 bottom-3 z-30 rounded-2xl border-2 border-primary bg-primary/10 shadow-sm outline-none',
          'focus-visible:ring-ring/30 focus-visible:ring-3',
          dragState ? 'cursor-grabbing' : 'cursor-grab',
        )}
        style={`left: ${windowLeftPx}px; width: ${windowWidthPx}px;`}
        aria-label={getWindowLabel()}
        aria-valuemin={0}
        aria-valuemax={safeDurationMs}
        aria-valuenow={renderedWindow.startMs}
        aria-valuetext={`${formatTime(renderedWindow.startMs)} to ${formatTime(renderedWindow.endMs)}`}
        onkeydown={handleWindowKeydown}
        onpointerdown={handleWindowPointerDown}
        onpointermove={handleWindowPointerMove}
        onpointerup={handleWindowPointerUp}
        onpointercancel={handleWindowPointerUp}
      ></div>
    </div>
  </div>
</section>
