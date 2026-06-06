<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';

  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import type { SubtitleOcrCue, SubtitleOcrCueBitmap } from '$lib/types';
  import {
    clampTimelineViewport,
    findCueNearestTimelineWindowCenter,
    findRailIndexNearestCenter,
    resolveSubtitleOcrReviewDurationMs,
    shouldCommitRailScrollSelection,
    shouldPublishRailViewportUpdate,
    shouldReportProgrammaticRailViewport,
  } from './subtitle-ocr-review-state';
  import SubtitleOcrCueCard from './SubtitleOcrCueCard.svelte';

  type ViewportSource = 'rail' | 'timeline-window' | 'timeline-zone' | 'timeline-zoom' | 'selection' | null;

  interface SubtitleOcrCueRailProps {
    cues: SubtitleOcrCue[];
    bitmaps: SubtitleOcrCueBitmap[];
    durationMs?: number;
    selectedCueId: string | null;
    viewportStartMs?: number;
    viewportEndMs?: number;
    viewportSource?: ViewportSource;
    timelineWindowDragging?: boolean;
    disabled?: boolean;
    textDisabled?: boolean;
    onSelectCue: (cueId: string) => void;
    onTextCommit: (cueId: string, text: string) => void;
    onViewportChange: (startMs: number, endMs: number, source: 'rail') => void;
  }

  let {
    cues,
    bitmaps,
    durationMs = 0,
    selectedCueId,
    viewportStartMs = 0,
    viewportEndMs = 0,
    viewportSource = null,
    timelineWindowDragging = false,
    disabled = false,
    textDisabled = false,
    onSelectCue,
    onTextCommit,
    onViewportChange,
  }: SubtitleOcrCueRailProps = $props();

  const CARD_WIDTH = 352;
  const CARD_GAP = 0;
  const CARD_SLOT_WIDTH = CARD_WIDTH + CARD_GAP;
  const OVERSCAN = 2;
  const PROGRAMMATIC_SCROLL_SETTLE_MS = 120;
  const PROGRAMMATIC_SCROLL_FALLBACK_MS = 180;
  const USER_SCROLL_SETTLE_MS = 96;

  let viewport = $state<HTMLElement | null>(null);
  let applyingSelectedScroll = false;
  let pendingProgrammaticViewportReport = false;
  let pendingScrollSelectionCueId: string | null = null;
  let scrollFrameId: number | null = null;
  let programmaticScrollSettleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let userScrollSettleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastReportedRailViewportKey = '';

  const bitmapByCueId = $derived.by(() => {
    const map = new Map<string, SubtitleOcrCueBitmap>();
    for (const bitmap of bitmaps) {
      map.set(bitmap.cueId, bitmap);
    }

    return map;
  });

  const selectedIndex = $derived(cues.findIndex((cue) => cue.id === selectedCueId));
  const railDurationMs = $derived(Math.max(
    durationMs,
    resolveSubtitleOcrReviewDurationMs({ cues, bitmaps }),
  ));

  const cueVirtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => viewport,
    estimateSize: () => CARD_SLOT_WIDTH,
    horizontal: true,
    overscan: OVERSCAN,
  });

  $effect(() => {
    const count = cues.length;
    const scrollElement = viewport;

    untrack(() => {
      get(cueVirtualizer).setOptions({
        count,
        getScrollElement: () => scrollElement,
        estimateSize: () => CARD_SLOT_WIDTH,
        horizontal: true,
        overscan: OVERSCAN,
      });
    });
  });

  $effect(() => {
    const element = viewport;
    const index = selectedIndex;
    const source = viewportSource;
    if (!element || index < 0 || (source !== null && source !== 'selection')) {
      return;
    }

    scrollCueToCenter(index, source === 'selection' ? 'smooth' : 'auto');
  });

  $effect(() => {
    const element = viewport;
    const startMs = viewportStartMs;
    const endMs = viewportEndMs;
    const source = viewportSource;
    const timelineDragging = timelineWindowDragging;
    if (!element || source === 'rail' || cues.length === 0) {
      return;
    }

    const targetCue = findCueNearestTimelineWindowCenter(cues, { startMs, endMs });
    const index = targetCue ? cues.findIndex((cue) => cue.id === targetCue.id) : -1;
    if (index < 0) {
      return;
    }

    const shouldReportViewport = shouldReportProgrammaticRailViewport({
      source,
      timelineWindowDragging: timelineDragging,
    });
    scrollCueToCenter(index, shouldReportViewport ? 'smooth' : 'auto', shouldReportViewport);
  });

  $effect(() => {
    const element = viewport;
    if (!element) {
      return;
    }

    element.addEventListener('scroll', handleScroll, { passive: true });
    element.addEventListener('scrollend', handleProgrammaticScrollEnd);

    return () => {
      element.removeEventListener('scroll', handleScroll);
      element.removeEventListener('scrollend', handleProgrammaticScrollEnd);
    };
  });

  $effect(() => {
    return () => {
      if (scrollFrameId !== null) {
        cancelAnimationFrame(scrollFrameId);
      }

      clearProgrammaticScrollSettleTimeout();
      clearUserScrollSettleTimeout();
    };
  });

  function getCueBitmap(cue: SubtitleOcrCue): SubtitleOcrCueBitmap | null {
    const directBitmap = bitmapByCueId.get(cue.id);
    if (directBitmap) {
      return directBitmap;
    }

    for (const sourceCueId of cue.sourceCueIds) {
      const sourceBitmap = bitmapByCueId.get(sourceCueId);
      if (sourceBitmap) {
        return sourceBitmap;
      }
    }

    return null;
  }

  function scrollCueToCenter(
    index: number,
    behavior: ScrollBehavior = 'smooth',
    reportViewportAfterScroll = false,
  ): void {
    const element = viewport;
    if (!element || index < 0) {
      return;
    }

    startProgrammaticScroll(reportViewportAfterScroll, behavior);
    element.scrollTo({
      left: getCueCenterScrollLeft(index, element),
      behavior,
    });
  }

  function getCueCenterScrollLeft(index: number, element: HTMLElement): number {
    const cueCenterPx = index * CARD_SLOT_WIDTH + CARD_SLOT_WIDTH / 2;
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);

    return Math.min(maxScrollLeft, Math.max(0, cueCenterPx - element.clientWidth / 2));
  }

  function startProgrammaticScroll(reportViewportAfterScroll: boolean, behavior: ScrollBehavior): void {
    applyingSelectedScroll = true;
    pendingProgrammaticViewportReport = reportViewportAfterScroll;
    pendingScrollSelectionCueId = null;
    clearUserScrollSettleTimeout();
    if (scrollFrameId !== null) {
      cancelAnimationFrame(scrollFrameId);
      scrollFrameId = null;
    }
    scheduleProgrammaticScrollSettle(behavior === 'smooth' ? PROGRAMMATIC_SCROLL_FALLBACK_MS : 0);
  }

  function clearProgrammaticScrollSettleTimeout(): void {
    if (programmaticScrollSettleTimeoutId !== null) {
      clearTimeout(programmaticScrollSettleTimeoutId);
      programmaticScrollSettleTimeoutId = null;
    }
  }

  function clearUserScrollSettleTimeout(): void {
    if (userScrollSettleTimeoutId !== null) {
      clearTimeout(userScrollSettleTimeoutId);
      userScrollSettleTimeoutId = null;
    }
  }

  function scheduleProgrammaticScrollSettle(delayMs = PROGRAMMATIC_SCROLL_SETTLE_MS): void {
    clearProgrammaticScrollSettleTimeout();
    programmaticScrollSettleTimeoutId = setTimeout(settleProgrammaticScroll, delayMs);
  }

  function scheduleUserScrollSettle(): void {
    clearUserScrollSettleTimeout();
    userScrollSettleTimeoutId = setTimeout(settleUserScroll, USER_SCROLL_SETTLE_MS);
  }

  function settleProgrammaticScroll(): void {
    const element = viewport;
    const shouldReportViewport = pendingProgrammaticViewportReport;
    clearProgrammaticScrollSettleTimeout();
    applyingSelectedScroll = false;
    pendingProgrammaticViewportReport = false;

    if (!element || !shouldReportViewport) {
      return;
    }

    publishRailViewportFromScroll(element);
  }

  function settleUserScroll(): void {
    const element = viewport;
    const pendingCueId = pendingScrollSelectionCueId;
    clearUserScrollSettleTimeout();
    pendingScrollSelectionCueId = null;

    if (element) {
      publishRailViewportFromScroll(element);
    }

    if (shouldCommitRailScrollSelection({ pendingCueId, selectedCueId }) && pendingCueId) {
      onSelectCue(pendingCueId);
    }
  }

  function handleProgrammaticScrollEnd(): void {
    if (applyingSelectedScroll) {
      settleProgrammaticScroll();
    } else {
      settleUserScroll();
    }
  }

  function findCueIndexAtOffset(offset: number): number {
    if (cues.length === 0) {
      return -1;
    }

    const safeOffset = Math.max(0, offset);
    return Math.min(cues.length - 1, Math.floor(safeOffset / CARD_SLOT_WIDTH));
  }

  function getVisibleViewportFromScroll(element: HTMLElement): { startMs: number; endMs: number } | null {
    if (cues.length === 0) {
      return null;
    }

    const startIndex = findCueIndexAtOffset(element.scrollLeft);
    const endIndex = findCueIndexAtOffset(element.scrollLeft + element.clientWidth);
    const startCue = cues[startIndex];
    const endCue = cues[endIndex];

    if (!startCue || !endCue) {
      return null;
    }

    return clampTimelineViewport(
      startCue.startTimeMs,
      Math.max(startCue.endTimeMs, endCue.endTimeMs),
      railDurationMs,
      1_000,
    );
  }

  function getViewportKey(startMs: number, endMs: number): string {
    return `${Math.round(startMs)}:${Math.round(endMs)}`;
  }

  function publishRailViewportFromScroll(element: HTMLElement): void {
    const viewportRange = getVisibleViewportFromScroll(element);
    if (!viewportRange) {
      return;
    }

    const nextViewportKey = getViewportKey(viewportRange.startMs, viewportRange.endMs);
    const currentViewportKey = getViewportKey(viewportStartMs, viewportEndMs);
    if (!shouldPublishRailViewportUpdate({
      nextViewportKey,
      currentViewportKey,
      lastReportedViewportKey: lastReportedRailViewportKey,
    })) {
      return;
    }

    lastReportedRailViewportKey = nextViewportKey;
    onViewportChange(viewportRange.startMs, viewportRange.endMs, 'rail');
  }

  function handleScroll(): void {
    if (applyingSelectedScroll) {
      scheduleProgrammaticScrollSettle();
      return;
    }

    scheduleUserScrollSettle();

    if (scrollFrameId !== null || !viewport) {
      return;
    }

    scrollFrameId = requestAnimationFrame(() => {
      scrollFrameId = null;
      if (!viewport || cues.length === 0) {
        return;
      }

      const centerIndex = findRailIndexNearestCenter({
        itemCount: cues.length,
        itemWidthPx: CARD_SLOT_WIDTH,
        scrollLeftPx: viewport.scrollLeft,
        viewportWidthPx: viewport.clientWidth,
      });
      const centerCue = cues[centerIndex];
      if (centerCue) {
        pendingScrollSelectionCueId = centerCue.id;
      }

      publishRailViewportFromScroll(viewport);
    });
  }

  function handleCueClick(cue: SubtitleOcrCue, index: number): void {
    onSelectCue(cue.id);
    scrollCueToCenter(index, 'smooth', true);
  }
