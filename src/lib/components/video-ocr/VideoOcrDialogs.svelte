<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import type { OcrConfig, OcrRetryMode, OcrVideoFile } from '$lib/types';

  import OcrResultDialog from './OcrResultDialog.svelte';
  import OcrRetryAllDialog from './OcrRetryAllDialog.svelte';
  import OcrRetryDialog from './OcrRetryDialog.svelte';

  type RemoveTarget = { mode: 'single'; fileId: string } | { mode: 'all' } | null;

  interface VideoOcrDialogsProps {
    resultDialogOpen: boolean;
    resultDialogFile: OcrVideoFile | null;
    retryDialogOpen: boolean;
    retryDialogFile: OcrVideoFile | null;
    retryAllDialogOpen: boolean;
    retryCount: number;
    retryAllMissingRawCount: number;
    baseConfig: OcrConfig;
    removeDialogOpen: boolean;
    removeTarget: RemoveTarget;
    onResultDialogOpenChange: (open: boolean) => void;
    onRetryDialogOpenChange: (open: boolean) => void;
    onRetryAllDialogOpenChange: (open: boolean) => void;
    onRetryConfirm: (
      fileId: string,
      versionName: string,
      mode: OcrRetryMode,
      config: OcrConfig,
    ) => void | Promise<void>;
    onRetryAllConfirm: (mode: OcrRetryMode, config: OcrConfig) => void | Promise<void>;
    onRemoveDialogOpenChange: (open: boolean) => void;
    onConfirmRemove: () => void | Promise<void>;
  }

  let {
    resultDialogOpen = $bindable(false),
    resultDialogFile,
    retryDialogOpen = $bindable(false),
    retryDialogFile,
    retryAllDialogOpen = $bindable(false),
    retryCount,
    retryAllMissingRawCount,
    baseConfig,
    removeDialogOpen = $bindable(false),
    removeTarget,
    onResultDialogOpenChange,
    onRetryDialogOpenChange,
    onRetryAllDialogOpenChange,
    onRetryConfirm,
    onRetryAllConfirm,
    onRemoveDialogOpenChange,
    onConfirmRemove,
  }: VideoOcrDialogsProps = $props();
</script>

<OcrResultDialog
  bind:open={resultDialogOpen}
  onOpenChange={onResultDialogOpenChange}
  file={resultDialogFile}
/>

<OcrRetryDialog
  bind:open={retryDialogOpen}
  onOpenChange={onRetryDialogOpenChange}
  file={retryDialogFile}
  baseConfig={baseConfig}
  onConfirm={onRetryConfirm}
/>

<OcrRetryAllDialog
  bind:open={retryAllDialogOpen}
  onOpenChange={onRetryAllDialogOpenChange}
  targetCount={retryCount}
  missingRawCount={retryAllMissingRawCount}
  baseConfig={baseConfig}
  onConfirm={onRetryAllConfirm}
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
      <AlertDialog.Cancel onclick={() => onRemoveDialogOpenChange(false)}>
        Cancel
      </AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => void onConfirmRemove()}
        class="bg-destructive text-white hover:bg-destructive/90"
      >
        Remove
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
