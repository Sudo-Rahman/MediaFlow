<script lang="ts">
  import { FileAudio, GripVertical, Link, Settings2, Subtitles, Trash2, Unlink } from '@lucide/svelte';
  import { SHADOW_ITEM_MARKER_PROPERTY_NAME } from 'svelte-dnd-action';

  import { mergeStore } from '$lib/stores';
  import type { ImportedTrack } from '$lib/types';
  import type { ImportSourceId } from '$lib/types/tool-import';
  import { dndzone } from '$lib/utils/dnd';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Empty from '$lib/components/ui/empty';
  import * as Item from '$lib/components/ui/item';
  import { ToolImportButton } from '$lib/components/shared';

  interface Props {
    onAddTrackFiles: () => void | Promise<void>;
    onEditImportedTrack: (trackId: string) => void;
    onImportFromSource: (sourceId: ImportSourceId) => void | Promise<void>;
  }

  let { onAddTrackFiles, onEditImportedTrack, onImportFromSource }: Props = $props();

  const FLIP_DURATION_MS = 200;

  type DragTrack = ImportedTrack & { [SHADOW_ITEM_MARKER_PROPERTY_NAME]?: boolean };

  let unassignedItems = $state<DragTrack[]>([]);
  let attachedItems = $state<DragTrack[]>([]);

  $effect(() => {
    unassignedItems = mergeStore.unassignedTracks.map((track) => ({ ...track }));
  });

  $effect(() => {
    attachedItems = mergeStore.selectedVideoId
      ? mergeStore.getAttachedTracks(mergeStore.selectedVideoId).map((track) => ({ ...track }))
      : [];
  });

  function getTrackTypeColor(type: string): string {
    switch (type) {
      case 'audio':
        return 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30';
      case 'subtitle':
        return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30';
      default:
        return 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30';
    }
  }

  function formatSeriesInfo(season?: number, episode?: number): string | null {
    if (episode === undefined) {
      return null;
    }

    if (season !== undefined) {
      return `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
    }

    return `EP ${episode.toString().padStart(2, '0')}`;
  }

  function handleUnassignedConsider(items: typeof unassignedItems): void {
    unassignedItems = items;
  }

  function handleUnassignedFinalize(items: typeof unassignedItems): void {
    const realItems = items.filter((item) => !item[SHADOW_ITEM_MARKER_PROPERTY_NAME]);
    unassignedItems = realItems;

    for (const item of realItems) {
      for (const video of mergeStore.videoFiles) {
        if (video.attachedTracks.some((attachedTrack) => attachedTrack.trackId === item.id)) {
          mergeStore.detachTrackFromVideo(item.id, video.id);
        }
      }
    }
  }

  function handleAttachedConsider(items: typeof attachedItems): void {
    attachedItems = items;
  }

  function handleAttachedFinalize(items: typeof attachedItems): void {
    const realItems = items.filter((item) => !item[SHADOW_ITEM_MARKER_PROPERTY_NAME]);
    attachedItems = realItems;

    if (!mergeStore.selectedVideoId) {
      return;
    }

    const currentAttached = new Set(
      mergeStore.selectedVideo?.attachedTracks.map((attachedTrack) => attachedTrack.trackId) ?? [],
    );
    const newAttachedIds = realItems.map((item) => item.id);

    for (const item of realItems) {
      if (!currentAttached.has(item.id)) {
        mergeStore.attachTrackToVideo(item.id, mergeStore.selectedVideoId);
      }
    }

    mergeStore.reorderAttachedTracks(mergeStore.selectedVideoId, newAttachedIds);
  }
</script>

<div class="space-y-4">
  <div class="flex justify-end">
    <ToolImportButton
      targetTool="merge"
      label="Add tracks"
      sourceFilter={['extraction_outputs']}
      onBrowse={onAddTrackFiles}
      onSelectSource={onImportFromSource}
    />
  </div>

  <Card.Root>
    <Card.Header class="py-3">
      <Card.Title class="text-sm flex items-center gap-2">
        <Unlink class="size-4 text-muted-foreground" />
        Unassigned tracks
      </Card.Title>
      <Card.Description>Drag tracks to attach them to a video</Card.Description>
    </Card.Header>
    <Card.Content class="pt-0">
      <section
        class="min-h-[60px] rounded-md border-2 border-dashed p-2 space-y-1"
        use:dndzone={{
          items: unassignedItems,
          flipDurationMs: FLIP_DURATION_MS,
          morphDisabled: true,
          type: 'tracks',
          onConsider: handleUnassignedConsider,
          onFinalize: handleUnassignedFinalize,
        }}
      >
        {#each unassignedItems as track (`${track.id}-${track[SHADOW_ITEM_MARKER_PROPERTY_NAME] ? 'shadow' : 'item'}`)}
          {@const TrackIcon = track.type === 'subtitle' ? Subtitles : FileAudio}
          {@const seriesInfo = formatSeriesInfo(track.seasonNumber, track.episodeNumber)}
          <Item.Root
            size="xs"
            variant="outline"
            data-is-dnd-shadow-item-hint={track[SHADOW_ITEM_MARKER_PROPERTY_NAME]}
            class="min-w-0 max-w-full overflow-hidden cursor-grab active:cursor-grabbing {getTrackTypeColor(track.type)}"
          >
            <div class="grid w-full min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-2">
              <GripVertical class="size-4 text-muted-foreground/50" />
              <TrackIcon class="size-4 text-muted-foreground" />
              <div class="min-w-0 overflow-hidden">
                <Item.Title class="block w-full min-w-0 truncate text-sm" title={track.name}>{track.name}</Item.Title>
                {#if seriesInfo || track.config.language}
                  <div class="mt-1 flex min-w-0 flex-wrap gap-1">
                    {#if seriesInfo}
                      <Badge variant="outline" class="text-xs">{seriesInfo}</Badge>
                    {/if}
                    {#if track.config.language}
                      <Badge variant="secondary" class="text-xs">{track.config.language}</Badge>
                    {/if}
                  </div>
                {/if}
              </div>
              <Button variant="ghost" size="icon-sm" onclick={() => onEditImportedTrack(track.id)}>
                <Settings2 class="size-3" />
                <span class="sr-only">Edit imported track</span>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onclick={() => mergeStore.removeImportedTrack(track.id)}
                class="text-muted-foreground hover:text-destructive"
              >
                <Trash2 class="size-3" />
                <span class="sr-only">Remove imported track</span>
              </Button>
            </div>
          </Item.Root>
        {:else}
          <Empty.Root class="border-0 p-4 select-none">
            <Empty.Description>No unassigned tracks. Add tracks or drag here to detach.</Empty.Description>
          </Empty.Root>
        {/each}
      </section>
    </Card.Content>
  </Card.Root>

  {#if mergeStore.selectedVideo}
    {@const video = mergeStore.selectedVideo}
    <Card.Root class="border-primary/50">
      <Card.Header class="py-3">
        <Card.Title class="text-sm flex items-center gap-2">
          <Link class="size-4 text-primary" />
          <span class="wrap-anywhere">Attached to: {video.name}</span>
        </Card.Title>
        <Card.Description>Drop tracks here to merge with this video</Card.Description>
      </Card.Header>
      <Card.Content class="pt-0">
        <section
          class="min-h-[80px] rounded-md border-2 border-primary/30 border-dashed p-2 space-y-1 bg-primary/5"
          use:dndzone={{
            items: attachedItems,
            flipDurationMs: FLIP_DURATION_MS,
            morphDisabled: true,
            type: 'tracks',
            onConsider: handleAttachedConsider,
            onFinalize: handleAttachedFinalize,
          }}
        >
          {#each attachedItems as track (`${track.id}-${track[SHADOW_ITEM_MARKER_PROPERTY_NAME] ? 'shadow' : 'item'}`)}
            {@const TrackIcon = track.type === 'subtitle' ? Subtitles : FileAudio}
            <Item.Root
              size="xs"
              variant="outline"
              data-is-dnd-shadow-item-hint={track[SHADOW_ITEM_MARKER_PROPERTY_NAME]}
              class="min-w-0 max-w-full overflow-hidden cursor-grab active:cursor-grabbing {getTrackTypeColor(track.type)}"
            >
              <div class="grid w-full min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-2">
                <GripVertical class="size-4 text-muted-foreground/50" />
                <TrackIcon class="size-4 text-muted-foreground" />
                <div class="min-w-0 overflow-hidden">
                  <Item.Title class="block w-full min-w-0 truncate text-sm" title={track.name}>{track.name}</Item.Title>
                  {#if track.config.delayMs !== 0 || track.config.language}
                    <div class="mt-1 flex min-w-0 flex-wrap gap-1">
                      {#if track.config.delayMs !== 0}
                        <Badge variant="secondary" class="text-xs">{track.config.delayMs}ms</Badge>
                      {/if}
                      {#if track.config.language}
                        <Badge variant="secondary" class="text-xs">{track.config.language}</Badge>
                      {/if}
                    </div>
                  {/if}
                </div>
                <Button variant="ghost" size="icon-sm" onclick={() => onEditImportedTrack(track.id)}>
                  <Settings2 class="size-3" />
                  <span class="sr-only">Edit imported track</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onclick={() => mergeStore.detachTrackFromVideo(track.id, video.id)}
                  class="text-muted-foreground hover:text-orange-500"
                >
                  <Unlink class="size-3" />
                  <span class="sr-only">Detach track</span>
                </Button>
              </div>
            </Item.Root>
          {:else}
            <Empty.Root class="border-0 p-6">
              <Empty.Description>Drop tracks here to attach to this video</Empty.Description>
            </Empty.Root>
          {/each}
        </section>
      </Card.Content>
    </Card.Root>
  {:else if mergeStore.videoFiles.length > 0}
    <Empty.Root class="border-0 py-8">
      <Empty.Description>Select a video to attach tracks</Empty.Description>
    </Empty.Root>
  {/if}
</div>
