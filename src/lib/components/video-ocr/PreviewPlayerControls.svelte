<script lang="ts" module>
  export interface PreviewPlayerControlsApi {
    syncPlaybackTime: (timeSeconds: number) => void;
  }

  export interface PreviewPlayerControlsSeekHandlers {
    onpreviewseek?: (timeSeconds: number) => void;
    onseek?: (timeSeconds: number) => void;
    oncancelseek?: () => void;
  }

  export function shouldRenderVolumePopoverInline(isFullscreen: boolean): boolean {
    return isFullscreen;
  }

  export type SeekPointerEndType = 'pointerup' | 'pointercancel';

  export function shouldCommitSeekOnPointerEnd(type: SeekPointerEndType): boolean {
    return type === 'pointerup';
  }

  export function shouldSyncSeekUiFromCurrentTime(activePointerId: number | null): boolean {
    return activePointerId === null;
  }
</script>

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
    onpreviewseek?: (timeSeconds: number) => void;
    onseek?: (timeSeconds: number) => void;
    oncancelseek?: () => void;
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
    onpreviewseek,
    onseek,
    oncancelseek,
    ontoggleplay,
    onskip,
    ontogglemute,
    onvolumechange,
    onfullscreen,
    class: className = '',
  }: PreviewPlayerControlsProps = $props();

  let volumeOpen = $state(false);
  let currentTimeTextEl = $state<HTMLSpanElement | null>(null);
  let seekControlEl = $state<HTMLDivElement | null>(null);
  let volumeCloseTimer: ReturnType<typeof setTimeout> | undefined;
  let latestPlaybackTimeSeconds = 0;
  let activeSeekPointerId: number | null = null;
  let seekDragStartTimeSeconds: number | null = null;
  let latestCurrentTimeLabel = '';
  let latestSeekAriaNow = '';

  const safeDuration = $derived(Number.isFinite(duration) ? Math.max(0, duration) : 0);
  const safeCurrentTime = $derived(
    clampPlaybackTime(latestPlaybackTimeSeconds),
  );
  const safeVolume = $derived(Number.isFinite(volume) ? Math.min(Math.max(0, volume), 1) : 0);
  const volumePercent = $derived(Math.round(safeVolume * 100));
  const controlsDisabled = $derived(disabled || safeDuration <= 0);
  const volumePopoverPortalProps = $derived({
    disabled: shouldRenderVolumePopoverInline(fullscreen),
  });

  function formatTime(timeSeconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(Number.isFinite(timeSeconds) ? timeSeconds : 0));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function handleSeek(timeSeconds: number): void {
    const nextTimeSeconds = clampPlaybackTime(timeSeconds);
    syncPlaybackTime(nextTimeSeconds);
    onseek?.(nextTimeSeconds);
  }

  function previewSeek(timeSeconds: number): void {
    const nextTimeSeconds = clampPlaybackTime(timeSeconds);
    syncPlaybackTime(nextTimeSeconds);
    onpreviewseek?.(nextTimeSeconds);
  }

  function handleVolumeChange(nextVolumePercent: number): void {
    onvolumechange?.(nextVolumePercent / 100);
  }

  function clampPlaybackTime(timeSeconds: number): number {
    const fallbackMax = safeDuration || Number.MAX_SAFE_INTEGER;
    return Number.isFinite(timeSeconds)
      ? Math.min(Math.max(0, timeSeconds), fallbackMax)
      : 0;
  }

  function getSeekProgressPercent(timeSeconds: number): number {
    if (safeDuration <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(100, (clampPlaybackTime(timeSeconds) / safeDuration) * 100));
  }

  function syncSeekDom(timeSeconds: number): void {
    const safeTimeSeconds = clampPlaybackTime(timeSeconds);
    const progressPercent = getSeekProgressPercent(safeTimeSeconds);
    const nextTimeLabel = formatTime(safeTimeSeconds);
    const nextAriaNow = safeTimeSeconds.toFixed(1);

    latestPlaybackTimeSeconds = safeTimeSeconds;
    if (currentTimeTextEl && latestCurrentTimeLabel !== nextTimeLabel) {
      currentTimeTextEl.dataset.timeLabel = nextTimeLabel;
      currentTimeTextEl.setAttribute('aria-label', nextTimeLabel);
      latestCurrentTimeLabel = nextTimeLabel;
    }
    if (seekControlEl) {
      seekControlEl.style.setProperty('--seek-progress', `${progressPercent}%`);
      if (latestSeekAriaNow !== nextAriaNow) {
        seekControlEl.setAttribute('aria-valuenow', nextAriaNow);
        latestSeekAriaNow = nextAriaNow;
      }
      seekControlEl.setAttribute('aria-valuetext', nextTimeLabel);
    }
  }

  export function syncPlaybackTime(timeSeconds: number): void {
    syncSeekDom(timeSeconds);
  }

  function seekTimeFromPointer(event: PointerEvent): number | null {
    if (!seekControlEl || controlsDisabled) {
      return null;
    }

    const rect = seekControlEl.getBoundingClientRect();
    if (rect.width <= 0) {
      return null;
    }

    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return ratio * safeDuration;
  }

  function handleSeekPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const nextTimeSeconds = seekTimeFromPointer(event);
    if (nextTimeSeconds === null) {
      return;
    }

    event.preventDefault();
    activeSeekPointerId = event.pointerId;
    seekDragStartTimeSeconds = latestPlaybackTimeSeconds;
    seekControlEl?.setPointerCapture(event.pointerId);
    previewSeek(nextTimeSeconds);
  }

  function handleSeekPointerMove(event: PointerEvent): void {
    if (activeSeekPointerId !== event.pointerId) {
      return;
    }

    const nextTimeSeconds = seekTimeFromPointer(event);
    if (nextTimeSeconds !== null) {
      previewSeek(nextTimeSeconds);
    }
  }

  function stopSeekDrag(event: PointerEvent, type: SeekPointerEndType): void {
    if (activeSeekPointerId !== event.pointerId) {
      return;
    }

    const nextTimeSeconds = seekTimeFromPointer(event);
    if (nextTimeSeconds !== null && shouldCommitSeekOnPointerEnd(type)) {
      previewSeek(nextTimeSeconds);
    }

    seekControlEl?.releasePointerCapture(event.pointerId);
    activeSeekPointerId = null;
    const restoreTimeSeconds = seekDragStartTimeSeconds;
    seekDragStartTimeSeconds = null;

    if (shouldCommitSeekOnPointerEnd(type)) {
      handleSeek(latestPlaybackTimeSeconds);
      return;
    }

    if (restoreTimeSeconds !== null) {
      syncPlaybackTime(restoreTimeSeconds);
    }
    oncancelseek?.();
  }

  function handleSeekKeydown(event: KeyboardEvent): void {
    if (controlsDisabled) {
      return;
    }

    const stepSeconds = event.shiftKey ? 10 : 1;
    const current = latestPlaybackTimeSeconds;
    let nextTimeSeconds: number | null = null;

    if (event.key === 'Home') {
      nextTimeSeconds = 0;
    } else if (event.key === 'End') {
      nextTimeSeconds = safeDuration;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      nextTimeSeconds = current - stepSeconds;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      nextTimeSeconds = current + stepSeconds;
    } else if (event.key === 'PageDown') {
      nextTimeSeconds = current - 10;
    } else if (event.key === 'PageUp') {
      nextTimeSeconds = current + 10;
    }

    if (nextTimeSeconds === null) {
      return;
    }

    event.preventDefault();
    handleSeek(nextTimeSeconds);
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

  $effect(() => {
    if (!shouldSyncSeekUiFromCurrentTime(activeSeekPointerId)) {
      return;
    }

    syncSeekDom(currentTime);
  });
</script>

<div
  class={cn(
    'min-h-14 border-t bg-background px-3 py-2',
    className,
  )}
>
  <div class="grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
    <div class="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="hidden xl:flex"
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
        class="hidden xl:flex"
        disabled={disabled}
        aria-label="Forward 10 seconds"
        title="Forward 10 seconds"
        onclick={() => onskip?.(10)}
      >
        <RotateCw class="size-4" aria-hidden="true" />
      </Button>
    </div>

    <div class="flex min-w-0 items-center space-x-4">
      <span
        bind:this={currentTimeTextEl}
        class="time-label font-mono text-xs tabular-nums text-muted-foreground"
        data-time-label={formatTime(safeCurrentTime)}
        role="timer"
        aria-label={formatTime(safeCurrentTime)}
      ></span>
      <div
        bind:this={seekControlEl}
        class={cn(
          'relative flex h-4 w-full touch-none select-none items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          controlsDisabled && 'opacity-50',
        )}
        style={`--seek-progress: ${getSeekProgressPercent(safeCurrentTime)}%;`}
        role="slider"
        tabindex={controlsDisabled ? undefined : 0}
        aria-label="Seek"
        aria-valuemin="0"
        aria-valuemax={safeDuration}
        aria-valuenow={safeCurrentTime}
        aria-valuetext={formatTime(safeCurrentTime)}
        aria-disabled={controlsDisabled}
        onpointerdown={handleSeekPointerDown}
        onpointermove={handleSeekPointerMove}
        onpointerup={(event) => stopSeekDrag(event, 'pointerup')}
        onpointercancel={(event) => stopSeekDrag(event, 'pointercancel')}
        onkeydown={handleSeekKeydown}
      >
        <span class="relative h-2 w-full grow overflow-hidden rounded-full bg-muted">
          <span
            class="absolute left-0 top-0 h-full select-none bg-primary"
            style="width: var(--seek-progress);"
          ></span>
        </span>
        <span
          class="absolute top-1/2 block h-4 w-6 shrink-0 -translate-x-1/2 -translate-y-1/2 select-none rounded-full bg-white shadow-md ring-1 ring-black/10 transition-[color,box-shadow,background-color] not-dark:bg-clip-padding"
          style="left: var(--seek-progress);"
          aria-hidden="true"
        ></span>
      </div>
      <span class="text-right font-mono text-xs tabular-nums text-muted-foreground">{formatTime(safeDuration)}</span>
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
          portalProps={volumePopoverPortalProps}
          data-video-volume-control
          class="w-11 p-2"
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
  .time-label::before {
    content: attr(data-time-label);
  }
</style>
