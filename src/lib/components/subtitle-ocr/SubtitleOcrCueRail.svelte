<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';

  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import type { SubtitleOcrCue, SubtitleOcrCueBitmap } from '$lib/types';
  import { clampTimelineViewport } from './subtitle-ocr-review-state';
  import SubtitleOcrCueCard from './SubtitleOcrCueCard.svelte';

  interface SubtitleOcrCueRailProps {
    cues: SubtitleOcrCue[];
    bitmaps: SubtitleOcrCueBitmap[];
    selectedCueId: string | null;
    disabled?: boolean;
    onSelectCue: (cueId: string) => void;
    onTextChange: (cueId: string, text: string) => void;
    onViewportChange: (startMs: number, endMs: number, source: 'rail') => void;
  }

  let {
    cues,
    bitmaps,
    selectedCueId,
    disabled = false,
    onSelectCue,
    onTextChange,
    onViewportChange,
  }: SubtitleOcrCueRailProps = $props();

  const SELECTED_CARD_WIDTH = 620;
  const NEIGHBOR_CARD_WIDTH = 420;
  const CARD_GAP = 18;
  const OVERSCAN = 3;

  let viewport = $state<HTMLElement | null>(null);
  let applyingSelectedScroll = false;
  let scrollFrameId: number | null = null;

  const bitmapByCueId = $derived.by(() => {
    const map = new Map<string, SubtitleOcrCueBitmap>();
    for (const bitmap of bitmaps) {
      map.set(bitmap.cueId, bitmap);
    }

    return map;
  });

  const selectedIndex = $derived(cues.findIndex((cue) => cue.id === selectedCueId));

  const cardOffsets = $derived.by(() => {
    const offsets = [0];
    for (const cue of cues) {
      offsets.push(offsets[offsets.length - 1] + getCueOuterWidth(cue, selectedCueId));
    }

    return offsets;
  });

  const cueVirtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => viewport,
    estimateSize: () => NEIGHBOR_CARD_WIDTH + CARD_GAP,
    horizontal: true,
    overscan: OVERSCAN,
  });

  $effect(() => {
    const count = cues.length;
    const scrollElement = viewport;
    const currentSelectedCueId = selectedCueId;
    const currentCues = cues;

    untrack(() => {
      get(cueVirtualizer).setOptions({
        count,
        getScrollElement: () => scrollElement,
        estimateSize: (index) => {
          const cue = currentCues[index];
          return cue
            ? getCueOuterWidth(cue, currentSelectedCueId)
            : NEIGHBOR_CARD_WIDTH + CARD_GAP;
        },
        horizontal: true,
        overscan: OVERSCAN,
      });
    });
  });

  $effect(() => {
    const element = viewport;
    const index = selectedIndex;
    if (!element || index < 0) {
      return;
    }

    applyingSelectedScroll = true;
    get(cueVirtualizer).scrollToIndex(index, { align: 'center' });

    const frameId = requestAnimationFrame(() => {
      applyingSelectedScroll = false;
    });

    return () => {
      cancelAnimationFrame(frameId);
      applyingSelectedScroll = false;
    };
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
    };
  });

  function getCueOuterWidth(cue: SubtitleOcrCue, currentSelectedCueId: string | null): number {
    const width = cue.id === currentSelectedCueId ? SELECTED_CARD_WIDTH : NEIGHBOR_CARD_WIDTH;

    return width + CARD_GAP;
  }

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

  function findCueIndexAtOffset(offset: number): number {
    if (cues.length === 0) {
      return -1;
    }

    const safeOffset = Math.max(0, offset);
    let low = 0;
    let high = cues.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const start = cardOffsets[mid] ?? 0;
      const end = cardOffsets[mid + 1] ?? start;

      if (safeOffset < start) {
        high = mid - 1;
      } else if (safeOffset >= end) {
        low = mid + 1;
      } else {
        return mid;
      }
    }

    return Math.min(cues.length - 1, Math.max(0, low));
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

    const durationMs = cues.reduce((max, cue) => Math.max(max, cue.endTimeMs), 0);

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

      const viewportRange = getVisibleViewportFromScroll(viewport);
      if (!viewportRange) {
        return;
      }

      onViewportChange(viewportRange.startMs, viewportRange.endMs, 'rail');
    });
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
      class="h-[34rem] min-w-0"
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
              class="absolute top-4"
              style={`width: ${selected ? SELECTED_CARD_WIDTH : NEIGHBOR_CARD_WIDTH}px; transform: translateX(${virtualCue.start}px);`}
            >
              <SubtitleOcrCueCard
                {cue}
                bitmap={getCueBitmap(cue)}
                {selected}
                mode="wide"
                {disabled}
                cueIndex={virtualCue.index}
                onSelectCue={onSelectCue}
                onTextChange={onTextChange}
              />
            </div>
          {/if}
        {/each}
      </div>
    </ScrollArea>
  {/if}
</section>
