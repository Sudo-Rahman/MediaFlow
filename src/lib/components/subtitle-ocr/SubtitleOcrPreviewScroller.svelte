<script lang="ts">
  import { convertFileSrc } from '@tauri-apps/api/core';
  import { ImageOff } from '@lucide/svelte';

  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import type { SubtitleOcrCue, SubtitleOcrCueBitmap } from '$lib/types';
  import { cn } from '$lib/utils';
  import { resolveSubtitleOcrBitmapSrc } from './subtitle-ocr-preview-src';

  interface SubtitleOcrPreviewScrollerProps {
    cue: SubtitleOcrCue | null;
    bitmap: SubtitleOcrCueBitmap | null;
    cues?: readonly SubtitleOcrCue[];
    bitmaps?: readonly SubtitleOcrCueBitmap[];
    cueIndex?: number;
    selected?: boolean;
    disabled?: boolean;
    onSelectCue?: (cueId: string) => void;
  }

  let {
    cue,
    bitmap,
    cues = [],
    bitmaps = [],
    cueIndex,
    selected = false,
    disabled = false,
    onSelectCue,
  }: SubtitleOcrPreviewScrollerProps = $props();

  let viewport = $state<HTMLElement | null>(null);
  let scrollFrameId: number | null = null;
  let commitTimeoutId: number | null = null;
  let programmaticScrollTimeoutId: number | null = null;
  let lastCommitMs = 0;
  let applyingScroll = false;

  const SCROLL_COMMIT_DELAY_MS = 140;
  const MIN_COMMIT_INTERVAL_MS = 180;
  const WHEEL_LINE_HEIGHT_PX = 16;
  const WHEEL_PAGE_CAP_RATIO = 0.9;
  const PROGRAMMATIC_SCROLL_MS = 260;

  const previewCues = $derived(cues.length > 0 ? cues : cue ? [cue] : []);
  const useScroller = $derived(previewCues.length > 1);
  const bitmapByCueId = $derived.by(() => {
    const map = new Map<string, SubtitleOcrCueBitmap>();
    for (const previewBitmap of bitmaps) {
      map.set(previewBitmap.cueId, previewBitmap);
    }

    return map;
  });
  const fallbackBitmapPath = $derived(bitmap?.previewPath);
  const canSelect = $derived(Boolean(cue && onSelectCue && !disabled));

  $effect(() => {
    const element = viewport;
    if (!element || !useScroller) {
      return;
    }

    element.addEventListener('scroll', handleScroll, { passive: true });
    element.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      element.removeEventListener('scroll', handleScroll);
      element.removeEventListener('wheel', handleWheel);
    };
  });

  $effect(() => {
    const element = viewport;
    const selectedCueId = cue?.id ?? null;
    if (!element || !useScroller || !selectedCueId) {
      return;
    }

    const selectedIndex = previewCues.findIndex((previewCue) => previewCue.id === selectedCueId);
    if (selectedIndex < 0) {
      return;
    }

    const targetScrollLeft = selectedIndex * Math.max(1, element.clientWidth);
    if (Math.abs(element.scrollLeft - targetScrollLeft) <= 2) {
      return;
    }

    applyingScroll = true;
    element.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
    clearProgrammaticScrollTimer();
    programmaticScrollTimeoutId = window.setTimeout(() => {
      applyingScroll = false;
      programmaticScrollTimeoutId = null;
    }, PROGRAMMATIC_SCROLL_MS);

    return () => {
      clearProgrammaticScrollTimer();
      applyingScroll = false;
    };
  });

  $effect(() => {
    return () => {
      clearScrollFrame();
      clearCommitTimer();
      clearProgrammaticScrollTimer();
    };
  });

  function resolveBitmapSrc(bitmapPath: string): string {
    return resolveSubtitleOcrBitmapSrc(bitmapPath, convertFileSrc);
  }

  function getPreviewCueBitmap(previewCue: SubtitleOcrCue): SubtitleOcrCueBitmap | null {
    if (cue?.id === previewCue.id && bitmap) {
      return bitmap;
    }

    const directBitmap = bitmapByCueId.get(previewCue.id);
    if (directBitmap) {
      return directBitmap;
    }

    for (const sourceCueId of previewCue.sourceCueIds) {
      const sourceBitmap = bitmapByCueId.get(sourceCueId);
      if (sourceBitmap) {
        return sourceBitmap;
      }
    }

    return null;
  }

  function getPreviewBitmapPath(previewCue: SubtitleOcrCue): string | undefined {
    return getPreviewCueBitmap(previewCue)?.previewPath;
  }

  function selectCue(cueId: string): void {
    if (!disabled && onSelectCue) {
      onSelectCue(cueId);
    }
  }

  function handleFallbackSelect(): void {
    if (cue && canSelect) {
      onSelectCue?.(cue.id);
    }
  }

  function handleScroll(): void {
    if (applyingScroll || scrollFrameId !== null) {
      return;
    }

    scrollFrameId = requestAnimationFrame(() => {
      scrollFrameId = null;
      if (!applyingScroll) {
        scheduleScrollCommit();
      }
    });
  }

  function handleWheel(event: WheelEvent): void {
    const element = viewport;
    if (!element || !useScroller) {
      return;
    }

    const horizontalDelta = normalizeWheelDelta(event, element);
    if (horizontalDelta === 0) {
      return;
    }

    event.preventDefault();
    const maxDeltaPx = Math.max(1, element.clientWidth * WHEEL_PAGE_CAP_RATIO);
    const clampedDelta = Math.sign(horizontalDelta) * Math.min(
      Math.abs(horizontalDelta),
      maxDeltaPx,
    );
    element.scrollLeft += clampedDelta;
    scheduleScrollCommit();
  }

  function normalizeWheelDelta(event: WheelEvent, element: HTMLElement): number {
    const rawDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;

    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      return rawDelta * WHEEL_LINE_HEIGHT_PX;
    }

    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      return rawDelta * Math.max(1, element.clientWidth);
    }

    return rawDelta;
  }

  function scheduleScrollCommit(): void {
    clearCommitTimer();
    commitTimeoutId = window.setTimeout(() => {
      commitTimeoutId = null;
      commitScrollSelection();
    }, SCROLL_COMMIT_DELAY_MS);
  }

  function commitScrollSelection(): void {
    const element = viewport;
    if (!element || disabled || !onSelectCue || previewCues.length === 0) {
      return;
    }

    const now = performance.now();
    const elapsedMs = now - lastCommitMs;
    if (elapsedMs < MIN_COMMIT_INTERVAL_MS) {
      clearCommitTimer();
      commitTimeoutId = window.setTimeout(() => {
        commitTimeoutId = null;
        commitScrollSelection();
      }, MIN_COMMIT_INTERVAL_MS - elapsedMs);
      return;
    }

    const selectedIndex = Math.max(
      0,
      Math.min(
        previewCues.length - 1,
        Math.round(element.scrollLeft / Math.max(1, element.clientWidth)),
      ),
    );
    const nextCue = previewCues[selectedIndex];
    if (!nextCue || nextCue.id === cue?.id) {
      return;
    }

    lastCommitMs = now;
    onSelectCue(nextCue.id);
  }

  function clearScrollFrame(): void {
    if (scrollFrameId !== null) {
      cancelAnimationFrame(scrollFrameId);
      scrollFrameId = null;
    }
  }

  function clearCommitTimer(): void {
    if (commitTimeoutId !== null) {
      clearTimeout(commitTimeoutId);
      commitTimeoutId = null;
    }
  }

  function clearProgrammaticScrollTimer(): void {
    if (programmaticScrollTimeoutId !== null) {
      clearTimeout(programmaticScrollTimeoutId);
      programmaticScrollTimeoutId = null;
    }
  }
