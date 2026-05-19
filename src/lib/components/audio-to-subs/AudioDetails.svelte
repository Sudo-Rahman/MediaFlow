<script lang="ts">
  import { AudioLines, Clock, Radio, Volume2, HardDrive, Disc3 } from '@lucide/svelte';
  import type { AudioFile } from '$lib/types';
  import { cn } from '$lib/utils';
  import { formatDuration, formatFileSize, formatChannels, formatBitrate } from '$lib/utils/format';
  import { getAudioTrackLanguageLabel } from '$lib/utils/audio-language';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Empty from '$lib/components/ui/empty';
  import * as Item from '$lib/components/ui/item';
  import Waveform from './Waveform.svelte';
  import { audioToSubsStore } from '$lib/stores/audio-to-subs.svelte';

  interface AudioDetailsProps {
    file: AudioFile | undefined;
    showWaveform?: boolean;
    onChangeTrack?: (file: AudioFile) => void;
    class?: string;
  }

  let { 
    file, 
    showWaveform = true,
    onChangeTrack,
    class: className = '' 
  }: AudioDetailsProps = $props();

  // Keep track of which files have had their waveform mounted
  // This ensures we don't remount waveforms when switching between files
  let mountedWaveforms = $state<Set<string>>(new Set());

  // Add current file to mounted set when it changes
  $effect(() => {
    if (file && !mountedWaveforms.has(file.id)) {
      mountedWaveforms = new Set([...mountedWaveforms, file.id]);
    }
  });

  // Check if track change button should be shown
  const canChangeTrack = $derived(
    file && 
    (file.audioTrackCount ?? 0) > 1 &&
    ['ready', 'completed', 'error'].includes(file.status)
  );
  const trackLanguageLabel = $derived(file ? getAudioTrackLanguageLabel(file.audioTrackLanguage) : null);
</script>

<div class={cn("h-full flex flex-col overflow-auto", className)}>
  {#if file}
    <!-- File info header -->
    <div class="p-4 border-b shrink-0">
      <div class="flex items-center gap-3">
        <div class="p-2 bg-primary/10 rounded-lg">
          <AudioLines class="size-6 text-primary" />
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-semibold truncate" title={file.name}>{file.name}</h3>
        </div>
      </div>
    </div>

    <!-- Waveform visualization - render all mounted waveforms but only show the selected one -->
    {#if showWaveform}
      {#each Array.from(mountedWaveforms) as fileId (fileId)}
        {@const waveformFile = audioToSubsStore.audioFiles.find(f => f.id === fileId)}
        {#if waveformFile}
          <div 
            class={cn(
              "h-fit p-4 border-b",
              fileId !== file.id && "hidden"
            )}
          >
            <Waveform 
              audioPath={waveformFile.path} 
              duration={waveformFile.duration} 
              fileSize={waveformFile.size} 
              fileId={waveformFile.id}
              selectedTrackIndex={waveformFile.selectedTrackIndex ?? 0}
            />
          </div>
        {/if}
      {/each}
    {/if}

    <!-- Metadata -->
    <div class="p-4 space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <!-- Duration -->
        <Item.Root variant="outline" size="xs" class="items-start">
          <Item.Media class="text-muted-foreground">
            <Clock class="size-4" />
          </Item.Media>
          <Item.Content>
            <Item.Description class="text-xs font-medium">Duration</Item.Description>
            <Item.Title class="text-lg">{file.duration ? formatDuration(file.duration) : 'N/A'}</Item.Title>
          </Item.Content>
        </Item.Root>

        <!-- Format -->
        <Item.Root variant="outline" size="xs" class="items-start">
          <Item.Media class="text-muted-foreground">
            <AudioLines class="size-4" />
          </Item.Media>
          <Item.Content>
            <Item.Description class="text-xs font-medium">Format</Item.Description>
            <Item.Title class="text-lg">{file.format?.toUpperCase() || 'N/A'}</Item.Title>
          </Item.Content>
        </Item.Root>

        <!-- Sample Rate -->
        <Item.Root variant="outline" size="xs" class="items-start">
          <Item.Media class="text-muted-foreground">
            <Radio class="size-4" />
          </Item.Media>
          <Item.Content>
            <Item.Description class="text-xs font-medium">Sample Rate</Item.Description>
            <Item.Title class="text-lg">{file.sampleRate ? `${(file.sampleRate / 1000).toFixed(1)} kHz` : 'N/A'}</Item.Title>
          </Item.Content>
        </Item.Root>

        <!-- Channels -->
        <Item.Root variant="outline" size="xs" class="items-start">
          <Item.Media class="text-muted-foreground">
            <Volume2 class="size-4" />
          </Item.Media>
          <Item.Content>
            <Item.Description class="text-xs font-medium">Channels</Item.Description>
            <Item.Title class="text-lg">{file.channels ? formatChannels(file.channels) : 'N/A'}</Item.Title>
          </Item.Content>
        </Item.Root>

        <!-- Bitrate -->
        <Item.Root variant="outline" size="xs" class="items-start">
          <Item.Media class="text-muted-foreground">
            <Radio class="size-4" />
          </Item.Media>
          <Item.Content>
            <Item.Description class="text-xs font-medium">Bitrate</Item.Description>
            <Item.Title class="text-lg">{file.bitrate ? formatBitrate(file.bitrate) : 'N/A'}</Item.Title>
          </Item.Content>
        </Item.Root>

        <!-- File Size -->
        <Item.Root variant="outline" size="xs" class="items-start">
          <Item.Media class="text-muted-foreground">
            <HardDrive class="size-4" />
          </Item.Media>
          <Item.Content>
            <Item.Description class="text-xs font-medium">Size</Item.Description>
            <Item.Title class="text-lg">{file.size ? formatFileSize(file.size) : 'N/A'}</Item.Title>
          </Item.Content>
        </Item.Root>
      </div>


        <Item.Root variant="outline" size="sm" class="items-start justify-between">
          <Item.Media class="text-muted-foreground">
            <Disc3 class="size-4" />
          </Item.Media>
          <Item.Content class="min-w-0">
            <Item.Description class="text-xs font-medium">Audio Track</Item.Description>
            <Item.Title class="max-w-full flex-wrap">
              <span>
                Track {(file.selectedTrackIndex ?? 0) + 1} of {file.audioTrackCount}
              </span>
              {#if trackLanguageLabel}
                <Badge variant="secondary" class="text-xs">
                  {trackLanguageLabel}
                </Badge>
              {:else}
                <span class="text-xs font-normal text-muted-foreground">No language tag</span>
              {/if}
            </Item.Title>
            {#if file.audioTrackTitle}
              <Item.Description class="truncate" title={file.audioTrackTitle}>
                {file.audioTrackTitle}
              </Item.Description>
            {/if}
          </Item.Content>
          <Item.Actions class="ml-auto">
            <!-- Audio Track Info (for multi-track files) -->
            {#if canChangeTrack}
              <Button
                variant="outline"
                size="sm"
                onclick={() => file && onChangeTrack?.(file)}
              >
                Change track
              </Button>
            {/if}
          </Item.Actions>
        </Item.Root>

    </div>
  {:else}
    <!-- Empty state -->
    <Empty.Root class="border-0">
      <Empty.Header>
        <Empty.Media>
          <AudioLines class="size-12 text-muted-foreground/50" />
        </Empty.Media>
        <Empty.Title>No file selected</Empty.Title>
        <Empty.Description>Select an audio file to see details</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {/if}
</div>
