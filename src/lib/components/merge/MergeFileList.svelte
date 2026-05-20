<script lang="ts">
  import {
    FileVideo,
    Loader2,
    XCircle,
    Trash2,
    Plus,
    CheckCircle,
    Film,
    Volume2,
    Subtitles,
    X,
  } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import type { FileRunState, MergeVideoFile } from '$lib/types';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Progress } from '$lib/components/ui/progress';
  import { FileItemCard } from '$lib/components/shared';
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

  interface MergeFileListProps {
    files: MergeVideoFile[];
    selectedId: string | null;
    fileRunStates?: Map<string, FileRunState>;
    isProcessing?: boolean;
    currentProcessingPath?: string | null;
    onSelect?: (id: string) => void;
    onRemove?: (id: string) => void;
    onCancelFile?: (id: string) => void | Promise<void>;
    onAddFiles?: () => void;
    showAddButton?: boolean;
    compact?: boolean;
    class?: string;
  }

  let {
    files,
    selectedId,
    fileRunStates = new Map(),
    isProcessing = false,
    currentProcessingPath = null,
    onSelect,
    onRemove,
    onCancelFile,
    onAddFiles,
    showAddButton = true,
    compact = false,
    class: className = ''
  }: MergeFileListProps = $props();

  function formatSeriesInfo(season?: number, episode?: number): string | null {
    if (episode === undefined) return null;
    if (season !== undefined) {
      return `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
    }
    return `EP ${episode.toString().padStart(2, '0')}`;
  }

</script>

<div class={cn('flex flex-col', className)}>
  <div class="space-y-1.5">
    {#each files as file (file.id)}
      {@const counts = countTracksByType(file.tracks)}
      {@const runState = fileRunStates.get(file.path)}
      {@const status = getFileCardStatus(file.status, runState)}
      {@const showProgress = !!runState && shouldShowFileCardProgress(status)}
      {@const isCurrentProcessing = isProcessing && currentProcessingPath === file.path}
      {@const showCancelAction = status === 'processing' && isCurrentProcessing}
      {@const removeDisabled = isProcessing && !isCurrentProcessing}
      {@const seriesInfo = formatSeriesInfo(file.seasonNumber, file.episodeNumber)}
      <FileItemCard
        title={file.name}
        compact={compact}
        selected={selectedId === file.id}
        onclick={() => onSelect?.(file.id)}
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
          <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
            {#if seriesInfo}
              <Badge variant="outline" class="text-xs">{seriesInfo}</Badge>
            {/if}
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
            {#if file.attachedTracks.length > 0}
              <Badge class="text-xs">+{file.attachedTracks.length}</Badge>
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
              onclick={(e: MouseEvent) => { e.stopPropagation(); void onCancelFile?.(file.id); }}
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
              onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove?.(file.id); }}
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
      {#if showAddButton}
        <div class="flex flex-col items-center justify-center py-8 text-center">
          <FileVideo class="size-10 text-muted-foreground/30 mb-2" />
          <p class="text-sm text-muted-foreground">No files</p>
          <Button variant="outline" size="sm" class="mt-3" onclick={onAddFiles}>
            <Plus class="size-4 mr-1" />
            Add files
          </Button>
        </div>
      {/if}
    {/each}
  </div>
</div>
