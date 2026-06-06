<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import type { AudioFile, AudioTrackInfo, BatchTrackStrategy, DeepgramConfig, TranscriptionProvider } from '$lib/types';

  import AudioTrackSelectDialog from './AudioTrackSelectDialog.svelte';
  import BatchTrackSelectDialog from './BatchTrackSelectDialog.svelte';
  import RetranscribeDialog from './RetranscribeDialog.svelte';
  import TranscriptionResultDialog from './TranscriptionResultDialog.svelte';

  type RemoveTarget = { mode: 'single'; fileId: string } | { mode: 'all' } | null;

  interface AudioToSubsDialogsProps {
    resultDialogOpen: boolean;
    resultDialogFile: AudioFile | null;
    retranscribeDialogOpen: boolean;
    retranscribeDialogFile: AudioFile | null;
    deepgramConfig: DeepgramConfig;
    provider: TranscriptionProvider;
    trackSelectDialogOpen: boolean;
    trackSelectTracks: AudioTrackInfo[];
    trackSelectFileName: string;
    batchTrackDialogOpen: boolean;
    batchTrackFileCount: number;
    batchTrackLanguages: string[];
    removeDialogOpen: boolean;
    removeTarget: RemoveTarget;
    onDeleteVersion: (fileId: string, versionId: string) => void | Promise<void>;
    onRetranscribeConfirm: (
      fileId: string,
      versionName: string,
      config: DeepgramConfig,
    ) => Promise<string | null> | string | null;
    onTrackSelect: (trackIndex: number) => void;
    onTrackSelectCancel: () => void;
    onBatchStrategySelect: (strategy: BatchTrackStrategy) => void;
    onBatchStrategyCancel: () => void;
    onConfirmRemove: () => void | Promise<void>;
    onRemoveDialogOpenChange: (open: boolean) => void;
  }

  let {
    resultDialogOpen = $bindable(false),
    resultDialogFile,
    retranscribeDialogOpen = $bindable(false),
    retranscribeDialogFile,
    deepgramConfig,
    provider,
    trackSelectDialogOpen = $bindable(false),
    trackSelectTracks,
    trackSelectFileName,
    batchTrackDialogOpen = $bindable(false),
    batchTrackFileCount,
    batchTrackLanguages,
    removeDialogOpen = $bindable(false),
    removeTarget,
    onDeleteVersion,
    onRetranscribeConfirm,
    onTrackSelect,
    onTrackSelectCancel,
    onBatchStrategySelect,
    onBatchStrategyCancel,
    onConfirmRemove,
    onRemoveDialogOpenChange,
  }: AudioToSubsDialogsProps = $props();
</script>

<TranscriptionResultDialog
  bind:open={resultDialogOpen}
  onOpenChange={(open) => {
    resultDialogOpen = open;
  }}
  file={resultDialogFile}
  onDeleteVersion={onDeleteVersion}
/>

<RetranscribeDialog
  bind:open={retranscribeDialogOpen}
  onOpenChange={(open) => {
    retranscribeDialogOpen = open;
  }}
  file={retranscribeDialogFile}
  baseConfig={deepgramConfig}
  {provider}
  onConfirm={onRetranscribeConfirm}
/>

<AudioTrackSelectDialog
  bind:open={trackSelectDialogOpen}
  onOpenChange={(open) => {
    trackSelectDialogOpen = open;
    if (!open) {
      onTrackSelectCancel();
    }
  }}
  tracks={trackSelectTracks}
  fileName={trackSelectFileName}
  onSelect={onTrackSelect}
/>

<BatchTrackSelectDialog
  bind:open={batchTrackDialogOpen}
  onOpenChange={(open) => {
    batchTrackDialogOpen = open;
    if (!open) {
      onBatchStrategyCancel();
    }
  }}
  fileCount={batchTrackFileCount}
  availableLanguages={batchTrackLanguages}
  onSelect={onBatchStrategySelect}
  onCancel={onBatchStrategyCancel}
/>

<AlertDialog.Root bind:open={removeDialogOpen} onOpenChange={onRemoveDialogOpenChange}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>
        {removeTarget?.mode === 'all' ? 'Remove all files while processing?' : 'Remove file while processing?'}
      </AlertDialog.Title>
      <AlertDialog.Description>
        {#if removeTarget?.mode === 'all'}
          One or more files are currently being processed. Removing all files will cancel active operations.
        {:else}
          This file is currently being processed. Removing it will cancel the active operation.
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>

    <AlertDialog.Footer>
      <AlertDialog.Cancel
        onclick={() => {
          onRemoveDialogOpenChange(false);
        }}
      >
        Cancel
      </AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={onConfirmRemove}
        class="bg-destructive text-white hover:bg-destructive/90"
      >
        Remove
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
