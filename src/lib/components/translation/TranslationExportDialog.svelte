<script lang="ts">
  import { untrack } from 'svelte';
  import { join } from '@tauri-apps/api/path';
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import { writeTextFile } from '@tauri-apps/plugin-fs';
  import { Download, FolderOpen, Loader2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';

  import type { TranslationJob } from '$lib/types';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  type ExportMode = 'latest_per_file' | 'all_versions' | 'custom';

  interface ExportVersionEntry {
    key: string;
    versionName: string;
    createdAt: string;
    content: string;
  }

  interface ExportFileGroup {
    jobId: string;
    fileName: string;
    fileFormat: 'srt' | 'ass' | 'vtt' | 'ssa';
    versions: ExportVersionEntry[];
  }

  interface ExportTarget {
    fileName: string;
    fileFormat: 'srt' | 'ass' | 'vtt' | 'ssa';
    versionName: string;
    content: string;
  }

  interface TranslationExportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    jobs: TranslationJob[];
  }

  let {
    open = $bindable(false),
    onOpenChange,
    jobs,
  }: TranslationExportDialogProps = $props();

  let mode = $state<ExportMode>('latest_per_file');
  let selectedFileIds = $state<Set<string>>(new Set());
  let selectedVersionKeys = $state<Set<string>>(new Set());
  let outputDir = $state('');
  let isExporting = $state(false);

  function getTimestamp(iso: string): number {
    const timestamp = Date.parse(iso);
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function stripExtension(fileName: string): string {
    return fileName.replace(/\.[^/.]+$/, '');
  }

  function sanitizeVersionName(name: string): string {
    const sanitized = name
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .toLowerCase();

    return sanitized.length > 0 ? sanitized : 'version';
  }

  function formatCreatedAt(iso: string): string {
    if (!iso) return 'Unknown date';
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return 'Unknown date';
    return parsed.toLocaleString('en-US');
  }

  const exportGroups = $derived.by(() => {
    return jobs
      .map((job): ExportFileGroup | null => {
        const versionEntries: ExportVersionEntry[] = job.translationVersions.map((version) => ({
          key: `${job.id}:${version.id}`,
          versionName: version.name,
          createdAt: version.createdAt,
          content: version.translatedContent,
        }));

        if (versionEntries.length === 0 && job.result?.translatedContent) {
          versionEntries.push({
            key: `${job.id}:legacy_result`,
            versionName: 'Current result',
            createdAt: '',
            content: job.result.translatedContent,
          });
        }

        if (versionEntries.length === 0) {
          return null;
        }

        const versions = [...versionEntries].sort(
          (a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt)
        );

        return {
          jobId: job.id,
          fileName: job.file.name,
          fileFormat: job.file.format,
          versions,
        };
      })
      .filter((group): group is ExportFileGroup => group !== null)
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  });

  const groupByJobId = $derived.by(() => new Map(exportGroups.map((group) => [group.jobId, group])));

  function initializeState(): void {
    mode = 'latest_per_file';
    outputDir = '';
    selectedFileIds = new Set(exportGroups.map((group) => group.jobId));
    selectedVersionKeys = new Set(
      exportGroups.flatMap((group) => group.versions.map((version) => version.key))
    );
  }

  $effect(() => {
    if (!open) return;
    untrack(() => {
      initializeState();
    });
  });

  function getLatestVersion(group: ExportFileGroup): ExportVersionEntry | null {
    return group.versions[0] ?? null;
  }

  const selectedGroups = $derived.by(() => {
    return exportGroups.filter((group) => selectedFileIds.has(group.jobId));
  });

  const exportTargets = $derived.by(() => {
    if (selectedGroups.length === 0) {
      return [] as ExportTarget[];
    }

    if (mode === 'latest_per_file') {
      return selectedGroups
        .map((group) => {
          const latest = getLatestVersion(group);
          if (!latest) return null;
          return {
            fileName: group.fileName,
            fileFormat: group.fileFormat,
            versionName: latest.versionName,
            content: latest.content,
          };
        })
        .filter((target): target is ExportTarget => target !== null);
    }

    if (mode === 'all_versions') {
      return selectedGroups.flatMap((group) =>
        group.versions.map((version) => ({
          fileName: group.fileName,
          fileFormat: group.fileFormat,
          versionName: version.versionName,
          content: version.content,
        }))
      );
    }

    return selectedGroups.flatMap((group) =>
      group.versions
        .filter((version) => selectedVersionKeys.has(version.key))
        .map((version) => ({
          fileName: group.fileName,
          fileFormat: group.fileFormat,
          versionName: version.versionName,
          content: version.content,
        }))
    );
  });

  const hasExportableData = $derived(exportGroups.length > 0);
  const selectedFileCount = $derived(selectedGroups.length);
  const selectedVersionCount = $derived(exportTargets.length);
  const canExport = $derived(
    outputDir.trim().length > 0 && selectedVersionCount > 0 && !isExporting
  );

  function setMode(value: ExportMode): void {
    mode = value;
  }

  function toggleFile(jobId: string): void {
    const group = groupByJobId.get(jobId);
    if (!group) return;

    const nextFiles = new Set(selectedFileIds);
    const nextVersions = new Set(selectedVersionKeys);

    if (nextFiles.has(jobId)) {
      nextFiles.delete(jobId);
      for (const version of group.versions) {
        nextVersions.delete(version.key);
      }
    } else {
      nextFiles.add(jobId);
      for (const version of group.versions) {
        nextVersions.add(version.key);
      }
    }

    selectedFileIds = nextFiles;
    selectedVersionKeys = nextVersions;
  }

  function toggleVersion(key: string): void {
    const nextVersions = new Set(selectedVersionKeys);
    if (nextVersions.has(key)) {
      nextVersions.delete(key);
    } else {
      nextVersions.add(key);
    }
    selectedVersionKeys = nextVersions;
  }

  async function handleBrowseOutput(): Promise<void> {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Select output folder',
    });

    if (selected && typeof selected === 'string') {
      outputDir = selected;
    }
  }

  function buildUniqueFileName(
    baseName: string,
    versionName: string,
    format: ExportTarget['fileFormat'],
    usedNames: Set<string>
  ): string {
    const versionSuffix = sanitizeVersionName(versionName);
    const extension = format.toLowerCase();
    const candidateBase = `${baseName}_${versionSuffix}`;

    let index = 1;
    let candidate = `${candidateBase}.${extension}`;
    while (usedNames.has(candidate.toLowerCase())) {
      index += 1;
      candidate = `${candidateBase}_${index}.${extension}`;
    }

    usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  async function handleExport(): Promise<void> {
    if (!canExport) return;

    isExporting = true;
    let successCount = 0;
    let failCount = 0;
    const usedNames = new Set<string>();

    try {
      for (const target of exportTargets) {
        try {
          const baseName = stripExtension(target.fileName);
          const fileName = buildUniqueFileName(
            baseName,
            target.versionName,
            target.fileFormat,
            usedNames
          );
          const filePath = await join(outputDir, fileName);
          await writeTextFile(filePath, target.content);
          successCount += 1;
        } catch (error) {
          failCount += 1;
          console.error('Failed to export translation file:', error);
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} file(s) exported`);
      }
      if (failCount > 0) {
        toast.error(`${failCount} file(s) failed to export`);
      }
      if (successCount > 0 && failCount === 0) {
        onOpenChange(false);
      }
    } finally {
      isExporting = false;
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content class="max-w-4xl max-h-[85vh] flex flex-col overflow-scroll">
    <Dialog.Header>
      <Dialog.Title>Export Translations</Dialog.Title>
      <Dialog.Description>
        Export translated subtitles by file and version.
      </Dialog.Description>
    </Dialog.Header>

    {#if !hasExportableData}
      <div class="rounded-md border p-4 text-sm text-muted-foreground">
        No translated versions are available yet.
      </div>
    {:else}
      <div class="space-y-4">
        <div class="space-y-2">
          <Label>Export mode</Label>
          <RadioGroup.Root value={mode} onValueChange={(value) => value && setMode(value as ExportMode)}>
            <div class="space-y-2">
              <label class="flex items-center gap-2 rounded-md border p-3">
                <RadioGroup.Item value="latest_per_file" id="export-latest-per-file" />
                <div class="text-sm">
                  <p class="font-medium">Latest per file</p>
                  <p class="text-muted-foreground">Export the newest version from each selected file.</p>
                </div>
              </label>

              <label class="flex items-center gap-2 rounded-md border p-3">
                <RadioGroup.Item value="all_versions" id="export-all-versions" />
                <div class="text-sm">
                  <p class="font-medium">All versions</p>
                  <p class="text-muted-foreground">Export every version from each selected file.</p>
                </div>
              </label>

              <label class="flex items-center gap-2 rounded-md border p-3">
                <RadioGroup.Item value="custom" id="export-custom-selection" />
                <div class="text-sm">
                  <p class="font-medium">Custom selection</p>
                  <p class="text-muted-foreground">Choose specific versions to export.</p>
                </div>
              </label>
            </div>
          </RadioGroup.Root>
        </div>

        <div class="rounded-md border">
          <div class="border-b p-3">
            <p class="text-sm font-medium">File filter</p>
            <p class="text-xs text-muted-foreground">Select which files to include.</p>
          </div>

          <ScrollArea class="h-40">
            <div class="space-y-2 p-3">
              {#each exportGroups as group}
                <label class="flex items-center justify-between gap-2 rounded-md border p-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <Checkbox
                      checked={selectedFileIds.has(group.jobId)}
                      onCheckedChange={() => toggleFile(group.jobId)}
                    />
                    <div class="min-w-0">
                      <p class="text-sm truncate">{group.fileName}</p>
                      <p class="text-xs text-muted-foreground">{group.versions.length} version(s)</p>
                    </div>
                  </div>
                  <Badge variant="outline" class="shrink-0 uppercase">{group.fileFormat}</Badge>
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
                {#each exportGroups as group}
                  <section class="space-y-2">
                    <p class="text-sm font-medium truncate">{group.fileName}</p>
                    <div class="space-y-1.5">
                      {#each group.versions as version}
                        <label class="flex items-center justify-between gap-2 rounded-md border p-2">
                          <div class="flex items-center gap-2 min-w-0">
                            <Checkbox
                              checked={selectedVersionKeys.has(version.key)}
                              onCheckedChange={() => toggleVersion(version.key)}
                              disabled={!selectedFileIds.has(group.jobId)}
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

        <div class="space-y-2">
          <Label>Output folder</Label>
          <div class="flex gap-2">
            <Input value={outputDir} readonly placeholder="Select output folder..." class="text-xs" />
            <Button variant="outline" size="icon" onclick={handleBrowseOutput} disabled={isExporting}>
              <FolderOpen class="size-4" />
            </Button>
          </div>
        </div>

        <div class="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          {selectedFileCount} file(s) selected · {selectedVersionCount} version(s) to export
        </div>
      </div>
    {/if}

    <Dialog.Footer>
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
