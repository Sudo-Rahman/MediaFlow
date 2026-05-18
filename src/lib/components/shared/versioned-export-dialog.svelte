<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Download, Loader2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';

  import {
    getAllowedExportFormatOptions,
    type RunBatchExportResult,
    type VersionedExportFailure,
    type VersionedExportFormatOption,
    type VersionedExportGroup,
    type VersionedExportMode,
    type VersionedExportRequest,
    type VersionedExportTarget,
    type VersionedExportVersion,
  } from '$lib/services/versioned-export';
  import { pickOutputDirectory } from '$lib/services/output-folder';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Label } from '$lib/components/ui/label';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import * as Select from '$lib/components/ui/select';
  import { resolveOutputFolderDisplay } from '$lib/utils';
  import OutputFolderField from './output-folder-field.svelte';

  interface VersionedExportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    groups: VersionedExportGroup[];
    formatOptions: VersionedExportFormatOption[];
    defaultFormat: string;
    onExport: (request: VersionedExportRequest) => Promise<RunBatchExportResult>;
    outputFolderLabel?: string;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    title,
    description,
    groups,
    formatOptions,
    defaultFormat,
    onExport,
    outputFolderLabel = 'Output folder',
  }: VersionedExportDialogProps = $props();

  let mode = $state<VersionedExportMode>('latest_per_file');
  let selectedFileIds = $state<Set<string>>(new Set());
  let selectedVersionKeys = $state<Set<string>>(new Set());
  let outputDir = $state('');
  let selectedFormat = $state('');
  let isExporting = $state(false);
  let exportFailures = $state<VersionedExportFailure[]>([]);
  let isDestroyed = false;

  onDestroy(() => {
    isDestroyed = true;
  });

  function getTimestamp(iso: string): number {
    const timestamp = Date.parse(iso);
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function formatCreatedAt(iso: string): string {
    if (!iso) {
      return 'Unknown date';
    }

    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      return 'Unknown date';
    }

    return parsed.toLocaleString('en-US');
  }

  function formatFailureVersionLabel(failure: VersionedExportFailure): string {
    const versionLabel = failure.versionName.trim();
    return versionLabel.length > 0 ? versionLabel : failure.versionId;
  }

  const sortedGroups = $derived.by(() => {
    return groups
      .map((group) => ({
        ...group,
        versions: [...group.versions].sort((a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt)),
      }))
      .filter((group) => group.versions.length > 0)
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  });

  const groupByFileId = $derived.by(() => new Map(sortedGroups.map((group) => [group.fileId, group])));

  function initializeState(): void {
    mode = 'latest_per_file';
    outputDir = '';
    selectedFormat = defaultFormat;
    exportFailures = [];
    selectedFileIds = new Set(sortedGroups.map((group) => group.fileId));
    selectedVersionKeys = new Set(
      sortedGroups.flatMap((group) => group.versions.map((version) => version.key)),
    );
  }

  $effect(() => {
    if (!open) {
      return;
    }

    untrack(() => {
      initializeState();
    });
  });

  const selectedGroups = $derived.by(() => sortedGroups.filter((group) => selectedFileIds.has(group.fileId)));

  function getLatestVersion(group: VersionedExportGroup) {
    return group.versions[0] ?? null;
  }

  function toExportTarget(group: VersionedExportGroup, version: VersionedExportVersion): VersionedExportTarget {
    return {
      fileId: group.fileId,
      fileName: group.fileName,
      versionKey: version.key,
      versionId: version.versionId,
      versionName: version.versionName,
      allowedFormats: version.allowedFormats,
    };
  }

  const exportTargets = $derived.by(() => {
    if (selectedGroups.length === 0) {
      return [] as VersionedExportTarget[];
    }

    if (mode === 'latest_per_file') {
      return selectedGroups
        .map((group) => {
          const latest = getLatestVersion(group);
          if (!latest) {
            return null;
          }

          return toExportTarget(group, latest);
        })
        .filter((target): target is VersionedExportTarget => target !== null);
    }

    if (mode === 'all_versions') {
      return selectedGroups.flatMap((group) =>
        group.versions.map((version) => toExportTarget(group, version)),
      );
    }

    return selectedGroups.flatMap((group) =>
      group.versions
        .filter((version) => selectedVersionKeys.has(version.key))
        .map((version) => toExportTarget(group, version)),
    );
  });

  const hasExportableData = $derived(sortedGroups.length > 0);
  const selectedFileCount = $derived(selectedGroups.length);
  const selectedVersionCount = $derived(exportTargets.length);
  const selectedFormatOptions = $derived(getAllowedExportFormatOptions(formatOptions, exportTargets));
  const selectedFormatIsAllowed = $derived(selectedFormatOptions.some((option) => option.value === selectedFormat));
  const formatOptionsWereFiltered = $derived(selectedFormatOptions.length < formatOptions.length);
  const hasAvailableFormat = $derived(selectedFormatOptions.length > 0);
  const canExport = $derived(
    outputDir.trim().length > 0 && selectedVersionCount > 0 && selectedFormatIsAllowed && !isExporting,
  );
  const displayedFailures = $derived(exportFailures.slice(0, 5));
  const hiddenFailureCount = $derived(Math.max(0, exportFailures.length - displayedFailures.length));
  const outputFolderDisplay = $derived.by(() =>
    resolveOutputFolderDisplay({
      explicitPath: outputDir,
      allowSourceFallback: false,
    }),
  );

  $effect(() => {
    if (!open || selectedFormatIsAllowed) {
      return;
    }

    selectedFormat = selectedFormatOptions.find((option) => option.value === defaultFormat)?.value
      ?? selectedFormatOptions[0]?.value
      ?? '';
  });

  function setMode(nextMode: VersionedExportMode): void {
    mode = nextMode;
  }

  function toggleFile(fileId: string): void {
    const group = groupByFileId.get(fileId);
    if (!group) {
      return;
    }

    const nextFiles = new Set(selectedFileIds);
    const nextVersions = new Set(selectedVersionKeys);

    if (nextFiles.has(fileId)) {
      nextFiles.delete(fileId);
      for (const version of group.versions) {
        nextVersions.delete(version.key);
      }
    } else {
      nextFiles.add(fileId);
      for (const version of group.versions) {
        nextVersions.add(version.key);
      }
    }

    selectedFileIds = nextFiles;
    selectedVersionKeys = nextVersions;
  }

  function toggleVersion(versionKey: string): void {
    const nextVersions = new Set(selectedVersionKeys);
    if (nextVersions.has(versionKey)) {
      nextVersions.delete(versionKey);
    } else {
      nextVersions.add(versionKey);
    }

    selectedVersionKeys = nextVersions;
  }

  async function handleBrowseOutput(): Promise<void> {
    const selected = await pickOutputDirectory();

    if (selected) {
      outputDir = selected;
    }
  }

  async function handleExport(): Promise<void> {
    const request: VersionedExportRequest = {
      mode,
      format: selectedFormat,
      outputDir: outputDir.trim(),
      targets: exportTargets,
    };

    if (request.outputDir.length === 0 || request.targets.length === 0 || !selectedFormatIsAllowed || isExporting) {
      return;
    }

    isExporting = true;
    exportFailures = [];

    try {
      const result = await onExport(request);
      if (isDestroyed) {
        return;
      }

      exportFailures = result.failures;

      if (result.successCount > 0) {
        toast.success(`${result.successCount} file(s) exported`);
      }

      if (result.failCount > 0) {
        toast.error(`${result.failCount} file(s) failed to export`);
      }

      if (result.successCount > 0 && result.failCount === 0) {
        onOpenChange(false);
      }
    } catch (error) {
      if (isDestroyed) {
        return;
      }

      exportFailures = [];
      const message = error instanceof Error ? error.message : 'Export failed';
      toast.error(message);
    } finally {
      if (!isDestroyed) {
        isExporting = false;
      }
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content class="max-w-4xl max-h-[85vh] flex flex-col">
    <Dialog.Header class="shrink-0">
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
    </Dialog.Header>

    <div class="dialog-scroll-body py-1">
    {#if !hasExportableData}
      <div class="rounded-md border p-4 text-sm text-muted-foreground">
        No exportable versions are available yet.
      </div>
    {:else}
      <div class="space-y-4">
        <div class="space-y-2">
          <Label>Export mode</Label>
          <RadioGroup.Root value={mode} onValueChange={(value) => value && setMode(value as VersionedExportMode)}>
            <div class="space-y-2">
              <label class="flex items-center gap-2 rounded-md border p-3">
                <RadioGroup.Item value="latest_per_file" id="versioned-export-latest-per-file" />
                <div class="text-sm">
                  <p class="font-medium">Latest per file</p>
                  <p class="text-muted-foreground">Export the newest version from each selected file.</p>
                </div>
              </label>

              <label class="flex items-center gap-2 rounded-md border p-3">
                <RadioGroup.Item value="all_versions" id="versioned-export-all-versions" />
                <div class="text-sm">
                  <p class="font-medium">All versions</p>
                  <p class="text-muted-foreground">Export every version from each selected file.</p>
                </div>
              </label>

              <label class="flex items-center gap-2 rounded-md border p-3">
                <RadioGroup.Item value="custom" id="versioned-export-custom-selection" />
                <div class="text-sm">
                  <p class="font-medium">Custom selection</p>
                  <p class="text-muted-foreground">Choose specific versions to export.</p>
                </div>
              </label>
            </div>
          </RadioGroup.Root>
        </div>

        <div class="space-y-2">
          <Label>Export format</Label>
          <Select.Root
            type="single"
            value={selectedFormat}
            onValueChange={(value) => {
              if (value) {
                selectedFormat = value;
              }
            }}
            disabled={isExporting || !hasAvailableFormat}
          >
            <Select.Trigger class="w-full">
              {selectedFormatOptions.find((option) => option.value === selectedFormat)?.label
                ?? formatOptions.find((option) => option.value === selectedFormat)?.label
                ?? selectedFormat.toUpperCase()}
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                {#each selectedFormatOptions as formatOption (formatOption.value)}
                  <Select.Item value={formatOption.value}>{formatOption.label}</Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
          {#if !hasAvailableFormat && selectedVersionCount > 0}
            <p class="text-xs text-destructive">
              No common export format is available for the selected versions.
            </p>
          {:else if formatOptionsWereFiltered}
            <p class="text-xs text-muted-foreground">
              Selected versions require positioned subtitles, so incompatible formats are hidden.
            </p>
          {/if}
        </div>

        <div class="rounded-md border">
          <div class="border-b p-3">
            <p class="text-sm font-medium">File filter</p>
            <p class="text-xs text-muted-foreground">Select which files to include.</p>
          </div>

          <ScrollArea class="h-40">
            <div class="space-y-2 p-3">
              {#each sortedGroups as group (group.fileId)}
                <label class="flex items-center justify-between gap-2 rounded-md border p-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <Checkbox
                      checked={selectedFileIds.has(group.fileId)}
                      onCheckedChange={() => toggleFile(group.fileId)}
                    />
                    <div class="min-w-0">
                      <p class="text-sm truncate">{group.fileName}</p>
                      <p class="text-xs text-muted-foreground">{group.versions.length} version(s)</p>
                    </div>
                  </div>
                  {#if group.fileBadge}
                    <Badge variant="outline" class="shrink-0 uppercase">{group.fileBadge}</Badge>
                  {/if}
                </label>
              {/each}
            </div>
          </ScrollArea>
        </div>

        {#if mode === 'custom'}
          <div class="rounded-md border">
            <div class="border-b p-3">
              <p class="text-sm font-medium">Version filter</p>
              <p class="text-xs text-muted-foreground">Choose exact versions to export.</p>
            </div>

            <ScrollArea class="h-56">
              <div class="space-y-4 p-3">
                {#each sortedGroups as group (group.fileId)}
                  <section class="space-y-2">
                    <p class="text-sm font-medium truncate">{group.fileName}</p>
                    <div class="space-y-1.5">
                      {#each group.versions as version (version.key)}
                        <label class="flex items-center justify-between gap-2 rounded-md border p-2">
                          <div class="flex items-center gap-2 min-w-0">
                            <Checkbox
                              checked={selectedVersionKeys.has(version.key)}
                              onCheckedChange={() => toggleVersion(version.key)}
                              disabled={!selectedFileIds.has(group.fileId)}
                            />
                            <div class="min-w-0">
                              <p class="text-sm truncate">{version.versionName}</p>
                              <p class="text-xs text-muted-foreground">{formatCreatedAt(version.createdAt)}</p>
                            </div>
                          </div>
                        </label>
                      {/each}
                    </div>
                  </section>
                {/each}
              </div>
            </ScrollArea>
          </div>
        {/if}

        <OutputFolderField
          label={outputFolderLabel}
          displayText={outputFolderDisplay.displayText}
          state={outputFolderDisplay.state}
          disabled={isExporting}
          onBrowse={handleBrowseOutput}
        />

        <div class="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          {selectedFileCount} file(s) selected · {selectedVersionCount} version(s) to export
        </div>

        {#if exportFailures.length > 0}
          <div class="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p class="text-sm font-medium text-destructive">Export issues</p>
            <ul class="space-y-1 text-xs text-destructive/90">
              {#each displayedFailures as failure (`${failure.fileId}:${failure.versionId}:${failure.message}`)}
                <li class="break-words">
                  {failure.fileName}/{formatFailureVersionLabel(failure)}: {failure.message}
                </li>
              {/each}
            </ul>
            {#if hiddenFailureCount > 0}
              <p class="text-xs text-destructive/80">
                +{hiddenFailureCount} more issue(s)
              </p>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
    </div>

    <Dialog.Footer class="shrink-0">
      <Button variant="outline" onclick={() => onOpenChange(false)} disabled={isExporting}>
        Cancel
      </Button>
      <Button onclick={handleExport} disabled={!canExport}>
        {#if isExporting}
          <Loader2 class="size-4 mr-2 animate-spin" />
          Exporting...
        {:else}
          <Download class="size-4 mr-2" />
          Export ({selectedVersionCount})
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
