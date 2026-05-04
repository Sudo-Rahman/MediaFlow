<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { Loader2 } from '@lucide/svelte';

  import { cn } from '$lib/utils';
  import { splitTextPreviewLines } from './virtualized-text-preview';

  interface VirtualizedTextPreviewProps {
    content: string;
    class?: string;
    emptyMessage?: string;
    loadingMessage?: string;
    lineHeight?: number;
  }

  let {
    content,
    class: className,
    emptyMessage = 'No content',
    loadingMessage = 'Preparing preview...',
    lineHeight = 20,
  }: VirtualizedTextPreviewProps = $props();

  let viewport = $state<HTMLDivElement | null>(null);
  let lines = $state.raw<string[]>([]);
  let isPreparing = $state(false);

  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => viewport,
    estimateSize: () => lineHeight,
    overscan: 16,
  });

  $effect(() => {
    const count = lines.length;
    const scrollElement = viewport;
    untrack(() => {
      get(rowVirtualizer).setOptions({
        count,
        getScrollElement: () => scrollElement,
        estimateSize: () => lineHeight,
        overscan: 16,
      });
    });
  });

  function scrollPreviewToTop(): void {
    untrack(() => {
      get(rowVirtualizer).scrollToOffset(0);
    });
  }

  $effect(() => {
    const nextContent = content;
    let cancelled = false;

    isPreparing = nextContent.length > 0;
    lines = [];

    const frameId = requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }

      lines = nextContent.length > 0 ? splitTextPreviewLines(nextContent) : [];
      isPreparing = false;

      tick().then(() => {
        if (!cancelled) {
          scrollPreviewToTop();
        }
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  });
</script>

<div
  bind:this={viewport}
  class={cn('h-full min-w-0 overflow-auto overscroll-contain bg-transparent', className)}
>
  {#if isPreparing}
    <div class="flex h-full items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 class="size-4 animate-spin" />
      <span>{loadingMessage}</span>
    </div>
  {:else if lines.length > 0}
    <div
      class="relative min-w-max"
      style={`height: ${$rowVirtualizer.getTotalSize()}px;`}
    >
      {#each $rowVirtualizer.getVirtualItems() as virtualRow (virtualRow.key)}
        {@const line = lines[virtualRow.index] ?? ''}
        <div
          class="absolute left-0 top-0 w-max min-w-full px-4 font-mono text-sm whitespace-pre [tab-size:2]"
          style={`height: ${virtualRow.size}px; transform: translateY(${virtualRow.start}px); line-height: ${lineHeight}px;`}
        >{line}</div>
      {/each}
    </div>
  {:else}
    <div class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      {emptyMessage}
    </div>
  {/if}
</div>
