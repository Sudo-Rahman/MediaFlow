<script lang="ts">
  import { Video, Volume2, Subtitles, Settings2, Clock, ChevronDown, ChevronRight } from '@lucide/svelte';
  import type { TrackGroup, MergeTrackConfig, TrackType, ImportedTrack, MergeTrack } from '$lib/types';
  import { mergeStore } from '$lib/stores/merge.svelte';
  import * as Accordion from '$lib/components/ui/accordion';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Item from '$lib/components/ui/item';
  import { cn } from '$lib/utils';
  import { formatLanguage } from '$lib/utils/format';

  interface MergeTrackGroupCardProps {
    group: TrackGroup;
    onEdit: (groupId: string) => void;
  }

  let { group, onEdit }: MergeTrackGroupCardProps = $props();

  const typeLabels: Record<TrackType, string> = {
    video: 'Video',
    audio: 'Audio',
    subtitle: 'Subtitle',
    data: 'Data'
  };

  // Get all tracks in this group
  const tracks = $derived(
    group.trackIds
      .map((id: string) => mergeStore.getTrackById(id))
      .filter((t: MergeTrack | ImportedTrack | undefined): t is MergeTrack | ImportedTrack => t !== undefined)
  );

  // Get track configs for source tracks
  function getTrackConfig(track: MergeTrack | ImportedTrack): MergeTrackConfig | undefined {
    if ('sourceFileId' in track) {
      return mergeStore.getSourceTrackConfig(track.id);
    }
    return track.config;
  }

  // Check if all tracks have consistent values
  function getConsistentValue<T>(getter: (config: MergeTrackConfig) => T): T | undefined | 'mixed' {
    const values = tracks
      .map(t => getTrackConfig(t))
      .filter((c): c is MergeTrackConfig => c !== undefined)
      .map(getter);
    
    if (values.length === 0) return undefined;
    
    const firstValue = values[0];
    const allSame = values.every(v => v === firstValue);
    
    return allSame ? firstValue : 'mixed';
  }

  // Derived values for the group
  const isDefault = $derived(getConsistentValue(c => c.default));
  const isForced = $derived(getConsistentValue(c => c.forced));

  // Check if any track has delay
  const hasDelay = $derived(
    tracks.some(t => {
      const config = getTrackConfig(t);
      return config && config.delayMs !== 0;
    })
  );

  // Check if all tracks are enabled
  const allEnabled = $derived(
    tracks.every(t => {
      const config = getTrackConfig(t);
      return config?.enabled ?? true;
    })
  );

  function handleToggleAll() {
    const newEnabled = !allEnabled;
    tracks.forEach(track => {
      if ('sourceFileId' in track) {
        mergeStore.updateSourceTrackConfig(track.id, { enabled: newEnabled });
      } else {
        mergeStore.updateTrackConfig(track.id, { enabled: newEnabled });
      }
    });
  }

  function getTrackDisplayName(track: MergeTrack | ImportedTrack): string {
    if ('sourceFileId' in track) {
      return `Track #${track.originalIndex} - ${track.codec.toUpperCase()}`;
    }
    return track.name;
  }

  function getTrackLanguage(track: MergeTrack | ImportedTrack): string | undefined {
    const config = getTrackConfig(track);
    return config?.language ?? track.language;
  }

  function getTypeLabel(type: TrackType): string {
    return typeLabels[type] ?? type;
  }
</script>

<Accordion.Item
  value={group.id}
  class={cn(
    "w-full overflow-hidden border rounded-3xl bg-card/70 shadow-xs transition-colors data-open:bg-card",
    !group.collapsed && "border-primary/25"
  )}
