<script lang="ts">
  import { Check, X } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
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
        <Button type="button" variant="secondary" size="sm" onclick={oncancel}>
          <X class="size-3.5" aria-hidden="true" />
          Cancel
        </Button>
      {/if}
      {#if showSave}
        <Button type="button" size="sm" disabled={saveDisabled} onclick={onsave}>
          <Check class="size-3.5" aria-hidden="true" />
          Save
        </Button>
      {/if}
    </div>
  {/if}
</div>
