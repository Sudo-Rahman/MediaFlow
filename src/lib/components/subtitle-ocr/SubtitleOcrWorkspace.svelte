<script lang="ts">
  import { Layers, Save, ScanText } from '@lucide/svelte';

  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '$lib/components/ui/empty';
  import type {
    SubtitleOcrCue,
    SubtitleOcrCueBitmap,
    SubtitleOcrSourceItem,
    SubtitleOcrVersion,
  } from '$lib/types';
  import { buildSubtitleOcrSourceLabel } from '$lib/types';
  import {
    centerTimelineViewport,
    clampTimelineViewport,
    resolveSubtitleOcrReviewMode,
    type SubtitleOcrReviewMode,
    type TimelineViewport,
  } from './subtitle-ocr-review-state';
  import SubtitleOcrCueCard from './SubtitleOcrCueCard.svelte';
  import SubtitleOcrCueRail from './SubtitleOcrCueRail.svelte';
  import SubtitleOcrTimeline from './SubtitleOcrTimeline.svelte';
  import SubtitleOcrVersionSelector from './SubtitleOcrVersionSelector.svelte';

  interface SubtitleOcrWorkspaceProps {
    item: SubtitleOcrSourceItem | null;
    activeVersion: SubtitleOcrVersion | null;
    renderedCues: SubtitleOcrCue[];
    selectedCueId: string | null;
    onSelectCue: (cueId: string) => void;
    onSelectVersion: (itemId: string, versionId: string) => void;
    onCueTextChange: (itemId: string, cueId: string, text: string) => void;
    onSaveDraftVersion: (itemId: string) => void | Promise<void>;
    isProcessing: boolean;
  }

  type ViewportChangeSource = 'rail' | 'timeline';
  type ActiveViewportSource = ViewportChangeSource | 'selection' | null;

  let {
    item,
    activeVersion,
    renderedCues,
    selectedCueId,
    onSelectCue,
    onSelectVersion,
    onCueTextChange,
    onSaveDraftVersion,
    isProcessing,
  }: SubtitleOcrWorkspaceProps = $props();

  let viewportStartMs = $state(0);
  let viewportEndMs = $state(0);
  let viewportScopeKey = $state('');
  let recenteredSelectionKey = $state('');
  let activeViewportSource = $state<ActiveViewportSource>(null);
  let centerElement = $state<HTMLElement | null>(null);
  let centerWidthPx = $state(0);

  const reviewVersion = $derived(
    activeVersion
      ?? item?.versions.find((version) => version.id === item.activeVersionId)
      ?? item?.versions[0]
      ?? null,
  );
  const bitmaps = $derived(reviewVersion?.bitmaps ?? []);
  const durationMs = $derived(resolveDurationMs(renderedCues, bitmaps));
  const selectedCue = $derived(
    renderedCues.find((cue) => cue.id === selectedCueId) ?? renderedCues[0] ?? null,
  );
  const effectiveSelectedCueId = $derived(selectedCue?.id ?? null);
  const activeVersionId = $derived(reviewVersion?.id ?? item?.activeVersionId ?? null);
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
  const canSelectPreviousCue = $derived(selectedCueIndex > 0);
  const canSelectNextCue = $derived(selectedCueIndex >= 0 && selectedCueIndex < renderedCues.length - 1);

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

    if (activeViewportSource === 'timeline') {
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

  function getVersionModeLabel(version: SubtitleOcrVersion): string {
    return version.mode === 'ai_cleanup_only' ? 'AI cleanup' : 'Full OCR';
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
  }

  function handleSelectCue(cueId: string, source: ActiveViewportSource = 'selection'): void {
    activeViewportSource = source;
    onSelectCue(cueId);

    if (source !== 'timeline') {
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

  function handleCueTextChange(cueId: string, text: string): void {
    if (item) {
      onCueTextChange(item.id, cueId, text);
    }
  }
</script>

{#if !item}
  <Empty class="h-full min-h-96 border-0">
    <EmptyHeader>
      <EmptyTitle>No subtitle source selected</EmptyTitle>
      <EmptyDescription>
        Select a subtitle source to review OCR thumbnails, timing, and recognized text.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
{:else if item.versions.length === 0}
  <Empty class="h-full min-h-96 border-0">
    <EmptyHeader>
      <EmptyTitle>No OCR versions yet</EmptyTitle>
      <EmptyDescription>
        This source is ready for processing. Run Subtitle OCR to create a reviewable version.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
{:else if !reviewVersion}
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
    <header class="flex shrink-0 flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-2">
          <ScanText class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 class="truncate text-base font-semibold">{item.displayName}</h2>
          <Badge variant="secondary" class="shrink-0">
            {getVersionModeLabel(reviewVersion)}
          </Badge>
          {#if item.draft?.dirty}
            <Badge variant="outline" class="shrink-0">Draft edits</Badge>
          {/if}
        </div>
        <p class="mt-1 truncate text-xs text-muted-foreground" title={buildSubtitleOcrSourceLabel(item)}>
          {buildSubtitleOcrSourceLabel(item)} · {renderedCues.length} cue{renderedCues.length === 1 ? '' : 's'} · {formatTime(durationMs)}
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        {#if item.draft?.dirty}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onclick={() => void onSaveDraftVersion(item.id)}
            disabled={isProcessing}
          >
            <Save class="size-4" />
            Save Draft Version
          </Button>
        {/if}
        <Layers class="size-4 text-muted-foreground" aria-hidden="true" />
        <SubtitleOcrVersionSelector
          versions={item.versions}
          activeVersionId={reviewVersion.id}
          onSelectVersion={handleSelectVersion}
        />
      </div>
    </header>

    <div bind:this={centerElement} class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {#if reviewMode === 'wide'}
        <SubtitleOcrCueRail
          cues={renderedCues}
          {bitmaps}
          selectedCueId={effectiveSelectedCueId}
          {viewportStartMs}
          {viewportEndMs}
          viewportSource={activeViewportSource}
          disabled={isProcessing}
          onSelectCue={(cueId) => handleSelectCue(cueId, 'rail')}
          onTextChange={handleCueTextChange}
          onViewportChange={handleViewportChange}
        />

        <div class="shrink-0 border-b">
          <SubtitleOcrTimeline
            cues={renderedCues}
            bitmaps={bitmaps}
            durationMs={durationMs}
            viewportStartMs={viewportStartMs}
            viewportEndMs={viewportEndMs}
            selectedCueId={effectiveSelectedCueId}
            selectedCueStartMs={selectedCue?.startTimeMs}
            onSelectCue={(cueId) => handleSelectCue(cueId, 'timeline')}
            onViewportChange={handleViewportChange}
          />
        </div>
      {:else}
        <div class="flex min-h-0 flex-1 flex-col overflow-auto">
          <SubtitleOcrCueCard
            cue={selectedCue}
            bitmap={selectedCueBitmap}
            selected={Boolean(selectedCue)}
            mode="compact"
            disabled={isProcessing}
            cueIndex={selectedCueIndex >= 0 ? selectedCueIndex : undefined}
            showNavigation
            onPreviousCue={canSelectPreviousCue ? handlePreviousCue : undefined}
            onNextCue={canSelectNextCue ? handleNextCue : undefined}
            onTextChange={handleCueTextChange}
          />
        </div>
      {/if}
    </div>
  </div>
{/if}
