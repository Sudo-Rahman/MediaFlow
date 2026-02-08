<script lang="ts">
  import { AudioLines, Clock, Radio, Volume2, HardDrive, Disc3 } from '@lucide/svelte';
  import type { AudioFile } from '$lib/types';
  import { cn } from '$lib/utils';
  import { formatDuration, formatFileSize, formatChannels, formatBitrate } from '$lib/utils/format';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
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
</script>

<div class={cn("h-full flex flex-col overflow-auto", className)}>
  {#if file}
    <!-- File info header -->
    <div class="p-4 border-b shrink-0">
      <div class="flex items-start gap-3">
        <div class="p-2 bg-primary/10 rounded-lg">
          <AudioLines class="size-6 text-primary" />
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-semibold truncate" title={file.name}>{file.name}</h3>
          <p class="text-sm text-muted-foreground truncate" title={file.path}>
            {file.path}
          </p>
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
        <Card.Root class="p-3">
          <div class="flex items-center gap-2 text-muted-foreground mb-1">
            <Clock class="size-4" />
            <span class="text-xs font-medium">Duration</span>
          </div>
          <p class="text-lg font-semibold">
            {file.duration ? formatDuration(file.duration) : 'N/A'}
          </p>
        </Card.Root>

        <!-- Format -->
        <Card.Root class="p-3">
          <div class="flex items-center gap-2 text-muted-foreground mb-1">
            <AudioLines class="size-4" />
            <span class="text-xs font-medium">Format</span>
          </div>
          <p class="text-lg font-semibold">
            {file.format?.toUpperCase() || 'N/A'}
          </p>
        </Card.Root>

        <!-- Sample Rate -->
        <Card.Root class="p-3">
          <div class="flex items-center gap-2 text-muted-foreground mb-1">
            <Radio class="size-4" />
            <span class="text-xs font-medium">Sample Rate</span>
          </div>
          <p class="text-lg font-semibold">
            {file.sampleRate ? `${(file.sampleRate / 1000).toFixed(1)} kHz` : 'N/A'}
          </p>
        </Card.Root>

        <!-- Channels -->
        <Card.Root class="p-3">
          <div class="flex items-center gap-2 text-muted-foreground mb-1">
            <Volume2 class="size-4" />
            <span class="text-xs font-medium">Channels</span>
          </div>
          <p class="text-lg font-semibold">
            {file.channels ? formatChannels(file.channels) : 'N/A'}
          </p>
        </Card.Root>

        <!-- Bitrate -->
        <Card.Root class="p-3">
          <div class="flex items-center gap-2 text-muted-foreground mb-1">
            <Radio class="size-4" />
            <span class="text-xs font-medium">Bitrate</span>
          </div>
          <p class="text-lg font-semibold">
            {file.bitrate ? formatBitrate(file.bitrate) : 'N/A'}
          </p>
        </Card.Root>

        <!-- File Size -->
        <Card.Root class="p-3">
          <div class="flex items-center gap-2 text-muted-foreground mb-1">
            <HardDrive class="size-4" />
            <span class="text-xs font-medium">Size</span>
          </div>
          <p class="text-lg font-semibold">
            {file.size ? formatFileSize(file.size) : 'N/A'}
          </p>
        </Card.Root>
      </div>


        <Card.Root class="p-3">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-2 text-muted-foreground">
                <Disc3 class="size-4" />
                <span class="text-xs font-medium">Audio Track</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium">
                  Track {(file.selectedTrackIndex ?? 0) + 1} of {file.audioTrackCount}
                </span>
                {#if file.audioTrackLanguage}
                  <Badge variant="secondary" class="text-xs">
                    {file.audioTrackLanguage.toUpperCase()}
                  </Badge>
                {/if}
              </div>
            </div>
            <div class="flex items-center gap-3 flex-wrap">
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
              {#if file.audioTrackTitle}
                  <span class="text-sm text-muted-foreground truncate max-w-[200px]" title={file.audioTrackTitle}>
                    {file.audioTrackTitle}
                  </span>
              {/if}
            </div>
          </div>
        </Card.Root>

    </div>
  {:else}
    <!-- Empty state -->
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center text-muted-foreground">
        <AudioLines class="size-12 mx-auto mb-4 opacity-50" />
        <p class="text-lg font-medium">No file selected</p>
        <p class="text-sm">Select an audio file to see details</p>
      </div>
    </div>
  {/if}
</div>
