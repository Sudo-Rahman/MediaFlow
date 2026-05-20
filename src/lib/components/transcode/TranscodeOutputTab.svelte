<script lang="ts">
  import { FileVideo } from '@lucide/svelte';

  import type { RenameWorkspaceStore } from '$lib/stores/rename.svelte';
  import type { TranscodeContainerCapability, TranscodeFile } from '$lib/types';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import * as Card from '$lib/components/ui/card';
  import * as Empty from '$lib/components/ui/empty';
  import * as Item from '$lib/components/ui/item';
  import * as Select from '$lib/components/ui/select';
  import { OutputFolderField } from '$lib/components/shared';
  import { resolveOutputFolderDisplay } from '$lib/utils';

  import type { TranscodeContainerUpdater, TranscodeOutputPathBuilder } from './types';

  interface Props {
    file: TranscodeFile;
    selectedContainer: TranscodeContainerCapability | null;
    availableContainers: TranscodeContainerCapability[];
    outputPreviewPath: string;
    workspace: RenameWorkspaceStore;
    readyQueueFiles: TranscodeFile[];
    outputConflictCount: number;
    buildOutputPath: TranscodeOutputPathBuilder;
    updateContainer: TranscodeContainerUpdater;
    onSelectOutputDir?: () => void | Promise<void>;
    onClearOutputDir?: () => void;
    onOpenRenameWorkspace?: () => void;
  }

  let {
    file,
    selectedContainer,
    availableContainers,
    outputPreviewPath,
    workspace,
    readyQueueFiles,
    outputConflictCount,
    buildOutputPath,
    updateContainer,
    onSelectOutputDir,
    onClearOutputDir,
    onOpenRenameWorkspace,
  }: Props = $props();

  const outputFolderDisplay = $derived.by(() =>
    resolveOutputFolderDisplay({
      explicitPath: workspace.outputDir,
      sourcePaths: file ? [file.path] : [],
      allowSourceFallback: true,
      fallbackLabel: 'Use each source folder',
    }),
  );
  const controlId = $props.id();
  const containerId = `${controlId}-container`;
</script>

<div class="grid gap-4 lg:grid-cols-2">
  <Card.Root>
    <Card.Header class="pb-3">
      <Card.Title>Container & Destination</Card.Title>
      <Card.Description>Choose the output container and where the transcoded files will be saved.</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-4">
      <div class="space-y-2">
        <Label for={containerId}>Container</Label>
        <Select.Root
          type="single"
          value={file.profile.containerId}
          onValueChange={(value) => {
            updateContainer(value);
          }}
          >
          <Select.Trigger id={containerId} class="w-full">{selectedContainer?.label ?? file.profile.containerId.toUpperCase()}</Select.Trigger>
          <Select.Content>
            <Select.Group>
              {#each availableContainers as container (container.id)}
                <Select.Item value={container.id}>{container.label}</Select.Item>
              {/each}
            </Select.Group>
          </Select.Content>
        </Select.Root>
      </div>

      <OutputFolderField
        label="Output folder"
        displayText={outputFolderDisplay.displayText}
        state={outputFolderDisplay.state}
        description="Optional. Leave empty to save transcoded files next to each source file."
        showReset={outputFolderDisplay.showReset}
        resetLabel="Use source folders"
        onBrowse={onSelectOutputDir}
        onReset={onClearOutputDir}
      />

      <div class="space-y-2">
        <Label>Output preview</Label>
        <Item.Root variant="outline" size="sm">
          <Item.Description class="block w-full min-w-0 max-w-full break-all">{outputPreviewPath}</Item.Description>
        </Item.Root>
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header class="pb-3">
      <Card.Title>Rename Workspace</Card.Title>
      <Card.Description>Open the integrated renaming workspace to edit output file names before transcoding.</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-4">
      <Item.Group class="gap-2">
        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
          <Item.Title>Selected outputs</Item.Title>
          <Badge>{workspace.selectedCount}</Badge>
        </Item.Root>
        <Item.Root variant="outline" size="xs" class="justify-between" role="listitem">
          <Item.Title>Conflicts</Item.Title>
          <Badge variant={outputConflictCount > 0 ? 'destructive' : 'secondary'}>
            {outputConflictCount}
          </Badge>
        </Item.Root>
      </Item.Group>

      <Button class="w-full" variant="outline" onclick={onOpenRenameWorkspace}>
        <FileVideo class="size-4 mr-2" />
        Open Rename Workspace
      </Button>

      <div class="space-y-2">
        <Label>Batch preview</Label>
        {#if readyQueueFiles.length > 0}
          <Item.Group class="max-h-56 gap-2 overflow-y-auto overflow-x-hidden">
            {#each readyQueueFiles.slice(0, 6) as queuedFile (queuedFile.id)}
              <Item.Root variant="outline" size="sm" class="min-w-0 overflow-hidden" role="listitem">
                <Item.Content class="min-w-0 overflow-hidden">
                  <Item.Title class="block w-full min-w-0 max-w-full truncate" title={queuedFile.name}>
                    {queuedFile.name}
                  </Item.Title>
                  <Item.Description class="block w-full min-w-0 max-w-full break-all">
                    {buildOutputPath(queuedFile)}
                  </Item.Description>
                </Item.Content>
              </Item.Root>
            {/each}
          </Item.Group>
        {:else}
          <Empty.Root class="border p-4">
            <Empty.Description>No ready files selected for output.</Empty.Description>
          </Empty.Root>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>
</div>
