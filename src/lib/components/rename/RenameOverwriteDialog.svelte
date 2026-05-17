<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Item from '$lib/components/ui/item';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  interface RenameOverwriteDialogProps {
    open: boolean;
    existingTargetCount: number;
    targetSamples: string[];
    onCancel: () => void;
    onConfirm: () => void | Promise<void>;
  }

  let {
    open = $bindable(false),
    existingTargetCount,
    targetSamples,
    onCancel,
    onConfirm,
  }: RenameOverwriteDialogProps = $props();
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Overwrite existing files?</AlertDialog.Title>
      <AlertDialog.Description>
        {existingTargetCount} destination file(s) already exist. Continuing will replace them.
      </AlertDialog.Description>
    </AlertDialog.Header>

    {#if targetSamples.length > 0}
      <ScrollArea class="max-h-36 border p-2">
        <div class="space-y-1">
          {#each targetSamples as targetPath (targetPath)}
            <Item.Root variant="muted" size="xs">
              <Item.Description class="truncate font-mono text-xs">{targetPath}</Item.Description>
            </Item.Root>
          {/each}
          {#if existingTargetCount > targetSamples.length}
            <Item.Root size="xs">
              <Item.Description class="text-xs">
                + {existingTargetCount - targetSamples.length} more
              </Item.Description>
            </Item.Root>
          {/if}
        </div>
      </ScrollArea>
    {/if}

    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={onCancel}>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={onConfirm} class="bg-destructive text-white hover:bg-destructive/90">
        Overwrite and Continue
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
