<script lang="ts">
  import { Video, Trash2, CheckCircle, Loader2, AlertCircle, Clock, FileText, RotateCw, X } from '@lucide/svelte';
  import type { OcrVideoFile } from '$lib/types';
  import { formatDuration, formatFileSize } from '$lib/utils/format';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import { FileItemCard } from '$lib/components/shared';
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
    return ['transcoding', 'extracting_frames', 'ocr_processing', 'generating_subs'].includes(status);
  }

  function getPhaseLabel(file: OcrVideoFile): string {
    if (file.progress?.phase) {
      return OCR_PHASE_LABELS[file.progress.phase] || 'Processing...';
    }
    if (file.status === 'transcoding') return 'Transcoding...';
    return 'Processing...';
  }

  function getProgressValue(file: OcrVideoFile): number {
    if (file.status === 'transcoding' && file.transcodingProgress !== undefined) {
      return file.transcodingProgress;
    }
    return file.progress?.percentage ?? 0;
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
          <CheckCircle class="size-5 text-green-500" />
        {:else if processing}
          <Loader2 class="size-5 animate-spin text-primary" />
        {:else if file.status === 'error'}
          <AlertCircle class="size-5 text-destructive" />
        {:else}
          <Video class="size-5 text-muted-foreground" />
        {/if}
      {/snippet}

      {#snippet content()}
        <p class="font-medium text-sm truncate">{file.name}</p>

        <div class="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
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
              {getPhaseLabel(file)} {getProgressValue(file)}%
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
                class="size-7 text-primary hover:text-primary"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onViewResult(file);
                }}
                title="View subtitles"
              >
                <FileText class="size-3.5" />
              </Button>
            {/if}

            {#if (file.status === 'error' || file.status === 'completed') && onRetry}
              <Button
                variant="ghost"
                size="icon"
                class="size-7 text-orange-500 hover:text-orange-600 hover:bg-orange-500/10"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onRetry(file);
                }}
                title="Retry"
              >
                <RotateCw class="size-3.5" />
              </Button>
            {/if}

            {#if processing && onCancel}
              <Button
                variant="ghost"
                size="icon"
                class="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onCancel(file.id);
                }}
                title="Cancel"
              >
                <X class="size-3.5" />
              </Button>
            {:else if !processing}
              <Button
                variant="ghost"
                size="icon"
                class="size-7"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onRemove(file.id);
                }}
                disabled={disabled}
                title="Remove"
              >
                <Trash2 class="size-3.5" />
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
