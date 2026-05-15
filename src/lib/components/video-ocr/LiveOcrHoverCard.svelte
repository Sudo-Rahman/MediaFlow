<script lang="ts">
  import type { OcrZoneFrame, OcrZoneRole } from '$lib/types';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as HoverCard from '$lib/components/ui/hover-card';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  interface LiveOcrHoverCardProps {
    detections: OcrZoneFrame[];
  }

  let { detections }: LiveOcrHoverCardProps = $props();

  const visibleDetections = $derived(detections.slice(-8).reverse());
  const allDetections = $derived([...detections].reverse());

  let dialogOpen = $state(false);

  function formatTimeMs(timeMs: number): string {
    const safeTimeMs = Math.max(0, Math.round(timeMs));
    const minutes = Math.floor(safeTimeMs / 60_000);
    const seconds = Math.floor((safeTimeMs % 60_000) / 1000);
    const milliseconds = safeTimeMs % 1000;

    return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }

  function roleLabel(role: OcrZoneRole): string {
    return role === 'main_subtitle' ? 'Main subtitle' : 'On-screen text';
  }

  function formatConfidence(confidence: number): string {
    return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
  }
</script>

<HoverCard.Root openDelay={150} closeDelay={100}>
  <HoverCard.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        type="button"
        variant="secondary"
        size="sm"
        class="h-7 rounded bg-background/90 px-2 text-xs shadow-sm backdrop-blur hover:bg-background"
      >
        Live detections · {detections.length}
      </Button>
    {/snippet}
  </HoverCard.Trigger>
  <HoverCard.Content
    align="start"
    side="bottom"
    sideOffset={6}
    collisionPadding={16}
    class="w-80 overflow-hidden rounded-lg p-0"
  >
    <div class="flex items-center justify-between gap-3 border-b px-3 py-2">
      <div class="min-w-0">
        <p class="text-sm font-medium">Live detections</p>
        <p class="text-[11px] text-muted-foreground">Latest recognized OCR text</p>
      </div>
      <Badge variant="secondary" class="shrink-0 text-[10px]">Provisional</Badge>
    </div>

    {#if visibleDetections.length > 0}
      <ScrollArea class="h-64" scrollbarYClasses="w-2">
        <div class="flex flex-col gap-2 p-3">
          {#each visibleDetections as detection (`${detection.frameIndex}:${detection.segmentId}:${detection.zoneId}:${detection.timeMs}`)}
            <div class="rounded-md border bg-muted/30 p-2">
              <div class="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span class="font-mono">{formatTimeMs(detection.timeMs)}</span>
                <span>{roleLabel(detection.role)}</span>
                <span class="ml-auto font-medium text-foreground">{formatConfidence(detection.confidence)}</span>
              </div>
              <p class="line-clamp-2 text-xs text-foreground">{detection.text}</p>
            </div>
          {/each}
        </div>
      </ScrollArea>
    {:else}
      <p class="px-3 py-4 text-xs text-muted-foreground">No live detections yet.</p>
    {/if}

    <div class="border-t p-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="w-full justify-center"
        onclick={() => {
          dialogOpen = true;
        }}
      >
        View all live detections
      </Button>
    </div>
  </HoverCard.Content>
</HoverCard.Root>

<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
    <Dialog.Header>
      <Dialog.Title>Live OCR detections</Dialog.Title>
      <Dialog.Description>
        Provisional OCR text detected during the current run.
      </Dialog.Description>
    </Dialog.Header>

    {#if allDetections.length > 0}
      <ScrollArea class="h-[60vh] rounded-md border" scrollbarYClasses="w-2">
        <div class="flex flex-col gap-2 p-3">
          {#each allDetections as detection (`dialog:${detection.frameIndex}:${detection.segmentId}:${detection.zoneId}:${detection.timeMs}`)}
            <div class="rounded-md border bg-muted/30 p-3">
              <div class="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span class="font-mono">{formatTimeMs(detection.timeMs)}</span>
                <Badge variant="outline" class="text-[10px]">{roleLabel(detection.role)}</Badge>
                <span class="ml-auto font-medium text-foreground">{formatConfidence(detection.confidence)}</span>
              </div>
              <p class="whitespace-pre-wrap text-sm text-foreground">{detection.text}</p>
            </div>
          {/each}
        </div>
      </ScrollArea>
    {:else}
      <p class="rounded-md border p-4 text-sm text-muted-foreground">No live detections yet.</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>
