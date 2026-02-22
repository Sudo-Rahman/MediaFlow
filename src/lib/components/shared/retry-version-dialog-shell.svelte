<script lang="ts">
  import type { Snippet } from 'svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';

  interface RetryVersionDialogShellProps {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    title: string;
    description: string;
    versionName?: string;
    versionNamePlaceholder?: string;
    confirmLabel?: string;
    confirmDisabled?: boolean;
    maxWidthClass?: string;
    onConfirm: () => void | Promise<void>;
    optionsContent?: Snippet;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    title,
    description,
    versionName = $bindable(''),
    versionNamePlaceholder = 'Version 1',
    confirmLabel = 'Run',
    confirmDisabled = false,
    maxWidthClass = 'max-w-xl',
    onConfirm,
    optionsContent,
  }: RetryVersionDialogShellProps = $props();

  function handleOpenChange(nextOpen: boolean) {
    open = nextOpen;
    onOpenChange?.(nextOpen);
  }

  function handleCancel() {
    handleOpenChange(false);
  }

  async function handleConfirm() {
    await onConfirm();
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class={`${maxWidthClass} max-h-[85vh] flex flex-col overflow-hidden`}>
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-auto p-4 space-y-5">
      <div class="space-y-2">
        <Label for="retry-version-name-input">Version name</Label>
        <Input
          id="retry-version-name-input"
          bind:value={versionName}
          placeholder={versionNamePlaceholder}
        />
      </div>

      {#if optionsContent}
        <div class="space-y-5">
          {@render optionsContent()}
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={handleCancel}>
        Cancel
      </Button>
      <Button onclick={handleConfirm} disabled={confirmDisabled}>
        {confirmLabel}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
