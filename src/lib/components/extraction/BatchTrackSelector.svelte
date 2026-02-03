<script lang="ts">
  import type { VideoFile, TrackType } from '$lib/types';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Separator } from '$lib/components/ui/separator';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { formatLanguage } from '$lib/utils/format';
  import { ChevronDown, Subtitles, Volume2, Video, Check, X } from '@lucide/svelte';

  interface BatchTrackSelectorProps {
    files: VideoFile[];
    selectedTracks: Map<string, number[]>;
    onBatchSelect: (selection: Map<string, number[]>) => void;
    class?: string;
  }

  let {
    files,
    selectedTracks,
    onBatchSelect,
    class: className = ''
  }: BatchTrackSelectorProps = $props();

  // Compute all available track types and languages
  const trackStats = $derived(() => {
    const stats = {
      types: new Map<TrackType, number>(),
      languages: new Map<string, { count: number; type: TrackType }[]>(),
      subtitleLanguages: new Set<string>(),
      audioLanguages: new Set<string>(),
    };

    for (const file of files) {
      for (const track of file.tracks) {
        // Count by type
        stats.types.set(track.type, (stats.types.get(track.type) || 0) + 1);

        // Collect languages
        if (track.language) {
          if (track.type === 'subtitle') {
            stats.subtitleLanguages.add(track.language);
          } else if (track.type === 'audio') {
            stats.audioLanguages.add(track.language);
          }
        }
      }
    }

    return stats;
  });

  const totalSelectedCount = $derived(() => {
    let count = 0;
    for (const tracks of selectedTracks.values()) {
      count += tracks.length;
    }
    return count;
  });

  // Preset selections
  type PresetType = 'all-subs' | 'subs-fra' | 'subs-eng' | 'all-audio' | 'audio-fra' | 'audio-eng' | 'all-video' | 'clear';

  function applyPreset(preset: PresetType) {
    const newSelection = new Map<string, number[]>();

    if (preset === 'clear') {
      onBatchSelect(newSelection);
      return;
    }

    for (const file of files) {
      const trackIds: number[] = [];

      for (const track of file.tracks) {
        let shouldSelect = false;

        switch (preset) {
          case 'all-subs':
            shouldSelect = track.type === 'subtitle';
            break;
          case 'subs-fra':
            shouldSelect = track.type === 'subtitle' && track.language === 'fra';
            break;
          case 'subs-eng':
            shouldSelect = track.type === 'subtitle' && track.language === 'eng';
            break;
          case 'all-audio':
            shouldSelect = track.type === 'audio';
            break;
          case 'audio-fra':
            shouldSelect = track.type === 'audio' && track.language === 'fra';
            break;
          case 'audio-eng':
            shouldSelect = track.type === 'audio' && track.language === 'eng';
            break;
          case 'all-video':
            shouldSelect = track.type === 'video';
            break;
        }

        if (shouldSelect) {
          trackIds.push(track.id);
        }
      }

      if (trackIds.length > 0) {
        newSelection.set(file.path, trackIds);
      }
    }

    onBatchSelect(newSelection);
  }

  function selectByLanguage(type: TrackType, language: string) {
    const newSelection = new Map(selectedTracks);

    for (const file of files) {
      const currentTracks = newSelection.get(file.path) || [];
      const newTracks = new Set(currentTracks);

      for (const track of file.tracks) {
        if (track.type === type && track.language === language) {
          newTracks.add(track.id);
        }
      }

      if (newTracks.size > 0) {
        newSelection.set(file.path, Array.from(newTracks));
      }
    }

    onBatchSelect(newSelection);
  }

  function deselectByLanguage(type: TrackType, language: string) {
    const newSelection = new Map(selectedTracks);

    for (const file of files) {
      const currentTracks = newSelection.get(file.path) || [];
      const filteredTracks = currentTracks.filter(trackId => {
        const track = file.tracks.find(t => t.id === trackId);
        return !(track && track.type === type && track.language === language);
      });

      if (filteredTracks.length > 0) {
        newSelection.set(file.path, filteredTracks);
      } else {
        newSelection.delete(file.path);
      }
    }

    onBatchSelect(newSelection);
  }

  function isLanguageFullySelected(type: TrackType, language: string): boolean {
    for (const file of files) {
      const selected = selectedTracks.get(file.path) || [];
      for (const track of file.tracks) {
        if (track.type === type && track.language === language && !selected.includes(track.id)) {
          return false;
        }
      }
    }
    return true;
  }

  function toggleLanguage(type: TrackType, language: string) {
    if (isLanguageFullySelected(type, language)) {
      deselectByLanguage(type, language);
    } else {
      selectByLanguage(type, language);
    }
  }
