<script lang="ts" module>
  import { Play, Trash2, FileText, Languages, X, Square, Check, AlertCircle, Download, Copy, Loader2, RotateCw } from '@lucide/svelte';
  export interface TranslationViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
  import { toast } from 'svelte-sonner';

  import { settingsStore, toolImportStore, translationStore } from '$lib/stores';
  import { translateSubtitle, detectSubtitleFormat, getSubtitleExtension, buildFullPromptForTokenCount, type BatchProgressInfo } from '$lib/services/translation';
  import { countTokens } from '$lib/services/tokenizer';
  import { logAndToast, log } from '$lib/utils/log-toast';
  import type { SubtitleFile, TranslationJob } from '$lib/types';
  import type { ImportSelectionMode, ImportSourceId, VersionedImportItem } from '$lib/types/tool-import';

  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Progress } from '$lib/components/ui/progress';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Resizable from '$lib/components/ui/resizable';
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import { FileItemCard, ToolImportButton, ToolImportSourceDialog } from '$lib/components/shared';

  import { TranslationConfigPanel } from '$lib/components/translation';

  import { Textarea } from '$lib/components/ui/textarea';

  interface TranslationViewProps {
    onNavigateToSettings?: () => void;
  }

  let { onNavigateToSettings }: TranslationViewProps = $props();

  const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.vtt', '.ssa'] as const;
  const SUBTITLE_FORMATS = SUBTITLE_EXTENSIONS.map((ext) => ext.slice(1).toUpperCase());
  let sourceDialogOpen = $state(false);
  let sourceDialogSourceId = $state<ImportSourceId | null>(null);
  let sourceDialogLabel = $state('');
  let sourceDialogItems = $state<VersionedImportItem[]>([]);

  // Reactive state for API key check - use $derived to react to settings changes
  const hasApiKey = $derived(
    settingsStore.isLoaded && !!settingsStore.getLLMApiKey(translationStore.config.provider)
  );

  // Token count cache by file path (to avoid recalculating on job status changes)
  let tokenCountCache = $state<Map<string, number>>(new Map());
  let isCountingTokens = $state(false);

  // Get token count for selected job from cache
  const tokenCount = $derived(() => {
    const path = translationStore.selectedJob?.file?.path;
    return path ? tokenCountCache.get(path) ?? null : null;
  });

  // Calculate tokens only when a NEW file path is selected
  let lastCountedPath = $state<string | null>(null);

  $effect(() => {
    const job = translationStore.selectedJob;
    const filePath = job?.file?.path;

    // Only calculate if we have a new file that wasn't counted before
    if (filePath && filePath !== lastCountedPath && !tokenCountCache.has(filePath)) {
      const fileContent = job.file.content;
      lastCountedPath = filePath;
      isCountingTokens = true;

      // Use untrack to avoid re-triggering on config changes
      untrack(() => {
        const { sourceLanguage, targetLanguage } = translationStore.config;
        const fullPrompt = buildFullPromptForTokenCount(
          fileContent,
          sourceLanguage,
          targetLanguage
        );

        countTokens(fullPrompt)
          .then(count => {
            tokenCountCache.set(filePath, count);
            tokenCountCache = new Map(tokenCountCache); // Trigger reactivity
          })
          .catch(() => { /* ignore errors */ })
          .finally(() => { isCountingTokens = false; });
      });
    }
  });

  // Expose API for drag & drop from parent
  export async function handleFileDrop(paths: string[]) {
    const subtitlePaths = paths.filter(p =>
      SUBTITLE_EXTENSIONS.some(ext => p.toLowerCase().endsWith(ext))
    );

    if (subtitlePaths.length === 0) {
      toast.warning('No valid subtitle files detected');
      return;
    }

    // Load all files
    for (const path of subtitlePaths) {
      await loadSubtitleFile(path);
    }
  }

  async function loadSubtitleFile(path: string) {
    try {
      const content = await readTextFile(path);
      const format = detectSubtitleFormat(content);

      if (!format) {
        logAndToast.error({
          source: 'translation',
          title: 'Could not detect subtitle format',
          details: `Unable to detect format for file: ${path}`,
          context: { filePath: path }
        });
        return;
      }

      const name = path.split('/').pop() || path.split('\\').pop() || path;

      const subtitleFile: SubtitleFile = {
        path,
        name,
        format,
        content,
        size: new Blob([content]).size
      };

      translationStore.addFile(subtitleFile);
      toast.success(`Loaded: ${name}`);
    } catch (error) {
      logAndToast.error({
        source: 'translation',
        title: 'Failed to load subtitle file',
        details: error instanceof Error ? error.message : String(error),
        context: { filePath: path }
      });
    }
  }

  async function handleImportClick() {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Subtitle files',
          extensions: SUBTITLE_EXTENSIONS.map(ext => ext.slice(1))
        }]
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        for (const path of paths) {
          if (typeof path === 'string') {
            await loadSubtitleFile(path);
          }
        }
      }
    } catch (error) {
      logAndToast.error({
        source: 'translation',
        title: 'Error opening file dialog',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function importSubtitlePaths(paths: string[]) {
    for (const path of paths) {
      await loadSubtitleFile(path);
    }
  }

  function isTextSubtitlePath(path: string): boolean {
    const lowerPath = path.toLowerCase();
    return SUBTITLE_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
  }

  function importSubtitleFiles(files: SubtitleFile[]) {
    if (files.length === 0) {
      return { imported: 0, skipped: 0 };
    }

    const existingPaths = new Set(translationStore.jobs.map((job) => job.file.path));
    let imported = 0;
    let skipped = 0;

    for (const file of files) {
      if (existingPaths.has(file.path)) {
        skipped++;
        continue;
      }
      translationStore.addFile(file);
      existingPaths.add(file.path);
      imported++;
    }

    return { imported, skipped };
  }

  async function handleImportFromSource(sourceId: ImportSourceId) {
    const sourceItems = toolImportStore.getItems(sourceId, 'translate');
    if (sourceItems.length === 0) {
      toast.info('No subtitle data available from this source');
      return;
    }

    if (sourceItems[0].itemType === 'versioned') {
      const sourceOption = toolImportStore
        .getAvailableSources('translate')
        .find((source) => source.sourceId === sourceId);

      sourceDialogSourceId = sourceId;
      sourceDialogLabel = sourceOption?.label ?? 'Source';
      sourceDialogItems = sourceItems.filter((item): item is VersionedImportItem => item.itemType === 'versioned');
      sourceDialogOpen = true;
      return;
    }

    const payload = toolImportStore.resolveImport({
      targetTool: 'translate',
      sourceId,
    });

    const textSubtitlePaths = payload.paths.filter(isTextSubtitlePath);
    const skippedCount = payload.paths.length - textSubtitlePaths.length;

    if (textSubtitlePaths.length === 0) {
      toast.info('No text subtitle files available from this source');
      return;
    }

    if (skippedCount > 0) {
      toast.info(`Skipped ${skippedCount} non-text subtitle file(s)`);
    }

    await importSubtitlePaths(textSubtitlePaths);
  }

  async function handleConfirmVersionImport(mode: ImportSelectionMode, selectedKeys: string[]) {
    if (!sourceDialogSourceId) {
      return;
    }

    const payload = toolImportStore.resolveImport({
      targetTool: 'translate',
      sourceId: sourceDialogSourceId,
      selectionMode: mode,
      selectedKeys,
    });

    const result = importSubtitleFiles(payload.subtitleFiles);
    if (result.imported > 0) {
      toast.success(`Imported ${result.imported} subtitle version(s)`);
    }
    if (result.imported === 0) {
      toast.info('No new subtitle versions to import');
    }
  }

  async function translateJob(job: TranslationJob) {
    const { provider, model, sourceLanguage, targetLanguage, batchCount } = translationStore.config;

    // Validate API key
    const apiKey = settingsStore.getLLMApiKey(provider);
    if (!apiKey) {
      translationStore.updateJob(job.id, {
        status: 'error',
        error: `No API key configured for ${provider}`
      });
      return;
    }

    if (!model) {
      translationStore.updateJob(job.id, {
        status: 'error',
        error: 'Please select a model'
      });
      return;
    }

    // Create abort controller for this job
    const abortController = new AbortController();
    translationStore.setJobAbortController(job.id, abortController);
    translationStore.updateJob(job.id, { status: 'translating', progress: 0 });

    try {
      const result = await translateSubtitle(
        job.file,
        provider,
        model,
        sourceLanguage,
        targetLanguage,
        (info: BatchProgressInfo | number) => {
          if (typeof info === 'number') {
            translationStore.updateJob(job.id, { progress: info });
          } else {
            translationStore.updateJob(job.id, {
              progress: info.progress,
              currentBatch: info.currentBatch,
              totalBatches: info.totalBatches
            });
          }
        },
        batchCount,
        abortController.signal
      );

      translationStore.updateJob(job.id, {
        result,
        status: result.success ? 'completed' : 'error',
        error: result.error,
        progress: 100
      });

      if (result.success) {
        log('success', 'translation',
          `Translated: ${job.file.name}`,
          `${translationStore.config.sourceLanguage} → ${translationStore.config.targetLanguage} (${batchCount} batch${batchCount > 1 ? 'es' : ''})`,
          { filePath: job.file.path, provider: translationStore.config.provider }
        );
        toast.success(`Translation completed: ${job.file.name}`);
      } else {
        const isCancelled = result.error?.toLowerCase().includes('cancel');
        if (isCancelled) {
          log('warning', 'translation',
            `Translation cancelled: ${job.file.name}`,
            'Cancelled by user',
            { filePath: job.file.path, provider: translationStore.config.provider }
          );
          // Toast already shown by handleCancelJob/handleCancelAll
        } else {
          log('error', 'translation',
            `Translation failed: ${job.file.name}`,
            result.error || 'Unknown error',
            { filePath: job.file.path, provider: translationStore.config.provider }
          );
          toast.error(result.error || 'Translation failed');
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      translationStore.updateJob(job.id, {
        status: 'error',
        error: errorMsg
      });
      logAndToast.error({
        source: 'translation',
        title: 'Translation failed',
        details: errorMsg,
        context: { filePath: job.file.path }
      });
    }
  }


  async function handleDownloadAll() {
    const completedJobs = translationStore.jobs.filter(j => j.status === 'completed' && j.result?.translatedContent);
    if (completedJobs.length === 0) {
      toast.warning('No translated files to download');
      return;
    }

    try {
      const selectedDir = await open({
        directory: true,
        multiple: false,
        title: 'Select Destination Folder'
      });

      if (!selectedDir || typeof selectedDir !== 'string') return;

      let savedCount = 0;
      const isWindows = navigator.userAgent.includes('Windows');
      const sep = isWindows ? '\\' : '/';

      for (const job of completedJobs) {
        if (!job.result?.translatedContent) continue;

        const extension = getSubtitleExtension(job.file.format);
        const baseName = job.file.name.replace(/\.[^/.]+$/, '');
        const targetLang = translationStore.config.targetLanguage;
        const fileName = `${baseName}.${targetLang}${extension}`;
        const filePath = `${selectedDir}${sep}${fileName}`;

        await writeTextFile(filePath, job.result.translatedContent);
        savedCount++;
      }

      toast.success(`Saved ${savedCount} files`);
    } catch (e) {
      logAndToast.error({
        source: 'translation',
        title: 'Failed to save files',
        details: e instanceof Error ? e.message : String(e)
      });
    }
  }

  async function handleTranslateAll() {
    const pendingJobs = translationStore.jobs.filter(j => j.status === 'pending' || j.status === 'error');

    if (pendingJobs.length === 0) {
      toast.warning('No files to translate');
      return;
    }

    translationStore.updateProgress({
      status: 'translating',
      currentFile: '',
      progress: 0,
      currentBatch: 0,
      totalBatches: 0
    });

    let i = 0;
    const activePromises = new Set<Promise<void>>();

    // We keep looping as long as there are pending jobs OR active translations
    while (i < pendingJobs.length || activePromises.size > 0) {
      // Check cancellation
      if ((translationStore.progress.status as string) === 'cancelled') {
        break;
      }

      // Dynamic batch size - read from settings every iteration
      const maxParallel = settingsStore.settings.translationSettings.maxParallelFiles;

      // Fill the pool with new jobs up to maxParallel
      while (activePromises.size < maxParallel && i < pendingJobs.length) {
        if ((translationStore.progress.status as string) === 'cancelled') break;

        const job = pendingJobs[i++];
        const promise = translateJob(job).finally(() => {
          activePromises.delete(promise);
        });

        activePromises.add(promise);
      }

      // If we have active jobs, wait for at least one to finish before checking again
      // This creates the "sliding window" effect
      if (activePromises.size > 0) {
        await Promise.race(activePromises);
      }
    }

    // Only set completed if not cancelled
    if ((translationStore.progress.status as string) !== 'cancelled') {
      translationStore.updateProgress({
        status: 'completed',
        progress: 100
      });
    }
  }


  function handleCancelAll() {
    translationStore.cancelAllJobs();
    toast.info('All translations cancelled');
  }

  function handleCancelJob(jobId: string) {
    translationStore.cancelJob(jobId);
    toast.info('Translation cancelled');
  }

  function handleRemoveJob(jobId: string) {
    translationStore.removeJob(jobId);
  }

  async function retryWithMoreBatches(job: TranslationJob) {
    // Double the batch count (minimum +1)
    const currentBatchCount = translationStore.config.batchCount;
    const newBatchCount = Math.max(currentBatchCount + 1, currentBatchCount * 2);

    // Temporarily set the higher batch count
    translationStore.setBatchCount(newBatchCount);

    toast.info(`Retrying with ${newBatchCount} batches...`);

    // Retry the job
    await translateJob(job);
  }

  async function handleSaveResult(job: TranslationJob) {
    if (!job.result?.translatedContent) return;

    try {
      const extension = getSubtitleExtension(job.file.format);
      const baseName = job.file.name.replace(/\.[^/.]+$/, '');
      const targetLang = translationStore.config.targetLanguage;
      const defaultFileName = `${baseName}.${targetLang}${extension}`;

      const savePath = await save({
        defaultPath: defaultFileName,
        filters: [{
          name: 'Subtitle files',
          extensions: [extension.replace('.', '')]
        }]
      });

      if (savePath) {
        await writeTextFile(savePath, job.result.translatedContent);
        toast.success('File saved successfully');
      }
    } catch (error) {
      logAndToast.error({
        source: 'translation',
        title: 'Failed to save file',
        details: error instanceof Error ? error.message : String(error),
        context: { filePath: job.file.path }
      });
    }
  }

  async function handleCopyToClipboard(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getStatusIcon(status: TranslationJob['status']) {
    switch (status) {
      case 'pending': return FileText;
      case 'translating': return Loader2;
      case 'completed': return Check;
      case 'error': return AlertCircle;
      case 'cancelled': return X;
      default: return FileText;
    }
  }

  function getStatusColor(status: TranslationJob['status']) {
    switch (status) {
      case 'pending': return 'text-muted-foreground';
      case 'translating': return 'text-primary animate-spin';
      case 'completed': return 'text-green-500';
      case 'error': return 'text-destructive';
      case 'cancelled': return 'text-orange-500';
      default: return 'text-muted-foreground';
    }
  }

  const hasFiles = $derived(translationStore.hasFiles);
  const isTranslating = $derived(translationStore.isTranslating);
  const canTranslate = $derived(
    hasFiles &&
    translationStore.config.model &&
    hasApiKey
  );
  const selectedJob = $derived(translationStore.selectedJob);

  // Global progress
  const totalJobs = $derived(translationStore.jobs.length);
  const completedJobsCount = $derived(translationStore.jobs.filter(j => j.status === 'completed').length);
  const globalProgressPercent = $derived(totalJobs === 0 ? 0 : (completedJobsCount / totalJobs) * 100);
</script>

<div class="flex flex-col h-full">
  <!-- Top Section: Config and File List -->
  <div class="flex border-b min-h-0 flex-1">
    <!-- Left Panel: File Import & Config -->
    <div class="flex-1 max-w-108 border-r flex flex-col min-h-0 p-4 gap-4 overflow-auto">
      <!-- File Section -->
      <Card.Root>
        <Card.Header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <FileText class="size-5 text-primary" />
              <Card.Title>Subtitle Files</Card.Title>
              {#if translationStore.jobs.length > 0}
                <Badge variant="secondary">{translationStore.jobs.length}</Badge>
              {/if}
            </div>

            <div class="flex items-center gap-2">
              {#if translationStore.jobs.length > 0}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onclick={() => { translationStore.removeAllJobs(); toast.info('All files cleared'); }}
                  disabled={isTranslating}
                  class="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 class="size-4" />
                  <span class="sr-only">Clear all</span>
                </Button>
              {/if}
              <ToolImportButton
                targetTool="translate"
                label="Import"
                variant="outline"
                onBrowse={handleImportClick}
                onSelectSource={handleImportFromSource}
                disabled={isTranslating}
              />
            </div>
          </div>
          {#if isTranslating || completedJobsCount > 0}
            <div class="mt-4 flex items-end gap-3">
              <div class="flex-1 space-y-1">
                <div class="flex justify-between text-xs text-muted-foreground">
                  <span>Total Progress</span>
                  <span>{Math.round(globalProgressPercent)}% ({completedJobsCount}/{totalJobs})</span>
                </div>
                <Progress value={globalProgressPercent} class="h-2" />
              </div>
              {#if completedJobsCount > 0 && !isTranslating}
                <Button variant="outline" size="sm" onclick={handleDownloadAll} disabled={isTranslating} class="h-8">
                  <Download class="size-4 mr-2" />
                  Download All
                </Button>
              {/if}
            </div>
          {/if}
        </Card.Header>
        <Card.Content class="p-2">
          {#if hasFiles}
            <div class="px-3">
              <div class="space-y-2">
                {#each translationStore.jobs as job (job.id)}
                  {@const StatusIcon = getStatusIcon(job.status)}
                  <FileItemCard
                    selected={selectedJob?.id === job.id}
                    class="bg-muted/50 hover:bg-muted"
                    onclick={() => translationStore.selectJob(job.id)}
                  >
                    {#snippet icon()}
                      <StatusIcon class="size-4 shrink-0 {getStatusColor(job.status)}" />
                    {/snippet}

                    {#snippet content()}
                      <p class="text-sm font-medium truncate">{job.file.name}</p>
                      <div class="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" class="text-xs uppercase">{job.file.format}</Badge>
                        {#if job.status === 'translating'}
                          <span>{job.progress}%</span>
                          {#if job.totalBatches > 1}
                            <span class="text-muted-foreground">
                              (Batch {job.currentBatch}/{job.totalBatches})
                            </span>
                          {/if}
                        {/if}
                      </div>
                      {#if job.status === 'translating'}
                        <Progress value={job.progress} class="h-1 mt-1" />
                      {/if}
                    {/snippet}

                    {#snippet actions()}
                      <div class="flex items-center gap-1">
                        {#if job.status === 'translating'}
                          <Button variant="ghost" size="icon" class="size-7" onclick={(e) => { e.stopPropagation(); handleCancelJob(job.id); }}>
                            <Square class="size-3" />
                          </Button>
                        {:else}
                          {#if job.status === 'error'}
                            <Button
                              variant="ghost"
                              size="icon"
                              class="size-7 hover:text-primary"
                              onclick={(e) => { e.stopPropagation(); translateJob(job); }}
                              disabled={isTranslating}
                              title="Retry"
                            >
                              <RotateCw class="size-3" />
                            </Button>
                          {/if}
                          <Button variant="ghost" size="icon" class="size-7" onclick={(e) => { e.stopPropagation(); handleRemoveJob(job.id); }} disabled={isTranslating}>
                            <X class="size-3" />
                          </Button>
                        {/if}
                      </div>
                    {/snippet}
                  </FileItemCard>
                {/each}
              </div>
            </div>
          {:else}
            <ImportDropZone
              icon={Languages}
              title="Drop subtitle files here"
              formats={SUBTITLE_FORMATS}
              onBrowse={handleImportClick}
              disabled={isTranslating}
            />
          {/if}
        </Card.Content>
      </Card.Root>

      <!-- Config Panel -->
      <TranslationConfigPanel onNavigateToSettings={onNavigateToSettings} />

      <!-- Batch Settings -->
      <Card.Root>
        <Card.Header class="pb-3">
          <Card.Title class="text-sm">Batch Settings</Card.Title>
        </Card.Header>
        <Card.Content class="space-y-3">
          <div class="space-y-2">
            <Label for="batch-count" class="text-xs">Number of batches</Label>
            <Input
              id="batch-count"
              type="number"
              min="1"
              max="20"
              value={translationStore.config.batchCount}
              oninput={(e) => translationStore.setBatchCount(parseInt(e.currentTarget.value) || 1)}
              class="h-8"
            />
            <p class="text-xs text-muted-foreground">
              Split file into N parts to avoid token limits (1 = no split)
            </p>
          </div>
        </Card.Content>
      </Card.Root>

      <!-- Action Buttons -->
      <div class="flex gap-2 mt-auto">
        {#if isTranslating}
          <Button variant="destructive" class="flex-1" onclick={handleCancelAll}>
            <Square class="size-4 mr-2" />
            Cancel All
          </Button>
        {:else}
          <Button
            size="lg"
            class="flex-1"
            onclick={handleTranslateAll}
            disabled={!canTranslate}
          >
            <Play class="size-4 mr-2" />
            Translate {translationStore.jobs.length > 1 ? `(${translationStore.jobs.length})` : ''}
          </Button>
        {/if}
      </div>
    </div>

    <!-- Right Panel: Comparison View -->
    <div class="flex-2 flex flex-col min-h-0 overflow-scroll">
      {#if selectedJob}
        <div class="p-4 border-b flex items-center justify-between">
          <div class="flex items-center gap-2">
            <FileText class="size-5 text-primary" />
            <h3 class="font-medium">{selectedJob.file.name}</h3>
            <Badge variant={selectedJob.status === 'completed' ? 'default' : selectedJob.status === 'error' ? 'destructive' : 'secondary'}>
              {selectedJob.status}
            </Badge>
          </div>
          {#if selectedJob.result?.translatedContent}
            <div class="flex gap-2">
              <Button variant="outline" size="sm" onclick={() => handleCopyToClipboard(selectedJob.result!.translatedContent)}>
                <Copy class="size-4 mr-2" />
                Copy
              </Button>
              <Button size="sm" onclick={() => handleSaveResult(selectedJob)}>
                <Download class="size-4 mr-2" />
                Save
              </Button>
            </div>
          {/if}
        </div>

        <Resizable.PaneGroup direction="horizontal" class="flex-1 min-h-0">
          <!-- Original Content -->
          <Resizable.Pane defaultSize={50} minSize={20}>
            <div class="h-full flex flex-col">
              <div class="p-2 bg-muted/30 border-b flex items-center justify-between">
                <span class="text-sm font-medium">Original</span>
                <span class="text-xs text-muted-foreground">
                  {selectedJob.file.content.split('\n').length} lines
                  {#if tokenCount() !== null}
                    · ~{tokenCount()?.toLocaleString()} tokens
                  {:else if isCountingTokens}
                    · <Loader2 class="size-3 animate-spin inline" />
                  {/if}
                </span>
              </div>
              <div class="flex-1 overflow-y-scroll">
                <pre class="p-4 text-sm whitespace-pre-wrap font-mono">{selectedJob.file.content}</pre>
              </div>
            </div>
          </Resizable.Pane>

          <Resizable.Handle withHandle />

          <!-- Translated Content -->
          <Resizable.Pane defaultSize={50} minSize={20}>
            <div class="h-full flex flex-col">
              <div class="p-2 bg-muted/30 border-b flex items-center justify-between">
                <span class="text-sm font-medium">Translation</span>
                <span class="text-xs text-muted-foreground">
                  {#if selectedJob.result?.translatedContent}
                    {selectedJob.result.translatedContent.split('\n').length} lines
                  {/if}
                  {#if selectedJob.result?.usage}
                    <Tooltip.Root>
                      <Tooltip.Trigger>· {selectedJob.result.usage.totalTokens.toLocaleString()} tokens</Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>
                          {selectedJob.result.usage.promptTokens.toLocaleString()} in / {selectedJob.result.usage.completionTokens.toLocaleString()} out
                        </span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  {/if}
                </span>
              </div>
              <div class="flex-1 overflow-y-scroll">
                {#if selectedJob.status === 'translating'}
                  <div class="flex flex-col items-center justify-center h-full p-8 gap-4">
                    <Loader2 class="size-8 text-primary animate-spin" />
                    <div class="text-center">
                      <p class="font-medium">Translating...</p>
                      <p class="text-sm text-muted-foreground">
                        {selectedJob.progress}%
                        {#if selectedJob.totalBatches > 1}
                          - Batch {selectedJob.currentBatch}/{selectedJob.totalBatches}
                        {/if}
                      </p>
                    </div>
                    <Progress value={selectedJob.progress} class="w-48" />
                  </div>
                {:else if selectedJob.result?.translatedContent}
                  <Textarea
                    class="w-full h-full p-4 resize-none font-mono text-sm border-0 focus-visible:ring-0 rounded-none bg-transparent"
                    value={selectedJob.result.translatedContent}
                    oninput={(e) => {
                      if (selectedJob && selectedJob.result) {
                        translationStore.updateJob(selectedJob.id, {
                          result: { ...selectedJob.result, translatedContent: e.currentTarget.value }
                        });
                      }
                    }}
                  />
                {:else if selectedJob.status === 'error'}
                  <div class="flex flex-col items-center justify-center h-full p-8 gap-4">
                    <AlertCircle class="size-8 text-destructive" />
                    <div class="text-center">
                      <p class="font-medium text-destructive">Translation failed</p>
                      <p class="text-sm text-muted-foreground mt-2">{selectedJob.error}</p>
                    </div>
                    {#if selectedJob.result?.truncated}
                      <div class="flex flex-col items-center gap-2 mt-2">
                        <p class="text-xs text-muted-foreground">Response was truncated due to token limits</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onclick={() => retryWithMoreBatches(selectedJob)}
                          disabled={isTranslating}
                        >
                          <RotateCw class="size-4 mr-2" />
                          Retry with more batches
                        </Button>
                      </div>
                    {/if}
                  </div>
                {:else if selectedJob.status === 'cancelled'}
                  <div class="flex flex-col items-center justify-center h-full p-8 gap-4">
                    <X class="size-8 text-orange-500" />
                    <p class="font-medium text-orange-500">Translation cancelled</p>
                  </div>
                {:else}
                  <div class="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground">
                    <Languages class="size-8 mb-4" />
                    <p>Click "Translate" to start</p>
                  </div>
                {/if}
              </div>
            </div>
          </Resizable.Pane>
        </Resizable.PaneGroup>
      {:else}
        <div class="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground p-8">
          <Languages class="size-12 mb-4" />
          <p class="text-lg font-medium">No file selected</p>
          <p class="text-sm">Import subtitle files to get started</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<ToolImportSourceDialog
  bind:open={sourceDialogOpen}
  onOpenChange={(open) => {
    sourceDialogOpen = open;
    if (!open) {
      sourceDialogSourceId = null;
      sourceDialogItems = [];
      sourceDialogLabel = '';
    }
  }}
  sourceLabel={sourceDialogLabel}
  items={sourceDialogItems}
  onConfirm={handleConfirmVersionImport}
/>
