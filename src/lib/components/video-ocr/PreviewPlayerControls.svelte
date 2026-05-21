<script lang="ts">
  import { Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { Slider } from '$lib/components/ui/slider';
  import { cn } from '$lib/utils';

  interface PreviewPlayerControlsProps {
    currentTime: number;
    duration: number;
    paused: boolean;
    muted: boolean;
    volume: number;
    fullscreen?: boolean;
    disabled?: boolean;
    onseek?: (timeSeconds: number) => void;
    ontoggleplay?: () => void;
    onskip?: (deltaSeconds: number) => void;
    ontogglemute?: () => void;
    onvolumechange?: (volume: number) => void;
    onfullscreen?: () => void;
    class?: string;
  }

  let {
    currentTime,
    duration,
    paused,
    muted,
    volume,
    fullscreen = false,
    disabled = false,
    onseek,
    ontoggleplay,
    onskip,
    ontogglemute,
    onvolumechange,
    onfullscreen,
    class: className = '',
  }: PreviewPlayerControlsProps = $props();

  let volumeOpen = $state(false);
  let volumeCloseTimer: ReturnType<typeof setTimeout> | undefined;

  const safeDuration = $derived(Number.isFinite(duration) ? Math.max(0, duration) : 0);
  const safeCurrentTime = $derived(
    Number.isFinite(currentTime) ? Math.min(Math.max(0, currentTime), safeDuration || Number.MAX_SAFE_INTEGER) : 0,
  );
  const safeVolume = $derived(Number.isFinite(volume) ? Math.min(Math.max(0, volume), 1) : 0);
  const volumePercent = $derived(Math.round(safeVolume * 100));
  const controlsDisabled = $derived(disabled || safeDuration <= 0);

  function formatTime(timeSeconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(Number.isFinite(timeSeconds) ? timeSeconds : 0));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function handleSeek(timeSeconds: number): void {
    onseek?.(timeSeconds);
  }

  function handleVolumeChange(nextVolumePercent: number): void {
    onvolumechange?.(nextVolumePercent / 100);
  }

  function openVolumePopover(): void {
    if (volumeCloseTimer) {
      clearTimeout(volumeCloseTimer);
      volumeCloseTimer = undefined;
    }

    volumeOpen = true;
  }

  function scheduleVolumePopoverClose(): void {
    if (volumeCloseTimer) {
      clearTimeout(volumeCloseTimer);
    }

    volumeCloseTimer = setTimeout(() => {
      volumeOpen = false;
      volumeCloseTimer = undefined;
    }, 120);
  }

  function handleVolumeFocusOut(event: FocusEvent): void {
    const nextFocusedElement = event.relatedTarget as HTMLElement | null;
    if (nextFocusedElement?.closest('[data-video-volume-control]')) return;
    scheduleVolumePopoverClose();
  }

  $effect(() => () => {
    if (volumeCloseTimer) {
      clearTimeout(volumeCloseTimer);
    }
  });
</script>

<div
  class={cn(
    'preview-player-controls-shell min-h-14 border-t bg-background px-3 py-2',
    className,
  )}
>
  <div class="preview-player-controls-grid grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
    <div class="transport-controls flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="skip-control"
        disabled={disabled}
        aria-label="Back 10 seconds"
        title="Back 10 seconds"
        onclick={() => onskip?.(-10)}
      >
        <RotateCcw class="size-4" aria-hidden="true" />
      </Button>

      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        disabled={disabled}
        aria-label={paused ? 'Play' : 'Pause'}
        title={paused ? 'Play' : 'Pause'}
        onclick={ontoggleplay}
      >
        {#if paused}
          <Play class="size-4" aria-hidden="true" />
        {:else}
          <Pause class="size-4" aria-hidden="true" />
        {/if}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="skip-control"
        disabled={disabled}
        aria-label="Forward 10 seconds"
        title="Forward 10 seconds"
        onclick={() => onskip?.(10)}
      >
        <RotateCw class="size-4" aria-hidden="true" />
      </Button>
    </div>

    <div class="seek-controls grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-2">
      <span class="time-label font-mono text-xs tabular-nums text-muted-foreground">{formatTime(safeCurrentTime)}</span>
      <Slider
        aria-label="Seek"
        type="single"
        value={safeCurrentTime}
        onValueChange={handleSeek}
        min={0}
        max={safeDuration}
        step={0.1}
        disabled={controlsDisabled}
      />
      <span class="time-label text-right font-mono text-xs tabular-nums text-muted-foreground">{formatTime(safeDuration)}</span>
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <Popover.Root
        bind:open={volumeOpen}
        onOpenChange={(open) => {
          volumeOpen = open;
        }}
      >
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              data-video-volume-control
              aria-label={muted || safeVolume === 0 ? 'Unmute' : 'Mute'}
              title={muted || safeVolume === 0 ? 'Unmute' : 'Mute'}
              onpointerenter={openVolumePopover}
              onpointerleave={scheduleVolumePopoverClose}
              onfocus={openVolumePopover}
              onfocusout={handleVolumeFocusOut}
              onclick={ontogglemute}
            >
              {#if muted || safeVolume === 0}
                <VolumeX class="size-4" aria-hidden="true" />
              {:else}
                <Volume2 class="size-4" aria-hidden="true" />
              {/if}
            </Button>
          {/snippet}
        </Popover.Trigger>

        <Popover.Content
          side="top"
          align="center"
          sideOffset={6}
          collisionPadding={8}
          data-video-volume-control
          class="w-11 rounded-md p-2"
          onpointerenter={openVolumePopover}
          onpointerleave={scheduleVolumePopoverClose}
          onfocusin={openVolumePopover}
          onfocusout={handleVolumeFocusOut}
        >
          <div class="flex h-28 items-center justify-center">
            <Slider
              aria-label="Volume"
              type="single"
              orientation="vertical"
              value={volumePercent}
              onValueChange={handleVolumeChange}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              style="height: 7rem; min-height: 7rem;"
            />
          </div>
        </Popover.Content>
      </Popover.Root>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        onclick={onfullscreen}
      >
        {#if fullscreen}
          <Minimize class="size-4" aria-hidden="true" />
        {:else}
          <Maximize class="size-4" aria-hidden="true" />
        {/if}
      </Button>
    </div>
  </div>
</div>

<style>
  .preview-player-controls-shell {
    container-type: inline-size;
  }

  @container (max-width: 38rem) {
    .preview-player-controls-grid {
      grid-template-columns: auto minmax(5rem, 1fr) auto;
      gap: 0.5rem;
    }

    .skip-control {
      display: none;
    }

    .seek-controls {
      grid-template-columns: 2.75rem minmax(4rem, 1fr) 2.75rem;
      gap: 0.375rem;
    }
  }

  @container (max-width: 30rem) {
    .preview-player-controls-grid {
      gap: 0.375rem;
    }

    .transport-controls {
      gap: 0;
    }

    .seek-controls {
      grid-template-columns: 2.35rem minmax(3rem, 1fr) 2.35rem;
    }

    .time-label {
      font-size: 0.625rem;
    }
  }
</style>
