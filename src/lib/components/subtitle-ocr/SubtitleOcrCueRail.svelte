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
    getRailVisibleViewportForCenteredIndex,
  } from './subtitle-ocr-review-state';
  import SubtitleOcrCueCard from './SubtitleOcrCueCard.svelte';

  type ViewportSource = 'rail' | 'timeline-window' | 'timeline-zone' | 'timeline-zoom' | 'selection' | null;

  interface SubtitleOcrCueRailProps {
    cues: SubtitleOcrCue[];
    bitmaps: SubtitleOcrCueBitmap[];
    selectedCueId: string | null;
    viewportStartMs?: number;
    viewportEndMs?: number;
    viewportSource?: ViewportSource;
    disabled?: boolean;
    onSelectCue: (cueId: string) => void;
    onTextChange: (cueId: string, text: string) => void;
    onViewportChange: (startMs: number, endMs: number, source: 'rail') => void;
  }

  let {
    cues,
    bitmaps,
    selectedCueId,
    viewportStartMs = 0,
    viewportEndMs = 0,
    viewportSource = null,
    disabled = false,
    onSelectCue,
    onTextChange,
    onViewportChange,
  }: SubtitleOcrCueRailProps = $props();

  const CARD_WIDTH = 352;
  const CARD_GAP = 16;
  const CARD_SLOT_WIDTH = CARD_WIDTH + CARD_GAP;
  const OVERSCAN = 3;

  let viewport = $state<HTMLElement | null>(null);
  let applyingSelectedScroll = false;
  let scrollFrameId: number | null = null;
  let programmaticScrollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let programmaticViewportTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const bitmapByCueId = $derived.by(() => {
    const map = new Map<string, SubtitleOcrCueBitmap>();
    for (const bitmap of bitmaps) {
      map.set(bitmap.cueId, bitmap);
    }

    return map;
  });

  const selectedIndex = $derived(cues.findIndex((cue) => cue.id === selectedCueId));
  const durationMs = $derived(cues.reduce((max, cue) => Math.max(max, cue.endTimeMs), 0));

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
    if (!element || source === 'rail' || cues.length === 0) {
      return;
    }

    const targetCue = findCueNearestTimelineWindowCenter(cues, { startMs, endMs });
    const index = targetCue ? cues.findIndex((cue) => cue.id === targetCue.id) : -1;
    if (index < 0) {
      return;
    }

    const shouldReportViewport = source === 'timeline-window' || source === 'timeline-zone';
    scrollCueToCenter(index, shouldReportViewport ? 'smooth' : 'auto', shouldReportViewport);
  });

  $effect(() => {
    const element = viewport;
    if (!element) {
      return;
    }

    element.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      element.removeEventListener('scroll', handleScroll);
    };
  });

  $effect(() => {
    return () => {
      if (scrollFrameId !== null) {
        cancelAnimationFrame(scrollFrameId);
      }

      if (programmaticScrollTimeoutId !== null) {
        clearTimeout(programmaticScrollTimeoutId);
      }

      if (programmaticViewportTimeoutId !== null) {
        clearTimeout(programmaticViewportTimeoutId);
      }
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

    markProgrammaticScroll(behavior);
    element.scrollTo({
      left: getCueCenterScrollLeft(index, element),
      behavior,
    });

    if (reportViewportAfterScroll) {
      scheduleProgrammaticViewportChange(index, behavior);
    }
  }

  function getCueCenterScrollLeft(index: number, element: HTMLElement): number {
    const cueCenterPx = index * CARD_SLOT_WIDTH + CARD_SLOT_WIDTH / 2;
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);

    return Math.min(maxScrollLeft, Math.max(0, cueCenterPx - element.clientWidth / 2));
  }

  function markProgrammaticScroll(behavior: ScrollBehavior): void {
    applyingSelectedScroll = true;
    if (programmaticScrollTimeoutId !== null) {
      clearTimeout(programmaticScrollTimeoutId);
    }

    programmaticScrollTimeoutId = setTimeout(() => {
      applyingSelectedScroll = false;
      programmaticScrollTimeoutId = null;
    }, behavior === 'smooth' ? 420 : 80);
  }

  function scheduleProgrammaticViewportChange(index: number, behavior: ScrollBehavior): void {
    const element = viewport;
    if (!element) {
      return;
    }

    if (programmaticViewportTimeoutId !== null) {
      clearTimeout(programmaticViewportTimeoutId);
    }

    programmaticViewportTimeoutId = setTimeout(() => {
      programmaticViewportTimeoutId = null;
      const viewportRange = getRailVisibleViewportForCenteredIndex(cues, {
        targetIndex: index,
        itemWidthPx: CARD_SLOT_WIDTH,
        viewportWidthPx: element.clientWidth,
        durationMs,
        minSpanMs: 1_000,
      });

      if (viewportRange) {
        onViewportChange(viewportRange.startMs, viewportRange.endMs, 'rail');
      }
    }, behavior === 'smooth' ? 460 : 90);
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
      durationMs,
      1_000,
    );
  }

  function handleScroll(): void {
    if (applyingSelectedScroll || scrollFrameId !== null || !viewport) {
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
      if (centerCue && centerCue.id !== selectedCueId) {
        onSelectCue(centerCue.id);
      }

      const viewportRange = getVisibleViewportFromScroll(viewport);
      if (!viewportRange) {
        return;
      }

      onViewportChange(viewportRange.startMs, viewportRange.endMs, 'rail');
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
      class="h-[33rem] min-w-0"
      scrollbarXClasses="h-2"
    >
      <div
        class="relative"
        style={`height: 32rem; width: ${$cueVirtualizer.getTotalSize()}px;`}
      >
        {#each $cueVirtualizer.getVirtualItems() as virtualCue (virtualCue.key)}
          {@const cue = cues[virtualCue.index]}
          {#if cue}
            {@const selected = cue.id === selectedCueId}
            <div
              class="absolute top-5"
              style={`width: ${CARD_WIDTH}px; height: 29.25rem; transform: translateX(${virtualCue.start + CARD_GAP / 2}px);`}
            >
              <SubtitleOcrCueCard
                {cue}
                bitmap={getCueBitmap(cue)}
                {selected}
                mode="wide"
                {disabled}
                cueIndex={virtualCue.index}
                onSelectCue={() => handleCueClick(cue, virtualCue.index)}
                onTextChange={onTextChange}
              />
            </div>
          {/if}
        {/each}
      </div>
    </ScrollArea>
  {/if}
</section>
