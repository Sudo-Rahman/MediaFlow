<script lang="ts">
  import { Captions } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { cn } from '$lib/utils';
  import type { ActiveCueSummary } from './preview-cues';
  import { formatCueConfidence, roleLabelForCue } from './preview-cues';

  interface ActiveCueSummaryProps {
    summary: ActiveCueSummary;
    class?: string;
  }

  let { summary, class: className = '' }: ActiveCueSummaryProps = $props();

  const primaryLabel = $derived(
    summary.primaryCue ? roleLabelForCue(summary.primaryCue) : 'No active OCR cue',
  );
  const primaryText = $derived(
    summary.primaryCue?.subtitle.text.trim() || 'No OCR text at current time',
  );
  const hasMultipleCues = $derived(summary.activeCues.length > 1);
</script>

<div class={cn('flex h-10 items-center gap-3 border-t bg-muted/35 px-3 py-1.5', className)}>
  <Captions class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

  <div class="min-w-0 flex-1">
    <div class="flex min-w-0 items-center gap-2">
      <span class="shrink-0 text-xs font-medium text-muted-foreground">{primaryLabel}</span>
      <span class="min-w-0 truncate text-sm font-medium text-foreground">{primaryText}</span>
    </div>
  </div>

  {#if hasMultipleCues}
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            type="button"
            variant="secondary"
            size="sm"
            class="h-7 shrink-0 px-2 text-xs"
            aria-label={`Show ${summary.activeCues.length} active OCR cues`}
          >
            {summary.activeCues.length} active cues
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content align="end" side="top" sideOffset={8} class="w-96 max-w-[calc(100vw-2rem)] p-0">
        <Popover.Header class="border-b px-3 py-2">
          <Popover.Title>Active OCR Cues</Popover.Title>
          <Popover.Description>OCR text active at the current playback time.</Popover.Description>
        </Popover.Header>
        <ScrollArea class="max-h-72" scrollbarYClasses="w-2">
          <div class="flex flex-col gap-2 p-3">
            {#each summary.activeCues as cue (`${cue.subtitle.id}:${cue.subtitle.zoneId ?? ''}`)}
              <div class="rounded-md border bg-background p-2">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                    {roleLabelForCue(cue)}
                  </span>
                  <span class="shrink-0 text-xs font-medium text-foreground">
                    {formatCueConfidence(cue.subtitle.confidence)}
                  </span>
                </div>
                <p class="mt-1 whitespace-pre-wrap text-sm text-foreground">{cue.subtitle.text}</p>
              </div>
            {/each}
          </div>
        </ScrollArea>
      </Popover.Content>
    </Popover.Root>
  {/if}
</div>