</script>

<div class="flex flex-col gap-3 p-4 rounded-lg border bg-card {className}">
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold">Quick Selection</h3>
    {#if totalSelectedCount() > 0}
      <Badge variant="secondary">
        {totalSelectedCount()} track{totalSelectedCount() > 1 ? 's' : ''}
      </Badge>
    {/if}
  </div>

  <!-- Quick presets -->
  <div class="flex flex-wrap gap-2">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button variant="outline" size="sm" {...props}>
            <Subtitles class="size-4 mr-1.5" />
            Subtitles
            <ChevronDown class="size-3 ml-1" />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <DropdownMenu.Item onclick={() => applyPreset('all-subs')}>
          All subtitles
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Label>By language</DropdownMenu.Label>
        {#each Array.from(trackStats().subtitleLanguages) as lang}
          {@const isSelected = isLanguageFullySelected('subtitle', lang)}
          <DropdownMenu.Item onclick={() => toggleLanguage('subtitle', lang)}>
            <div class="flex items-center gap-2 w-full">
              {#if isSelected}
                <Check class="size-4 text-primary" />
              {:else}
                <div class="size-4"></div>
              {/if}
              <span>{formatLanguage(lang)}</span>
            </div>
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button variant="outline" size="sm" {...props}>
            <Volume2 class="size-4 mr-1.5" />
            Audio
            <ChevronDown class="size-3 ml-1" />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <DropdownMenu.Item onclick={() => applyPreset('all-audio')}>
          All audio tracks
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Label>By language</DropdownMenu.Label>
        {#each Array.from(trackStats().audioLanguages) as lang}
          {@const isSelected = isLanguageFullySelected('audio', lang)}
          <DropdownMenu.Item onclick={() => toggleLanguage('audio', lang)}>
            <div class="flex items-center gap-2 w-full">
              {#if isSelected}
                <Check class="size-4 text-primary" />
              {:else}
                <div class="size-4"></div>
              {/if}
              <span>{formatLanguage(lang)}</span>
            </div>
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    <Button variant="outline" size="sm" onclick={() => applyPreset('all-video')}>
      <Video class="size-4 mr-1.5" />
      Video
    </Button>

    {#if totalSelectedCount() > 0}
      <Button variant="ghost" size="sm" onclick={() => applyPreset('clear')}>
        <X class="size-4 mr-1.5" />
        Clear
      </Button>
    {/if}
  </div>

  <!-- Quick language chips for common selections -->
  {#if trackStats().subtitleLanguages.size > 0 || trackStats().audioLanguages.size > 0}
    <Separator />
    <div class="flex flex-wrap gap-1.5">
      {#each Array.from(trackStats().subtitleLanguages) as lang}
        {@const isSelected = isLanguageFullySelected('subtitle', lang)}
        <button
          class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full transition-colors
            {isSelected
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}"
          onclick={() => toggleLanguage('subtitle', lang)}
        >
          <Subtitles class="size-3" />
          {formatLanguage(lang)}
        </button>
      {/each}
      {#each Array.from(trackStats().audioLanguages) as lang}
        {@const isSelected = isLanguageFullySelected('audio', lang)}
        <button
          class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full transition-colors
            {isSelected
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}"
          onclick={() => toggleLanguage('audio', lang)}
        >
          <Volume2 class="size-3" />
          {formatLanguage(lang)}
        </button>
      {/each}
    </div>
  {/if}
</div>

