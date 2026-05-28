<script lang="ts">
  import { Check, ChevronDown, FileText, Pencil } from '@lucide/svelte';

  import type { OcrVersion } from '$lib/types';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Item from '$lib/components/ui/item';
  import * as Popover from '$lib/components/ui/popover';
  import { cn } from '$lib/utils';
  import { createOcrPreviewVersionOptions } from './ocr-version-selector';

  interface OcrVersionSelectorProps {
    versions: OcrVersion[];
    activeVersionId?: string | null;
    showDraft?: boolean;
    draftName?: string;
    disabled?: boolean;
    renderPopoverInline?: boolean;
    onSelectVersion?: (versionId: string | null) => void | Promise<void>;
    class?: string;
  }

  let {
    versions,
    activeVersionId = null,
    showDraft = false,
    draftName = 'Draft Version',
    disabled = false,
    renderPopoverInline = false,
    onSelectVersion,
    class: className = '',
  }: OcrVersionSelectorProps = $props();

  let popoverOpen = $state(false);

  const options = $derived(createOcrPreviewVersionOptions({ versions, showDraft, draftName }));
  const activeOption = $derived.by(() => {
    if (showDraft && activeVersionId === null) {
      return options.find((option) => option.id === null) ?? null;
    }

    return options.find((option) => option.id === activeVersionId)
      ?? options.find((option) => !option.draft)
      ?? options[0]
      ?? null;
  });
  const showSelector = $derived(options.length > 1 || showDraft);

  async function handleSelect(versionId: string | null): Promise<void> {
    popoverOpen = false;
    await onSelectVersion?.(versionId);
  }
</script>

{#if showSelector && activeOption}
  <Popover.Root bind:open={popoverOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          type="button"
          variant="secondary"
          size="sm"
          class={cn('h-8 min-w-0 max-w-52 gap-1.5 px-2 text-xs', className)}
          aria-label="Select OCR version"
          aria-expanded={popoverOpen}
          disabled={disabled}
        >
          {#if activeOption.draft}
            <Pencil class="size-3.5 shrink-0" aria-hidden="true" />
          {:else}
            <FileText class="size-3.5 shrink-0" aria-hidden="true" />
          {/if}
          <span class="min-w-0 truncate">{activeOption.label}</span>
          <ChevronDown class="size-3.5 shrink-0" aria-hidden="true" />
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content
      align="end"
      sideOffset={6}
      portalProps={{ disabled: renderPopoverInline }}
      class="w-80 max-w-[calc(100vw-2rem)] p-2"
    >
      <div class="px-2 py-1.5">
        <p class="text-xs font-medium text-muted-foreground">OCR version</p>
      </div>
      <div class="max-h-72 overflow-y-auto">
        {#each options as option (`${option.draft ? 'draft' : 'version'}:${option.id ?? 'draft'}`)}
          <Item.Root
            size="xs"
            class="cursor-pointer flex-nowrap hover:bg-muted"
            aria-current={option.id === activeOption.id ? 'true' : undefined}
            onclick={() => void handleSelect(option.id)}
          >
            {#snippet child({ props: itemProps })}
              <button type="button" {...itemProps}>
                <Item.Media>
                  {#if option.draft}
                    <Pencil class="size-4 text-muted-foreground" aria-hidden="true" />
                  {:else}
                    <FileText class="size-4 text-muted-foreground" aria-hidden="true" />
                  {/if}
                </Item.Media>
                <Item.Content class="min-w-0 overflow-hidden">
                  <Item.Title class="w-full truncate">{option.label}</Item.Title>
                  <Item.Description class="block w-full truncate text-xs">
                    {option.description}
                  </Item.Description>
                </Item.Content>
                <Item.Actions class="shrink-0">
                  {#if option.draft}
                    <Badge variant="secondary" class="text-[10px]">Draft</Badge>
                  {/if}
                  {#if option.id === activeOption.id}
                    <Check class="size-4 shrink-0 text-primary" aria-hidden="true" />
                  {/if}
                </Item.Actions>
              </button>
            {/snippet}
          </Item.Root>
        {/each}
      </div>
    </Popover.Content>
  </Popover.Root>
{/if}
