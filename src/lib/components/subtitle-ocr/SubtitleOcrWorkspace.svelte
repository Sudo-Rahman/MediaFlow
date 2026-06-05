<script lang="ts">
  import { Layers, ScanText } from '@lucide/svelte';

  import { Badge } from '$lib/components/ui/badge';
  import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '$lib/components/ui/empty';
  import type {
    SubtitleOcrCue,
    SubtitleOcrCueBitmap,
    SubtitleOcrProcessingDraft,
    SubtitleOcrSourceItem,
    SubtitleOcrVersion,
  } from '$lib/types';
  import { buildSubtitleOcrSourceLabel } from '$lib/types';
  import { cn } from '$lib/utils';
  import {
    buildSubtitleOcrReviewStats,
    centerTimelineViewport,
    clampTimelineViewport,
    findCueNearestTimelineWindowCenter,
    resolveSubtitleOcrReviewMode,
    shouldSuppressSubtitleOcrReviewTextSelection,
    type SubtitleOcrReviewMode,
    type TimelineViewport,
  } from './subtitle-ocr-review-state';
  import SubtitleOcrCueCard from './SubtitleOcrCueCard.svelte';
  import SubtitleOcrCueRail from './SubtitleOcrCueRail.svelte';
  import SubtitleOcrTimeline from './SubtitleOcrTimeline.svelte';
  import SubtitleOcrVersionSelector from './SubtitleOcrVersionSelector.svelte';

  interface SubtitleOcrWorkspaceProps {
    item: SubtitleOcrSourceItem | null;
    reviewVersion: SubtitleOcrVersion | null;
    reviewBitmaps: SubtitleOcrCueBitmap[];
    renderedCues: SubtitleOcrCue[];
    selectedCueId: string | null;
    activeReviewTargetId: string | null;
    processingDraft?: SubtitleOcrProcessingDraft;
    isReadOnly: boolean;
    onSelectCue: (cueId: string) => void;
    onSelectVersion: (itemId: string, versionId: string) => void;
    onCueTextCommit: (itemId: string, cueId: string, text: string) => void;
  }

  type ViewportChangeSource = 'rail' | 'timeline-window' | 'timeline-zone' | 'timeline-zoom';
  type ActiveViewportSource = ViewportChangeSource | 'selection' | null;
  const REVIEW_HEADER_DETAILS_MIN_WIDTH_PX = 620;
  const VERSION_SELECTOR_COMPACT_WIDTH_PX = 520;

  let {
    item,
    reviewVersion: reviewVersionProp,
    reviewBitmaps,
    renderedCues,
    selectedCueId,
    activeReviewTargetId,
    processingDraft,
    isReadOnly,
    onSelectCue,
    onSelectVersion,
    onCueTextCommit,
  }: SubtitleOcrWorkspaceProps = $props();

  let viewportStartMs = $state(0);
  let viewportEndMs = $state(0);
  let viewportScopeKey = $state('');
  let recenteredSelectionKey = $state('');
  let activeViewportSource = $state<ActiveViewportSource>(null);
  let timelineWindowDragging = $state(false);
  let centerElement = $state<HTMLElement | null>(null);
  let centerWidthPx = $state(0);

  const reviewVersion = $derived(reviewVersionProp);
  const bitmaps = $derived(reviewBitmaps);
  const durationMs = $derived(resolveDurationMs(renderedCues, bitmaps));
  const selectedCue = $derived(
    renderedCues.find((cue) => cue.id === selectedCueId) ?? renderedCues[0] ?? null,
  );
  const effectiveSelectedCueId = $derived(selectedCue?.id ?? null);
  const activeVersionId = $derived(activeReviewTargetId);
  const reviewMode: SubtitleOcrReviewMode = $derived(resolveSubtitleOcrReviewMode(centerWidthPx));
  const bitmapByCueId = $derived.by(() => {
    const map = new Map<string, SubtitleOcrCueBitmap>();
    for (const bitmap of bitmaps) {
      map.set(bitmap.cueId, bitmap);
    }

    return map;
  });
  const selectedCueBitmap = $derived(getCueBitmap(selectedCue));
  const selectedCueIndex = $derived(
    selectedCue ? renderedCues.findIndex((cue) => cue.id === selectedCue.id) : -1,
  );
  const subtitleOcrReviewStats = $derived(buildSubtitleOcrReviewStats(renderedCues, durationMs));
  const compactVersionSelector = $derived(isNarrowMeasuredWidth(centerWidthPx, VERSION_SELECTOR_COMPACT_WIDTH_PX));
  const hideReviewModeDetails = $derived(isNarrowMeasuredWidth(centerWidthPx, REVIEW_HEADER_DETAILS_MIN_WIDTH_PX));
  const hideVersionIcon = $derived(compactVersionSelector);
  const canSelectPreviousCue = $derived(selectedCueIndex > 0);
  const canSelectNextCue = $derived(selectedCueIndex >= 0 && selectedCueIndex < renderedCues.length - 1);
  const suppressReviewTextSelection = $derived(shouldSuppressSubtitleOcrReviewTextSelection({
    timelineWindowDragging,
  }));

  $effect(() => {
    const element = centerElement;
    if (!element) {
      centerWidthPx = 0;
      return;
    }

    centerWidthPx = Math.round(element.clientWidth);

    const resizeObserver = new ResizeObserver(([entry]) => {
      centerWidthPx = Math.round(entry.contentRect.width);
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  });

  $effect(() => {
    const nextScopeKey = `${item?.id ?? 'none'}:${activeVersionId ?? 'none'}:${durationMs}:${renderedCues.length}`;
    if (nextScopeKey === viewportScopeKey) {
      return;
    }

    viewportScopeKey = nextScopeKey;
    recenteredSelectionKey = '';
    const nextViewport = createInitialViewport(selectedCue, durationMs);
    activeViewportSource = 'selection';
    viewportStartMs = nextViewport.startMs;
    viewportEndMs = nextViewport.endMs;
  });

  $effect(() => {
    if (!selectedCue || durationMs <= 0) {
      return;
    }

    const selectionKey = getSelectionRecenterKey(selectedCue.id);
    if (selectionKey === recenteredSelectionKey) {
      return;
    }

    if (activeViewportSource && activeViewportSource !== 'selection') {
      recenteredSelectionKey = selectionKey;
      return;
    }

    const nextViewport = centerTimelineViewport(selectedCue, resolveViewportSpanMs(), durationMs);
    recenteredSelectionKey = selectionKey;
    activeViewportSource = 'selection';
    viewportStartMs = nextViewport.startMs;
    viewportEndMs = nextViewport.endMs;
  });

  function resolveDurationMs(cues: readonly SubtitleOcrCue[], cueBitmaps: readonly SubtitleOcrCueBitmap[]): number {
    const cueEndMs = cues.reduce((max, cue) => Math.max(max, cue.endTimeMs), 0);
    const bitmapEndMs = cueBitmaps.reduce((max, bitmap) => Math.max(max, bitmap.endTimeMs), 0);

    return Math.max(cueEndMs, bitmapEndMs);
  }

  function createInitialViewport(cue: SubtitleOcrCue | null, totalDurationMs: number): TimelineViewport {
    if (totalDurationMs <= 0) {
      return { startMs: 0, endMs: 0 };
    }

    const spanMs = Math.min(totalDurationMs, Math.max(10_000, totalDurationMs * 0.12));

    return centerTimelineViewport(cue, spanMs, totalDurationMs);
  }

  function resolveViewportSpanMs(): number {
    if (durationMs <= 0) {
      return 0;
    }

    return Math.max(viewportEndMs - viewportStartMs, Math.min(30_000, durationMs));
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

  function centerViewportOnCue(cue: SubtitleOcrCue | null): void {
    if (!cue || durationMs <= 0) {
      return;
    }

    const nextViewport = centerTimelineViewport(cue, resolveViewportSpanMs(), durationMs);
    recenteredSelectionKey = getSelectionRecenterKey(cue.id);
    activeViewportSource = 'selection';
    viewportStartMs = nextViewport.startMs;
    viewportEndMs = nextViewport.endMs;
  }

  function getSelectionRecenterKey(cueId: string): string {
    return `${item?.id ?? 'none'}:${activeVersionId ?? 'none'}:${cueId}`;
  }

  function getVersionModeLabel(version: SubtitleOcrVersion): string {
    return version.mode === 'ai_cleanup_only' ? 'AI cleanup' : 'Full OCR';
  }

  function getReviewModeLabel(version: SubtitleOcrVersion | null): string {
    return version ? getVersionModeLabel(version) : 'OCR draft';
  }

  function handleViewportChange(
    startMs: number,
    endMs: number,
    source: ViewportChangeSource,
  ): void {
    const nextViewport = clampTimelineViewport(startMs, endMs, durationMs);
    activeViewportSource = source;
    viewportStartMs = nextViewport.startMs;
    viewportEndMs = nextViewport.endMs;

    if (source === 'timeline-window') {
      const targetCue = findCueNearestTimelineWindowCenter(renderedCues, nextViewport);
      if (targetCue && targetCue.id !== effectiveSelectedCueId) {
        onSelectCue(targetCue.id);
      }
    }
  }

  function handleTimelineWindowDragChange(dragging: boolean): void {
    timelineWindowDragging = dragging;
  }

  function handleSelectCue(cueId: string, source: ActiveViewportSource = 'selection'): void {
    activeViewportSource = source;
    onSelectCue(cueId);

    if (source === 'selection') {
      centerViewportOnCue(renderedCues.find((cue) => cue.id === cueId) ?? null);
    }
  }

  function handlePreviousCue(): void {
    if (!canSelectPreviousCue) {
      return;
    }

    const cue = renderedCues[selectedCueIndex - 1];
    if (!cue) {
      return;
    }

    onSelectCue(cue.id);
    centerViewportOnCue(cue);
  }

  function handleNextCue(): void {
    if (!canSelectNextCue) {
      return;
    }

    const cue = renderedCues[selectedCueIndex + 1];
    if (!cue) {
      return;
    }

    onSelectCue(cue.id);
    centerViewportOnCue(cue);
  }

  function handleSelectVersion(versionId: string): void {
    if (item) {
      onSelectVersion(item.id, versionId);
    }
  }

  function isNarrowMeasuredWidth(widthPx: number, thresholdPx: number): boolean {
    return widthPx > 0 && widthPx < thresholdPx;
  }

  function handleCueTextCommit(cueId: string, text: string): void {
    if (item) {
      onCueTextCommit(item.id, cueId, text);
    }
  }
</script>

{#if !item}
  <Empty class="h-full min-h-96 border-0">
    <EmptyHeader>
      <EmptyTitle>No subtitle source selected</EmptyTitle>
      <EmptyDescription>
        Select a subtitle source to review OCR previews, timing, and recognized text.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
{:else if item.versions.length === 0 && !processingDraft}
  <Empty class="h-full min-h-96 border-0">
    <EmptyHeader>
      <EmptyTitle>No OCR versions yet</EmptyTitle>
      <EmptyDescription>
        This source is ready for processing. Run Subtitle OCR to create a reviewable version.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
{:else if !reviewVersion && !processingDraft}
  <Empty class="h-full min-h-96 border-0">
    <EmptyHeader>
      <EmptyTitle>No active version</EmptyTitle>
      <EmptyDescription>
        Select an OCR version before reviewing cues.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
{:else}
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex min-w-0 shrink-0 items-center gap-3 border-b px-4 py-3">
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <ScanText class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 class="min-w-0 truncate text-base font-semibold">{item.displayName}</h2>
          <span
            class={cn(
              'inline-flex shrink-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out motion-reduce:transition-none',
              hideReviewModeDetails ? 'max-w-0 -translate-y-0.5 opacity-0' : 'max-w-24 translate-y-0 opacity-100',
            )}
          >
            <Badge variant="secondary">
              {getReviewModeLabel(reviewVersion)}
            </Badge>
          </span>
        </div>
        <p class="mt-1 min-w-0 truncate text-xs text-muted-foreground" title={`${buildSubtitleOcrSourceLabel(item)} · ${subtitleOcrReviewStats}`}>
          <span>{buildSubtitleOcrSourceLabel(item)}</span>
          <span
            class={cn(
              'inline-block overflow-hidden whitespace-nowrap align-bottom transition-[max-width,opacity,transform] duration-200 ease-out motion-reduce:transition-none',
              hideReviewModeDetails ? 'max-w-0 -translate-y-0.5 opacity-0' : 'max-w-48 translate-y-0 opacity-100',
            )}
          >
            · {subtitleOcrReviewStats}
          </span>
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <span
          class={cn(
            'inline-flex shrink-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out motion-reduce:transition-none',
            hideVersionIcon ? 'max-w-0 -translate-y-0.5 opacity-0' : 'max-w-4 translate-y-0 opacity-100',
          )}
        >
          <Layers class="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <SubtitleOcrVersionSelector
          versions={item.versions}
          activeVersionId={activeVersionId}
          {processingDraft}
          compact={compactVersionSelector}
          onSelectVersion={handleSelectVersion}
        />
      </div>
    </header>

    <div
      bind:this={centerElement}
      class={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        suppressReviewTextSelection && 'subtitle-ocr-review--lock-selection cursor-grabbing',
      )}
    >
      {#if reviewMode === 'wide'}
        <SubtitleOcrCueRail
          cues={renderedCues}
          {bitmaps}
          selectedCueId={effectiveSelectedCueId}
          {viewportStartMs}
          {viewportEndMs}
          viewportSource={activeViewportSource}
          {timelineWindowDragging}
          textDisabled={isReadOnly}
          onSelectCue={(cueId) => handleSelectCue(cueId, 'rail')}
          onTextCommit={handleCueTextCommit}
          onViewportChange={handleViewportChange}
        />

        <div class="shrink-0 border-b">
          <SubtitleOcrTimeline
            cues={renderedCues}
            durationMs={durationMs}
            viewportStartMs={viewportStartMs}
            viewportEndMs={viewportEndMs}
            selectedCueId={effectiveSelectedCueId}
            onSelectCue={(cueId) => handleSelectCue(cueId, 'timeline-zone')}
            onViewportChange={handleViewportChange}
            onWindowDragChange={handleTimelineWindowDragChange}
          />
        </div>
      {:else}
        <div class="flex min-h-0 flex-1 flex-col overflow-auto">
          <SubtitleOcrCueCard
            cue={selectedCue}
            bitmap={selectedCueBitmap}
            previewBitmaps={bitmaps}
            previewCues={renderedCues}
            selected={Boolean(selectedCue)}
            mode="compact"
            textDisabled={isReadOnly}
            cueIndex={selectedCueIndex >= 0 ? selectedCueIndex : undefined}
            showNavigation
            onSelectCue={(cueId) => handleSelectCue(cueId, 'selection')}
            onPreviousCue={canSelectPreviousCue ? handlePreviousCue : undefined}
            onNextCue={canSelectNextCue ? handleNextCue : undefined}
            onTextCommit={handleCueTextCommit}
          />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  :global(.subtitle-ocr-review--lock-selection),
  :global(.subtitle-ocr-review--lock-selection *) {
    user-select: none !important;
    -webkit-user-select: none !important;
  }
</style>
