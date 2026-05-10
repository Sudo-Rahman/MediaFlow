<script lang="ts">
  import { Video, Trash2, CheckCircle, Loader2, AlertCircle, Clock, FileText, RotateCw, X } from '@lucide/svelte';
  import type { OcrVideoFile } from '$lib/types';
  import { formatDuration, formatFileSize } from '$lib/utils/format';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
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
    FILE_ITEM_CARD_TITLE_CLASS,
  } from '$lib/utils/file-item-card-visuals';
  import { OCR_PHASE_LABELS } from '$lib/types';

  interface VideoFileListProps {
    files: OcrVideoFile[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onRemove: (id: string) => void;
    onCancel?: (id: string) => void;
    onViewResult?: (file: OcrVideoFile) => void;
    onRetry?: (file: OcrVideoFile) => void;
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
  }: VideoFileListProps = $props();

  function isProcessing(status: OcrVideoFile['status']): boolean {
    return ['scanning', 'transcoding', 'extracting_frames', 'ocr_processing', 'generating_subs'].includes(status);
  }

  function getPhaseLabel(file: OcrVideoFile): string {
    if (file.status === 'scanning') {
      return 'Scanning media...';
    }

    if (file.status === 'transcoding') {
      return file.transcodingCodec
        ? `Transcoding... · ${file.transcodingCodec}`
        : 'Transcoding...';
    }

    if (file.progress?.phase) {
      return OCR_PHASE_LABELS[file.progress.phase] || 'Processing...';
    }

    return 'Processing...';
  }

  function getProgressValue(file: OcrVideoFile): number {
    if (file.status === 'transcoding' && file.transcodingProgress !== undefined) {
      return file.transcodingProgress;
    }
    return file.progress?.overallPercentage ?? file.progress?.percentage ?? 0;
  }

  function hasDeterminateProgress(file: OcrVideoFile): boolean {
    return file.status !== 'scanning';
  }
</script>

<div class="space-y-2">
  {#each files as file (file.id)}
    {@const isSelected = file.id === selectedId}
    {@const processing = isProcessing(file.status)}
    {@const versionCount = file.ocrVersions?.length ?? 0}
    <FileItemCard selected={isSelected} onclick={() => onSelect(file.id)}>
      {#snippet icon()}
        {#if file.status === 'completed'}
          <CheckCircle class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} text-green-500`} />
        {:else if processing}
          <Loader2 class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} animate-spin text-primary`} />
        {:else if file.status === 'error'}
          <AlertCircle class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} text-destructive`} />
        {:else}
          <Video class={`${FILE_ITEM_CARD_STATUS_ICON_CLASS} text-muted-foreground`} />
        {/if}
      {/snippet}

      {#snippet content()}
        <p class={FILE_ITEM_CARD_TITLE_CLASS}>{file.name}</p>

        <div class={FILE_ITEM_CARD_META_CLASS}>
          {#if file.duration}
            <span class="flex items-center gap-1">
              <Clock class="size-3" />
              {formatDuration(file.duration)}
            </span>
          {/if}

          {#if file.width && file.height}
            <Badge variant="outline" class="text-[10px] px-1.5 py-0">
              {file.width}x{file.height}
            </Badge>
          {/if}

          {#if file.size && file.size > 0}
            <span>{formatFileSize(file.size)}</span>
          {/if}
        </div>

        {#if processing}
          <div class="mt-2">
            <Progress value={getProgressValue(file)} class="h-1.5" />
            <p class="text-xs text-muted-foreground mt-1">
              {getPhaseLabel(file)}
              {#if hasDeterminateProgress(file)}
                {getProgressValue(file)}%
              {/if}
            </p>
          </div>
        {/if}

        {#if file.status === 'error' && file.error}
          <p class="text-xs text-destructive mt-1 truncate" title={file.error}>
            {file.error}
          </p>
        {/if}
      {/snippet}

      {#snippet actions()}
        <div class="flex flex-col items-end gap-1">
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
                title="View subtitles"
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

            {#if ['transcoding', 'extracting_frames', 'ocr_processing', 'generating_subs'].includes(file.status) && onCancel}
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

          {#if versionCount > 0}
            <Badge variant="secondary" class="text-[10px] px-1.5 py-0">
              {versionCount} version{versionCount > 1 ? 's' : ''}
            </Badge>
          {/if}
        </div>
      {/snippet}
    </FileItemCard>
  {/each}
  
  {#if files.length === 0}
    <div class="text-center py-8 text-muted-foreground">
      <Video class="size-8 mx-auto mb-2 opacity-50" />
      <p class="text-sm">No video files</p>
    </div>
  {/if}
</div>
