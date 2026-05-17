<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Item from '$lib/components/ui/item';
  import { cn } from '$lib/utils';

  interface FileItemCardProps {
    selected?: boolean;
    compact?: boolean;
    disabled?: boolean;
    class?: string;
    icon?: Snippet;
    content: Snippet;
    actions?: Snippet;
    footer?: Snippet;
    onclick?: () => void;
  }

  let {
    selected = false,
    compact = false,
    disabled = false,
    class: className = '',
    icon,
    content,
    actions,
    footer,
    onclick,
  }: FileItemCardProps = $props();
</script>

<Item.Root
  variant={selected ? 'outline' : 'default'}
  size={compact ? 'xs' : 'sm'}
  class={cn(
    'items-start text-left hover:bg-muted/70',
    selected && 'border-primary bg-card ring-1 ring-primary/20 hover:bg-card',
    disabled && 'cursor-not-allowed opacity-60',
    className
  )}
>
  <button
    type="button"
    class={cn(
      'flex min-w-0 flex-1 flex-wrap items-start gap-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
      compact && 'gap-2',
      disabled && 'cursor-not-allowed'
    )}
    onclick={onclick}
    disabled={disabled}
    aria-pressed={selected}
  >
    {#if icon}
      <Item.Media class="mt-0.5">
        {@render icon()}
      </Item.Media>
    {/if}

    <Item.Content class="min-w-0">
      {@render content()}
    </Item.Content>

    {#if footer}
      <Item.Footer class="mt-2">
        {@render footer()}
      </Item.Footer>
    {/if}
  </button>

  {#if actions}
    <Item.Actions class="shrink-0">
      {@render actions()}
    </Item.Actions>
  {/if}
</Item.Root>
