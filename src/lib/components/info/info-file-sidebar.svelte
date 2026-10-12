<script lang="ts">
  import { Film, Trash2 } from '@lucide/svelte';

  import { ToolImportButton } from '$lib/components/shared';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import { Button } from '$lib/components/ui/button';

  import type { FileInfo } from '$lib/stores/info.svelte';
  import type { ImportSourceId } from '$lib/types/tool-import';

  import InfoFileListItem from './info-file-list-item.svelte';

  interface Props {
    files: FileInfo[];
    selectedFileId: string | null;
    supportedFormats: string[];
    onBrowse: () => void | Promise<void>;
    onBrowseFolders: () => void | Promise<void>;
    onSelectSource: (sourceId: ImportSourceId) => void | Promise<void>;
    onSelectFile: (fileId: string) => void;
    onRemoveFile: (fileId: string) => void;
    onClearAll: () => void;
  }

  let {
    files,
    selectedFileId,
    supportedFormats,
    onBrowse,
    onBrowseFolders,
    onSelectSource,
    onSelectFile,
    onRemoveFile,
    onClearAll,
  }: Props = $props();
</script>

<div class="w-[max(20rem,25vw)] max-w-lg border-r flex flex-col overflow-hidden">
  <div class="p-3 border-b flex items-center justify-between">
    <h2 class="font-semibold">Files ({files.length})</h2>
    <div class="flex gap-1">
      {#if files.length > 0}
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={onClearAll}
          class="text-muted-foreground hover:text-destructive"
        >
          <Trash2 class="size-4" />
        </Button>
      {/if}
      <ToolImportButton
        targetTool="info"
        onBrowse={onBrowse}
        onBrowseFolders={onBrowseFolders}
        onSelectSource={onSelectSource}
      />
    </div>
  </div>

  <div class="flex-1 min-h-0 overflow-auto">
    {#if files.length === 0}
      <div class="p-2">
        <ImportDropZone
          icon={Film}
          title="Drop media files here"
          formats={supportedFormats}
          onBrowse={onBrowse}
        />
      </div>
    {:else}
      <div class="space-y-2 p-2">
        {#each files as file (file.id)}
          <InfoFileListItem
            {file}
            selected={selectedFileId === file.id}
            onSelect={() => onSelectFile(file.id)}
            onRemove={onRemoveFile}
          />
        {/each}
      </div>
    {/if}
  </div>
</div>
