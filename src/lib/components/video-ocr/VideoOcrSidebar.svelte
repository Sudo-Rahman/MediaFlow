<script lang="ts">
  import { Trash2, Video } from '@lucide/svelte';

  import type { OcrVideoFile } from '$lib/types';
  import { Button } from '$lib/components/ui/button';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import { ToolImportButton } from '$lib/components/shared';

  import VideoFileList from './VideoFileList.svelte';

  interface VideoOcrSidebarProps {
    files: OcrVideoFile[];
    selectedFileId: string | null;
    supportedFormats: string;
    isProcessing: boolean;
    transcodingCount: number;
    onSelectFile: (fileId: string) => void;
    onRequestRemoveFile: (fileId: string) => void;
    onCancelFile: (fileId: string) => void | Promise<void>;
    onViewResult: (file: OcrVideoFile) => void;
    onRetryFile: (file: OcrVideoFile) => void;
    onAddFiles: () => void | Promise<void>;
    onAddFolders: () => void | Promise<void>;
    onClearAll: () => void | Promise<void>;
  }

  let {
    files,
    selectedFileId,
    supportedFormats,
    isProcessing,
    transcodingCount,
    onSelectFile,
    onRequestRemoveFile,
    onCancelFile,
    onViewResult,
    onRetryFile,
    onAddFiles,
    onAddFolders,
    onClearAll,
  }: VideoOcrSidebarProps = $props();

  const hasFiles = $derived(files.length > 0);
</script>

<div class="w-[max(20rem,25vw)] max-w-[32rem] border-r flex flex-col overflow-hidden">
  <div class="p-3 border-b shrink-0 flex items-center justify-between">
    <h2 class="font-semibold">Video Files ({files.length})</h2>
    <div class="flex items-center gap-1">
      {#if hasFiles}
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={() => void onClearAll()}
          class="text-muted-foreground hover:text-destructive"
          disabled={isProcessing}
        >
          <Trash2 class="size-4" />
          <span class="sr-only">Clear list</span>
        </Button>
      {/if}

      <ToolImportButton
        targetTool="video-ocr"
        onBrowse={() => void onAddFiles()}
        onBrowseFolders={() => void onAddFolders()}
        disabled={isProcessing}
      />
    </div>
  </div>

  <div class="flex-1 min-h-0 overflow-auto p-2">
    {#if !hasFiles}
      <ImportDropZone
        icon={Video}
        title="Drop video files here"
        formats={supportedFormats}
        onBrowse={() => void onAddFiles()}
        disabled={isProcessing}
      />
    {:else}
      <VideoFileList
        {files}
        selectedId={selectedFileId}
        onSelect={onSelectFile}
        onRemove={onRequestRemoveFile}
        onCancel={onCancelFile}
        onViewResult={onViewResult}
        onRetry={onRetryFile}
        disabled={isProcessing}
      />
    {/if}
  </div>

  {#if transcodingCount > 0}
    <div class="p-2 border-t shrink-0">
      <p class="text-xs text-muted-foreground text-center">
        Transcoding {transcodingCount} video{transcodingCount > 1 ? 's' : ''}...
      </p>
    </div>
  {/if}
</div>
