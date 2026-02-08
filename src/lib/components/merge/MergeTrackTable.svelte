<script lang="ts">
  import { Video, Volume2, Subtitles, Table, Clock } from '@lucide/svelte';
  import type { MergeTrack, ImportedTrack, MergeTrackConfig } from '$lib/types';
  import { mergeStore } from '$lib/stores/merge.svelte';
  import { COMMON_LANGUAGES } from '$lib/types';
  import { formatLanguage } from '$lib/utils/format';
  import { Input } from '$lib/components/ui/input';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Badge } from '$lib/components/ui/badge';
  import * as Select from '$lib/components/ui/select';
  import { cn } from '$lib/utils';

  interface MergeTrackTableProps {
    class?: string;
  }

  let { class: className = '' }: MergeTrackTableProps = $props();

  // Get all tracks (source + imported)
  const allTracks = $derived(() => {
    const tracks: Array<{
      track: MergeTrack | ImportedTrack;
      config: MergeTrackConfig | undefined;
      source: 'source' | 'imported';
      videoName?: string;
    }> = [];

    // Source tracks
    mergeStore.videoFiles.forEach(video => {
      video.tracks.forEach(track => {
        tracks.push({
          track,
          config: mergeStore.getSourceTrackConfig(track.id),
          source: 'source',
          videoName: video.name
        });
      });
    });

    // Imported tracks
    mergeStore.importedTracks.forEach(track => {
      tracks.push({
        track,
        config: track.config,
        source: 'imported'
      });
    });

    return tracks;
  });

  const typeIcons = {
    video: Video,
    audio: Volume2,
    subtitle: Subtitles,
  };

  function handleToggleEnabled(trackId: string, source: 'source' | 'imported', current: boolean) {
    if (source === 'source') {
      mergeStore.updateSourceTrackConfig(trackId, { enabled: !current });
    } else {
      mergeStore.updateTrackConfig(trackId, { enabled: !current });
    }
  }

  function handleLanguageChange(trackId: string, source: 'source' | 'imported', value: string) {
    if (source === 'source') {
      mergeStore.updateSourceTrackConfig(trackId, { language: value });
    } else {
      mergeStore.updateTrackConfig(trackId, { language: value });
    }
  }

  function handleTitleChange(trackId: string, source: 'source' | 'imported', value: string) {
    if (source === 'source') {
      mergeStore.updateSourceTrackConfig(trackId, { title: value || undefined });
    } else {
      mergeStore.updateTrackConfig(trackId, { title: value || undefined });
    }
  }

  function handleDefaultChange(trackId: string, source: 'source' | 'imported', checked: boolean) {
    if (source === 'source') {
      mergeStore.updateSourceTrackConfig(trackId, { default: checked });
    } else {
      mergeStore.updateTrackConfig(trackId, { default: checked });
    }
  }

  function handleForcedChange(trackId: string, source: 'source' | 'imported', checked: boolean) {
    if (source === 'source') {
      mergeStore.updateSourceTrackConfig(trackId, { forced: checked });
    } else {
      mergeStore.updateTrackConfig(trackId, { forced: checked });
    }
  }

  function handleDelayChange(trackId: string, source: 'source' | 'imported', value: string) {
    const num = parseInt(value, 10);
    const delayMs = isNaN(num) ? 0 : num;
    
    if (source === 'source') {
      mergeStore.updateSourceTrackConfig(trackId, { delayMs });
    } else {
      mergeStore.updateTrackConfig(trackId, { delayMs });
    }
  }

  function getTrackDisplayName(track: MergeTrack | ImportedTrack): string {
    if ('sourceFileId' in track) {
      return `Track #${track.originalIndex}`;
    }
    return track.name;
  }

  function getTrackTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      video: 'Video',
      audio: 'Audio',
      subtitle: 'Sub',
      data: 'Data'
    };
    return labels[type] || type;
  }
</script>

