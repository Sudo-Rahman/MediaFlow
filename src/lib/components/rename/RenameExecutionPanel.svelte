<script lang="ts">
  import { FolderOpen, Play, Square } from '@lucide/svelte';

  import type { RenameMode, RenameProgress } from '$lib/types/rename';
  import { Button } from '$lib/components/ui/button';
  import * as Item from '$lib/components/ui/item';
  import { Progress } from '$lib/components/ui/progress';
  import { formatTransferRate } from '$lib/utils/format';

  interface RenameExecutionPanelProps {
    mode: RenameMode;
    selectedCount: number;
    canExecute: boolean;
    isProcessing: boolean;
    isCancelling: boolean;
    progress: RenameProgress;
    copiedBytesLabel: string;
    totalBytesLabel: string;
    onExecute: () => void | Promise<void>;
    onCancel: () => void | Promise<void>;
    onOpenFolder: () => void | Promise<void>;
  }

  let {
    mode,
    selectedCount,
    canExecute,
    isProcessing,
    isCancelling,
    progress,
    copiedBytesLabel,
    totalBytesLabel,
    onExecute,
    onCancel,
    onOpenFolder,
  }: RenameExecutionPanelProps = $props();

  const isCopyProcessing = $derived(isProcessing && mode === 'copy');
  const executeLabel = $derived(
    `${mode === 'rename' ? 'Rename' : 'Copy'} ${selectedCount} file${selectedCount !== 1 ? 's' : ''}`,
  );
  const showOpenFolder = $derived(progress.status === 'completed' || progress.status === 'cancelled');
</script>

<div class="space-y-4">
  {#if isCopyProcessing}
    <Item.Root variant="outline" size="xs" class="items-stretch">
      <Item.Content class="gap-2">
        <Item.Title>Copying...</Item.Title>
        {#if progress.currentFile}
          <Item.Description class="truncate text-xs" title={progress.currentFile}>
            Current file: {progress.currentFile}
          </Item.Description>
        {/if}
        <div class="space-y-1.5">
          <Progress value={progress.currentFileProgress} class="h-1.5" />
          <p class="text-[11px] text-muted-foreground">
            File progress: {Math.round(progress.currentFileProgress)}%
            {#if progress.currentSpeedBytesPerSec && progress.currentSpeedBytesPerSec > 0}
              · {formatTransferRate(progress.currentSpeedBytesPerSec)}
            {/if}
          </p>
          <p class="text-[11px] text-muted-foreground">
            {progress.current}/{progress.total} files completed
          </p>
          <p class="text-[11px] text-muted-foreground">
            Copied: {copiedBytesLabel} / {totalBytesLabel}
          </p>
        </div>
      </Item.Content>
    </Item.Root>
  {/if}

  {#if isProcessing}
    <Button class="w-full" size="lg" variant="destructive" disabled={isCancelling} onclick={onCancel}>
      <Square class="mr-2 size-4" />
      Cancel
    </Button>
  {:else}
    <Button class="w-full" size="lg" disabled={!canExecute} onclick={onExecute}>
      <Play class="mr-2 size-4" />
      {executeLabel}
    </Button>
  {/if}

  {#if showOpenFolder}
    <Button variant="outline" class="w-full" onclick={onOpenFolder}>
      <FolderOpen class="mr-2 size-4" />
      Open Folder
    </Button>
  {/if}
</div>