</script>

<section class="min-h-0 border-b bg-muted/20" aria-label="Subtitle OCR cue rail">
  {#if cues.length === 0}
    <div class="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
      No cues to preview.
    </div>
  {:else}
    <ScrollArea
      bind:viewportRef={viewport}
      orientation="horizontal"
      class="h-[35rem] min-w-0"
      scrollbarXClasses="h-2"
    >
      <div
        class="relative h-full"
        style={`width: ${$cueVirtualizer.getTotalSize()}px;`}
      >
        {#each $cueVirtualizer.getVirtualItems() as virtualCue (virtualCue.key)}
          {@const cue = cues[virtualCue.index]}
          {#if cue}
            {@const selected = cue.id === selectedCueId}
            <div
              class="absolute top-5 will-change-transform p-1.5 h-[33rem]"
              style={`width: ${CARD_WIDTH}px; transform: translate3d(${virtualCue.start + CARD_GAP / 2}px, 0, 0); contain: layout paint style; content-visibility: auto; contain-intrinsic-size: ${CARD_WIDTH}px 33rem;`}
            >
              <SubtitleOcrCueCard
                {cue}
                bitmap={getCueBitmap(cue)}
                {selected}
                mode="wide"
                {disabled}
                {textDisabled}
                cueIndex={virtualCue.index}
                onSelectCue={() => handleCueClick(cue, virtualCue.index)}
                {onTextCommit}
              />
            </div>
          {/if}
        {/each}
      </div>
    </ScrollArea>
  {/if}
</section>
