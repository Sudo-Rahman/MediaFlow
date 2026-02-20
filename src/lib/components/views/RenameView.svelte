<script lang="ts" module>
  import { Trash2, Search, FolderOpen, Play, Square, RefreshCw, AlertTriangle, X, ArrowUpDown, ArrowUp, ArrowDown, FileText } from '@lucide/svelte';
  export interface RenameViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { exists } from '@tauri-apps/plugin-fs';
  import { invoke } from '@tauri-apps/api/core';
  import { toast } from 'svelte-sonner';

  import { renameStore } from '$lib/stores/rename.svelte';
  import { toolImportStore } from '$lib/stores/tool-import.svelte';
  import { createRenameFile, buildNewPath } from '$lib/services/rename';
  import { logAndToast, log } from '$lib/utils/log-toast';
  import type { ImportSourceId } from '$lib/types/tool-import';
  import type { RuleType, RuleConfig, RenameMode, RenameFile } from '$lib/types/rename';

  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Label } from '$lib/components/ui/label';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import { ToolImportButton } from '$lib/components/shared';
  import {
    RenameTable,
    RenameRuleEditor,
  } from '$lib/components/rename';
  import type { SortField, SortDirection } from '$lib/types/rename';

  interface FileMetadata {
    size: number;
    created_at: number | null;
    modified_at: number | null;
  }

  interface RenameExecutionPlanItem {
    file: RenameFile;
    newPath: string;
  }

  let overwriteDialogOpen = $state(false);
  let pendingCopyPlan = $state.raw<RenameExecutionPlanItem[] | null>(null);
  let existingCopyTargets = $state<string[]>([]);

  async function fetchFileMetadata(path: string): Promise<{ size?: number; createdAt?: Date; modifiedAt?: Date }> {
    try {
      const metadata = await invoke<FileMetadata>('get_file_metadata', { path });
      return {
        size: metadata.size,
        createdAt: metadata.created_at ? new Date(metadata.created_at) : undefined,
        modifiedAt: metadata.modified_at ? new Date(metadata.modified_at) : undefined,
      };
    } catch (error) {
      console.error('Failed to fetch metadata for', path, error);
      return {};
    }
  }

  export async function handleFileDrop(paths: string[]) {
    if (paths.length === 0) {
      toast.warning('No files detected');
      return;
    }

    // Reset progress if completed
    if (renameStore.progress.status === 'completed') {
      renameStore.resetProgress();
    }

    // Create rename file entries with metadata
    const newFiles = await Promise.all(
      paths.map(async (path) => {
        const metadata = await fetchFileMetadata(path);
        return createRenameFile(path, metadata.size, metadata.modifiedAt, metadata.createdAt);
      })
    );
    renameStore.addFiles(newFiles);

    toast.success(`${paths.length} file(s) added`);
  }

  async function handleImportClick() {
    try {
      const selected = await open({
        multiple: true,
        title: 'Select files to rename',
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        await handleFileDrop(paths);
      }
    } catch (error) {
      logAndToast.error({
        source: 'rename',
        title: 'Error opening file dialog',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleImportFromSource(sourceId: ImportSourceId) {
    const { paths } = toolImportStore.resolveImport({
      targetTool: 'rename',
      sourceId,
    });

    if (paths.length === 0) {
      toast.info('No files available from this source');
      return;
    }

    const newFiles = await Promise.all(
      paths.map(async (path) => {
        const metadata = await fetchFileMetadata(path);
        return createRenameFile(path, metadata.size, metadata.modifiedAt, metadata.createdAt);
      }),
    );
    renameStore.addFiles(newFiles);

    toast.success(`${paths.length} file(s) imported`);
  }

  async function handleSelectOutputDir() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select output folder',
      });

      if (selected && typeof selected === 'string') {
        renameStore.setOutputDir(selected);
      }
    } catch (error) {
      console.error('Error selecting output directory:', error);
    }
  }

  function buildExecutionPlan(selectedFiles: RenameFile[], mode: RenameMode): RenameExecutionPlanItem[] {
    return selectedFiles.map((file) => ({
      file,
      newPath: buildNewPath(file, mode === 'copy' ? renameStore.outputDir : undefined),
    }));
  }

  async function findExistingCopyTargets(plan: RenameExecutionPlanItem[]): Promise<string[]> {
    const targets: string[] = [];
    for (const item of plan) {
      try {
        if (await exists(item.newPath)) {
          targets.push(item.newPath);
        }
      } catch (error) {
        console.error('Failed to check destination path', item.newPath, error);
      }
    }
    return targets;
  }

  async function executePlan(
    plan: RenameExecutionPlanItem[],
    mode: RenameMode,
    overwriteCopy: boolean,
  ): Promise<void> {
    // Start processing with new AbortController
    renameStore.startProcessing();
    renameStore.updateProgress({
      current: 0,
      total: plan.length,
    });

    let successCount = 0;
    let errorCount = 0;
    let cancelledCount = 0;

    for (let i = 0; i < plan.length; i++) {
      // Check for cancellation before each file
      if (renameStore.isCancelled) {
        cancelledCount = plan.length - i;
        break;
      }

      const item = plan[i];
      const file = item.file;

      renameStore.updateProgress({
        current: i + 1,
        currentFile: file.originalName,
      });

      renameStore.setFileStatus(file.id, 'processing');

      try {
        if (mode === 'rename') {
          await invoke('rename_file', {
            oldPath: file.originalPath,
            newPath: item.newPath,
          });
        } else {
          await invoke('copy_file', {
            sourcePath: file.originalPath,
            destPath: item.newPath,
            overwrite: overwriteCopy,
          });
        }

        renameStore.markFileComplete(file.id, true);
        successCount++;

        // Log success for this file
        log('success', 'rename',
          `${mode === 'rename' ? 'Renamed' : 'Copied'}: ${file.originalName}`,
          `${file.originalName} → ${file.newName}`,
          { filePath: file.originalPath, outputPath: item.newPath }
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        renameStore.markFileComplete(file.id, false, errorMsg);
        errorCount++;

        // Log error for this file
        log('error', 'rename',
          `Failed to ${mode}: ${file.originalName}`,
          errorMsg,
          { filePath: file.originalPath }
        );
      }
    }

    renameStore.updateProgress({ status: renameStore.isCancelled ? 'cancelled' : 'completed' });

    if (renameStore.isCancelled) {
      toast.warning(`Cancelled: ${successCount} completed, ${cancelledCount} skipped`);
    } else if (errorCount === 0) {
      toast.success(`${successCount} file(s) ${mode === 'rename' ? 'renamed' : 'copied'} successfully`);
    } else {
      toast.warning(`${successCount} success, ${errorCount} error(s)`);
    }
  }

  async function handleExecute() {
    const selectedFiles = renameStore.selectedFiles;
    
    if (selectedFiles.length === 0) {
      toast.warning('No files selected for renaming');
      return;
    }

    if (renameStore.hasConflicts) {
      toast.error('Please resolve naming conflicts before proceeding');
      return;
    }

    const mode = renameStore.mode;
    if (mode === 'copy' && !renameStore.outputDir) {
      toast.error('Please select an output folder for copy mode');
      return;
    }

    const plan = buildExecutionPlan(selectedFiles, mode);
    if (mode === 'copy') {
      const collisions = await findExistingCopyTargets(plan);
      if (collisions.length > 0) {
        pendingCopyPlan = plan;
        existingCopyTargets = collisions;
        overwriteDialogOpen = true;
        return;
      }
    }

    await executePlan(plan, mode, false);
  }

  function cancelCopyOverwritePrompt(): void {
    overwriteDialogOpen = false;
    pendingCopyPlan = null;
    existingCopyTargets = [];
  }

  async function confirmCopyOverwrite(): Promise<void> {
    const plan = pendingCopyPlan;
    if (!plan) {
      cancelCopyOverwritePrompt();
      return;
    }

    overwriteDialogOpen = false;
    pendingCopyPlan = null;
    existingCopyTargets = [];
    await executePlan(plan, 'copy', true);
  }

  async function handleOpenFolder() {
    try {
      const dir = renameStore.outputDir || (renameStore.files[0] && 
        renameStore.files[0].originalPath.substring(0, renameStore.files[0].originalPath.lastIndexOf('/')));
      if (dir) {
        await invoke('open_folder', { path: dir });
      }
    } catch (error) {
      console.error('Error opening folder:', error);
    }
  }

  function handleClearAll() {
    renameStore.clear();
    toast.info('All files cleared');
  }

  function handleSearchChange(e: Event) {
    const target = e.target as HTMLInputElement;
    renameStore.setSearchQuery(target.value);
  }

  function handleModeChange(value: string) {
    renameStore.setMode(value as RenameMode);
  }

  function handleAddRule(type: RuleType) {
    renameStore.addRule(type);
  }

  function handleRemoveRule(id: string) {
    renameStore.removeRule(id);
  }

  function handleToggleRule(id: string) {
    renameStore.toggleRule(id);
  }

  function handleDuplicateRule(id: string) {
    renameStore.duplicateRule(id);
  }

  function handleUpdateRuleConfig(id: string, config: RuleConfig) {
    renameStore.updateRuleConfig(id, config);
  }

  function handleClearRules() {
    renameStore.clearRules();
  }

  function handleReorderRules(newRules: import('$lib/types/rename').RenameRule[]) {
    renameStore.reorderRules(newRules);
  }

  function handleToggleAll() {
    if (allSelected) {
      renameStore.deselectAll();
    } else {
      renameStore.selectAll();
    }
  }

  // Derived state
  const files = $derived(renameStore.filteredFiles);
  const rules = $derived(renameStore.rules);
  const progress = $derived(renameStore.progress);
  const selectedCount = $derived(renameStore.selectedCount);
  const totalCount = $derived(renameStore.files.length);
  const hasConflicts = $derived(renameStore.hasConflicts);
  const conflictCount = $derived(renameStore.conflictCount);
  const hasChanges = $derived(renameStore.hasChanges);
  const isProcessing = $derived(renameStore.isProcessing);
  const mode = $derived(renameStore.mode);
  const outputDir = $derived(renameStore.outputDir);
  const currentSort = $derived(renameStore.sortConfig);

  // Sort labels
  const SORT_LABELS: Record<SortField, string> = {
    name: 'Name',
    size: 'Size',
    date: 'Date',
  };

  function handleSort(field: SortField) {
    if (currentSort.field === field) {
      renameStore.toggleSortDirection();
    } else {
      renameStore.setSort(field, 'asc');
    }
  }

  // Selection state
  const allSelected = $derived(totalCount > 0 && selectedCount === totalCount);
  const someSelected = $derived(selectedCount > 0 && selectedCount < totalCount);

  const canExecute = $derived(
    selectedCount > 0 && 
    !hasConflicts && 
    !isProcessing &&
    hasChanges &&
    (mode === 'rename' || outputDir)
  );

  const overwriteTargetSamples = $derived(existingCopyTargets.slice(0, 5));
</script>

<div class="h-full flex overflow-hidden">
  <!-- Main panel: Files table -->
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Toolbar -->
    <div class="p-3 border-b shrink-0 flex items-center gap-3">
      <ToolImportButton
        targetTool="rename"
        label="Add Files"
        onBrowse={handleImportClick}
        onSelectSource={handleImportFromSource}
      />

      {#if totalCount > 0}
        <!-- Search -->
        <div class="relative flex-1 max-w-xs">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={renameStore.searchQuery}
            oninput={handleSearchChange}
            class="pl-8 h-8"
          />
          {#if renameStore.searchQuery}
            <button
              class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onclick={() => renameStore.setSearchQuery('')}
            >
              <X class="size-4" />
            </button>
          {/if}
        </div>

        <!-- Sort dropdown -->
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button variant="outline" size="sm" {...props} class="gap-1.5">
                <ArrowUpDown class="size-3.5" />
                {SORT_LABELS[currentSort.field]}
                {#if currentSort.direction === 'asc'}
                  <ArrowUp class="size-3" />
                {:else}
                  <ArrowDown class="size-3" />
                {/if}
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" class="w-40">
            <DropdownMenu.Label>Sort by</DropdownMenu.Label>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={() => handleSort('name')}>
              Name
              {#if currentSort.field === 'name'}
                {#if currentSort.direction === 'asc'}
                  <ArrowUp class="size-3 ml-auto" />
                {:else}
                  <ArrowDown class="size-3 ml-auto" />
                {/if}
              {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => handleSort('size')}>
              Size
              {#if currentSort.field === 'size'}
                {#if currentSort.direction === 'asc'}
                  <ArrowUp class="size-3 ml-auto" />
                {:else}
                  <ArrowDown class="size-3 ml-auto" />
                {/if}
              {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => handleSort('date')}>
              Date
              {#if currentSort.field === 'date'}
                {#if currentSort.direction === 'asc'}
                  <ArrowUp class="size-3 ml-auto" />
                {:else}
                  <ArrowDown class="size-3 ml-auto" />
                {/if}
              {/if}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <div class="flex-1"></div>

        <!-- Status badges -->
        <div class="flex items-center gap-2">
          {#if hasConflicts}
            <Badge variant="destructive" class="gap-1">
              <AlertTriangle class="size-3" />
              {conflictCount} conflict{conflictCount > 1 ? 's' : ''}
            </Badge>
          {/if}
          
          <span class="text-sm text-muted-foreground">
            {selectedCount} / {totalCount} selected
          </span>
        </div>

        <!-- Clear all -->
        <Button
          variant="ghost"
          size="sm"
          onclick={handleClearAll}
          class="text-muted-foreground hover:text-destructive"
        >
          <Trash2 class="size-4 mr-1.5" />
          Clear
        </Button>
      {/if}
    </div>

    <!-- Table or Drop Zone -->
    <div class="flex-1 min-h-0 overflow-hidden">
      {#if totalCount === 0}
        <div class="h-full p-2">
          <ImportDropZone
            icon={FileText}
            title="Drop files here"
            formats="All files"
            onBrowse={handleImportClick}
            class="h-full"
          />
        </div>
      {:else}
        <RenameTable
          {files}
          {allSelected}
          {someSelected}
          onToggleSelection={(id) => renameStore.toggleFileSelection(id)}
          onToggleAll={handleToggleAll}
          onRemove={(id) => renameStore.removeFile(id)}
          class="h-full"
        />
      {/if}
    </div>

  </div>

  <!-- Right panel: Rules & Actions -->
  <div class="w-96 border-l flex flex-col overflow-hidden shrink-0">
    <!-- Rules editor -->
    <RenameRuleEditor
      {rules}
      onAddRule={handleAddRule}
      onRemoveRule={handleRemoveRule}
      onToggleRule={handleToggleRule}
      onDuplicateRule={handleDuplicateRule}
      onUpdateRuleConfig={handleUpdateRuleConfig}
      onReorderRules={handleReorderRules}
      onClearRules={handleClearRules}
      class="flex-1 min-h-0 overflow-hidden"
    />

    <!-- Action panel -->
    <div class="p-4 border-t shrink-0 space-y-4 bg-background">
      <!-- Mode selection -->
      <div class="space-y-2">
        <Label class="text-xs uppercase tracking-wide text-muted-foreground">Mode</Label>
        <RadioGroup.Root value={mode} onValueChange={handleModeChange} class="flex gap-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <RadioGroup.Item value="rename" />
            <span class="text-sm">Rename</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <RadioGroup.Item value="copy" />
            <span class="text-sm">Copy</span>
          </label>
        </RadioGroup.Root>
      </div>

      <!-- Output directory (for copy mode) -->
      {#if mode === 'copy'}
        <div class="space-y-2">
          <Label class="text-xs uppercase tracking-wide text-muted-foreground">Output Folder</Label>
          <Button
            variant="outline"
            class="w-full justify-start gap-2 h-auto py-2 text-left"
            onclick={handleSelectOutputDir}
          >
            <FolderOpen class="size-4 shrink-0" />
            <span class="truncate flex-1 text-sm">
              {#if outputDir}
                {outputDir}
              {:else}
                <span class="text-muted-foreground">Select folder...</span>
              {/if}
            </span>
          </Button>
        </div>
      {/if}

      <!-- Execute button -->
      {#if isProcessing}
        <Button
          class="w-full"
          size="lg"
          variant="destructive"
          onclick={() => renameStore.cancelProcessing()}
        >
          <Square class="size-4 mr-2" />
          Cancel
        </Button>
      {:else}
        <Button
          class="w-full"
          size="lg"
          disabled={!canExecute}
          onclick={handleExecute}
        >
          <Play class="size-4 mr-2" />
          {mode === 'rename' ? 'Rename' : 'Copy'} {selectedCount} file{selectedCount !== 1 ? 's' : ''}
        </Button>
      {/if}

      {#if progress.status === 'completed' || progress.status === 'cancelled'}
        <Button
          variant="outline"
          class="w-full"
          onclick={handleOpenFolder}
        >
          <FolderOpen class="size-4 mr-2" />
          Open Folder
        </Button>
      {/if}
    </div>
  </div>
</div>

<AlertDialog.Root bind:open={overwriteDialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Overwrite existing files?</AlertDialog.Title>
      <AlertDialog.Description>
        {existingCopyTargets.length} destination file(s) already exist. Continuing will replace them.
      </AlertDialog.Description>
    </AlertDialog.Header>

    {#if overwriteTargetSamples.length > 0}
      <div class="rounded-md border bg-muted/40 p-3 space-y-1 max-h-36 overflow-auto">
        {#each overwriteTargetSamples as targetPath}
          <p class="text-xs font-mono truncate">{targetPath}</p>
        {/each}
        {#if existingCopyTargets.length > overwriteTargetSamples.length}
          <p class="text-xs text-muted-foreground">
            + {existingCopyTargets.length - overwriteTargetSamples.length} more
          </p>
        {/if}
      </div>
    {/if}

    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={cancelCopyOverwritePrompt}>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={confirmCopyOverwrite}
        class="bg-destructive text-white hover:bg-destructive/90"
      >
        Overwrite and Continue
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
