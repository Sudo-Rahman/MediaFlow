<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Item from '$lib/components/ui/item';
  import { cn } from '$lib/utils';

  interface FileItemCardProps {
    selected?: boolean;
    compact?: boolean;
    disabled?: boolean;
    class?: string;
    title: string;
    icon?: Snippet;
    meta?: Snippet;
    details?: Snippet;
    actions?: Snippet;
    footer?: Snippet;
    onclick?: () => void;
    selectionLabel?: string;
  }

  let {
    selected = false,
    compact = false,
    disabled = false,
    class: className = '',
    title,
    icon,
    meta,
    details,
    actions,
    footer,
    onclick,
    selectionLabel = `Select ${title}`,
  }: FileItemCardProps = $props();
</script>

<Item.Root
  variant={selected ? 'outline' : 'default'}
  size={compact ? 'xs' : 'sm'}
  class={cn(
    'relative grid items-start text-left hover:bg-muted/70',
    actions ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[auto_minmax(0,1fr)]',
    selected && 'border-primary bg-card ring-1 ring-primary/20 hover:bg-card',
    disabled && 'cursor-not-allowed opacity-60',
    className
  )}
>
  {#if onclick}
    <button
      type="button"
      class={cn(
        'absolute inset-0 z-0 rounded-[inherit] text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        disabled && 'cursor-not-allowed'
      )}
      onclick={onclick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={selectionLabel}
    ></button>
  {/if}

  {#if icon}
    <Item.Media class={cn('relative z-10 col-start-1 row-start-1 mt-0.5 self-start', onclick && 'pointer-events-none')}>
      {@render icon()}
    </Item.Media>
  {/if}

  <Item.Content
    class={cn(
      'relative z-10 row-start-1 min-w-0',
      icon ? 'col-start-2' : 'col-start-1',
      onclick && 'pointer-events-none',
      actions && 'grid [grid-template-columns:subgrid]',
      actions && (icon ? 'col-end-4' : 'col-end-3'),
      disabled && 'cursor-not-allowed'
    )}
  >
    <p class="col-start-1 min-w-0 truncate font-medium text-sm" {title}>{title}</p>

    {#if meta}
      <div class="col-span-full min-w-0">
        {@render meta()}
      </div>
    {/if}

    {#if details}
      <div class="col-span-full min-w-0">
        {@render details()}
      </div>
    {/if}
  </Item.Content>

  {#if footer}
    <Item.Footer class={cn('relative z-10 col-start-2 mt-2', actions && 'col-end-4', onclick && 'pointer-events-none')}>
      {@render footer()}
    </Item.Footer>
  {/if}

  {#if actions}
    <Item.Actions
      class="relative z-20 col-start-3 row-start-1 shrink-0 self-start justify-self-end"
    >
      {@render actions()}
    </Item.Actions>
  {/if}
</Item.Root>
