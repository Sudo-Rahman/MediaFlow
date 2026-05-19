<script lang="ts">
  import { createRenameWorkspaceStore } from '$lib/stores';
  import { RenameWorkspace } from '$lib/components/rename';
  import { OutputFolderField } from '$lib/components/shared';
  import { Badge } from '$lib/components/ui/badge';
  import * as Item from '$lib/components/ui/item';
  import { resolveOutputFolderDisplay } from '$lib/utils';

  interface Props {
    workspace: ReturnType<typeof createRenameWorkspaceStore>;
    outputFolderDisplay: ReturnType<typeof resolveOutputFolderDisplay>;
    selectedVideosCount: number;
    selectedTracksCount: number;
    onClearAll: () => void;
    onRemoveFile: (fileId: string) => void;
    onBrowseOutputDir: () => void | Promise<void>;
    onResetOutputDir: () => void;
  }

  let {
    workspace,
    outputFolderDisplay,
    selectedVideosCount,
    selectedTracksCount,
    onClearAll,
    onRemoveFile,
    onBrowseOutputDir,
    onResetOutputDir,
  }: Props = $props();
</script>

<div class="h-full">
  <RenameWorkspace
    {workspace}
    showImportButton={false}
    onClearAll={onClearAll}
    onRemoveFile={onRemoveFile}
    emptyStateTitle="No videos in the merge batch"
    emptyStateSubtitle="Add videos in Merge to configure output names."
  >
    {#snippet actionPanel()}
      <div class="space-y-2">
        <OutputFolderField
          label="Output folder"
          displayText={outputFolderDisplay.displayText}
          state={outputFolderDisplay.state}
          description="Optional. Leave empty to save merged files next to each source video."
          showReset={outputFolderDisplay.showReset}
          resetLabel="Use source folders"
          onBrowse={onBrowseOutputDir}
          onReset={onResetOutputDir}
        />
      </div>

      <div class="flex w-full flex-col gap-2">
        <Item.Root size="xs" variant="muted" class="justify-between">
          <Item.Content>
            <Item.Title>Selected videos</Item.Title>
          </Item.Content>
          <Badge variant={selectedVideosCount > 0 ? 'default' : 'secondary'}>
            {selectedVideosCount}
          </Badge>
        </Item.Root>
        <Item.Root size="xs" variant="muted" class="justify-between">
          <Item.Content>
            <Item.Title>Attached tracks</Item.Title>
          </Item.Content>
          <Badge variant={selectedTracksCount > 0 ? 'default' : 'secondary'}>
            {selectedTracksCount}
          </Badge>
        </Item.Root>
      </div>
    {/snippet}
  </RenameWorkspace>
</div>
