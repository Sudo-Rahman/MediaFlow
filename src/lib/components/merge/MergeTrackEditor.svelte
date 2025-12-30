<script lang="ts">
  import { cn } from '$lib/utils';
  import type { MergeTrack, MergeTrackConfig } from '$lib/types';
  import { formatLanguage, formatBitrate, formatChannels, formatResolution } from '$lib/utils/format';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Card from '$lib/components/ui/card';
  import Video from 'lucide-svelte/icons/video';
  import Volume2 from 'lucide-svelte/icons/volume-2';
  import Subtitles from 'lucide-svelte/icons/subtitles';
  import GripVertical from 'lucide-svelte/icons/grip-vertical';
  import Settings2 from 'lucide-svelte/icons/settings-2';
  import Clock from 'lucide-svelte/icons/clock';

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

  const typeIcons = {
    video: Video,
    audio: Volume2,
    subtitle: Subtitles,
  };

  const typeLabels = {
    video: 'Vidéo',
    audio: 'Audio',
    subtitle: 'Sous-titre',
    data: 'Données'
  };

  const typeColors = {
    video: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
    audio: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30',
    subtitle: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
    data: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30'
  };

  function getConfig(trackId: string): MergeTrackConfig | undefined {
    return trackConfigs.get(trackId);
  }

  function isEnabled(trackId: string): boolean {
    return getConfig(trackId)?.enabled ?? true;
  }

  const groupedTracks = $derived(() => {
    const groups: Record<string, MergeTrack[]> = {
      video: [],
      audio: [],
      subtitle: [],
    };

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
    draggedTrackId = trackId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', trackId);
    }
  }

  function handleDragOver(e: DragEvent, trackId: string) {
    e.preventDefault();
    if (draggedTrackId && draggedTrackId !== trackId) {
      dragOverTrackId = trackId;
    }
  }

  function handleDragLeave() {
    dragOverTrackId = null;
  }

  function handleDrop(e: DragEvent, targetTrackId: string) {
    e.preventDefault();
    if (draggedTrackId && draggedTrackId !== targetTrackId) {
      const targetConfig = getConfig(targetTrackId);
      if (targetConfig) {
        onReorderTrack?.(draggedTrackId, targetConfig.order);
      }
    }
    draggedTrackId = null;
    dragOverTrackId = null;
  }

  function handleDragEnd() {
    draggedTrackId = null;
    dragOverTrackId = null;
  }
</script>

<div class={cn('space-y-4', className)}>
  {#each Object.entries(groupedTracks()) as [type, typeTracks]}
    {#if typeTracks.length > 0}
      {@const Icon = typeIcons[type as keyof typeof typeIcons]}
      <Card.Root>
        <Card.Header class="py-3">
          <div class="flex items-center gap-2">
            {#if Icon}
              <Icon class="size-4 text-muted-foreground" />
            {/if}
            <Card.Title class="text-sm">{typeLabels[type as keyof typeof typeLabels]} ({typeTracks.length})</Card.Title>
          </div>
        </Card.Header>
        <Card.Content class="pt-0 space-y-1.5">
          {#each typeTracks as track (track.id)}
            {@const config = getConfig(track.id)}
            {@const enabled = isEnabled(track.id)}
            <div
              class={cn(
                'flex items-center gap-2 rounded-md border p-2.5 transition-all',
                enabled ? 'bg-card' : 'bg-muted/30 opacity-60',
                dragOverTrackId === track.id && 'border-primary border-dashed',
                draggedTrackId === track.id && 'opacity-50',
                typeColors[track.type as keyof typeof typeColors]
              )}
              draggable="true"
              ondragstart={(e) => handleDragStart(e, track.id)}
              ondragover={(e) => handleDragOver(e, track.id)}
              ondragleave={handleDragLeave}
              ondrop={(e) => handleDrop(e, track.id)}
              ondragend={handleDragEnd}
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
                    <Badge class="text-xs">Défaut</Badge>
                  {/if}
                  {#if config?.forced ?? track.forced}
                    <Badge variant="destructive" class="text-xs">Forcé</Badge>
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
                <span class="sr-only">Modifier</span>
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
        <p>Sélectionnez un fichier pour voir ses pistes</p>
      </Card.Content>
    </Card.Root>
  {/if}
</div>

