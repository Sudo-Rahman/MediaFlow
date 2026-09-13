<script lang="ts" module>
  export interface RenameViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { exists } from '@tauri-apps/plugin-fs';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { toast } from 'svelte-sonner';

  import { renameStore } from '$lib/stores/rename.svelte';
  import { toolImportStore } from '$lib/stores/tool-import.svelte';
  import { fetchFileMetadata } from '$lib/services/file-metadata';
  import { pickOutputDirectory } from '$lib/services/output-folder';
  import { buildNewPath, createRenameFile, getDirectoryFromPath } from '$lib/services/rename';
  import { resolveOutputFolderDisplay } from '$lib/utils';
  import { logAndToast, log } from '$lib/utils/log-toast';
  import { formatFileSize } from '$lib/utils/format';
  import type { RenameCopyProgressEvent } from '$lib/types/progress';
  import type { ImportSourceId } from '$lib/types/tool-import';
  import type { ExpandedImportFile } from '$lib/types';
  import type { RenameMode, RenameFile } from '$lib/types/rename';
  import {
    expandToolImportRoots,
    expandedFilesFromPaths,
    pickAndExpandToolImport,
    toolImportPolicy,
  } from '$lib/services/import-coordination';

  import { RenameWorkspace } from '$lib/components/rename';
  import RenameExecutionPanel from '$lib/components/rename/RenameExecutionPanel.svelte';
  import RenameModePanel from '$lib/components/rename/RenameModePanel.svelte';
  import RenameOverwriteDialog from '$lib/components/rename/RenameOverwriteDialog.svelte';

  interface RenameExecutionPlanItem {
    file: RenameFile;
    newPath: string;
  }

  const COPY_CANCELLED_ERROR = 'Copy cancelled';
  const importPolicy = toolImportPolicy('rename');

  let overwriteDialogOpen = $state(false);
  let pendingCopyPlan = $state.raw<RenameExecutionPlanItem[] | null>(null);
  let existingCopyTargets = $state<string[]>([]);
  let isCancelling = $state(false);

  function isCopyCancelledError(errorMsg: string): boolean {
    return errorMsg === COPY_CANCELLED_ERROR || errorMsg.includes(COPY_CANCELLED_ERROR);
  }

  async function buildRenameFiles(expandedFiles: readonly ExpandedImportFile[]): Promise<RenameFile[]> {
    return Promise.all(
      expandedFiles.map(async ({ path, sourceGroup }) => {
        const metadata = await fetchFileMetadata(path);
        return createRenameFile(path, metadata.size, metadata.modifiedAt, metadata.createdAt, sourceGroup);
      }),
    );
  }

  async function addPathsToWorkspace(
    expandedFiles: readonly ExpandedImportFile[],
    successMessage: string,
  ): Promise<void> {
    if (expandedFiles.length === 0) {
      return;
    }

    if (renameStore.progress.status !== 'idle' && renameStore.progress.status !== 'processing') {
      renameStore.resetProgress();
    }

    const newFiles = await buildRenameFiles(expandedFiles);
    renameStore.addFiles(newFiles);
    toast.success(successMessage);
  }

  onMount(() => {
    let destroyed = false;
    let removeListener: UnlistenFn | null = null;

    const registerCopyProgressListener = async () => {
      const unlisten = await listen<RenameCopyProgressEvent>('rename-copy-progress', (event) => {
        if (!renameStore.isProcessing || renameStore.mode !== 'copy') {
          return;
        }

        const payload = event.payload;
        renameStore.updateCurrentCopyProgress(
          payload.sourcePath,
          payload.bytesCopied,
          payload.totalBytes,
          payload.progress,
          payload.speedBytesPerSec,
        );
      });

      if (destroyed) {
        unlisten();
        return;
      }

      removeListener = unlisten;
    };

    void registerCopyProgressListener();

    return () => {
      destroyed = true;
      removeListener?.();
    };
  });

  $effect(() => {
    if (!overwriteDialogOpen && pendingCopyPlan) {
      pendingCopyPlan = null;
      existingCopyTargets = [];
    }
  });

  export async function handleFileDrop(paths: string[]) {
    const expandedFiles = await expandToolImportRoots(paths, importPolicy, 'rename');
    await addPathsToWorkspace(expandedFiles, `${expandedFiles.length} file(s) added`);
  }

  async function handleImportClick() {
    try {
      const expandedFiles = await pickAndExpandToolImport(importPolicy, 'rename', 'files');
      await addPathsToWorkspace(expandedFiles, `${expandedFiles.length} file(s) imported`);
    } catch (error) {
      logAndToast.error({
        source: 'rename',
        title: 'Error opening file dialog',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleImportFolders(): Promise<void> {
    try {
      const expandedFiles = await pickAndExpandToolImport(importPolicy, 'rename', 'folders');
      await addPathsToWorkspace(expandedFiles, `${expandedFiles.length} file(s) imported`);
    } catch (error) {
      logAndToast.error({
        source: 'rename',
        title: 'Error opening folder dialog',
        details: error instanceof Error ? error.message : String(error),
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

    await addPathsToWorkspace(expandedFilesFromPaths(paths), `${paths.length} file(s) imported`);
  }

  async function handleSelectOutputDir() {
    try {
      const selected = await pickOutputDirectory();

      if (selected) {
        renameStore.setOutputDir(selected);
      }
    } catch (error) {
      console.error('Error selecting output directory:', error);
    }
  }

  function buildExecutionPlan(selectedFiles: RenameFile[], mode: RenameMode): RenameExecutionPlanItem[] {
    return selectedFiles.map((file) => ({
      file,
      newPath: buildNewPath(file, mode === 'copy' ? { outputDir: renameStore.outputDir } : undefined),
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
    const totalPlannedBytes =
      mode === 'copy'
        ? plan.reduce((sum, item) => sum + Math.max(0, item.file.size ?? 0), 0)
        : 0;

    renameStore.startProcessingRun(plan.length, totalPlannedBytes);

    let successCount = 0;
    let errorCount = 0;
    let cancelledCount = 0;

    for (let i = 0; i < plan.length; i++) {
      if (renameStore.isCancelled) {
        break;
      }

      const item = plan[i];
      const file = item.file;

      renameStore.setCurrentFile(file);
      renameStore.setFileStatus(file.id, 'processing');
      let outcome: 'success' | 'error' | 'cancelled' = 'success';

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

        log(
          'success',
          'rename',
          `${mode === 'rename' ? 'Renamed' : 'Copied'}: ${file.originalName}`,
          `${file.originalName} → ${file.newName}`,
          { filePath: file.originalPath, outputPath: item.newPath },
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const cancelled = renameStore.isCancelled || (mode === 'copy' && isCopyCancelledError(errorMsg));

        if (cancelled) {
          outcome = 'cancelled';
          cancelledCount++;
          renameStore.setFileStatus(file.id, 'cancelled', COPY_CANCELLED_ERROR);
          log(
            'warning',
            'rename',
            `Cancelled ${mode}: ${file.originalName}`,
            COPY_CANCELLED_ERROR,
            { filePath: file.originalPath, outputPath: item.newPath },
          );
        } else {
          outcome = 'error';
          renameStore.markFileComplete(file.id, false, errorMsg);
          errorCount++;

          log(
            'error',
            'rename',
            `Failed to ${mode}: ${file.originalName}`,
            errorMsg,
            { filePath: file.originalPath },
          );
        }
      } finally {
        renameStore.markCurrentFileProcessed(outcome);
      }

      if (outcome === 'cancelled') {
        break;
      }
    }

    const wasCancelled = renameStore.isCancelled || cancelledCount > 0;
    renameStore.updateProgress({ status: wasCancelled ? 'cancelled' : 'completed' });
    const skippedCount = Math.max(0, plan.length - (successCount + errorCount + cancelledCount));

    if (wasCancelled) {
      toast.warning(`Cancelled: ${successCount} completed, ${cancelledCount + skippedCount} skipped`);
    } else if (errorCount === 0) {
      toast.success(`${successCount} file(s) ${mode === 'rename' ? 'renamed' : 'copied'} successfully`);
    } else {
      toast.warning(`${successCount} success, ${errorCount} error(s)`);
    }
  }

  async function handleCancelProcessing() {
    if (!renameStore.isProcessing || isCancelling) {
      return;
    }

    renameStore.cancelProcessing();
    const currentMode = renameStore.mode;

    if (currentMode !== 'copy') {
      toast.info('Cancelling operation...');
      return;
    }

    const sourcePath = renameStore.progress.currentFilePath;
    if (!sourcePath) {
      toast.info('Cancelling operation...');
      return;
    }

    isCancelling = true;
    try {
      await invoke('cancel_copy_file', { sourcePath });
      toast.info('Cancelling current copy...');
    } catch (error) {
      logAndToast.error({
        source: 'rename',
        title: 'Cancel failed',
        details: error instanceof Error ? error.message : String(error),
      });
    } finally {
      isCancelling = false;
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
      const dir = renameStore.outputDir || getDirectoryFromPath(renameStore.files[0]?.originalPath ?? '');

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

  function handleModeChange(value: string) {
    renameStore.setMode(value as RenameMode);
  }

  const progress = $derived(renameStore.progress);
  const selectedCount = $derived(renameStore.selectedCount);
  const hasChanges = $derived(renameStore.hasChanges);
  const isProcessing = $derived(renameStore.isProcessing);
  const mode = $derived(renameStore.mode);
  const outputDir = $derived(renameStore.outputDir);
  const outputFolderDisplay = $derived.by(() =>
    resolveOutputFolderDisplay({
      explicitPath: outputDir,
      allowSourceFallback: false,
    }),
  );
  const canExecute = $derived(
    selectedCount > 0
    && !renameStore.hasBlockingIssues
    && !isProcessing
    && hasChanges
    && (mode === 'rename' || Boolean(outputDir)),
  );
  const overwriteTargetSamples = $derived(existingCopyTargets.slice(0, 5));
  const copiedBytes = $derived(Math.max(0, progress.completedBytes + progress.currentFileBytesCopied));
  const totalBytes = $derived(Math.max(0, progress.totalBytes));
  const copiedBytesLabel = $derived(
    formatFileSize(totalBytes > 0 ? Math.min(copiedBytes, totalBytes) : copiedBytes),
  );
  const totalBytesLabel = $derived(formatFileSize(totalBytes));
</script>

<RenameWorkspace
  workspace={renameStore}
  importTargetTool="rename"
  onBrowseImport={handleImportClick}
  onBrowseImportFolders={handleImportFolders}
  onSelectImportSource={handleImportFromSource}
  onClearAll={handleClearAll}
>
  {#snippet actionPanel()}
    <RenameModePanel
      {mode}
      {outputFolderDisplay}
      onModeChange={handleModeChange}
      onSelectOutputDir={handleSelectOutputDir}
    />

    <RenameExecutionPanel
      {mode}
      {selectedCount}
      {canExecute}
      {isProcessing}
      {isCancelling}
      {progress}
      {copiedBytesLabel}
      {totalBytesLabel}
      onExecute={handleExecute}
      onCancel={handleCancelProcessing}
      onOpenFolder={handleOpenFolder}
    />
  {/snippet}
</RenameWorkspace>

<RenameOverwriteDialog
  bind:open={overwriteDialogOpen}
  existingTargetCount={existingCopyTargets.length}
  targetSamples={overwriteTargetSamples}
  onCancel={cancelCopyOverwritePrompt}
  onConfirm={confirmCopyOverwrite}
/>
