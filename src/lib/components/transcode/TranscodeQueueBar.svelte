<script lang="ts">
  import { FolderOpen, Play, X } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import { formatTransferRate } from '$lib/utils/format';

  interface Props {
    readyCount: number;
    conflictCount: number;
    isProcessing: boolean;
    isCancelling: boolean;
    progress: number;
    totalFiles: number;
    currentSpeedBytesPerSec?: number;
    currentFrame?: number;
    totalFrames?: number;
    framesPerSecond?: number;
    onOpenOutput?: () => void;
    onCancelAll?: () => void | Promise<void>;
    onStartTranscode?: () => void | Promise<void>;
  }

  let {
    readyCount,
    conflictCount,
    isProcessing,
    isCancelling,
    progress,
    totalFiles,
    currentSpeedBytesPerSec,
    currentFrame,
    totalFrames,
    framesPerSecond,
    onOpenOutput,
    onCancelAll,
    onStartTranscode,
  }: Props = $props();

  const integerFormatter = new Intl.NumberFormat('en-US');

  function formatWholeNumber(value: number): string {
    return integerFormatter.format(Math.round(value));
  }

  function normalizeNonNegative(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  function normalizePositive(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
  }

  function formatFrameProgress(current: number | undefined, total: number | undefined): string {
    const normalizedCurrent = normalizeNonNegative(current);
    const normalizedTotal = normalizePositive(total);

    if (normalizedCurrent !== undefined && normalizedTotal !== undefined) {
      return `${formatWholeNumber(Math.min(normalizedCurrent, normalizedTotal))}/${formatWholeNumber(normalizedTotal)} frames`;
    }
    if (normalizedTotal !== undefined) {
      return `${formatWholeNumber(normalizedTotal)} frames`;
    }
    if (normalizedCurrent !== undefined) {
      return `${formatWholeNumber(normalizedCurrent)} frames`;
    }
    return '';
  }

  function formatFramesPerSecond(value: number | undefined): string {
    const normalizedValue = normalizePositive(value);
    if (normalizedValue === undefined) {
      return '';
    }

    const formattedValue = normalizedValue >= 100
      ? formatWholeNumber(normalizedValue)
      : normalizedValue.toFixed(1);
    return `${formattedValue} fps`;
  }

  const frameProgressText = $derived(formatFrameProgress(currentFrame, totalFrames));
  const framesPerSecondText = $derived(formatFramesPerSecond(framesPerSecond));
</script>

<div class="border-t px-4 py-3 flex flex-wrap items-center justify-between gap-3">
  <div class="min-w-0">
    <p class="text-sm font-medium">Queue</p>
    <p class="text-xs text-muted-foreground">
      {readyCount} ready file(s)
      {#if conflictCount > 0}
        · {conflictCount} conflict(s)
      {/if}
      {#if isProcessing && totalFiles > 0}
        · {Math.round(progress)}% overall
        {#if currentSpeedBytesPerSec}
          · {formatTransferRate(currentSpeedBytesPerSec)}
        {/if}
        {#if frameProgressText}
          · {frameProgressText}
        {/if}
        {#if framesPerSecondText}
          · {framesPerSecondText}
        {/if}
      {/if}
    </p>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <Button variant="outline" onclick={onOpenOutput}>
      <FolderOpen class="size-4 mr-2" />
      Output
    </Button>

    {#if isProcessing}
      <Button variant="destructive" onclick={onCancelAll} disabled={isCancelling}>
        <X class="size-4 mr-2" />
        Cancel All
      </Button>
    {:else}
      <Button onclick={onStartTranscode} disabled={readyCount === 0 || conflictCount > 0}>
        <Play class="size-4 mr-2" />
        Start Transcode
      </Button>
    {/if}
  </div>
</div>
