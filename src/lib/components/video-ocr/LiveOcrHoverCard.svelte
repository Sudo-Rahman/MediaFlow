<script lang="ts">
  import type { OcrZoneFrame, OcrZoneRole } from '$lib/types';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as HoverCard from '$lib/components/ui/hover-card';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  interface LiveOcrHoverCardProps {
    detections: OcrZoneFrame[];
  }

  let { detections }: LiveOcrHoverCardProps = $props();

  const visibleDetections = $derived(detections.slice(-8).reverse());

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
  <HoverCard.Content align="start" side="top" class="w-80 rounded-lg p-3">
    <div class="mb-2 flex items-center justify-between gap-3">
      <p class="text-sm font-medium">Live detections</p>
      <Badge variant="secondary" class="text-[10px]">Provisional</Badge>
    </div>

    {#if visibleDetections.length > 0}
      <ScrollArea class="max-h-64 pr-3">
        <div class="space-y-2">
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
      <p class="text-xs text-muted-foreground">No live detections yet.</p>
    {/if}
  </HoverCard.Content>
</HoverCard.Root>
