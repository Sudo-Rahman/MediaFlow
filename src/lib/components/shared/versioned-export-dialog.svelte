<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Download, Loader2 } from '@lucide/svelte';
  import { useId } from 'bits-ui';
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
  import * as Alert from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Empty from '$lib/components/ui/empty';
  import * as Field from '$lib/components/ui/field';
  import * as Item from '$lib/components/ui/item';
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
  const baseId = useId();
  const exportModeLabelId = `${baseId}-versioned-export-mode-label`;
  const latestPerFileId = `${baseId}-versioned-export-latest-per-file`;
  const latestPerFileTitleId = `${latestPerFileId}-title`;
  const latestPerFileDescriptionId = `${latestPerFileId}-description`;
  const allVersionsId = `${baseId}-versioned-export-all-versions`;
  const allVersionsTitleId = `${allVersionsId}-title`;
  const allVersionsDescriptionId = `${allVersionsId}-description`;
  const customSelectionId = `${baseId}-versioned-export-custom-selection`;
  const customSelectionTitleId = `${customSelectionId}-title`;
  const customSelectionDescriptionId = `${customSelectionId}-description`;
  const exportFormatLabelId = `${baseId}-versioned-export-format-label`;
  const exportIssuesTitleId = `${baseId}-versioned-export-issues-title`;
  const exportIssuesDescriptionId = `${baseId}-versioned-export-issues-description`;

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

  function toggleVersionIfFileSelected(fileId: string, versionKey: string): void {
    if (!selectedFileIds.has(fileId)) {
      return;
    }

    toggleVersion(versionKey);
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
        <Empty.Root class="min-h-24 flex-none p-6">
          <Empty.Header>
            <Empty.Title>No exportable versions are available yet.</Empty.Title>
          </Empty.Header>
        </Empty.Root>
      {:else}
        <Field.Group class="gap-4">
          <Field.Set class="gap-3">
            <Field.Legend id={exportModeLabelId} variant="label" class="mb-0">Export mode</Field.Legend>
            <RadioGroup.Root
              value={mode}
              aria-labelledby={exportModeLabelId}
              onValueChange={(value) => value && setMode(value as VersionedExportMode)}
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
                      <Item.Content>
                        <Item.Title id={latestPerFileTitleId}>Latest per file</Item.Title>
                        <Item.Description id={latestPerFileDescriptionId}>Export the newest version from each selected file.</Item.Description>
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
                      <Item.Content>
                        <Item.Title id={allVersionsTitleId}>All versions</Item.Title>
                        <Item.Description id={allVersionsDescriptionId}>Export every version from each selected file.</Item.Description>
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
                      <Item.Content>
                        <Item.Title id={customSelectionTitleId}>Custom selection</Item.Title>
                        <Item.Description id={customSelectionDescriptionId}>Choose specific versions to export.</Item.Description>
                      </Item.Content>
                    </div>
                  {/snippet}
                </Item.Root>
              </div>
            </RadioGroup.Root>
          </Field.Set>

          <Field.Field>
            <Field.Label id={exportFormatLabelId}>Export format</Field.Label>
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
              <Select.Trigger class="w-full" aria-labelledby={exportFormatLabelId}>
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
              <Field.Description class="text-xs text-destructive">
                No common export format is available for the selected versions.
              </Field.Description>
            {:else if formatOptionsWereFiltered}
              <Field.Description class="text-xs">
                Selected versions require positioned subtitles, so incompatible formats are hidden.
              </Field.Description>
            {/if}
          </Field.Field>

          <Field.Set class="gap-3">
            <Field.Legend variant="label" class="mb-0">File filter</Field.Legend>
            <Field.Description class="text-xs">Select which files to include.</Field.Description>

            <ScrollArea class="h-40">
              <div class="flex flex-col gap-2 pr-3">
                {#each sortedGroups as group, groupIndex (group.fileId)}
                  {@const fileId = `${baseId}-export-file-${groupIndex}`}
                  {@const fileTitleId = `${fileId}-title`}
                  {@const fileDescriptionId = `${fileId}-description`}
                  <Item.Root variant="outline" size="xs" class="cursor-pointer">
                    {#snippet child({ props })}
                      <div
                        {...props}
                        onclick={() => toggleFile(group.fileId)}
                      >
                        <Item.Media>
                          <Checkbox
                            checked={selectedFileIds.has(group.fileId)}
                            onCheckedChange={() => toggleFile(group.fileId)}
                            onclick={(event) => event.stopPropagation()}
                            aria-labelledby={fileTitleId}
                            aria-describedby={fileDescriptionId}
                          />
                        </Item.Media>
                        <Item.Content class="min-w-0">
                          <Item.Title id={fileTitleId} class="truncate">{group.fileName}</Item.Title>
                          <Item.Description id={fileDescriptionId} class="text-xs">{group.versions.length} version(s)</Item.Description>
                        </Item.Content>
                        {#if group.fileBadge}
                          <Item.Actions>
                            <Badge variant="outline" class="shrink-0 uppercase">{group.fileBadge}</Badge>
                          </Item.Actions>
                        {/if}
                      </div>
                    {/snippet}
                  </Item.Root>
                {/each}
              </div>
            </ScrollArea>
          </Field.Set>

          {#if mode === 'custom'}
            <Field.Set class="gap-3">
              <Field.Legend variant="label" class="mb-0">Version filter</Field.Legend>
              <Field.Description class="text-xs">Choose exact versions to export.</Field.Description>

              <ScrollArea class="h-56">
                <div class="flex flex-col gap-4 pr-3">
                  {#each sortedGroups as group, groupIndex (group.fileId)}
                    <section class="flex flex-col gap-2">
                      <p class="text-sm font-medium truncate">{group.fileName}</p>
                      <div class="flex flex-col gap-1.5">
                        {#each group.versions as version, versionIndex (version.key)}
                          {@const versionId = `${baseId}-export-version-${groupIndex}-${versionIndex}`}
                          {@const versionTitleId = `${versionId}-title`}
                          {@const versionDescriptionId = `${versionId}-description`}
                          <Item.Root
                            variant="outline"
                            size="xs"
                            class={['cursor-pointer', !selectedFileIds.has(group.fileId) && 'opacity-60']}
                          >
                            {#snippet child({ props })}
                              <div
                                {...props}
                                onclick={() => toggleVersionIfFileSelected(group.fileId, version.key)}
                              >
                                <Item.Media>
                                  <Checkbox
                                    checked={selectedVersionKeys.has(version.key)}
                                    onCheckedChange={() => toggleVersion(version.key)}
                                    onclick={(event) => event.stopPropagation()}
                                    disabled={!selectedFileIds.has(group.fileId)}
                                    aria-labelledby={versionTitleId}
                                    aria-describedby={versionDescriptionId}
                                  />
                                </Item.Media>
                                <Item.Content class="min-w-0">
                                  <Item.Title id={versionTitleId} class="truncate">{version.versionName}</Item.Title>
                                  <Item.Description id={versionDescriptionId} class="text-xs">{formatCreatedAt(version.createdAt)}</Item.Description>
                                </Item.Content>
                              </div>
                            {/snippet}
                          </Item.Root>
                        {/each}
                      </div>
                    </section>
                  {/each}
                </div>
              </ScrollArea>
            </Field.Set>
          {/if}

          <OutputFolderField
            label={outputFolderLabel}
            displayText={outputFolderDisplay.displayText}
            state={outputFolderDisplay.state}
            disabled={isExporting}
            onBrowse={handleBrowseOutput}
          />

          <Item.Root variant="muted" size="xs">
            <Item.Content>
              <Item.Description>
                {selectedFileCount} file(s) selected · {selectedVersionCount} version(s) to export
              </Item.Description>
            </Item.Content>
          </Item.Root>

          {#if exportFailures.length > 0}
            <Alert.Root
              variant="destructive"
              role="region"
              aria-labelledby={exportIssuesTitleId}
              aria-describedby={exportIssuesDescriptionId}
            >
              <Alert.Title id={exportIssuesTitleId}>Export issues</Alert.Title>
              <Alert.Description id={exportIssuesDescriptionId} class="flex flex-col gap-2">
                <ul class="flex flex-col gap-1 text-xs">
                  {#each displayedFailures as failure (`${failure.fileId}:${failure.versionId}:${failure.message}`)}
                    <li class="break-words">
                      {failure.fileName}/{formatFailureVersionLabel(failure)}: {failure.message}
                    </li>
                  {/each}
                </ul>
                {#if hiddenFailureCount > 0}
                  <p class="text-xs">
                    +{hiddenFailureCount} more issue(s)
                  </p>
                {/if}
              </Alert.Description>
            </Alert.Root>
          {/if}
        </Field.Group>
      {/if}
    </div>

    <Dialog.Footer class="shrink-0">
      <Button variant="outline" onclick={() => onOpenChange(false)} disabled={isExporting}>
        Cancel
      </Button>
      <Button onclick={handleExport} disabled={!canExport}>
        {#if isExporting}
          <Loader2 data-icon="inline-start" class="animate-spin" />
          Exporting...
        {:else}
          <Download data-icon="inline-start" />
          Export ({selectedVersionCount})
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
