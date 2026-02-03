<script lang="ts">
  import { Video, Volume2, Subtitles, ChevronDown, ChevronRight, Settings2, Check, X, Clock } from '@lucide/svelte';
  import type { TrackGroup, MergeTrackConfig, TrackType, ImportedTrack, MergeTrack } from '$lib/types';
  import { mergeStore } from '$lib/stores/merge.svelte';
  import { Card } from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { cn } from '$lib/utils';
  import { formatLanguage } from '$lib/utils/format';
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;
  ;

  interface MergeTrackGroupCardProps {
    group: TrackGroup;
    onEdit: (groupId: string) => void;
  }

  let { group, onEdit }: MergeTrackGroupCardProps = $props();

  const typeIcons = {
    video: Video,
    audio: Volume2,
    subtitle: Subtitles,
  };

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
  const language = $derived(getConsistentValue(c => c.language));
  const title = $derived(getConsistentValue(c => c.title));
  const isDefault = $derived(getConsistentValue(c => c.default));
  const isForced = $derived(getConsistentValue(c => c.forced));
  const delayMs = $derived(getConsistentValue(c => c.delayMs));

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

  function toggleGroup() {
    mergeStore.toggleGroupCollapsed(group.id);
  }

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
</script>

<Card class={cn(
  "overflow-hidden transition-all duration-200",
  !group.collapsed && "ring-1 ring-primary/20"
)}>
  <!-- Header -->
  <div 
    class="flex items-center gap-3 p-4 bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors"
    onclick={toggleGroup}
    onkeydown={(e) => e.key === 'Enter' && toggleGroup()}
    role="button"
    tabindex="0"
  >
    <!-- Collapse/Expand Icon -->
    <div class="text-muted-foreground">
      {#if group.collapsed}
        <ChevronRight class="size-5" />
      {:else}
        <ChevronDown class="size-5" />
      {/if}
    </div>

    <!-- Type Icon -->
    <div class="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 text-primary">
      {#if group.type === 'video'}
        <Video class="size-4" />
      {:else if group.type === 'audio'}
        <Volume2 class="size-4" />
      {:else}
        <Subtitles class="size-4" />
      {/if}
    </div>

    <!-- Group Info -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="font-medium">
          {typeLabels[group.type]}s
        </span>
        <Badge variant="secondary" class="text-xs">
          {group.language ? formatLanguage(group.language) : 'Undefined'}
        </Badge>
        <Badge variant="outline" class="text-xs">
          {tracks.length} track{tracks.length > 1 ? 's' : ''}
        </Badge>
      </div>
    </div>

    <!-- Quick Status Badges -->
    <div class="flex items-center gap-2">
      {#if isDefault === true}
        <Badge variant="default" class="text-xs">Default</Badge>
      {:else if isDefault === 'mixed'}
        <Badge variant="outline" class="text-xs text-amber-600 border-amber-600">Mixed Default</Badge>
      {/if}

      {#if isForced === true}
        <Badge variant="secondary" class="text-xs">Forced</Badge>
      {:else if isForced === 'mixed'}
        <Badge variant="outline" class="text-xs text-amber-600 border-amber-600">Mixed Forced</Badge>
      {/if}

      {#if hasDelay}
        <Clock class="size-4 text-muted-foreground" />
      {/if}

      <!-- Enable/Disable All -->
      <div class="flex items-center gap-2 ml-2 pl-2 border-l">
        <Checkbox
          checked={allEnabled}
          onCheckedChange={handleToggleAll}
          onclick={(e) => e.stopPropagation()}
        />
      </div>

      <!-- Edit Button -->
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        onclick={(e) => {
          e.stopPropagation();
          onEdit(group.id);
        }}
      >
        <Settings2 class="size-4" />
      </Button>
    </div>
  </div>

  <!-- Expanded Content: Track List -->
  {#if !group.collapsed}
    <div class="border-t bg-muted/10">
      <div class="p-2 space-y-1">
        {#each tracks as track (track.id)}
          {@const config = getTrackConfig(track)}
          <div class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50 text-sm">
            <!-- Track Enable Checkbox -->
            <Checkbox
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
            <div class="flex-1 min-w-0 flex items-center gap-2">
              <span class="truncate">{getTrackDisplayName(track)}</span>
              
              {#if getTrackLanguage(track)}
                <Badge variant="outline" class="text-xs shrink-0">
                  {formatLanguage(getTrackLanguage(track)!)}
                </Badge>
              {/if}
            </div>

            <!-- Track Badges -->
            <div class="flex items-center gap-1 shrink-0">
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
            </div>
          </div>
        {/each}
      </div>

      <!-- Footer with Edit Button -->
      <div class="px-4 py-3 border-t bg-muted/20">
        <Button
          variant="outline"
          size="sm"
          class="w-full"
          onclick={() => onEdit(group.id)}
        >
          <Settings2 class="size-4 mr-2" />
          Edit {tracks.length} tracks
        </Button>
      </div>
    </div>
  {/if}
</Card>