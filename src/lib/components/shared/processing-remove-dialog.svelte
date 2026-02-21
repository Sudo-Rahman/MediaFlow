<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';

  interface ProcessingRemoveDialogProps {
    open?: boolean;
    mode: 'single' | 'all' | null;
    inProgress?: boolean;
    onConfirm?: () => void | Promise<void>;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    mode,
    inProgress = false,
    onConfirm,
    onCancel,
  }: ProcessingRemoveDialogProps = $props();

  const title = $derived(
    mode === 'all' ? 'Remove all files while processing?' : 'Remove file while processing?',
  );

  const description = $derived(
    mode === 'all'
      ? 'One or more files are currently being processed. Removing all files will cancel active operations.'
      : 'This file is currently being processed. Removing it will cancel the active operation.',
  );

  function handleCancel() {
    open = false;
    onCancel?.();
  }

  async function handleConfirm() {
    await onConfirm?.();
  }
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      <AlertDialog.Description>
        {description}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={handleCancel}>
        Cancel
      </AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={handleConfirm}
        class="bg-destructive text-white hover:bg-destructive/90"
        disabled={inProgress}
      >
        {#if inProgress}
          Removing...
        {:else}
          Remove
        {/if}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
