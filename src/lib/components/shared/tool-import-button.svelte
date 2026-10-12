<script lang="ts">
  import { ChevronDown, FolderOpen, Upload } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { toolImportStore } from '$lib/stores/tool-import.svelte';
  import type { ImportSourceId, ToolId } from '$lib/types/tool-import';

  interface ToolImportButtonProps {
    targetTool: ToolId;
    label?: string;
    disabled?: boolean;
    variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive';
    size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm';
    class?: string;
    sourceFilter?: ImportSourceId[];
    onBrowse: () => void | Promise<void>;
    onBrowseFolders: () => void | Promise<void>;
    onSelectSource?: (sourceId: ImportSourceId) => void | Promise<void>;
  }

  let {
    targetTool,
    label = 'Import',
    disabled = false,
    variant = 'default',
    size = 'sm',
    class: className = '',
    sourceFilter,
    onBrowse,
    onBrowseFolders,
    onSelectSource,
  }: ToolImportButtonProps = $props();

  const sources = $derived(toolImportStore.getAvailableSources(targetTool, sourceFilter));
  const hasSources = $derived(Boolean(onSelectSource) && sources.length > 0);

  async function handleBrowse() {
    if (disabled) {
      return;
    }

    await onBrowse();
  }

  async function handleBrowseFolders() {
    if (disabled) {
      return;
    }

    await onBrowseFolders();
  }

  async function handleSourceSelect(sourceId: ImportSourceId) {
    if (disabled) {
      return;
    }

    await onSelectSource?.(sourceId);
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button
        {variant}
        {size}
        {...props}
        disabled={disabled}
        class={className}
        aria-label={label}
      >
        <Upload class="mr-1.5 size-4" />
        {label}
        <ChevronDown class="ml-1 size-3" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>

  <DropdownMenu.Content align="start" class="w-64">
    <DropdownMenu.Item onclick={handleBrowse}>
      <Upload class="mr-2 size-4" />
      Files…
    </DropdownMenu.Item>
    <DropdownMenu.Item onclick={handleBrowseFolders}>
      <FolderOpen class="mr-2 size-4" />
      Folders…
    </DropdownMenu.Item>

    {#if hasSources}
      <DropdownMenu.Separator />
      <DropdownMenu.Label>Import from</DropdownMenu.Label>

      {#each sources as source (source.sourceId)}
        <DropdownMenu.Item onclick={() => handleSourceSelect(source.sourceId)}>
          <span class="mr-2 inline-flex size-4 items-center justify-center text-xs text-muted-foreground">+</span>
          {source.label} ({source.count})
        </DropdownMenu.Item>
      {/each}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
