<script lang="ts">
  import { Maximize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import { Slider } from '$lib/components/ui/slider';
  import { cn } from '$lib/utils';

  interface PreviewPlayerControlsProps {
    currentTime: number;
    duration: number;
    paused: boolean;
    muted: boolean;
    volume: number;
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

  function handleVolumePointerLeave(event: PointerEvent): void {
    const wrapper = event.currentTarget as HTMLElement;
    const activeElement = document.activeElement;
    const nextPointerTarget = event.relatedTarget as Node | null;

    if (
      (activeElement && wrapper.contains(activeElement))
      || (nextPointerTarget && wrapper.contains(nextPointerTarget))
    ) {
      return;
    }

    volumeOpen = false;
  }

  function handleVolumeFocusOut(event: FocusEvent): void {
    const wrapper = event.currentTarget as HTMLElement;
    const nextFocusedElement = event.relatedTarget as Node | null;

    if (!nextFocusedElement || !wrapper.contains(nextFocusedElement)) {
      volumeOpen = false;
    }
  }
</script>

<div
  class={cn(
    'grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t bg-background px-3 py-2',
    className,
  )}
>
  <div class="flex shrink-0 items-center gap-1">
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
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
      disabled={disabled}
      aria-label="Forward 10 seconds"
      title="Forward 10 seconds"
      onclick={() => onskip?.(10)}
    >
      <RotateCw class="size-4" aria-hidden="true" />
    </Button>
  </div>

  <div class="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-2">
    <span class="font-mono text-xs tabular-nums text-muted-foreground">{formatTime(safeCurrentTime)}</span>
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
    <span class="text-right font-mono text-xs tabular-nums text-muted-foreground">{formatTime(safeDuration)}</span>
  </div>

  <div class="flex shrink-0 items-center gap-1">
    <div
      class="relative"
      role="group"
      aria-label="Volume controls"
      onpointerenter={() => {
        volumeOpen = true;
      }}
      onpointerleave={handleVolumePointerLeave}
      onfocusin={() => {
        volumeOpen = true;
      }}
      onfocusout={handleVolumeFocusOut}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={muted || safeVolume === 0 ? 'Unmute' : 'Mute'}
        title={muted || safeVolume === 0 ? 'Unmute' : 'Mute'}
        onclick={ontogglemute}
      >
        {#if muted || safeVolume === 0}
          <VolumeX class="size-4" aria-hidden="true" />
        {:else}
          <Volume2 class="size-4" aria-hidden="true" />
        {/if}
      </Button>

      {#if volumeOpen}
        <div class="absolute bottom-full left-1/2 z-20 flex h-36 -translate-x-1/2 flex-col items-center gap-2 rounded-md border bg-popover px-3 py-3 text-popover-foreground shadow-md">
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
            class="h-24"
          />
          <span class="font-mono text-[10px] tabular-nums text-muted-foreground">{volumePercent}%</span>
        </div>
      {/if}
    </div>

    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      aria-label="Enter fullscreen"
      title="Enter fullscreen"
      onclick={onfullscreen}
    >
      <Maximize class="size-4" aria-hidden="true" />
    </Button>
  </div>
</div>