>
  <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center">
    <Accordion.Trigger
      class="min-w-0 items-center justify-start gap-3 p-4 text-left hover:no-underline [&>svg[data-slot=accordion-trigger-icon]]:hidden"
      aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${getTypeLabel(group.type).toLowerCase()} track group`}
    >
      <span class="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
        {#if group.collapsed}
          <ChevronRight class="size-4" />
        {:else}
          <ChevronDown class="size-4" />
        {/if}
      </span>

      <span class="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <span class="flex size-9 shrink-0 items-center justify-center bg-primary/10 text-primary">
          {#if group.type === 'video'}
            <Video class="size-4" />
          {:else if group.type === 'audio'}
            <Volume2 class="size-4" />
          {:else}
            <Subtitles class="size-4" />
          {/if}
        </span>

        <span class="flex min-w-0 flex-col gap-1">
          <span class="flex min-w-0 flex-wrap items-center gap-2">
            <span class="truncate font-medium">
              {getTypeLabel(group.type)}s
            </span>
            <Badge variant="secondary" class="h-6 text-xs">
              {group.language ? formatLanguage(group.language) : 'Undefined'}
            </Badge>
            <Badge variant="outline" class="h-6 text-xs">
              {tracks.length} track{tracks.length > 1 ? 's' : ''}
            </Badge>
          </span>
          <span class="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {#if isDefault === true}
              <Badge variant="default" class="h-5 px-2 text-[11px]">Default</Badge>
            {:else if isDefault === 'mixed'}
              <Badge variant="outline" class="h-5 border-amber-600 px-2 text-[11px] text-amber-600">Mixed default</Badge>
            {/if}

            {#if isForced === true}
              <Badge variant="secondary" class="h-5 px-2 text-[11px]">Forced</Badge>
            {:else if isForced === 'mixed'}
              <Badge variant="outline" class="h-5 border-amber-600 px-2 text-[11px] text-amber-600">Mixed forced</Badge>
            {/if}

            {#if hasDelay}
              <span class="inline-flex items-center gap-1">
                <Clock class="size-3.5" />
                Delay
              </span>
            {/if}
          </span>
        </span>
      </span>
    </Accordion.Trigger>

    <div class="mr-4 flex shrink-0 items-center gap-2 border-l pl-4">
      <Checkbox
        aria-label="Toggle all tracks in group"
        checked={allEnabled}
        onCheckedChange={handleToggleAll}
      />

      <Button
        variant="ghost"
        size="sm"
        class="gap-2 px-2"
        onclick={() => onEdit(group.id)}
      >
        <Settings2 class="size-4" />
        Edit
      </Button>
    </div>
  </div>

  <!-- Expanded Content: Track List -->
  <Accordion.Content class="-mx-4 border-t bg-muted/15 px-4 py-3">
    <Item.Group class="gap-1">
        {#each tracks as track (track.id)}
          {@const config = getTrackConfig(track)}
          <Item.Root size="xs" class="min-w-0 flex-nowrap hover:bg-muted/50" role="listitem">
            <!-- Track Enable Checkbox -->
            <Checkbox
              aria-label={`Toggle ${getTrackDisplayName(track)}`}
              checked={config?.enabled ?? true}
              onCheckedChange={(checked) => {
                if ('sourceFileId' in track) {
                  mergeStore.updateSourceTrackConfig(track.id, { enabled: !!checked });
                } else {
                  mergeStore.updateTrackConfig(track.id, { enabled: !!checked });
                }
              }}
            />

            <!-- Track Info -->
            <Item.Content class="min-w-0">
            <div class="flex min-w-0 items-center gap-2">
              <Item.Title class="min-w-0 flex-1 truncate" title={getTrackDisplayName(track)}>
                {getTrackDisplayName(track)}
              </Item.Title>
              
              {#if getTrackLanguage(track)}
                <Badge variant="outline" class="text-xs shrink-0">
                  {formatLanguage(getTrackLanguage(track)!)}
                </Badge>
              {/if}
            </div>
            </Item.Content>

            <!-- Track Badges -->
            <Item.Actions class="shrink-0">
              {#if config?.default}
                <Badge variant="default" class="text-xs">Default</Badge>
              {/if}
              {#if config?.forced}
                <Badge variant="secondary" class="text-xs">Forced</Badge>
              {/if}
              {#if config?.delayMs}
                <Badge variant="outline" class="text-xs">
                  {config.delayMs > 0 ? '+' : ''}{config.delayMs}ms
                </Badge>
              {/if}
            </Item.Actions>
          </Item.Root>
        {/each}
    </Item.Group>
  </Accordion.Content>
</Accordion.Item>
