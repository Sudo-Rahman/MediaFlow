<script lang="ts" module>
  let nextRetryVersionNameInputId = 0;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';

  interface RetryVersionDialogShellProps {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    title: string;
    description: string;
    versionName?: string;
    versionNamePlaceholder?: string;
    confirmLabel?: string;
    confirmDisabled?: boolean;
    inputId?: string;
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
    inputId = `retry-version-name-input-${nextRetryVersionNameInputId += 1}`,
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

    <div class="flex flex-1 flex-col gap-5 overflow-auto p-4">
      <Field.Field>
        <Field.Label for={inputId}>Version name</Field.Label>
        <Input
          id={inputId}
          bind:value={versionName}
          placeholder={versionNamePlaceholder}
        />
      </Field.Field>

      {#if optionsContent}
        <div class="flex flex-col gap-5">
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
