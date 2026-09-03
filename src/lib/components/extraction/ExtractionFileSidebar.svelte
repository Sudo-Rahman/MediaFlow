<script lang="ts">
  import { FileVideo, Trash2 } from '@lucide/svelte';

  import { ToolImportButton } from '$lib/components/shared';
  import { Button } from '$lib/components/ui/button';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import type { FileRunState, VideoFile } from '$lib/types';

  import FileList from './FileList.svelte';

  interface ExtractionFileSidebarProps {
    files: VideoFile[];
    selectedPath: string | null;
    fileRunStates: Map<string, FileRunState>;
    isProcessing: boolean;
    currentProcessingPath: string | null;
    supportedFormats: string[];
    onImport: () => void | Promise<void>;
    onImportFolders: () => void | Promise<void>;
    onClearAll?: () => void;
    onSelectFile?: (path: string) => void;
    onCancelFile?: (path: string) => void | Promise<void>;
    onRemoveFile?: (path: string) => void;
  }

  let {
    files,
    selectedPath,
    fileRunStates,
    isProcessing,
    currentProcessingPath,
    supportedFormats,
    onImport,
    onImportFolders,
    onClearAll,
    onSelectFile,
    onCancelFile,
    onRemoveFile,
  }: ExtractionFileSidebarProps = $props();
</script>

<div class="w-[max(20rem,25vw)] max-w-lg border-r flex flex-col overflow-hidden">
  <div class="p-3 border-b shrink-0 flex items-center justify-between">
    <h2 class="font-semibold">Files ({files.length})</h2>
    <div class="flex items-center gap-1">
      {#if files.length > 0}
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={onClearAll}
          class="text-muted-foreground hover:text-destructive"
        >
          <Trash2 class="size-4" />
          <span class="sr-only">Clear list</span>
        </Button>
      {/if}
      <ToolImportButton targetTool="extract" onBrowse={onImport} onBrowseFolders={onImportFolders} />
    </div>
  </div>

  {#if files.length === 0}
    <div class="flex-1 p-2 overflow-auto">
      <ImportDropZone
        icon={FileVideo}
        title="Drop media files here"
        formats={supportedFormats}
        onBrowse={onImport}
      />
    </div>
  {:else}
    <div class="flex-1 min-h-0 overflow-auto p-2">
      <FileList
        {files}
        {selectedPath}
        {fileRunStates}
        isProcessing={isProcessing}
        {currentProcessingPath}
        onSelect={onSelectFile}
        onCancelFile={onCancelFile}
        onRemove={onRemoveFile}
      />
    </div>
  {/if}
</div>
