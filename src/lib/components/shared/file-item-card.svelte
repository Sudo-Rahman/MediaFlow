<script lang="ts">
  import type { Snippet } from 'svelte';
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

<button
  type="button"
  class={cn(
    'w-full rounded-lg border text-left transition-colors hover:bg-accent',
    compact ? 'p-2.5' : 'p-3',
    selected &&
      'border-primary bg-card ring-1 ring-primary/20 hover:bg-card',
    disabled && 'cursor-not-allowed opacity-60',
    className
  )}
  onclick={onclick}
  disabled={disabled}
>
  <div class={cn('flex items-start', compact ? 'gap-2' : 'gap-3')}>
    {#if icon}
      <div class="shrink-0 mt-0.5">
        {@render icon()}
      </div>
    {/if}

    <div class="flex-1 min-w-0">
      {@render content()}
    </div>

    {#if actions}
      <div class="shrink-0">
        {@render actions()}
      </div>
    {/if}
  </div>

  {#if footer}
    <div class="mt-2">
      {@render footer()}
    </div>
  {/if}
</button>
