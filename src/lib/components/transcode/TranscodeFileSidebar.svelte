<script lang="ts">
  import {
    CheckCircle,
    FileVideo,
    Film,
    Info,
    Loader2,
    Subtitles,
    Trash2,
    Volume2,
    X,
    XCircle,
  } from '@lucide/svelte';

  import type { FileRunState, TranscodeFile } from '$lib/types';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Progress } from '$lib/components/ui/progress';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import { FileItemCard, ToolImportButton } from '$lib/components/shared';
  import { describeTrackSummary } from '$lib/services/transcode';
  import { cn } from '$lib/utils';
  import { countTracksByType } from '$lib/utils/media-tracks';
  import {
    FILE_ITEM_CARD_ACTION_BUTTON_CLASS,
    FILE_ITEM_CARD_ACTION_ICON_CLASS,
    FILE_ITEM_CARD_CANCEL_ACTION_CLASS,
    FILE_ITEM_CARD_META_CLASS,
    FILE_ITEM_CARD_REMOVE_ACTION_CLASS,
    FILE_ITEM_CARD_STATUS_ICON_CLASS,
  } from '$lib/utils/file-item-card-visuals';
  import { getFileCardStatus, shouldShowFileCardProgress } from '$lib/utils/file-run-state';
  import { formatDuration, formatFileSize } from '$lib/utils/format';

  interface Props {
    files: TranscodeFile[];
    selectedFileId: string | null;
    fileRunStates: Map<string, FileRunState>;
    isProcessing: boolean;
    currentProcessingFileId: string | null;
    supportedFormats: string[];
    onSelectFile?: (id: string) => void;
    onOpenInfo?: (id: string) => void;
    onRemoveFile?: (id: string) => void;
    onCancelFile?: (id: string) => void | Promise<void>;
    onAddFiles?: () => void | Promise<void>;
    onClearAll?: () => void;
  }

  let {
    files,
    selectedFileId,
    fileRunStates,
    isProcessing,
    currentProcessingFileId,
    supportedFormats,
    onSelectFile,
    onOpenInfo,
    onRemoveFile,
    onCancelFile,
    onAddFiles,
    onClearAll,
  }: Props = $props();

  function formatStatusLabel(status: ReturnType<typeof getFileCardStatus>): string {
    switch (status) {
      case 'queued':
        return 'Queued';
      case 'processing':
        return 'Transcoding';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      case 'error':
        return 'Error';
      case 'scanning':
        return 'Scanning';
      default:
        return 'Ready';
    }
  }

  function formatAiStatusLabel(file: TranscodeFile): string | null {
    if (file.aiStatus === 'analyzing') return 'AI analyzing';
    if (file.aiStatus === 'completed') return 'AI ready';
    if (file.aiStatus === 'error') return 'AI error';
    return null;
  }
</script>

<div class="w-[max(20rem,25vw)] max-w-lg border-r flex flex-col overflow-hidden">
  <div class="p-3 border-b flex items-center justify-between gap-2">
    <div>
      <h2 class="font-semibold">Files ({files.length})</h2>
    </div>
    <div class="flex items-center gap-1">
      {#if files.length > 0}
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={onClearAll}
          class="text-muted-foreground hover:text-destructive"
          disabled={isProcessing}
        >
          <Trash2 class="size-4" />
        </Button>
      {/if}
      <ToolImportButton
        targetTool="transcode"
        label="Add Files"
        onBrowse={onAddFiles}
      />
    </div>
  </div>

  <div class="flex-1 min-h-0 overflow-auto p-2">
    {#if files.length === 0}
      <ImportDropZone
        icon={FileVideo}
        title="Drop media files here"
        formats={supportedFormats}
        onBrowse={onAddFiles}
      />
    {:else}
      <div class="space-y-2">
        {#each files as file (file.id)}
          {@const runState = fileRunStates.get(file.path)}
          {@const status = getFileCardStatus(file.status, runState)}
          {@const counts = countTracksByType(file.tracks)}
          {@const showProgress = !!runState && shouldShowFileCardProgress(status)}
          {@const isCurrentProcessing = isProcessing && currentProcessingFileId === file.id}
          {@const showCancelAction = status === 'processing' && isCurrentProcessing}
          {@const removeDisabled = isProcessing && !isCurrentProcessing}
          {@const aiLabel = formatAiStatusLabel(file)}
          {@const showBadgeRow =
            status !== 'ready' || counts.video > 0 || counts.audio > 0 || counts.subtitle > 0 || !!aiLabel}
          <FileItemCard
            title={file.name}
            selected={selectedFileId === file.id}
            onclick={() => onSelectFile?.(file.id)}
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
              {:else if status === 'queued' || status === 'processing'}
                <Loader2 class={cn(FILE_ITEM_CARD_STATUS_ICON_CLASS, status === 'queued' ? 'text-orange-500 animate-spin' : 'text-primary animate-spin')} />
              {:else}
                <FileVideo class={cn(FILE_ITEM_CARD_STATUS_ICON_CLASS, file.hasVideo ? 'text-primary' : 'text-emerald-500')} />
              {/if}
            {/snippet}

            {#snippet meta()}
              {#if showBadgeRow}
                <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {#if status !== 'ready'}
                    <Badge
                      variant={status === 'error' ? 'destructive' : status === 'completed' ? 'default' : 'secondary'}
                      class="text-xs"
                    >
                      {formatStatusLabel(status)}
                    </Badge>
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
                  {#if aiLabel}
                    <Badge variant="outline" class="text-xs">{aiLabel}</Badge>
                  {/if}
                </div>
              {/if}
            {/snippet}

            {#snippet details()}
              <p class="mt-1 text-xs text-muted-foreground line-clamp-2">
                {#if file.status === 'error'}
                  {file.error}
                {:else if file.tracks.length > 0}
                  {describeTrackSummary(file)}
                {:else}
                  Preparing media scan...
                {/if}
              </p>

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
              <div class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  class={FILE_ITEM_CARD_ACTION_BUTTON_CLASS}
                  onclick={(event: MouseEvent) => {
                    event.stopPropagation();
                    onOpenInfo?.(file.id);
                  }}
                  title="File information"
                >
                  <Info class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
                </Button>

                {#if showCancelAction}
                  <Button
                    variant="ghost"
                    size="icon"
                    class={cn(FILE_ITEM_CARD_ACTION_BUTTON_CLASS, FILE_ITEM_CARD_CANCEL_ACTION_CLASS)}
                    onclick={(event: MouseEvent) => {
                      event.stopPropagation();
                      void onCancelFile?.(file.id);
                    }}
                    title="Cancel current file"
                  >
                    <X class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
                  </Button>
                {:else}
                  <Button
                    variant="ghost"
                    size="icon"
                    class={cn(FILE_ITEM_CARD_ACTION_BUTTON_CLASS, FILE_ITEM_CARD_REMOVE_ACTION_CLASS)}
                    onclick={(event: MouseEvent) => {
                      event.stopPropagation();
                      onRemoveFile?.(file.id);
                    }}
                    disabled={removeDisabled}
                    title={removeDisabled ? 'Cannot remove while another file is processing' : 'Remove'}
                  >
                    <Trash2 class={FILE_ITEM_CARD_ACTION_ICON_CLASS} />
                  </Button>
                {/if}
              </div>
            {/snippet}
          </FileItemCard>
        {/each}
      </div>
    {/if}
  </div>
</div>
