<script lang="ts">
  import {
    FileVideo,
    Film,
    Volume2,
    Subtitles,
    Loader2,
    XCircle,
    Trash2,
    CheckCircle,
  } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import { FileItemCard } from '$lib/components/shared';
  import type { FileRunState, VideoFile } from '$lib/types';
  import { countTracksByType } from '$lib/utils/media-tracks';
  import {
    getFileCardStatus,
    getFileCardStatusLabel,
    getFileCardStatusTextClass,
    shouldShowFileCardProgress,
  } from '$lib/utils/file-run-state';
  import { formatDuration, formatFileSize } from '$lib/utils/format';

  interface FileListProps {
    files: VideoFile[];
    selectedPath: string | null;
    fileRunStates?: Map<string, FileRunState>;
    isProcessing?: boolean;
    currentProcessingPath?: string | null;
    onSelect?: (path: string) => void;
    onRemove?: (path: string) => void;
    class?: string;
  }

  let {
    files,
    selectedPath,
    fileRunStates = new Map(),
    isProcessing = false,
    currentProcessingPath = null,
    onSelect,
    onRemove,
    class: className = ''
  }: FileListProps = $props();

</script>

<div class={cn('flex flex-col gap-2', className)}>
  {#each files as file (file.path)}
    {@const counts = countTracksByType(file.tracks)}
    {@const runState = fileRunStates.get(file.path)}
    {@const status = getFileCardStatus(file.status, runState)}
    {@const statusLabel = getFileCardStatusLabel(file.status, runState, file.error)}
    {@const isCurrentProcessing = isProcessing && currentProcessingPath === file.path}
    {@const removeDisabled = isProcessing && !isCurrentProcessing}
    <FileItemCard selected={selectedPath === file.path} onclick={() => onSelect?.(file.path)}>
      {#snippet icon()}
        {#if status === 'scanning'}
          <Loader2 class="size-5 text-muted-foreground animate-spin" />
        {:else if status === 'error'}
          <XCircle class="size-5 text-destructive" />
        {:else if status === 'completed'}
          <CheckCircle class="size-5 text-green-500" />
        {:else if status === 'cancelled'}
          <XCircle class="size-5 text-orange-500" />
        {:else if status === 'processing'}
          <Loader2 class="size-5 text-primary animate-spin" />
        {:else}
          <FileVideo class="size-5 text-primary" />
        {/if}
      {/snippet}

      {#snippet content()}
        <p class="font-medium text-sm truncate">{file.name}</p>

        <div class="flex flex-wrap gap-1.5 mt-1.5">
          {#if counts.video > 0}
            <Badge variant="secondary" class="text-xs gap-1">
              <Film class="size-3" />
              {counts.video}
            </Badge>
          {/if}
          {#if counts.audio > 0}
            <Badge variant="secondary" class="text-xs gap-1">
              <Volume2 class="size-3" />
              {counts.audio}
            </Badge>
          {/if}
          {#if counts.subtitle > 0}
            <Badge variant="secondary" class="text-xs gap-1">
              <Subtitles class="size-3" />
              {counts.subtitle}
            </Badge>
          {/if}
        </div>

        <div class="flex gap-2 mt-1 text-xs text-muted-foreground">
          <span>{formatFileSize(file.size)}</span>
          {#if file.duration}
            <span>{formatDuration(file.duration)}</span>
          {/if}
        </div>

        <p
          class={cn('text-xs mt-1', getFileCardStatusTextClass(status))}
          title={statusLabel}
        >
          {statusLabel}
        </p>

        {#if runState && shouldShowFileCardProgress(status)}
          <div class="mt-2">
            <Progress value={runState.progress} class="h-1.5" />
          </div>
        {/if}
      {/snippet}

      {#snippet actions()}
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove?.(file.path); }}
          disabled={removeDisabled}
          title={removeDisabled ? 'Cannot remove while another file is processing' : 'Remove'}
        >
          <Trash2 class="size-4" />
          <span class="sr-only">Remove</span>
        </Button>
      {/snippet}
    </FileItemCard>
  {:else}
    <p class="text-center text-muted-foreground py-8">No files imported</p>
  {/each}
</div>
