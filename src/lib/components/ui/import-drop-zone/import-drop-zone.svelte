<script lang="ts">
  import type { Component } from 'svelte';
  import type { IconProps } from '@lucide/svelte';
  import * as Item from '$lib/components/ui/item'

  import { cn } from '$lib/utils';

  type IconComponent = Component<IconProps>;

  interface ImportDropZoneProps {
    icon: IconComponent;
    title: string;
    formats: string | string[];
    subtitle?: string;
    onBrowse: () => void | Promise<void>;
    disabled?: boolean;
    class?: string;
    isDragging?: boolean;
  }

  let {
    icon: Icon,
    title,
    formats,
    subtitle = 'or click to browse',
    onBrowse,
    disabled = false,
    class: className = '',
    isDragging
  }: ImportDropZoneProps = $props();

  let isDraggingLocal = $state(false);

  const formatText = $derived(Array.isArray(formats) ? formats.join(', ') : formats);
  const dragActive = $derived((isDragging ?? isDraggingLocal) && !disabled);
  function handleBrowse() {
    if (disabled) return;
    void onBrowse();
  }
</script>

<div
  class={cn(
    'flex-1 flex flex-col items-center justify-center rounded-4xl border-2 border-dashed p-8 transition-colors',
    dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-muted-foreground/50',
    className
  )}
  role="button"
  tabindex={disabled ? -1 : 0}
  aria-disabled={disabled}
  onclick={handleBrowse}
  onkeydown={(event) => {
    if (disabled) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleBrowse();
    }
  }}
  ondragover={(event) => {
    event.preventDefault();
    if (!disabled) isDraggingLocal = true;
  }}
  ondragleave={() => {
    isDraggingLocal = false;
  }}
  ondrop={(event) => {
    event.preventDefault();
    isDraggingLocal = false;
  }}
>
  <div class="flex flex-col items-center text-center">
    <div class="relative mb-4">
        <Item.Root variant="muted" class="flex items-center justify-center size-20 rounded-full">
            <Item.Title>
                <Icon class="size-12 text-muted-foreground" />
            </Item.Title>
        </Item.Root>
    </div>

    <p class="text-lg font-medium text-muted-foreground">
      {title}
    </p>
    <p class="text-sm text-muted-foreground/70 mt-1">
      {subtitle}
    </p>

    <Item.Root variant="muted" class="mt-4 px-4 py-2 ">
        <Item.Title>
            <p class="text-xs text-muted-foreground/70">
              Supported formats: {formatText}
            </p>
        </Item.Title>
    </Item.Root>
  </div>
</div>
