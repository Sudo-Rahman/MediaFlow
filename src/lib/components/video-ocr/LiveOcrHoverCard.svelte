<script lang="ts">
  import type { OcrZoneFrame, OcrZoneRole, VideoOcrSelection } from '$lib/types';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Empty from '$lib/components/ui/empty';
  import * as HoverCard from '$lib/components/ui/hover-card';
  import * as Item from '$lib/components/ui/item';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  interface LiveOcrHoverCardProps {
    detections: OcrZoneFrame[];
    detectionCount?: number;
    selection?: VideoOcrSelection;
    renderPopoverInline?: boolean;
    onOpenChange?: (open: boolean) => void;
  }

  let {
    detections,
    detectionCount,
    selection,
    renderPopoverInline = false,
    onOpenChange,
  }: LiveOcrHoverCardProps = $props();

  const visibleDetections = $derived(detections.slice(-8).reverse());
  const allDetections = $derived([...detections].reverse());
  const displayDetectionCount = $derived(Math.max(detections.length, detectionCount ?? 0));

  let dialogOpen = $state(false);
  let hoverOpen = $state(false);

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

  function zoneLabel(detection: OcrZoneFrame): string {
    const segment = selection?.segments.find((entry) => entry.id === detection.segmentId);
    const zoneIndex = segment?.zones.findIndex((zone) => zone.id === detection.zoneId) ?? -1;

    if (!segment || zoneIndex < 0) {
      return 'Unknown zone';
    }

    return segment.zones[zoneIndex].label?.trim() || `Zone ${zoneIndex + 1}`;
  }

  function formatConfidence(confidence: number): string {
    return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
  }
</script>

{#snippet detectionItem(detection: OcrZoneFrame)}
  {@const scopeLabel = `${roleLabel(detection.role)} · ${zoneLabel(detection)}`}
  <Item.Root variant="outline" size="xs" class="items-start">
    <Item.Content class="min-w-0">
      <Item.Title class="max-w-full gap-2 text-xs text-muted-foreground">
        <span class="shrink-0 font-mono font-normal">{formatTimeMs(detection.timeMs)}</span>
        <Badge variant="outline" class="min-w-0 max-w-44 truncate text-[10px]" title={scopeLabel}>
          {scopeLabel}
        </Badge>
        <span class="ml-auto shrink-0 font-medium text-foreground">{formatConfidence(detection.confidence)}</span>
      </Item.Title>
      <Item.Description class="whitespace-pre-wrap text-sm text-foreground line-clamp-none">
        {detection.text}
      </Item.Description>
    </Item.Content>
  </Item.Root>
{/snippet}

<HoverCard.Root
  bind:open={hoverOpen}
  openDelay={150}
  closeDelay={100}
  onOpenChange={(open) => {
    onOpenChange?.(open);
  }}
>
  <HoverCard.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        type="button"
        variant="secondary"
        size="sm"
        class="h-7 px-2 text-xs"
      >
        Live detections · {displayDetectionCount}
      </Button>
    {/snippet}
  </HoverCard.Trigger>
  <HoverCard.Content
    align="start"
    side="bottom"
    sideOffset={6}
    collisionPadding={16}
    portalProps={{ disabled: renderPopoverInline }}
    class="w-80 overflow-hidden p-0"
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
            {@render detectionItem(detection)}
          {/each}
        </div>
      </ScrollArea>
    {:else}
      <Empty.Root class="min-h-24 flex-none border-0 p-4">
        <Empty.Description>No live detections yet.</Empty.Description>
      </Empty.Root>
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
  <Dialog.Content class="flex h-[85dvh] max-h-[calc(100dvh-2rem)] max-w-3xl flex-col overflow-hidden">
    <Dialog.Header class="shrink-0">
      <Dialog.Title>Live OCR detections</Dialog.Title>
      <Dialog.Description>
        Provisional OCR text detected during the current run.
      </Dialog.Description>
    </Dialog.Header>

    {#if allDetections.length > 0}
      <ScrollArea class="min-h-0 flex-1 rounded-md border" scrollbarYClasses="w-2">
        <div class="flex flex-col gap-2 p-3">
          {#each allDetections as detection (`dialog:${detection.frameIndex}:${detection.segmentId}:${detection.zoneId}:${detection.timeMs}`)}
            {@render detectionItem(detection)}
          {/each}
        </div>
      </ScrollArea>
    {:else}
      <Empty.Root class="min-h-32 flex-none border p-4">
        <Empty.Description>No live detections yet.</Empty.Description>
      </Empty.Root>
    {/if}
  </Dialog.Content>
</Dialog.Root>
