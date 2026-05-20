<script lang="ts">
  import { AudioLines, Trash2, CheckCircle, Loader2, AlertCircle, Clock, FileAudio, FileText, RotateCw, X } from '@lucide/svelte';
  import type { AudioFile } from '$lib/types';
  import { formatDuration, formatFileSize, formatChannels } from '$lib/utils/format';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Empty from '$lib/components/ui/empty';
  import { Progress } from '$lib/components/ui/progress';
  import { FileItemCard } from '$lib/components/shared';
  import {
    FILE_ITEM_CARD_ACTION_BUTTON_CLASS,
    FILE_ITEM_CARD_ACTION_ICON_CLASS,
    FILE_ITEM_CARD_CANCEL_ACTION_CLASS,
    FILE_ITEM_CARD_META_CLASS,
    FILE_ITEM_CARD_PRIMARY_ACTION_CLASS,
    FILE_ITEM_CARD_REMOVE_ACTION_CLASS,
    FILE_ITEM_CARD_RETRY_ACTION_CLASS,
    FILE_ITEM_CARD_STATUS_ICON_CLASS,
  } from '$lib/utils/file-item-card-visuals';

  interface AudioFileListProps {
    files: AudioFile[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onRemove: (id: string) => void;
    onCancel?: (id: string) => void;
    onViewResult?: (file: AudioFile) => void;
    onRetry?: (file: AudioFile) => void;
    disabled?: boolean;
  }

  let { 
    files, 
    selectedId, 
    onSelect, 
    onRemove,
    onCancel,
    onViewResult,
    onRetry,
    disabled = false 
  }: AudioFileListProps = $props();

</script>

<div class="space-y-2">
  {#each files as file (file.id)}
    {@const isSelected = file.id === selectedId}
    {@const isTranscribing = file.status === 'transcribing'}
    {@const isTranscoding = file.status === 'transcoding'}
    {@const versionCount = file.transcriptionVersions?.length ?? 0}
    <FileItemCard
      title={file.name}
      selected={isSelected}
      onclick={() => onSelect(file.id)}
      selectionLabel={`Select ${file.name}`}
    >
      {#snippet icon()}
        {#if file.status === 'completed'}
          <CheckCircle class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} text-green-500`} />
        {:else if file.status === 'transcribing'}
          <Loader2 class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} animate-spin text-primary`} />
        {:else if file.status === 'transcoding'}
          <Loader2 class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} animate-spin text-orange-500`} />
        {:else if file.status === 'error'}
          <AlertCircle class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} text-destructive`} />
        {:else}
          <FileAudio class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} text-muted-foreground`} />
        {/if}
      {/snippet}

      {#snippet meta()}
        <div class={FILE_ITEM_CARD_META_CLASS}>
          {#if file.duration}
            <span class="flex items-center gap-1">
              <Clock class="size-3" />
              {formatDuration(file.duration)}
            </span>
          {/if}

          {#if file.format}
            <Badge variant="outline" class="text-[10px] px-1.5 py-0">
              {file.format.toUpperCase()}
            </Badge>
          {/if}

          {#if file.channels}
            <span>{formatChannels(file.channels)}</span>
          {/if}

          {#if file.size && file.size > 0}
            <span>{formatFileSize(file.size)}</span>
          {/if}

          {#if versionCount > 0}
            <Badge variant="secondary" class="text-[10px] px-1.5 py-0">
              {versionCount} version{versionCount > 1 ? 's' : ''}
            </Badge>
          {/if}
        </div>
      {/snippet}

      {#snippet details()}
        {#if file.status === 'transcribing' && file.progress !== undefined}
          <div class="mt-2">
            <Progress value={file.progress} class="h-1.5" />
            <p class="text-xs text-muted-foreground mt-1">Transcribing {file.progress}%</p>
          </div>
        {/if}

        {#if file.status === 'transcoding' && file.transcodingProgress !== undefined}
          <div class="mt-2">
            <Progress value={file.transcodingProgress} class="h-1.5 [&>div]:bg-orange-500" />
            <p class="text-xs text-orange-600 mt-1">Converting to OPUS {file.transcodingProgress}%</p>
          </div>
        {/if}

        {#if file.status === 'error' && file.error}
          <p class="text-xs text-destructive mt-1 truncate" title={file.error}>
            {file.error}
          </p>
        {/if}
      {/snippet}

      {#snippet actions()}
        <div class="flex items-center gap-1">
          {#if versionCount > 0 && onViewResult}
            <Button
              variant="ghost"
              size="icon"
              class={`${FILE_ITEM_CARD_ACTION_BUTTON_CLASS} ${FILE_ITEM_CARD_PRIMARY_ACTION_CLASS}`}
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                onViewResult(file);
              }}
              title="View results"
            >
              <FileText class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
            </Button>
          {/if}

          {#if (file.status === 'error' || file.status === 'completed') && onRetry}
            <Button
              variant="ghost"
              size="icon"
              class={`${FILE_ITEM_CARD_ACTION_BUTTON_CLASS} ${FILE_ITEM_CARD_RETRY_ACTION_CLASS}`}
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                onRetry(file);
              }}
              disabled={disabled}
              title="Retry"
            >
              <RotateCw class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
            </Button>
          {/if}

          {#if isTranscribing && onCancel}
            <Button
              variant="ghost"
              size="icon"
              class={`${FILE_ITEM_CARD_ACTION_BUTTON_CLASS} ${FILE_ITEM_CARD_CANCEL_ACTION_CLASS}`}
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                onCancel(file.id);
              }}
              title="Cancel"
            >
              <X class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
            </Button>
          {:else}
            <Button
              variant="ghost"
              size="icon"
              class={`${FILE_ITEM_CARD_ACTION_BUTTON_CLASS} ${FILE_ITEM_CARD_REMOVE_ACTION_CLASS}`}
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                onRemove(file.id);
              }}
              disabled={disabled}
              title="Remove"
            >
              <Trash2 class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
            </Button>
          {/if}
        </div>
      {/snippet}
    </FileItemCard>
  {/each}
  
  {#if files.length === 0}
    <Empty.Root class="border-0 py-8">
      <Empty.Header>
        <Empty.Media>
          <AudioLines class="size-8 text-muted-foreground/50" />
        </Empty.Media>
        <Empty.Title class="text-sm">No audio files</Empty.Title>
      </Empty.Header>
    </Empty.Root>
  {/if}
</div>
