<script lang="ts">
  import { Captions } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import type { ActiveCueSummary } from './preview-cues';
  import { roleLabelForCue } from './preview-cues';

  interface ActiveCueSummaryProps {
    summary: ActiveCueSummary;
    paletteOpen?: boolean;
    onOpenPalette?: () => void;
    class?: string;
  }

  let {
    summary,
    paletteOpen = false,
    onOpenPalette,
    class: className = '',
  }: ActiveCueSummaryProps = $props();

  const primaryLabel = $derived(
    summary.primaryCue ? roleLabelForCue(summary.primaryCue) : 'No active OCR cue',
  );
  const primaryText = $derived(
    summary.primaryCue?.subtitle.text.trim() || 'No OCR text at current time',
  );
  const activeCueCount = $derived(summary.activeCues.length);
  const showPaletteButton = $derived(activeCueCount > 0 || paletteOpen);
  const paletteButtonLabel = $derived(
    paletteOpen
      ? 'Active OCR cues palette is open'
      : `Open ${activeCueCount} active OCR ${activeCueCount === 1 ? 'cue' : 'cues'}`,
  );
</script>

<div class={cn('flex h-10 items-center gap-3 border-t bg-muted/35 px-3 py-1.5', className)}>
  <Captions class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

  <div class="min-w-0 flex-1">
    <div class="flex min-w-0 items-center gap-2">
      <span class="hidden max-w-40 shrink truncate text-xs font-medium text-muted-foreground xl:inline">
        {primaryLabel}
      </span>
      <span class="min-w-0 truncate text-sm font-medium text-foreground">{primaryText}</span>
    </div>
  </div>

  {#if showPaletteButton}
    <Button
      type="button"
      variant="secondary"
      size="sm"
      class="h-7 shrink-0 px-2 text-xs"
      aria-label={paletteButtonLabel}
      aria-pressed={paletteOpen}
      onclick={onOpenPalette}
    >
      <span aria-hidden="true">{activeCueCount}</span>
      <span class="hidden xl:inline">active cues</span>
    </Button>
  {/if}
</div>
