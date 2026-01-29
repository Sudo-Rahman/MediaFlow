<script lang="ts">
  import type { AudioFile } from '$lib/types';
  import { cn } from '$lib/utils';
  import { formatDuration, formatFileSize, formatChannels, formatBitrate } from '$lib/utils/format';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import AudioLines from 'lucide-svelte/icons/audio-lines';
  import Clock from 'lucide-svelte/icons/clock';
  import Radio from 'lucide-svelte/icons/radio';
  import Volume2 from 'lucide-svelte/icons/volume-2';
  import HardDrive from 'lucide-svelte/icons/hard-drive';
  import Waveform from './Waveform.svelte';

  interface AudioDetailsProps {
    file: AudioFile | undefined;
    showWaveform?: boolean;
    class?: string;
  }

  let { 
    file, 
    showWaveform = true,
    class: className = '' 
  }: AudioDetailsProps = $props();
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

    <!-- Waveform visualization -->
    {#if showWaveform && file.path}
      {#key file.path}
        <div class="h-fit p-4 border-b">
          <Waveform audioPath={file.path} duration={file.duration} fileSize={file.size} />
        </div>
      {/key}
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
