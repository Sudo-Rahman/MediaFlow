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
  import { clampTimelineViewport, type TimelineViewport } from './subtitle-ocr-review-state';
  import SubtitleOcrBasket from './SubtitleOcrBasket.svelte';
  import SubtitleOcrFilmstrip from './SubtitleOcrFilmstrip.svelte';
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

  type ViewportChangeSource = 'filmstrip' | 'timeline';

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

  const reviewVersion = $derived(
    activeVersion
      ?? item?.versions.find((version) => version.id === item.activeVersionId)
      ?? item?.versions[0]
      ?? null,
  );
  const bitmaps = $derived(reviewVersion?.bitmaps ?? []);
  const durationMs = $derived(resolveDurationMs(renderedCues, bitmaps));
  const selectedCue = $derived(renderedCues.find((cue) => cue.id === selectedCueId) ?? null);
  const activeVersionId = $derived(reviewVersion?.id ?? item?.activeVersionId ?? null);

  $effect(() => {
    const nextScopeKey = `${item?.id ?? 'none'}:${activeVersionId ?? 'none'}:${durationMs}:${renderedCues.length}`;
    if (nextScopeKey === viewportScopeKey) {
      return;
    }

    viewportScopeKey = nextScopeKey;
    const nextViewport = createInitialViewport(selectedCue, durationMs);
    viewportStartMs = nextViewport.startMs;
    viewportEndMs = nextViewport.endMs;
  });

  $effect(() => {
    if (!selectedCue || durationMs <= 0) {
      return;
    }

    if (selectedCue.startTimeMs >= viewportStartMs && selectedCue.endTimeMs <= viewportEndMs) {
      return;
    }

    const spanMs = Math.max(viewportEndMs - viewportStartMs, Math.min(30_000, durationMs));
    const nextStartMs = selectedCue.startTimeMs - spanMs * 0.25;
    const nextViewport = clampTimelineViewport(nextStartMs, nextStartMs + spanMs, durationMs);
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
    const startMs = cue ? cue.startTimeMs - spanMs * 0.25 : 0;

    return clampTimelineViewport(startMs, startMs + spanMs, totalDurationMs);
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
    _source: ViewportChangeSource,
  ): void {
    const nextViewport = clampTimelineViewport(startMs, endMs, durationMs);
    viewportStartMs = nextViewport.startMs;
    viewportEndMs = nextViewport.endMs;
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

    <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="shrink-0 border-b">
          <SubtitleOcrFilmstrip
            bitmaps={bitmaps}
            cues={renderedCues}
            selectedCueId={selectedCueId}
            viewportStartMs={viewportStartMs}
            viewportEndMs={viewportEndMs}
            onSelectCue={onSelectCue}
            onViewportChange={handleViewportChange}
          />
        </div>

        <div class="shrink-0 border-b lg:border-b-0">
          <SubtitleOcrTimeline
            cues={renderedCues}
            durationMs={durationMs}
            viewportStartMs={viewportStartMs}
            viewportEndMs={viewportEndMs}
            selectedCueStartMs={selectedCue?.startTimeMs}
            onViewportChange={handleViewportChange}
          />
        </div>
      </div>

      <aside class="min-h-0 border-t lg:w-[24rem] lg:border-l lg:border-t-0">
        <SubtitleOcrBasket
          cue={selectedCue}
          onTextChange={handleCueTextChange}
        />
      </aside>
    </div>
  </div>
{/if}
