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
    X,
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
    shouldShowFileCardProgress,
  } from '$lib/utils/file-run-state';
  import {
    FILE_ITEM_CARD_ACTION_BUTTON_CLASS,
    FILE_ITEM_CARD_ACTION_ICON_CLASS,
    FILE_ITEM_CARD_CANCEL_ACTION_CLASS,
    FILE_ITEM_CARD_META_CLASS,
    FILE_ITEM_CARD_REMOVE_ACTION_CLASS,
    FILE_ITEM_CARD_STATUS_ICON_CLASS,
  } from '$lib/utils/file-item-card-visuals';
  import { formatDuration, formatFileSize } from '$lib/utils/format';

  interface FileListProps {
    files: VideoFile[];
    selectedPath: string | null;
    fileRunStates?: Map<string, FileRunState>;
    isProcessing?: boolean;
    currentProcessingPath?: string | null;
    onSelect?: (path: string) => void;
    onRemove?: (path: string) => void;
    onCancelFile?: (path: string) => void | Promise<void>;
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
    onCancelFile,
    class: className = ''
  }: FileListProps = $props();

</script>

<div class={cn('flex flex-col gap-2', className)}>
  {#each files as file (file.path)}
    {@const counts = countTracksByType(file.tracks)}
    {@const runState = fileRunStates.get(file.path)}
    {@const status = getFileCardStatus(file.status, runState)}
    {@const showProgress = !!runState && shouldShowFileCardProgress(status)}
    {@const isCurrentProcessing = isProcessing && currentProcessingPath === file.path}
    {@const showCancelAction = status === 'processing' && isCurrentProcessing}
    {@const removeDisabled = isProcessing && !isCurrentProcessing}
    <FileItemCard
      title={file.name}
      selected={selectedPath === file.path}
      onclick={() => onSelect?.(file.path)}
      selectionLabel={`Select ${file.name}`}
    >
      {#snippet icon()}
        {#if status === 'scanning'}
          <Loader2 class={cn(FILE_ITEM_CARD_STATUS_ICON_CLASS, 'text-muted-foreground animate-spin')} />
        {:else if status === 'error'}
          <XCircle class={cn(FILE_ITEM_CARD_STATUS_ICON_CLASS, 'text-destructive')} />
        {:else if status === 'completed'}
          <CheckCircle class={cn(FILE_ITEM_CARD_STATUS_ICON_CLASS, 'text-green-500')} />
        {:else if status === 'cancelled'}
          <XCircle class={cn(FILE_ITEM_CARD_STATUS_ICON_CLASS, 'text-orange-500')} />
        {:else if status === 'processing'}
          <Loader2 class={cn(FILE_ITEM_CARD_STATUS_ICON_CLASS, 'text-primary animate-spin')} />
        {:else}
          <FileVideo class={cn(FILE_ITEM_CARD_STATUS_ICON_CLASS, 'text-primary')} />
        {/if}
      {/snippet}

      {#snippet meta()}
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
      {/snippet}

      {#snippet details()}
        <div class={FILE_ITEM_CARD_META_CLASS}>
          <span>{formatFileSize(file.size)}</span>
          {#if file.duration}
            <span>• {formatDuration(file.duration)}</span>
          {/if}
          {#if showProgress && runState}
            <span>• {Math.round(runState.progress)}%</span>
          {/if}
        </div>

        {#if showProgress && runState}
          <div class="mt-2">
            <Progress value={runState.progress} class="h-1.5" />
          </div>
        {/if}
      {/snippet}

      {#snippet actions()}
        {#if showCancelAction}
          <Button
            variant="ghost"
            size="icon"
            class={cn(FILE_ITEM_CARD_ACTION_BUTTON_CLASS, FILE_ITEM_CARD_CANCEL_ACTION_CLASS)}
            onclick={(e: MouseEvent) => { e.stopPropagation(); void onCancelFile?.(file.path); }}
            title="Cancel current file"
          >
            <X class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
            <span class="sr-only">Cancel current file</span>
          </Button>
        {:else}
          <Button
            variant="ghost"
            size="icon"
            class={cn(FILE_ITEM_CARD_ACTION_BUTTON_CLASS, FILE_ITEM_CARD_REMOVE_ACTION_CLASS)}
            onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove?.(file.path); }}
            disabled={removeDisabled}
            title={removeDisabled ? 'Cannot remove while another file is processing' : 'Remove'}
          >
            <Trash2 class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
            <span class="sr-only">Remove</span>
          </Button>
        {/if}
      {/snippet}
    </FileItemCard>
  {:else}
    <p class="text-center text-muted-foreground py-8">No files imported</p>
  {/each}
</div>
