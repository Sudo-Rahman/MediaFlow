<script lang="ts">
  import { convertFileSrc } from '@tauri-apps/api/core';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { ImageOff } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';

  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { countExportableSubtitleOcrCues } from '$lib/services/subtitle-ocr-export';
  import type { SubtitleOcrCue, SubtitleOcrCueBitmap } from '$lib/types';
  import { cn } from '$lib/utils';
  import {
    clampTimelineViewport,
    findCueNearestTime,
    toCueTileWidth,
  } from './subtitle-ocr-review-state';

  interface SubtitleOcrFilmstripProps {
    bitmaps: SubtitleOcrCueBitmap[];
    cues: SubtitleOcrCue[];
    selectedCueId: string | null;
    viewportStartMs: number;
    viewportEndMs: number;
    onSelectCue: (cueId: string) => void;
    onViewportChange: (startMs: number, endMs: number, source: 'filmstrip') => void;
  }

  let {
    bitmaps,
    cues,
    selectedCueId,
    viewportStartMs,
    viewportEndMs,
    onSelectCue,
    onViewportChange,
  }: SubtitleOcrFilmstripProps = $props();

  const TILE_GAP = 10;
  const TILE_HEIGHT = 112;
  const TILE_OVERSCAN = 6;
  const BITMAP_URL_PATH = /^(?:https?:\/\/|data:|blob:|\/\/)/i;

  let viewport = $state<HTMLElement | null>(null);
  let applyingViewportScroll = false;
  let scrollFrameId: number | null = null;

  const bitmapByCueId = $derived.by(() => {
    const map = new Map<string, SubtitleOcrCueBitmap>();
    for (const bitmap of bitmaps) {
      map.set(bitmap.cueId, bitmap);
    }

    return map;
  });

  const durationMs = $derived.by(() => {
    const cueEndMs = cues.reduce((max, cue) => Math.max(max, cue.endTimeMs), 0);
    const bitmapEndMs = bitmaps.reduce((max, bitmap) => Math.max(max, bitmap.endTimeMs), 0);

    return Math.max(cueEndMs, bitmapEndMs);
  });
  const exportableCueCount = $derived(countExportableSubtitleOcrCues(cues));

  const tileOffsets = $derived.by(() => {
    const offsets = [0];
    for (const cue of cues) {
      offsets.push(offsets[offsets.length - 1] + getCueOuterWidth(cue));
    }

    return offsets;
  });

  const cueVirtualizer = createVirtualizer<HTMLElement, HTMLButtonElement>({
    count: 0,
    getScrollElement: () => viewport,
    estimateSize: () => 160,
    horizontal: true,
    overscan: TILE_OVERSCAN,
  });

  $effect(() => {
    const count = cues.length;
    const scrollElement = viewport;
    const currentCues = cues;

    untrack(() => {
      get(cueVirtualizer).setOptions({
        count,
        getScrollElement: () => scrollElement,
        estimateSize: (index) => {
          const cue = currentCues[index];
          return cue ? getCueOuterWidth(cue) : 160;
        },
        horizontal: true,
        overscan: TILE_OVERSCAN,
      });
    });
  });

  $effect(() => {
    const element = viewport;
    const startMs = viewportStartMs;
    const currentCues = cues;
    const offsets = tileOffsets;

    if (!element || currentCues.length === 0) {
      return;
    }

    const nearestCue = findCueNearestTime(currentCues, startMs);
    const targetIndex = nearestCue
      ? currentCues.findIndex((cue) => cue.id === nearestCue.id)
      : 0;
    const targetOffset = Math.max(0, offsets[Math.max(0, targetIndex)] ?? 0);

    if (Math.abs(element.scrollLeft - targetOffset) <= 8) {
      return;
    }

    applyingViewportScroll = true;
    element.scrollTo({ left: targetOffset, behavior: 'auto' });

    const frameId = requestAnimationFrame(() => {
      applyingViewportScroll = false;
    });

    return () => {
      cancelAnimationFrame(frameId);
      applyingViewportScroll = false;
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

  function getCueOuterWidth(cue: SubtitleOcrCue): number {
    return toCueTileWidth(cue) + TILE_GAP;
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

  function resolveBitmapSrc(bitmapPath: string): string {
    return BITMAP_URL_PATH.test(bitmapPath) ? bitmapPath : convertFileSrc(bitmapPath);
  }

  function getReviewBitmapPath(bitmap: SubtitleOcrCueBitmap | null): string | undefined {
    return bitmap?.previewPath;
  }

  function formatTime(ms: number): string {
    const safeMs = Math.max(0, Math.round(ms));
    const totalSeconds = Math.floor(safeMs / 1_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = safeMs % 1_000;

    return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }

  function formatCueRange(cue: SubtitleOcrCue): string {
    return `${formatTime(cue.startTimeMs)} - ${formatTime(cue.endTimeMs)}`;
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
      const start = tileOffsets[mid] ?? 0;
      const end = tileOffsets[mid + 1] ?? start;

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
    if (durationMs <= 0 || cues.length === 0) {
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
      Math.min(500, durationMs),
    );
  }

  function handleScroll(): void {
    if (applyingViewportScroll || scrollFrameId !== null) {
      return;
    }

    scrollFrameId = requestAnimationFrame(() => {
      scrollFrameId = null;

      if (applyingViewportScroll || !viewport) {
        return;
      }

      const nextViewport = getVisibleViewportFromScroll(viewport);
      if (!nextViewport) {
        return;
      }

      onViewportChange(nextViewport.startMs, nextViewport.endMs, 'filmstrip');
    });
  }
</script>

<section class="flex min-h-0 flex-col gap-2 px-4 py-3" aria-label="Subtitle OCR filmstrip">
  <div class="flex items-center justify-between gap-3">
    <div class="min-w-0">
      <h3 class="text-sm font-medium">Filmstrip</h3>
      <p class="truncate text-xs text-muted-foreground">
        {exportableCueCount} cue{exportableCueCount === 1 ? '' : 's'} from {formatTime(viewportStartMs)} to {formatTime(viewportEndMs)}
      </p>
    </div>
  </div>

  {#if cues.length === 0}
    <div class="flex h-32 items-center justify-center text-sm text-muted-foreground">
      No cues to preview.
    </div>
  {:else}
    <ScrollArea
      bind:viewportRef={viewport}
      orientation="horizontal"
      class="h-36 min-w-0"
      scrollbarXClasses="h-2"
    >
      <div
        class="relative"
        style={`height: ${TILE_HEIGHT + 28}px; width: ${$cueVirtualizer.getTotalSize()}px;`}
      >
        {#each $cueVirtualizer.getVirtualItems() as virtualTile (virtualTile.key)}
          {@const cue = cues[virtualTile.index]}
          {#if cue}
            {@const bitmap = getCueBitmap(cue)}
            {@const tileWidth = toCueTileWidth(cue)}
            {@const isSelected = cue.id === selectedCueId}
            <button
              type="button"
              class={cn(
                'absolute top-1 flex flex-col overflow-hidden rounded-xl border bg-background text-left shadow-none transition-[border-color,box-shadow,transform]',
                'focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-3 focus-visible:outline-none',
                isSelected
                  ? 'z-10 border-primary ring-2 ring-primary/30'
                  : 'border-border hover:border-primary/50',
              )}
              style={`height: ${TILE_HEIGHT}px; width: ${tileWidth}px; transform: translateX(${virtualTile.start}px) scale(${isSelected ? 1.015 : 1}); transform-origin: center;`}
              aria-pressed={isSelected}
              aria-label={`Select subtitle cue ${virtualTile.index + 1}`}
              title={formatCueRange(cue)}
              onclick={() => onSelectCue(cue.id)}
            >
              <span class="flex min-h-0 flex-1 items-center justify-center bg-zinc-950">
                {#if getReviewBitmapPath(bitmap)}
                  <img
                    src={resolveBitmapSrc(getReviewBitmapPath(bitmap) ?? '')}
                    alt={`Cue ${virtualTile.index + 1} preview`}
                    loading="lazy"
                    class="max-h-full max-w-full object-contain"
                  />
                {:else}
                  <span class="flex flex-col items-center gap-1 text-xs text-zinc-400">
                    <ImageOff class="size-5" aria-hidden="true" />
                    No preview
                  </span>
                {/if}
              </span>
              <span class="flex h-7 items-center justify-between gap-2 px-2 text-[11px] text-muted-foreground">
                <span class="truncate tabular-nums">{formatCueRange(cue)}</span>
              </span>
            </button>
          {/if}
        {/each}
      </div>
    </ScrollArea>
  {/if}
</section>
