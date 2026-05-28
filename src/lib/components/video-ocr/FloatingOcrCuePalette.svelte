<script lang="ts">
  import { GripHorizontal, X } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Empty from '$lib/components/ui/empty';
  import * as Item from '$lib/components/ui/item';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { cn } from '$lib/utils';
  import type { ActiveCueSummary } from './preview-cues';
  import { formatCueConfidence, roleLabelForCue } from './preview-cues';
  import {
    clampFloatingPalettePosition,
    getViewportFloatingPaletteRect,
    type FloatingPalettePosition,
  } from './floating-palette-position';

  interface FloatingOcrCuePaletteProps {
    summary: ActiveCueSummary;
    position: FloatingPalettePosition;
    onPositionChange?: (position: FloatingPalettePosition) => void;
    onClose?: () => void;
    class?: string;
  }

  let {
    summary,
    position,
    onPositionChange,
    onClose,
    class: className = '',
  }: FloatingOcrCuePaletteProps = $props();

  const PALETTE_PADDING = 16;

  let paletteEl = $state<HTMLDivElement | null>(null);
  let dragState = $state<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPosition: FloatingPalettePosition;
  } | null>(null);

  const positionStyle = $derived(`left: ${position.x}px; top: ${position.y}px;`);

  $effect(() => {
    if (!paletteEl) {
      return;
    }

    const observer = new ResizeObserver(() => {
      clampCurrentPosition();
    });

    observer.observe(paletteEl);
    window.addEventListener('resize', clampCurrentPosition);
    clampCurrentPosition();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', clampCurrentPosition);
    };
  });

  $effect(() => {
    if (!dragState) {
      return;
    }

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  });

  function getClampedPosition(nextPosition: FloatingPalettePosition): FloatingPalettePosition {
    if (!paletteEl) {
      return nextPosition;
    }

    return clampFloatingPalettePosition(
      nextPosition,
      getViewportFloatingPaletteRect(),
      paletteEl.getBoundingClientRect(),
      PALETTE_PADDING,
    );
  }

  function clampCurrentPosition(): void {
    const clampedPosition = getClampedPosition(position);
    if (clampedPosition.x === position.x && clampedPosition.y === position.y) {
      return;
    }

    onPositionChange?.(clampedPosition);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select, [role="button"]')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: position,
    };
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    event.preventDefault();
    const nextPosition = getClampedPosition({
      x: dragState.startPosition.x + event.clientX - dragState.startClientX,
      y: dragState.startPosition.y + event.clientY - dragState.startClientY,
    });

    onPositionChange?.(nextPosition);
  }

  function handlePointerEnd(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    event.preventDefault();
    dragState = null;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    onClose?.();
  }
</script>

<svelte:window
  onpointermove={handlePointerMove}
  onpointerup={handlePointerEnd}
  onpointercancel={handlePointerEnd}
  onkeydown={handleKeydown}
/>

<Card.Root
  bind:ref={paletteEl}
  class={cn(
    'fixed z-40 w-96 max-w-[calc(100vw_-_2rem)] gap-0 py-0',
    className,
  )}
  size="sm"
  style={positionStyle}
  role="region"
  aria-label="Active OCR cues"
>
  <Card.Header
    class={cn(
      'grid-cols-[auto_1fr_auto] items-start gap-x-3 border-b px-3 py-2 cursor-grab touch-none select-none active:cursor-grabbing',
      dragState && 'cursor-grabbing',
    )}
    role="group"
    aria-label="Drag active OCR cues palette"
    onpointerdown={handlePointerDown}
  >
    <GripHorizontal class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <div class="min-w-0">
      <Card.Title class="text-sm font-semibold leading-none">Active OCR Cues</Card.Title>
      <Card.Description class="mt-1 text-xs">OCR text active at the current playback time.</Card.Description>
    </div>
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      class="shrink-0"
      aria-label="Close active OCR cues palette"
      onclick={() => onClose?.()}
    >
      <X class="size-3.5" aria-hidden="true" />
    </Button>
  </Card.Header>

  {#if summary.activeCues.length > 0}
    <ScrollArea class="max-h-72" scrollbarYClasses="w-2">
      <Card.Content class="flex flex-col gap-2 p-3">
        {#each summary.activeCues as cue (`${cue.subtitle.id}:${cue.subtitle.zoneId ?? ''}`)}
          <Item.Root variant="outline" size="xs" class="flex-nowrap items-start">
            <Item.Content class="min-w-0">
              <Item.Title class="w-auto max-w-full truncate text-xs text-muted-foreground">
                {roleLabelForCue(cue)}
              </Item.Title>
              <Item.Description class="line-clamp-none whitespace-pre-wrap break-words text-foreground">
                {cue.subtitle.text}
              </Item.Description>
            </Item.Content>
            <Item.Actions class="shrink-0 text-xs font-medium text-foreground">
              {formatCueConfidence(cue.subtitle.confidence)}
            </Item.Actions>
          </Item.Root>
        {/each}
      </Card.Content>
    </ScrollArea>
  {:else}
    <Card.Content class="p-3">
      <Empty.Root class="min-h-[3.25rem] flex-none border-0 p-0">
        <Empty.Description>No active OCR cues at the current playback time.</Empty.Description>
      </Empty.Root>
    </Card.Content>
  {/if}
</Card.Root>