</script>

{#if useScroller}
  <ScrollArea
    bind:viewportRef={viewport}
    orientation="horizontal"
    class="size-full"
    scrollbarXClasses="h-1.5"
  >
    <div class="flex h-full snap-x snap-mandatory">
      {#each previewCues as previewCue, previewIndex (previewCue.id)}
        {@const previewBitmapPath = getPreviewBitmapPath(previewCue)}
        {@const previewSelected = previewCue.id === cue?.id}
        <button
          type="button"
          class={cn(
            'flex h-full min-w-full snap-center appearance-none items-center justify-center border-0 bg-transparent p-0 text-inherit transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
            previewSelected ? 'scale-100 opacity-100' : 'scale-[0.985] opacity-80',
          )}
          aria-label={`Select subtitle cue ${previewIndex + 1}`}
          aria-current={previewSelected ? 'true' : undefined}
          onclick={() => selectCue(previewCue.id)}
          disabled={!onSelectCue || disabled}
        >
          {#if previewBitmapPath}
            <img
              src={resolveBitmapSrc(previewBitmapPath)}
              alt={`Cue ${previewIndex + 1} bitmap`}
              loading={previewSelected ? 'eager' : 'lazy'}
              class="max-h-full max-w-full object-contain"
            />
          {:else}
            <span class="flex flex-col items-center gap-2 py-16 text-sm text-zinc-400">
              <ImageOff class="size-6" aria-hidden="true" />
              No preview
            </span>
          {/if}
        </button>
      {/each}
    </div>
  </ScrollArea>
{:else}
  <button
    type="button"
    class="flex size-full min-h-0 appearance-none items-center justify-center border-0 bg-transparent p-0 text-inherit disabled:pointer-events-none"
    aria-label="Select subtitle cue"
    onclick={handleFallbackSelect}
    disabled={!canSelect}
  >
    {#if fallbackBitmapPath}
      <img
        src={resolveBitmapSrc(fallbackBitmapPath)}
        alt={cueIndex !== undefined ? `Cue ${cueIndex + 1} bitmap` : 'Selected cue bitmap'}
        loading={selected ? 'eager' : 'lazy'}
        class="max-h-full max-w-full object-contain"
      />
    {:else}
      <span class="flex flex-col items-center gap-2 py-16 text-sm text-zinc-400">
        <ImageOff class="size-6" aria-hidden="true" />
        No preview
      </span>
    {/if}
  </button>
{/if}
