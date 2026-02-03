<script lang="ts">
  import { Video, Volume2, Subtitles, GripVertical, Settings2, Clock } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import type { MergeTrack, MergeTrackConfig } from '$lib/types';
  import { formatLanguage, formatBitrate, formatChannels, formatResolution } from '$lib/utils/format';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Card from '$lib/components/ui/card';
  ;
  ;
  ;
  ;
  ;
  ;

  interface MergeTrackEditorProps {
    tracks: MergeTrack[];
    trackConfigs: Map<string, MergeTrackConfig>;
    onToggleTrack?: (trackId: string) => void;
    onEditTrack?: (trackId: string) => void;
    onReorderTrack?: (trackId: string, newOrder: number) => void;
    class?: string;
  }

  let {
    tracks,
    trackConfigs,
    onToggleTrack,
    onEditTrack,
    onReorderTrack,
    class: className = ''
  }: MergeTrackEditorProps = $props();

  const TYPE_CONFIG = {
    video: { icon: Video, label: 'Video', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30' },
    audio: { icon: Volume2, label: 'Audio', color: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30' },
    subtitle: { icon: Subtitles, label: 'Subtitle', color: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30' },
    data: { icon: Video, label: 'Data', color: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30' }
  } as const;

  function getConfig(trackId: string): MergeTrackConfig | undefined {
    return trackConfigs.get(trackId);
  }

  function isEnabled(trackId: string): boolean {
    return getConfig(trackId)?.enabled ?? true;
  }

  const groupedTracks = $derived(() => {
    const groups: Record<string, MergeTrack[]> = { video: [], audio: [], subtitle: [] };
    for (const track of tracks) {
      if (groups[track.type]) {
        groups[track.type].push(track);
      }
    }
    return groups;
  });

  let draggedTrackId = $state<string | null>(null);
  let dragOverTrackId = $state<string | null>(null);

  function handleDragStart(e: DragEvent, trackId: string) {
    if (!e.dataTransfer) return;
    draggedTrackId = trackId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', trackId);
  }

  function handleDragOver(e: DragEvent, trackId: string) {
    e.preventDefault();
    if (draggedTrackId && draggedTrackId !== trackId) {
      dragOverTrackId = trackId;
    }
  }

  function handleDrop(e: DragEvent, targetTrackId: string) {
    e.preventDefault();
    if (draggedTrackId && draggedTrackId !== targetTrackId) {
      const targetConfig = getConfig(targetTrackId);
      if (targetConfig) {
        onReorderTrack?.(draggedTrackId, targetConfig.order);
      }
    }
    resetDragState();
  }

  function resetDragState() {
    draggedTrackId = null;
    dragOverTrackId = null;
  }
</script>

<div class={cn('space-y-4', className)}>
  {#each Object.entries(groupedTracks()) as [type, typeTracks]}
    {#if typeTracks.length > 0}
      {@const typeConfig = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG]}
      {@const Icon = typeConfig?.icon}
      <Card.Root>
        <Card.Header class="py-3">
          <div class="flex items-center gap-2">
            {#if Icon}
              <Icon class="size-4 text-muted-foreground" />
            {/if}
            <Card.Title class="text-sm">{typeConfig?.label || type} ({typeTracks.length})</Card.Title>
          </div>
        </Card.Header>
        <Card.Content class="pt-0 space-y-1.5">
          {#each typeTracks as track (track.id)}
            {@const config = getConfig(track.id)}
            {@const enabled = isEnabled(track.id)}
            {@const trackTypeConfig = TYPE_CONFIG[track.type as keyof typeof TYPE_CONFIG]}
            <div
              class={cn(
                'flex items-center gap-2 rounded-md border p-2.5 transition-all',
                enabled ? 'bg-card' : 'bg-muted/30 opacity-60',
                dragOverTrackId === track.id && 'border-primary border-dashed',
                draggedTrackId === track.id && 'opacity-50',
                trackTypeConfig?.color
              )}
              draggable="true"
              ondragstart={(e) => handleDragStart(e, track.id)}
              ondragover={(e) => handleDragOver(e, track.id)}
              ondragleave={() => dragOverTrackId = null}
              ondrop={(e) => handleDrop(e, track.id)}
              ondragend={resetDragState}
              role="listitem"
            >
              <div class="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground">
                <GripVertical class="size-4" />
              </div>

              <Checkbox
                checked={enabled}
                onCheckedChange={() => onToggleTrack?.(track.id)}
              />

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" class="font-mono text-xs">
                    #{track.originalIndex}
                  </Badge>
                  <span class="font-medium text-sm">{track.codec.toUpperCase()}</span>
                  {#if config?.language || track.language}
                    <Badge variant="secondary" class="text-xs">
                      {formatLanguage(config?.language || track.language || '')}
                    </Badge>
                  {/if}
                  {#if config?.default ?? track.default}
                    <Badge class="text-xs">Default</Badge>
                  {/if}
                  {#if config?.forced ?? track.forced}
                    <Badge variant="destructive" class="text-xs">Forced</Badge>
                  {/if}
                </div>

                <div class="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                  {#if config?.title || track.title}
                    <span class="truncate max-w-[200px]">"{config?.title || track.title}"</span>
                  {/if}

                  {#if track.type === 'video'}
                    {#if track.width && track.height}
                      <span>{formatResolution(track.width, track.height)}</span>
                    {/if}
                    {#if track.frameRate}
                      <span>{track.frameRate} fps</span>
                    {/if}
                  {/if}

                  {#if track.type === 'audio'}
                    {#if track.channels}
                      <span>{formatChannels(track.channels)}</span>
                    {/if}
                    {#if track.sampleRate}
                      <span>{track.sampleRate} Hz</span>
                    {/if}
                  {/if}

                  {#if track.bitrate}
                    <span>{formatBitrate(track.bitrate)}</span>
                  {/if}

                  {#if config?.delayMs && config.delayMs !== 0}
                    <span class="flex items-center gap-1 text-orange-500">
                      <Clock class="size-3" />
                      {config.delayMs > 0 ? '+' : ''}{config.delayMs}ms
                    </span>
                  {/if}
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon-sm"
                class="shrink-0"
                onclick={() => onEditTrack?.(track.id)}
              >
                <Settings2 class="size-4" />
                <span class="sr-only">Edit</span>
              </Button>
            </div>
          {/each}
        </Card.Content>
      </Card.Root>
    {/if}
  {/each}

  {#if tracks.length === 0}
    <Card.Root>
      <Card.Content class="py-8 text-center text-muted-foreground">
        <p>Select a file to view its tracks</p>
      </Card.Content>
    </Card.Root>
  {/if}
</div>

