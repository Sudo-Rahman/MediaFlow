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
    getFileCardStatusLabel,
    getFileCardStatusTextClass,
    shouldShowFileCardProgress,
  } from '$lib/utils/file-run-state';
  import { formatDuration, formatFileSize } from '$lib/utils/format';

  interface MergeFileListProps {
    files: MergeVideoFile[];
    selectedId: string | null;
    fileRunStates?: Map<string, FileRunState>;
    isProcessing?: boolean;
    currentProcessingPath?: string | null;
    onSelect?: (id: string) => void;
    onRemove?: (id: string) => void;
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
      {@const statusLabel = getFileCardStatusLabel(file.status, runState, file.error)}
      {@const isCurrentProcessing = isProcessing && currentProcessingPath === file.path}
      {@const removeDisabled = isProcessing && !isCurrentProcessing}
      {@const seriesInfo = formatSeriesInfo(file.seasonNumber, file.episodeNumber)}
      <FileItemCard
        compact={compact}
        selected={selectedId === file.id}
        onclick={() => onSelect?.(file.id)}
      >
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
          <p class="font-medium truncate text-sm">{file.name}</p>

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
            class="size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onclick={(e: MouseEvent) => { e.stopPropagation(); onRemove?.(file.id); }}
            disabled={removeDisabled}
            title={removeDisabled ? 'Cannot remove while another file is processing' : 'Remove'}
          >
            <Trash2 class="size-3" />
            <span class="sr-only">Remove</span>
          </Button>
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
