<script lang="ts">
  import { Check, Video, Volume2, Subtitles, Database } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import type { Track, VideoFile } from '$lib/types';
  import { formatBitrate, formatLanguage, formatChannels, formatResolution } from '$lib/utils/format';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Empty from '$lib/components/ui/empty';
  import * as Item from '$lib/components/ui/item';

  interface TrackDetailsProps {
    file: VideoFile;
    selectedTrackIds: number[];
    onToggleTrack?: (trackId: number) => void;
    onSelectAll?: (type: Track['type']) => void;
    onDeselectAll?: (type: Track['type']) => void;
    class?: string;
  }

  let { file, selectedTrackIds, onToggleTrack, onSelectAll, onDeselectAll, class: className = '' }: TrackDetailsProps = $props();

  // Group tracks by type
  const groupedTracks = $derived.by(() => {
    const groups: Record<string, Track[]> = {
      video: [],
      audio: [],
      subtitle: [],
      data: []
    };

    for (const track of file.tracks) {
      if (groups[track.type]) {
        groups[track.type].push(track);
      }
    }

    return groups;
  });

  const typeLabels: Record<string, string> = {
    video: 'Video',
    audio: 'Audio',
    subtitle: 'Subtitles',
    data: 'Data'
  };

  const typeIcons: Record<string, typeof Video> = {
    video: Video,
    audio: Volume2,
    subtitle: Subtitles,
    data: Database
  };

  function isSelected(trackId: number) {
    return selectedTrackIds.includes(trackId);
  }

  function areAllSelected(type: Track['type']) {
    const tracks = groupedTracks[type];
    return tracks.length > 0 && tracks.every(t => selectedTrackIds.includes(t.id));
  }

  function areNoneSelected(type: Track['type']) {
    const tracks = groupedTracks[type];
    return tracks.every(t => !selectedTrackIds.includes(t.id));
  }

  function handleTrackRowKeydown(event: KeyboardEvent, trackId: number): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    onToggleTrack?.(trackId);
  }
</script>

<div class={cn('space-y-4', className)}>
  <header class="flex min-w-0 items-center justify-between gap-3 px-1">
    <div class="min-w-0">
      <h2 class="truncate text-sm font-semibold">{file.name}</h2>
      <p class="text-xs text-muted-foreground">
        {file.tracks.length} track{file.tracks.length > 1 ? 's' : ''} available
      </p>
    </div>
  </header>

  {#each Object.entries(groupedTracks) as [type, tracks] (type)}
    {#if tracks.length > 0}
      {@const Icon = typeIcons[type]}
      {@const allSelected = areAllSelected(type as Track['type'])}
      <Card.Root>
        <Card.Header class="pb-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Icon class="size-4 text-muted-foreground" />
              <Card.Title class="text-sm">{typeLabels[type]} ({tracks.length})</Card.Title>
            </div>
            <div class="flex gap-1">
              {#if !allSelected}
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 text-xs"
                  onclick={() => onSelectAll?.(type as Track['type'])}
                >
                  Select all
                </Button>
              {:else}
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 text-xs"
                  onclick={() => onDeselectAll?.(type as Track['type'])}
                >
                  Deselect all
                </Button>
              {/if}
            </div>
          </div>
        </Card.Header>
        <Card.Content class="pt-0">
          <div class="flex w-full flex-col gap-1.5">
            {#each tracks as track (track.id)}
              <Item.Root
                size="sm"
                variant={isSelected(track.id) ? 'outline' : 'default'}
                class={cn(
                  'items-start hover:bg-muted/70 cursor-pointer',
                  isSelected(track.id) && 'border-primary bg-card ring-1 ring-primary/20 hover:bg-card'
                )}
                role="checkbox"
                aria-checked={isSelected(track.id)}
                aria-label={`Select track #${track.index} ${track.codec.toUpperCase()}`}
                tabindex={0}
                onclick={() => onToggleTrack?.(track.id)}
                onkeydown={(event) => handleTrackRowKeydown(event, track.id)}
              >
                <span
                  aria-hidden="true"
                  class={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-input/90 transition-colors',
                    isSelected(track.id) && 'border-primary bg-primary text-primary-foreground'
                  )}
                >
                  {#if isSelected(track.id)}
                    <Check class="size-3.5" />
                  {/if}
                </span>

                <Item.Content class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" class="font-mono text-xs">
                      #{track.index}
                    </Badge>
                    <span class="font-medium text-sm">{track.codec.toUpperCase()}</span>
                    {#if track.language}
                      <Badge variant="secondary" class="text-xs">
                        {formatLanguage(track.language)}
                      </Badge>
                    {/if}
                    {#if track.default}
                      <Badge class="text-xs">Default</Badge>
                    {/if}
                    {#if track.forced}
                      <Badge variant="destructive" class="text-xs">Forced</Badge>
                    {/if}
                  </div>

                  <div class="flex flex-wrap gap-2 mt-1.5 text-xs text-muted-foreground">
                    {#if track.title}
                      <span>"{track.title}"</span>
                    {/if}

                    {#if type === 'video'}
                      {#if track.width && track.height}
                        <span>{formatResolution(track.width, track.height)}</span>
                      {/if}
                      {#if track.frameRate}
                        <span>{track.frameRate} fps</span>
                      {/if}
                    {/if}

                    {#if type === 'audio'}
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
                  </div>
                </Item.Content>
              </Item.Root>
            {/each}
          </div>
        </Card.Content>
      </Card.Root>
    {/if}
  {/each}

  {#if file.tracks.length === 0}
    <Empty.Root class="border-0 py-8">
      <Empty.Header>
        <Empty.Media>
          <Database class="size-8 text-muted-foreground/50" />
        </Empty.Media>
        <Empty.Title class="text-base">No tracks detected</Empty.Title>
        <Empty.Description>No tracks detected in this file</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {/if}
</div>
