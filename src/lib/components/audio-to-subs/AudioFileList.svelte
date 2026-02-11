<script lang="ts">
  import { AudioLines, Trash2, CheckCircle, Loader2, AlertCircle, Clock, FileAudio, FileText, RotateCw, X } from '@lucide/svelte';
  import type { AudioFile } from '$lib/types';
  import { formatDuration, formatFileSize, formatChannels } from '$lib/utils/format';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import { FileItemCard } from '$lib/components/shared';

  interface AudioFileListProps {
    files: AudioFile[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onRemove: (id: string) => void;
    onCancel?: (id: string) => void;
    onViewResult?: (file: AudioFile) => void;
    onRetranscribe?: (file: AudioFile) => void;
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
    onRetranscribe,
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
    <FileItemCard selected={isSelected} onclick={() => onSelect(file.id)}>
      {#snippet icon()}
        {#if file.status === 'completed'}
          <CheckCircle class="size-5 text-green-500" />
        {:else if file.status === 'transcribing'}
          <Loader2 class="size-5 animate-spin text-primary" />
        {:else if file.status === 'transcoding'}
          <Loader2 class="size-5 animate-spin text-orange-500" />
        {:else if file.status === 'error'}
          <AlertCircle class="size-5 text-destructive" />
        {:else}
          <FileAudio class="size-5 text-muted-foreground" />
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
        </div>

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
                title="View results"
              >
                <FileText class="size-3.5" />
              </Button>
            {/if}

            {#if file.status === 'error' && onRetry}
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

            {#if file.status === 'completed' && onRetranscribe}
              <Button
                variant="ghost"
                size="icon"
                class="size-7 text-muted-foreground hover:text-primary"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  onRetranscribe(file);
                }}
                title="New transcription"
              >
                <RotateCw class="size-3.5" />
              </Button>
            {/if}

            {#if isTranscribing && onCancel}
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
            {:else}
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
      <AudioLines class="size-8 mx-auto mb-2 opacity-50" />
      <p class="text-sm">No audio files</p>
    </div>
  {/if}
</div>
