<script lang="ts">
  import { AudioLines, Check, Languages } from '@lucide/svelte';
  import type { AudioTrackInfo } from '$lib/types';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';
  ;
  ;
  ;

  interface AudioTrackSelectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tracks: AudioTrackInfo[];
    fileName: string;
    onSelect: (trackIndex: number) => void;
  }

  let { 
    open = $bindable(false), 
    onOpenChange,
    tracks,
    fileName,
    onSelect
  }: AudioTrackSelectDialogProps = $props();

  let selectedTrackIndex = $state<number | null>(null);

  // Reset selection when dialog opens
  $effect(() => {
    if (open) {
      // Select the default track, or first track
      const defaultTrack = tracks.find(t => t.isDefault);
      selectedTrackIndex = defaultTrack?.index ?? tracks[0]?.index ?? null;
    }
  });

  function formatBitrate(bitrate?: number): string {
    if (!bitrate) return '';
    if (bitrate >= 1000) {
      return `${(bitrate / 1000).toFixed(0)} kbps`;
    }
    return `${bitrate} bps`;
  }

  function formatSampleRate(sampleRate: number): string {
    if (sampleRate >= 1000) {
      return `${(sampleRate / 1000).toFixed(1)} kHz`;
    }
    return `${sampleRate} Hz`;
  }

  function formatChannels(channels: number): string {
    switch (channels) {
      case 1: return 'Mono';
      case 2: return 'Stereo';
      case 6: return '5.1';
      case 8: return '7.1';
      default: return `${channels} ch`;
    }
  }

  function handleConfirm() {
    if (selectedTrackIndex !== null) {
      onSelect(selectedTrackIndex);
      onOpenChange(false);
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <AudioLines class="size-5" />
        Select Audio Track
      </Dialog.Title>
      <Dialog.Description>
        {fileName} contains multiple audio tracks. Choose one to transcribe.
      </Dialog.Description>
    </Dialog.Header>

    <div class="py-4 space-y-2">
      {#each tracks as track (track.index)}
        {@const isSelected = selectedTrackIndex === track.index}
        <button
          class={cn(
            "w-full text-left p-3 rounded-lg border transition-colors",
            isSelected 
              ? "border-primary bg-primary/5" 
              : "border-border hover:bg-muted/50"
          )}
          onclick={() => selectedTrackIndex = track.index}
        >
          <div class="flex items-start gap-3">
            <!-- Selection indicator -->
            <div class={cn(
              "size-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
              isSelected ? "border-primary bg-primary" : "border-muted-foreground"
            )}>
              {#if isSelected}
                <Check class="size-3 text-primary-foreground" />
              {/if}
            </div>
            
            <!-- Track info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-medium text-sm">
                  Track {track.index + 1}
                  {#if track.title}
                    - {track.title}
                  {/if}
                </span>
                {#if track.isDefault}
                  <Badge variant="secondary" class="text-[10px]">Default</Badge>
                {/if}
              </div>
              
              <div class="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                <Badge variant="outline" class="text-[10px]">
                  {track.codec.toUpperCase()}
                </Badge>
                
                <span>{formatChannels(track.channels)}</span>
                <span>{formatSampleRate(track.sampleRate)}</span>
                
                {#if track.bitrate}
                  <span>{formatBitrate(track.bitrate)}</span>
                {/if}
                
                {#if track.language}
                  <span class="flex items-center gap-1">
                    <Languages class="size-3" />
                    {track.language.toUpperCase()}
                  </span>
                {/if}
              </div>
            </div>
          </div>
        </button>
      {/each}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button onclick={handleConfirm} disabled={selectedTrackIndex === null}>
        Select
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