<div class={cn("flex flex-col h-full", className)}>
  <!-- Header -->
  <div class="flex items-center justify-between p-4 border-b bg-muted/30">
    <div class="flex items-center gap-3">
      <Table class="size-5 text-muted-foreground" />
      <div>
        <h3 class="font-medium">Table View</h3>
        <p class="text-sm text-muted-foreground">
          Quick edit all tracks
        </p>
      </div>
    </div>

    <Badge variant="secondary">
      {allTracks().length} track{allTracks().length > 1 ? 's' : ''}
    </Badge>
  </div>

  <!-- Table -->
  <div class="flex-1 overflow-auto">
    <div class="min-w-[800px]">
      <!-- Table Header -->
      <div class="sticky top-0 z-10 grid grid-cols-[40px_200px_80px_120px_200px_80px_80px_100px] gap-2 p-3 bg-muted border-b text-sm font-medium">
        <div></div>
        <div>Name</div>
        <div>Type</div>
        <div>Language</div>
        <div>Title</div>
        <div class="text-center">Default</div>
        <div class="text-center">Forced</div>
        <div>Delay</div>
      </div>

      <!-- Table Body -->
      <div class="divide-y">
        {#each allTracks() as { track, config, source, videoName }}
          <div class="grid grid-cols-[40px_200px_80px_120px_200px_80px_80px_100px] gap-2 p-3 items-center hover:bg-muted/30 transition-colors">
            <!-- Enable Checkbox -->
            <div>
              <Checkbox
                checked={config?.enabled ?? true}
                onCheckedChange={() => handleToggleEnabled(track.id, source, config?.enabled ?? true)}
              />
            </div>

            <!-- Name -->
            <div class="min-w-0">
              <div class="truncate font-medium text-sm" title={getTrackDisplayName(track)}>
                {getTrackDisplayName(track)}
              </div>
              {#if videoName}
                <div class="text-xs text-muted-foreground truncate" title={videoName}>
                  {videoName}
                </div>
              {/if}
            </div>

            <!-- Type -->
            <div>
              <Badge variant="outline" class="text-xs">
                {getTrackTypeLabel(track.type)}
              </Badge>
            </div>

            <!-- Language -->
            <div>
              <Select.Root
                type="single"
                value={config?.language || track.language || 'und'}
                onValueChange={(value) => handleLanguageChange(track.id, source, value)}
              >
                <Select.Trigger class="w-full h-8 text-xs">
                  <span class="truncate">
                    {formatLanguage(config?.language || track.language || 'und')}
                  </span>
                </Select.Trigger>
                <Select.Content>
                  {#each COMMON_LANGUAGES as lang}
                    <Select.Item value={lang.code} class="text-xs">{lang.label}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>

            <!-- Title -->
            <div>
              <Input
                type="text"
                placeholder="Title..."
                value={config?.title || track.title || ''}
                oninput={(e) => handleTitleChange(track.id, source, e.currentTarget.value)}
                class="h-8 text-xs"
              />
            </div>

            <!-- Default -->
            <div class="flex items-center justify-center">
              <Checkbox
                checked={config?.default || ('default' in track ? track.default : false) || false}
                onCheckedChange={(checked) => handleDefaultChange(track.id, source, !!checked)}
              />
            </div>

            <!-- Forced -->
            <div class="flex items-center justify-center">
              {#if track.type === 'subtitle'}
                <Checkbox
                  checked={config?.forced || ('forced' in track ? track.forced : false) || false}
                  onCheckedChange={(checked) => handleForcedChange(track.id, source, !!checked)}
                />
              {:else}
                <span class="text-muted-foreground">-</span>
              {/if}
            </div>

            <!-- Delay -->
            <div>
              <div class="flex items-center gap-1">
                <Clock class="size-3 text-muted-foreground" />
                <Input
                  type="number"
                  placeholder="0"
                  value={config?.delayMs?.toString() || '0'}
                  oninput={(e) => handleDelayChange(track.id, source, e.currentTarget.value)}
                  class="h-8 text-xs w-20"
                />
              </div>
            </div>
          </div>
        {/each}
      </div>

      {#if allTracks().length === 0}
        <div class="text-center py-12 text-muted-foreground">
          <Table class="size-12 mx-auto mb-4 opacity-50" />
          <p>No tracks to display</p>
          <p class="text-sm mt-1">Import videos and tracks to get started</p>
        </div>
      {/if}
    </div>
  </div>
</div>
