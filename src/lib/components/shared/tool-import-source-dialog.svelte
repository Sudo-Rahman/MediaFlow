<script lang="ts">
  import { CheckSquare, List, Sparkles } from '@lucide/svelte';
  import { useId } from 'bits-ui';

  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Field from '$lib/components/ui/field';
  import * as Item from '$lib/components/ui/item';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import type { ImportSelectionMode, VersionedImportItem } from '$lib/types/tool-import';

  interface ToolImportSourceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sourceLabel: string;
    items: VersionedImportItem[];
    onConfirm: (mode: ImportSelectionMode, selectedKeys: string[]) => void | Promise<void>;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    sourceLabel,
    items,
    onConfirm,
  }: ToolImportSourceDialogProps = $props();

  let mode = $state<ImportSelectionMode>('latest_per_file');
  let selectedKeys = $state<Set<string>>(new Set());

  $effect(() => {
    if (!open) {
      return;
    }

    mode = 'latest_per_file';
    selectedKeys = new Set(items.map((item) => item.key));
  });

  const groupedItems = $derived.by(() => {
    const groups = new Map<string, { mediaName: string; versions: VersionedImportItem[] }>();

    for (const item of items) {
      const current = groups.get(item.mediaPath);
      if (!current) {
        groups.set(item.mediaPath, { mediaName: item.mediaName, versions: [item] });
        continue;
      }
      current.versions.push(item);
    }

    return Array.from(groups.entries())
      .map(([mediaPath, group]) => ({
        mediaPath,
        mediaName: group.mediaName,
        versions: group.versions.sort((a, b) => Date.parse(b.versionCreatedAt) - Date.parse(a.versionCreatedAt)),
      }))
      .sort((a, b) => a.mediaName.localeCompare(b.mediaName));
  });

  const canConfirm = $derived(mode !== 'custom' || selectedKeys.size > 0);
  const baseId = useId();
  const modeLabelId = `${baseId}-tool-import-mode-label`;
  const latestPerFileId = `${baseId}-latest-per-file`;
  const latestPerFileTitleId = `${latestPerFileId}-title`;
  const latestPerFileDescriptionId = `${latestPerFileId}-description`;
  const allVersionsId = `${baseId}-all-versions`;
  const allVersionsTitleId = `${allVersionsId}-title`;
  const allVersionsDescriptionId = `${allVersionsId}-description`;
  const customSelectionId = `${baseId}-custom-selection`;
  const customSelectionTitleId = `${customSelectionId}-title`;
  const customSelectionDescriptionId = `${customSelectionId}-description`;

  function formatPersistenceSource(source: VersionedImportItem['persisted']): string {
    return source === 'mediaflow' ? '.mediaflow.json' : 'memory';
  }

  function setMode(value: ImportSelectionMode) {
    mode = value;
  }

  function toggleSelection(key: string) {
    const next = new Set(selectedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    selectedKeys = next;
  }

  async function handleConfirm() {
    if (!canConfirm) {
      return;
    }

    await onConfirm(mode, Array.from(selectedKeys));
    onOpenChange(false);
  }
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content class="max-w-3xl max-h-[80vh] flex flex-col">
    <Dialog.Header class="shrink-0">
      <Dialog.Title>Import from {sourceLabel}</Dialog.Title>
      <Dialog.Description>Select how you want to import versions.</Dialog.Description>
    </Dialog.Header>

    <div class="dialog-scroll-body flex flex-col gap-4 py-1">
      <Field.Set class="gap-0">
        <Field.Legend id={modeLabelId} variant="label" class="sr-only">Select how you want to import versions.</Field.Legend>
        <RadioGroup.Root
          value={mode}
          aria-labelledby={modeLabelId}
          onValueChange={(value) => value && setMode(value as ImportSelectionMode)}
        >
          <div class="flex flex-col gap-2">
            <Item.Root variant="outline" size="sm" class="cursor-pointer">
              {#snippet child({ props })}
                <div
                  {...props}
                  onclick={() => setMode('latest_per_file')}
                >
                  <Item.Media>
                    <RadioGroup.Item
                      value="latest_per_file"
                      id={latestPerFileId}
                      aria-labelledby={latestPerFileTitleId}
                      aria-describedby={latestPerFileDescriptionId}
                    />
                  </Item.Media>
                  <Item.Media variant="icon" class="text-muted-foreground">
                    <Sparkles />
                  </Item.Media>
                  <Item.Content>
                    <Item.Title id={latestPerFileTitleId}>Latest version per file</Item.Title>
                    <Item.Description id={latestPerFileDescriptionId}>Import only the newest version for each source file.</Item.Description>
                  </Item.Content>
                </div>
              {/snippet}
            </Item.Root>

            <Item.Root variant="outline" size="sm" class="cursor-pointer">
              {#snippet child({ props })}
                <div
                  {...props}
                  onclick={() => setMode('all_versions')}
                >
                  <Item.Media>
                    <RadioGroup.Item
                      value="all_versions"
                      id={allVersionsId}
                      aria-labelledby={allVersionsTitleId}
                      aria-describedby={allVersionsDescriptionId}
                    />
                  </Item.Media>
                  <Item.Media variant="icon" class="text-muted-foreground">
                    <List />
                  </Item.Media>
                  <Item.Content>
                    <Item.Title id={allVersionsTitleId}>All versions</Item.Title>
                    <Item.Description id={allVersionsDescriptionId}>Import every available version.</Item.Description>
                  </Item.Content>
                </div>
              {/snippet}
            </Item.Root>

            <Item.Root variant="outline" size="sm" class="cursor-pointer">
              {#snippet child({ props })}
                <div
                  {...props}
                  onclick={() => setMode('custom')}
                >
                  <Item.Media>
                    <RadioGroup.Item
                      value="custom"
                      id={customSelectionId}
                      aria-labelledby={customSelectionTitleId}
                      aria-describedby={customSelectionDescriptionId}
                    />
                  </Item.Media>
                  <Item.Media variant="icon" class="text-muted-foreground">
                    <CheckSquare />
                  </Item.Media>
                  <Item.Content>
                    <Item.Title id={customSelectionTitleId}>Custom selection</Item.Title>
                    <Item.Description id={customSelectionDescriptionId}>Choose exactly which versions to import.</Item.Description>
                  </Item.Content>
                </div>
              {/snippet}
            </Item.Root>
          </div>
        </RadioGroup.Root>
      </Field.Set>

      {#if mode === 'custom'}
        <section class="flex flex-col gap-3">
          <div>
            <p class="text-sm font-medium">Select versions</p>
            <p class="text-xs text-muted-foreground">
              {selectedKeys.size} selected
            </p>
          </div>

          <div class="flex flex-col gap-4">
            {#each groupedItems as group, groupIndex (group.mediaPath)}
              <section class="flex flex-col gap-2">
                <p class="text-sm font-medium truncate">{group.mediaName}</p>
                <div class="flex flex-col gap-1.5">
                  {#each group.versions as version, versionIndex (version.key)}
                    {@const versionId = `${baseId}-import-version-${groupIndex}-${versionIndex}`}
                    {@const versionTitleId = `${versionId}-title`}
                    {@const versionDescriptionId = `${versionId}-description`}
                    <Item.Root variant="outline" size="xs" class="cursor-pointer">
                      {#snippet child({ props })}
                        <div
                          {...props}
                          onclick={() => toggleSelection(version.key)}
                        >
                          <Item.Media>
                            <Checkbox
                              checked={selectedKeys.has(version.key)}
                              onCheckedChange={() => toggleSelection(version.key)}
                              onclick={(event) => event.stopPropagation()}
                              aria-labelledby={versionTitleId}
                              aria-describedby={versionDescriptionId}
                            />
                          </Item.Media>
                          <Item.Content class="min-w-0">
                            <Item.Title id={versionTitleId} class="truncate">{version.versionName}</Item.Title>
                            <Item.Description id={versionDescriptionId} class="truncate text-xs">
                              {new Date(version.versionCreatedAt).toLocaleString('en-US')}
                            </Item.Description>
                          </Item.Content>
                          <Item.Actions>
                            <Badge variant="outline" class="shrink-0">{formatPersistenceSource(version.persisted)}</Badge>
                          </Item.Actions>
                        </div>
                      {/snippet}
                    </Item.Root>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        </section>
      {/if}
    </div>

    <Dialog.Footer class="shrink-0">
      <Button variant="outline" onclick={() => onOpenChange(false)}>Cancel</Button>
      <Button onclick={handleConfirm} disabled={!canConfirm}>Import</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
