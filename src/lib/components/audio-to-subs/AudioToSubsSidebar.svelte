<script lang="ts">
  import { AudioLines, Trash2, X } from '@lucide/svelte';

  import type { AudioFile } from '$lib/types';
  import type { ImportSourceId } from '$lib/types/tool-import';
  import { ToolImportButton } from '$lib/components/shared';
  import { Button } from '$lib/components/ui/button';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';

  import AudioFileList from './AudioFileList.svelte';

  interface AudioToSubsSidebarProps {
    files: AudioFile[];
    selectedId: string | null;
    isTranscribing: boolean;
    audioFormats: string;
    onBrowse: () => void | Promise<void>;
    onBrowseFolders: () => void | Promise<void>;
    onImportFromSource: (sourceId: ImportSourceId) => void | Promise<void>;
    onCancelAll: () => void | Promise<void>;
    onClearAll: () => void;
    onSelectFile: (id: string) => void;
    onRemoveFile: (id: string) => void | Promise<void>;
    onCancelFile: (id: string) => void | Promise<void>;
    onViewResult: (file: AudioFile) => void;
    onRetry: (file: AudioFile) => void;
  }

  let {
    files,
    selectedId,
    isTranscribing,
    audioFormats,
    onBrowse,
    onBrowseFolders,
    onImportFromSource,
    onCancelAll,
    onClearAll,
    onSelectFile,
    onRemoveFile,
    onCancelFile,
    onViewResult,
    onRetry,
  }: AudioToSubsSidebarProps = $props();
</script>

<div class="w-[max(20rem,25vw)] max-w-lg border-r flex flex-col overflow-hidden">
  <div class="p-3 border-b shrink-0 flex items-center justify-between">
    <h2 class="font-semibold">Audio Files ({files.length})</h2>

    <div class="flex items-center gap-1">
      {#if isTranscribing}
        <Button
          variant="destructive"
          size="sm"
          onclick={onCancelAll}
          title="Cancel all transcriptions"
        >
          <X class="size-4 mr-1" />
          Cancel
        </Button>
      {:else}
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

        <ToolImportButton
          targetTool="audio-to-subs"
          onBrowse={onBrowse}
          onBrowseFolders={onBrowseFolders}
          onSelectSource={onImportFromSource}
          disabled={isTranscribing}
        />
      {/if}
    </div>
  </div>

  <div class="flex-1 min-h-0 overflow-auto p-2">
    {#if files.length === 0}
      <ImportDropZone
        icon={AudioLines}
        title="Drop audio files here"
        formats={audioFormats}
        onBrowse={onBrowse}
        disabled={isTranscribing}
      />
    {:else}
      <AudioFileList
        {files}
        {selectedId}
        onSelect={onSelectFile}
        onRemove={onRemoveFile}
        onCancel={onCancelFile}
        onViewResult={onViewResult}
        onRetry={onRetry}
        disabled={isTranscribing}
      />
    {/if}
  </div>
</div>
