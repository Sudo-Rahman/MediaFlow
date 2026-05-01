<script lang="ts">
  import { CheckSquare, List, Sparkles } from '@lucide/svelte';

  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Dialog from '$lib/components/ui/dialog';
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

    <div class="dialog-scroll-body space-y-4 py-1">
      <RadioGroup.Root value={mode} onValueChange={(value) => value && setMode(value as ImportSelectionMode)}>
        <div class="space-y-2">
          <label class="flex items-center gap-2 rounded-md border p-3">
            <RadioGroup.Item value="latest_per_file" id="latest-per-file" />
            <Sparkles class="size-4 text-muted-foreground" />
            <div class="text-sm">
              <p class="font-medium">Latest version per file</p>
              <p class="text-muted-foreground">Import only the newest version for each source file.</p>
            </div>
          </label>

          <label class="flex items-center gap-2 rounded-md border p-3">
            <RadioGroup.Item value="all_versions" id="all-versions" />
            <List class="size-4 text-muted-foreground" />
            <div class="text-sm">
              <p class="font-medium">All versions</p>
              <p class="text-muted-foreground">Import every available version.</p>
            </div>
          </label>

          <label class="flex items-center gap-2 rounded-md border p-3">
            <RadioGroup.Item value="custom" id="custom-selection" />
            <CheckSquare class="size-4 text-muted-foreground" />
            <div class="text-sm">
              <p class="font-medium">Custom selection</p>
              <p class="text-muted-foreground">Choose exactly which versions to import.</p>
            </div>
          </label>
        </div>
      </RadioGroup.Root>

      {#if mode === 'custom'}
        <div class="rounded-md border">
          <div class="border-b p-3">
            <p class="text-sm font-medium">Select versions</p>
            <p class="text-xs text-muted-foreground">
              {selectedKeys.size} selected
            </p>
          </div>

          <div>
            <div class="space-y-4 p-3">
              {#each groupedItems as group (group.mediaPath)}
                <section class="space-y-2">
                  <p class="text-sm font-medium truncate">{group.mediaName}</p>
                  <div class="space-y-1.5">
                    {#each group.versions as version (version.key)}
                      <label class="flex items-center justify-between gap-2 rounded-md border p-2">
                        <div class="flex items-center gap-2 min-w-0">
                          <Checkbox
                            checked={selectedKeys.has(version.key)}
                            onCheckedChange={() => toggleSelection(version.key)}
                          />
                          <div class="min-w-0">
                            <p class="text-sm truncate">{version.versionName}</p>
                            <p class="text-xs text-muted-foreground truncate">{new Date(version.versionCreatedAt).toLocaleString('en-US')}</p>
                          </div>
                        </div>
                        <Badge variant="outline" class="shrink-0">{formatPersistenceSource(version.persisted)}</Badge>
                      </label>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>

    <Dialog.Footer class="shrink-0">
      <Button variant="outline" onclick={() => onOpenChange(false)}>Cancel</Button>
      <Button onclick={handleConfirm} disabled={!canConfirm}>Import</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
