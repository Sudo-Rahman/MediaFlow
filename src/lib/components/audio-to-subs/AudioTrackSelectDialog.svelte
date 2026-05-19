<script lang="ts">
  import { AudioLines, Check, Languages } from '@lucide/svelte';
  import type { AudioTrackInfo } from '$lib/types';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import * as Item from '$lib/components/ui/item';
  import { getAudioTrackLanguageLabel } from '$lib/utils/audio-language';
  import { cn } from '$lib/utils';

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
    <Dialog.Content class="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
    <Dialog.Header class="shrink-0">
      <Dialog.Title class="flex items-center gap-2">
        <AudioLines class="size-5" />
        Select Audio Track
      </Dialog.Title>
      <Dialog.Description>
        {fileName} contains multiple audio tracks. Choose one to transcribe.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-scroll-body flex flex-col gap-2 py-4">
      {#each tracks as track (track.index)}
        {@const isSelected = selectedTrackIndex === track.index}
        <Item.Root
          variant={isSelected ? 'outline' : 'default'}
          size="sm"
          class={cn(
            "hover:bg-muted/50",
            isSelected && "border-primary bg-card ring-1 ring-primary/20 hover:bg-card"
          )}
        >
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class={cn(String(props.class ?? ''), "text-left")}
              aria-pressed={isSelected}
              onclick={() => selectedTrackIndex = track.index}
            >
              <Item.Media class="mt-0.5">
                <div class={cn(
                  "size-5 rounded-full border-2 flex items-center justify-center",
                  isSelected ? "border-primary bg-primary" : "border-muted-foreground"
                )}>
                  {#if isSelected}
                    <Check class="size-3 text-primary-foreground" />
                  {/if}
                </div>
              </Item.Media>

              <Item.Content class="min-w-0">
                <Item.Title class="max-w-full">
                  <span class="truncate">
                    Track {track.index + 1}
                    {#if track.title}
                      - {track.title}
                    {/if}
                  </span>
                  {#if track.isDefault}
                    <Badge variant="secondary" class="text-[10px]">Default</Badge>
                  {/if}
                </Item.Title>

                <Item.Description class="flex max-w-full flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" class="text-[10px]">
                    {track.codec.toUpperCase()}
                  </Badge>

                  <span>{formatChannels(track.channels)}</span>
                  <span>{formatSampleRate(track.sampleRate)}</span>

                  {#if track.bitrate}
                    <span>{formatBitrate(track.bitrate)}</span>
                  {/if}

                  {#if getAudioTrackLanguageLabel(track.language)}
                    <span class="flex items-center gap-1">
                      <Languages class="size-3" />
                      {getAudioTrackLanguageLabel(track.language)}
                    </span>
                  {:else}
                    <span>No language tag</span>
                  {/if}
                </Item.Description>
              </Item.Content>
            </button>
          {/snippet}
        </Item.Root>
      {/each}
    </div>

    <Dialog.Footer class="shrink-0">
      <Button variant="outline" onclick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button onclick={handleConfirm} disabled={selectedTrackIndex === null}>
        Select
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
