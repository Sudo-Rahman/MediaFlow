<script lang="ts">
  import { convertFileSrc } from '@tauri-apps/api/core';

  import type { SubtitleOcrCue, SubtitleOcrCueBitmap } from '$lib/types';
  import { cn } from '$lib/utils';
  import {
    buildTimelineBuckets,
    clampTimelineViewport,
    panTimelineViewport,
    type TimelineBucket,
    type TimelineViewport,
    zoomTimelineViewport,
  } from './subtitle-ocr-review-state';

  interface SubtitleOcrTimelineProps {
    cues: SubtitleOcrCue[];
    bitmaps?: SubtitleOcrCueBitmap[];
    durationMs: number;
    viewportStartMs: number;
    viewportEndMs: number;
    selectedCueId?: string | null;
    selectedCueStartMs?: number;
    onSelectCue?: (cueId: string) => void;
    onViewportChange: (startMs: number, endMs: number, source: 'timeline') => void;
  }

  interface DragState {
    pointerId: number;
    startClientX: number;
    trackWidth: number;
    viewportStartMs: number;
    viewportEndMs: number;
    didDrag: boolean;
  }

  let {
    cues,
    bitmaps = [],
    durationMs,
    viewportStartMs,
    viewportEndMs,
    selectedCueId = null,
    onSelectCue = () => {},
    onViewportChange,
  }: SubtitleOcrTimelineProps = $props();

  const THUMBNAIL_URL_PATH = /^(?:https?:\/\/|data:|blob:|\/\/)/i;
  const CLICK_DRAG_THRESHOLD_PX = 4;
  const MIN_BUCKET_WIDTH_PX = 104;

  let trackElement = $state<HTMLDivElement | null>(null);
  let timelineWidthPx = $state(0);
  let dragState = $state<DragState | null>(null);
  let suppressNextClick = false;
  let pendingViewport: TimelineViewport | null = null;
  let viewportFrameId: number | null = null;

  const safeDurationMs = $derived(Math.max(0, Math.round(durationMs)));
  const viewport = $derived(clampTimelineViewport(viewportStartMs, viewportEndMs, safeDurationMs));
  const viewportSpanMs = $derived(Math.max(0, viewport.endMs - viewport.startMs));

  const bitmapByCueId = $derived.by(() => {
    const map = new Map<string, SubtitleOcrCueBitmap>();
    for (const bitmap of bitmaps) {
      map.set(bitmap.cueId, bitmap);
    }

    return map;
  });

  const buckets = $derived.by((): TimelineBucket<SubtitleOcrCue>[] => {
    if (safeDurationMs <= 0 || timelineWidthPx <= 0) {
      return [];
    }

    return buildTimelineBuckets(cues, {
      viewport,
      durationMs: safeDurationMs,
      timelineWidthPx,
      minBucketWidthPx: MIN_BUCKET_WIDTH_PX,
    });
  });

  $effect(() => {
    const element = trackElement;
    if (!element) {
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
    return () => {
      if (viewportFrameId !== null) {
        cancelAnimationFrame(viewportFrameId);
      }
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

  function formatBucketRange(bucket: TimelineBucket<SubtitleOcrCue>): string {
    return `${formatTime(bucket.startMs)} - ${formatTime(bucket.endMs)}`;
  }

  function getBucketFlexBasis(bucket: TimelineBucket<SubtitleOcrCue>): string {
    if (viewportSpanMs <= 0) {
      return '0%';
    }

    const bucketSpanMs = Math.max(0, bucket.endMs - bucket.startMs);
    return `${(bucketSpanMs / viewportSpanMs) * 100}%`;
  }

  function queueViewportChange(nextViewport: TimelineViewport): void {
    if (safeDurationMs <= 0) {
      return;
    }

    pendingViewport = clampTimelineViewport(nextViewport.startMs, nextViewport.endMs, safeDurationMs);

    if (viewportFrameId !== null) {
      return;
    }

    viewportFrameId = requestAnimationFrame(() => {
      viewportFrameId = null;
      const queuedViewport = pendingViewport;
      pendingViewport = null;

      if (!queuedViewport) {
        return;
      }

      onViewportChange(queuedViewport.startMs, queuedViewport.endMs, 'timeline');
    });
  }

  function getCueBitmap(cue: SubtitleOcrCue | null): SubtitleOcrCueBitmap | null {
    if (!cue) {
      return null;
    }

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

  function resolveThumbnailSrc(thumbnailPath: string): string {
    return THUMBNAIL_URL_PATH.test(thumbnailPath) ? thumbnailPath : convertFileSrc(thumbnailPath);
  }

  function getBucketTargetCue(bucket: TimelineBucket<SubtitleOcrCue>): SubtitleOcrCue | null {
    return bucket.exactCue ?? bucket.representativeCue;
  }

  function getBucketLabel(bucket: TimelineBucket<SubtitleOcrCue>): string {
    const targetCue = getBucketTargetCue(bucket);
    if (targetCue) {
      return `Select cue at ${formatBucketRange(bucket)}`;
    }

    return `Center timeline on empty range ${formatBucketRange(bucket)}`;
  }

  function handleWheel(event: WheelEvent): void {
    if (safeDurationMs <= 0 || viewportSpanMs <= 0) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget instanceof HTMLElement
      ? event.currentTarget.getBoundingClientRect()
      : null;
    const anchorRatio = rect && rect.width > 0
      ? (event.clientX - rect.left) / rect.width
      : 0.5;
    const factor = event.deltaY > 0 ? 1.18 : 0.82;

    queueViewportChange(zoomTimelineViewport(viewport, safeDurationMs, factor, anchorRatio));
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !trackElement || safeDurationMs <= 0 || viewportSpanMs <= 0) {
      return;
    }

    const trackWidth = trackElement.clientWidth;
    if (trackWidth <= 0) {
      return;
    }

    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
      target.setPointerCapture(event.pointerId);
    }

    dragState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      trackWidth,
      viewportStartMs: viewport.startMs,
      viewportEndMs: viewport.endMs,
      didDrag: false,
    };
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startClientX;
    const didDrag = dragState.didDrag || Math.abs(deltaX) > CLICK_DRAG_THRESHOLD_PX;
    dragState = {
      ...dragState,
      didDrag,
    };

    if (!didDrag) {
      return;
    }

    const deltaMs = -(deltaX / dragState.trackWidth) * viewportSpanMs;
    queueViewportChange(
      panTimelineViewport(
        { startMs: dragState.viewportStartMs, endMs: dragState.viewportEndMs },
        safeDurationMs,
        deltaMs,
      ),
    );
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    suppressNextClick = dragState.didDrag;
    dragState = null;
  }

  function handleBucketClick(bucket: TimelineBucket<SubtitleOcrCue>): void {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }

    const targetCue = getBucketTargetCue(bucket);
    if (targetCue) {
      onSelectCue(targetCue.id);
      return;
    }

    const centerMs = bucket.startMs + (bucket.endMs - bucket.startMs) / 2;
    const spanMs = Math.max(1_000, viewportSpanMs);
    queueViewportChange(
      clampTimelineViewport(
        centerMs - spanMs / 2,
        centerMs + spanMs / 2,
        safeDurationMs,
      ),
    );
  }

</script>

<section class="flex flex-col gap-3 px-4 py-3" aria-label="Subtitle OCR timeline">
  <div class="min-w-0">
    <h3 class="text-sm font-medium">Timeline</h3>
    <p class="truncate text-xs text-muted-foreground">
      {formatTime(viewport.startMs)} - {formatTime(viewport.endMs)}
    </p>
  </div>

  <div
    bind:this={trackElement}
    class={cn(
      'flex h-20 gap-1 overflow-hidden rounded-lg border bg-muted/30 p-1 outline-none',
      dragState?.didDrag ? 'cursor-grabbing' : 'cursor-grab',
    )}
    role="list"
    aria-label="Timeline buckets"
    onwheel={handleWheel}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
  >
    {#if buckets.length === 0}
      <div class="flex min-w-0 flex-1 items-center justify-center text-xs text-muted-foreground">
        No cues
      </div>
    {:else}
      {#each buckets as bucket (bucket.id)}
        {@const bucketCue = getBucketTargetCue(bucket)}
        {@const bucketBitmap = getCueBitmap(bucketCue)}
        <div
          role="listitem"
          class="min-w-0 shrink"
          style={`flex-basis: ${getBucketFlexBasis(bucket)};`}
        >
          <button
            type="button"
            class={cn(
              'group relative size-full overflow-hidden rounded-md border text-left outline-none transition-colors',
              'focus-visible:ring-ring/30 focus-visible:ring-3',
              bucket.isGap
                ? 'border-dashed bg-background/70 hover:bg-muted'
                : 'border-border bg-background hover:border-primary/60',
              bucketCue?.id === selectedCueId && 'border-primary ring-2 ring-primary/30',
            )}
            aria-label={getBucketLabel(bucket)}
            aria-current={bucketCue?.id === selectedCueId ? 'true' : undefined}
            onclick={() => handleBucketClick(bucket)}
          >
            {#if bucketBitmap?.thumbnailPath}
              <img
                class="size-full object-cover"
                src={resolveThumbnailSrc(bucketBitmap.thumbnailPath)}
                alt=""
                loading="lazy"
                draggable="false"
              />
              <div class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" aria-hidden="true"></div>
            {:else}
              <div
                class={cn(
                  'absolute inset-0',
                  bucket.isGap
                    ? 'bg-[repeating-linear-gradient(135deg,var(--muted)_0,var(--muted)_8px,transparent_8px,transparent_16px)] opacity-70'
                    : 'bg-muted',
                )}
                aria-hidden="true"
              ></div>
            {/if}

            <span class="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] leading-none text-white">
              {formatTime(bucket.startMs)}
            </span>
            <span class="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] leading-none text-white">
              {bucket.cueCount > 0 ? bucket.cueCount : 'No cues'}
            </span>
          </button>
        </div>
      {/each}
    {/if}
  </div>
</section>
