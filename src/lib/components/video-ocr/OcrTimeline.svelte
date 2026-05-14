<script lang="ts">
  import type { OcrZoneRole, VideoOcrSelection } from '$lib/types';
  import { assignOcrTimelineLanes, cn } from '$lib/utils';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  interface OcrTimelineProps {
    selection: VideoOcrSelection;
    durationMs: number;
    currentTimeMs: number;
    selectedSegmentId?: string | null;
    selectedZoneId?: string | null;
    onSelect?: (segmentId: string, zoneId: string) => void;
    onSetRole?: (segmentId: string, zoneId: string, role: OcrZoneRole) => void;
    onDeleteZone?: (segmentId: string, zoneId: string) => void;
    onTrimSegment?: (segmentId: string, startTimeMs: number, endTimeMs: number) => void;
  }

  interface RoleConfig {
    role: OcrZoneRole;
    label: string;
    emptyLabel: string;
    blockClass: string;
  }

  interface RoleBlock {
    id: string;
    segmentId: string;
    zoneId: string;
    label: string;
    startTimeMs: number;
    endTimeMs: number;
  }

  let {
    selection,
    durationMs,
    currentTimeMs,
    selectedSegmentId = null,
    selectedZoneId = null,
    onSelect,
    onSetRole,
    onDeleteZone,
  }: OcrTimelineProps = $props();

  const roles: RoleConfig[] = [
    {
      role: 'main_subtitle',
      label: 'Main subtitle',
      emptyLabel: 'No subtitle zones',
      blockClass: 'border-sky-500/70 bg-sky-500/15 text-sky-950 dark:text-sky-100',
    },
    {
      role: 'on_screen_text',
      label: 'On-screen text',
      emptyLabel: 'No on-screen text zones',
      blockClass: 'border-amber-500/70 bg-amber-500/15 text-amber-950 dark:text-amber-100',
    },
  ];

  const safeDurationMs = $derived(Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1);
  const segmentCount = $derived(selection.segments.length);

  function blocksForRole(role: OcrZoneRole): RoleBlock[] {
    return selection.segments.flatMap((segment) =>
      segment.zones
        .filter((zone) => zone.role === role)
        .map((zone, zoneIndex) => ({
          id: `${segment.id}:${zone.id}`,
          segmentId: segment.id,
          zoneId: zone.id,
          label: zone.label ?? `Zone ${zoneIndex + 1}`,
          startTimeMs: segment.startTimeMs,
          endTimeMs: segment.endTimeMs,
        })),
    );
  }

  function percentage(timeMs: number): number {
    return Math.max(0, Math.min(100, (timeMs / safeDurationMs) * 100));
  }

  function formatTime(timeMs: number): string {
    const safeTimeMs = Math.max(0, Math.round(timeMs));
    const totalSeconds = Math.floor(safeTimeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
</script>

<Card class="min-h-0 overflow-hidden">
  <CardHeader class="px-4 py-3">
    <div class="flex items-center justify-between gap-3">
      <CardTitle class="text-sm">OCR timeline</CardTitle>
      <div class="flex items-center gap-2">
        <Badge variant="secondary">{segmentCount} segments</Badge>
        <Badge variant="outline">{formatTime(currentTimeMs)}</Badge>
      </div>
    </div>
  </CardHeader>
  <CardContent class="space-y-3 px-4 pb-4">
    {#each roles as roleConfig (roleConfig.role)}
      {@const blocks = assignOcrTimelineLanes(blocksForRole(roleConfig.role))}
      {@const laneCount = Math.max(1, ...blocks.map((block) => block.lane + 1))}
      <section class="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
        <div class="pt-2 text-xs font-medium text-muted-foreground">{roleConfig.label}</div>
        <ScrollArea class="h-24 rounded-md border bg-muted/20" scrollbarYClasses="w-2">
          <div
            class="relative min-w-full"
            style={`height: ${Math.max(72, laneCount * 30 + 16)}px`}
          >
            <div class="absolute left-0 right-0 top-1/2 h-px bg-border"></div>
            {#if blocks.length === 0}
              <div class="absolute inset-0 flex items-center px-3 text-xs text-muted-foreground">
                {roleConfig.emptyLabel}
              </div>
            {/if}
            {#each blocks as block (block.id)}
              {@const left = percentage(block.startTimeMs)}
              {@const width = Math.max(1.5, percentage(block.endTimeMs) - left)}
              <ContextMenu.Root>
                <ContextMenu.Trigger>
                  <button
                    type="button"
                    class={cn(
                      'absolute h-6 overflow-hidden rounded-md border px-2 text-left text-xs font-medium shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      roleConfig.blockClass,
                      selectedSegmentId === block.segmentId && selectedZoneId === block.zoneId
                        && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
                    )}
                    style={`left: ${left}%; width: ${width}%; top: ${8 + block.lane * 30}px;`}
                    title={`${block.label} ${formatTime(block.startTimeMs)}-${formatTime(block.endTimeMs)}`}
                    onclick={() => onSelect?.(block.segmentId, block.zoneId)}
                  >
                    <span class="block truncate">{block.label}</span>
                  </button>
                </ContextMenu.Trigger>
                <ContextMenu.Content>
                  <ContextMenu.Item onclick={() => onSetRole?.(block.segmentId, block.zoneId, 'main_subtitle')}>
                    Set as Main subtitle
                  </ContextMenu.Item>
                  <ContextMenu.Item onclick={() => onSetRole?.(block.segmentId, block.zoneId, 'on_screen_text')}>
                    Set as On-screen text
                  </ContextMenu.Item>
                  <ContextMenu.Separator />
                  <ContextMenu.Item
                    variant="destructive"
                    onclick={() => onDeleteZone?.(block.segmentId, block.zoneId)}
                  >
                    Delete zone
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Root>
            {/each}
            <div
              class="absolute bottom-1 top-1 w-px bg-foreground shadow-sm"
              style={`left: ${percentage(currentTimeMs)}%`}
              aria-label="Current playback position"
            ></div>
          </div>
        </ScrollArea>
      </section>
    {/each}
  </CardContent>
</Card>
