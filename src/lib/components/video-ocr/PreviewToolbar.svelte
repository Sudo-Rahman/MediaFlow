<script lang="ts">
  import { Check, X } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';

  interface PreviewToolbarProps {
    title?: string;
    description?: string;
    showCancel?: boolean;
    showSave?: boolean;
    saveDisabled?: boolean;
    oncancel?: () => void;
    onsave?: () => void;
    class?: string;
  }

  let {
    title = 'Video preview',
    description = '',
    showCancel = false,
    showSave = false,
    saveDisabled = false,
    oncancel,
    onsave,
    class: className = '',
  }: PreviewToolbarProps = $props();
</script>

<div class={cn('flex min-h-11 items-center justify-between gap-3 border-b bg-background px-3 py-2', className)}>
  <div class="min-w-0">
    <p class="truncate text-sm font-medium text-foreground">{title}</p>
    {#if description}
      <p class="truncate text-xs text-muted-foreground">{description}</p>
    {/if}
  </div>

  {#if showCancel || showSave}
    <div class="flex shrink-0 items-center gap-2">
      {#if showCancel}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                type="button"
                variant="secondary"
                size="sm"
                class="h-8 w-8 px-0 xl:w-auto xl:px-3"
                aria-label="Cancel OCR zone editing"
                onclick={oncancel}
              >
                <X class="size-3.5" aria-hidden="true" />
                <span class="hidden xl:inline">Cancel</span>
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content class="xl:hidden">Cancel</Tooltip.Content>
        </Tooltip.Root>
      {/if}
      {#if showSave}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                type="button"
                size="sm"
                class="h-8 w-8 px-0 xl:w-auto xl:px-3"
                aria-label="Save OCR zone editing"
                disabled={saveDisabled}
                onclick={onsave}
              >
                <Check class="size-3.5" aria-hidden="true" />
                <span class="hidden xl:inline">Save</span>
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content class="xl:hidden">Save</Tooltip.Content>
        </Tooltip.Root>
      {/if}
    </div>
  {/if}
</div>
