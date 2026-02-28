<script lang="ts" module>
  import { Play, Trash2, FileText, Languages, X, Square, AlertCircle, Copy, Loader2, RotateCw } from '@lucide/svelte';
  export interface TranslationViewApi {
    handleFileDrop: (paths: string[]) => Promise<void>;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { readTextFile } from '@tauri-apps/plugin-fs';
  import { toast } from 'svelte-sonner';

  import { settingsStore, toolImportStore, translationStore } from '$lib/stores';
  import { translateSubtitle, translateSubtitleMultiModel, detectSubtitleFormat, buildFullPromptForTokenCount, type BatchProgressInfo } from '$lib/services/translation';
  import { countTokens } from '$lib/services/tokenizer';
  import {
    createTranslationVersion,
    generateTranslationVersionName,
    addTranslationVersion as persistTranslationVersion,
    removeTranslationVersion as removePersistedTranslationVersion,
    loadTranslationData,
    saveTranslationData,
  } from '$lib/services/translation-storage';
  import { logAndToast, log } from '$lib/utils/log-toast';
  import type {
    LanguageCode,
    LLMProvider,
    ModelJob,
    SubtitleFile,
    TranslationJob,
    TranslationModelSelection,
  } from '$lib/types';
  import { LLM_PROVIDERS, SUPPORTED_LANGUAGES } from '$lib/types';
  import type { ImportSelectionMode, ImportSourceId, VersionedImportItem } from '$lib/types/tool-import';

  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import { Progress } from '$lib/components/ui/progress';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Resizable from '$lib/components/ui/resizable';
  import * as Select from '$lib/components/ui/select';
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { ImportDropZone } from '$lib/components/ui/import-drop-zone';
  import { ToolImportButton, ToolImportSourceDialog } from '$lib/components/shared';

  import {
    TranslationConfigPanel,
    TranslationFileList,
    TranslationRetryDialog,
    TranslationResultDialog,
  } from '$lib/components/translation';

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

      // Load persisted translation versions if any
      const existingData = await loadTranslationData(path);
      if (existingData && existingData.translationVersions.length > 0) {
        const job = translationStore.jobs.find(j => j.file.path === path);
        if (job) {
          translationStore.setTranslationVersions(job.id, existingData.translationVersions);
        }
      }

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

  async function importSubtitleFiles(files: SubtitleFile[]) {
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

      // Load persisted translation versions if any
      const existingData = await loadTranslationData(file.path);
      if (existingData && existingData.translationVersions.length > 0) {
        const job = translationStore.jobs.find(j => j.file.path === file.path);
        if (job) {
          translationStore.setTranslationVersions(job.id, existingData.translationVersions);
        }
      }
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

    const result = await importSubtitleFiles(payload.subtitleFiles);
    if (result.imported > 0) {
      toast.success(`Imported ${result.imported} subtitle version(s)`);
    }
    if (result.imported === 0) {
      toast.info('No new subtitle versions to import');
    }
  }

  /** Get a display name for a model (e.g. "GPT-5", "Claude 4 Sonnet") */
  function getModelDisplayName(provider: string, model: string): string {
    const providerConfig = LLM_PROVIDERS[provider as keyof typeof LLM_PROVIDERS];
    if (!providerConfig) return model;
    const found = providerConfig.models.find(m => m.id === model);
    return found?.name || model;
  }

  function createRunId(jobId: string): string {
    return `${jobId}_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function createModelJobId(runId: string, index: number): string {
    return `${runId}_model_${index}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function isRunActive(jobId: string, runId: string): boolean {
    return translationStore.isRunActive(jobId, runId);
  }

  function getModelJob(jobId: string, modelJobId: string): ModelJob | undefined {
    return translationStore.jobs
      .find(j => j.id === jobId)
      ?.modelJobs?.find(mj => mj.id === modelJobId);
  }

  function isPrimaryRetryableStatus(status: TranslationJob['status']): boolean {
    return status === 'pending' || status === 'error' || status === 'cancelled';
  }

  function selectTranslateAllTargets(jobs: TranslationJob[]): TranslationJob[] {
    const primaryTargets = jobs.filter((job) => isPrimaryRetryableStatus(job.status));
    if (primaryTargets.length > 0) {
      return primaryTargets;
    }

    return jobs.filter((job) => job.status === 'completed');
  }

  interface TranslationRunConfig {
    provider: LLMProvider;
    model: string;
    sourceLanguage: LanguageCode;
    targetLanguage: LanguageCode;
    batchCount: number;
    models: TranslationModelSelection[];
  }

  interface TranslationRetryConfirmPayload {
    versionName: string;
    provider: LLMProvider;
    model: string;
    sourceLanguage: LanguageCode;
    targetLanguage: LanguageCode;
    batchCount: number;
    models: TranslationModelSelection[];
  }

  function createRunConfig(overrides?: Partial<TranslationRunConfig>): TranslationRunConfig {
    const models = (overrides?.models ?? translationStore.config.models).map((entry) => ({ ...entry }));
    return {
      provider: overrides?.provider ?? translationStore.config.provider,
      model: overrides?.model ?? translationStore.config.model,
      sourceLanguage: overrides?.sourceLanguage ?? translationStore.config.sourceLanguage,
      targetLanguage: overrides?.targetLanguage ?? translationStore.config.targetLanguage,
      batchCount: Math.max(1, overrides?.batchCount ?? translationStore.config.batchCount),
      models,
    };
  }

  /** Translate a single file with a single model (existing flow) */
  async function translateJobSingleModel(
    job: TranslationJob,
    runConfig: TranslationRunConfig,
    versionNameOverride?: string,
  ) {
    const { provider, model, sourceLanguage, targetLanguage, batchCount } = runConfig;
    const runId = createRunId(job.id);

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

    translationStore.startRun(job.id, runId);

    // Create abort controller for this job
    const abortController = new AbortController();
    translationStore.setJobAbortControllerIfActive(job.id, runId, abortController);
    if (!isRunActive(job.id, runId)) {
      log('info', 'translation', 'Late response dropped',
        'Single-model dispatch skipped after run invalidation',
        { filePath: job.file.path, provider, jobId: job.id, runId }
      );
      return;
    }
    translationStore.updateJobIfActive(job.id, runId, {
      status: 'translating',
      progress: 0,
      currentBatch: 0,
      totalBatches: 0,
      error: undefined,
    });

    log('info', 'translation', 'Translation run started',
      `${sourceLanguage} → ${targetLanguage} (${batchCount} batch${batchCount > 1 ? 'es' : ''})`,
      { filePath: job.file.path, provider, jobId: job.id, runId }
    );

    try {
      const result = await translateSubtitle(
        job.file,
        provider,
        model,
        sourceLanguage,
        targetLanguage,
        {
          onProgress: (info: BatchProgressInfo | number) => {
            if (typeof info === 'number') {
              translationStore.updateJobIfActive(job.id, runId, { progress: info });
            } else {
              translationStore.updateJobIfActive(job.id, runId, {
                progress: info.progress,
                currentBatch: info.currentBatch,
                totalBatches: info.totalBatches
              });
            }
          },
          batchCount,
          signal: abortController.signal,
          runId,
          batchConcurrency: 2,
        }
      );

      if (!isRunActive(job.id, runId)) {
        log('info', 'translation', 'Late response dropped',
          'Single-model result ignored after run invalidation',
          { filePath: job.file.path, provider, jobId: job.id, runId }
        );
        return;
      }

      if (result.success) {
        translationStore.updateJobIfActive(job.id, runId, {
          result,
          status: 'completed',
          error: result.error,
          progress: 100
        });

        if (!isRunActive(job.id, runId)) {
          log('info', 'translation', 'Late response dropped',
            'Single-model success side-effects skipped after run invalidation',
            { filePath: job.file.path, provider, jobId: job.id, runId }
          );
          return;
        }

        log('success', 'translation',
          `Translated: ${job.file.name}`,
          `${sourceLanguage} → ${targetLanguage} (${batchCount} batch${batchCount > 1 ? 'es' : ''})`,
          { filePath: job.file.path, provider, jobId: job.id, runId }
        );
        toast.success(`Translation completed: ${job.file.name}`);

        // Create and persist a translation version only while run is still active.
        if (!isRunActive(job.id, runId)) {
          log('info', 'translation', 'Late response dropped',
            'Version creation skipped after run invalidation',
            { filePath: job.file.path, provider, jobId: job.id, runId }
          );
          return;
        }

        const existingVersions = translationStore.selectedJob?.id === job.id
          ? (translationStore.selectedJob?.translationVersions ?? [])
          : (translationStore.jobs.find(j => j.id === job.id)?.translationVersions ?? []);
        const versionName = versionNameOverride?.trim() || generateTranslationVersionName(existingVersions);
        const version = createTranslationVersion(
          versionName,
          provider,
          model,
          sourceLanguage,
          targetLanguage,
          batchCount,
          result.translatedContent,
          result.usage,
          result.truncated,
        );

        translationStore.addTranslationVersion(job.id, version);

        if (!isRunActive(job.id, runId)) {
          log('info', 'translation', 'Late response dropped',
            'Version persistence skipped after run invalidation',
            { filePath: job.file.path, provider, jobId: job.id, runId }
          );
          return;
        }

        const persisted = await persistTranslationVersion(job.file.path, version);
        if (!persisted) {
          log('warning', 'translation', 'Translation version not persisted',
            'Version is available in memory only for this session',
            { filePath: job.file.path, provider, jobId: job.id, runId }
          );
        }
      } else {
        const isCancelled = result.error?.toLowerCase().includes('cancel');
        if (isCancelled) {
          translationStore.updateJobIfActive(job.id, runId, {
            status: 'cancelled',
            error: 'Cancelled by user',
          });
          log('warning', 'translation',
            `Translation cancelled: ${job.file.name}`,
            'Cancelled by user',
            { filePath: job.file.path, provider, jobId: job.id, runId }
          );
          // Toast already shown by handleCancelJob/handleCancelAll
        } else {
          translationStore.updateJobIfActive(job.id, runId, {
            result,
            status: 'error',
            error: result.error,
          });

          if (!isRunActive(job.id, runId)) {
            log('info', 'translation', 'Late response dropped',
              'Single-model error side-effects skipped after run invalidation',
              { filePath: job.file.path, provider, jobId: job.id, runId }
            );
            return;
          }

          log('error', 'translation',
            `Translation failed: ${job.file.name}`,
            result.error || 'Unknown error',
            { filePath: job.file.path, provider, jobId: job.id, runId }
          );
          toast.error(result.error || 'Translation failed');
        }
      }
    } catch (error) {
      if (!isRunActive(job.id, runId)) {
        log('info', 'translation', 'Late response dropped',
          'Single-model exception ignored after run invalidation',
          { filePath: job.file.path, provider, jobId: job.id, runId }
        );
        return;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        translationStore.updateJobIfActive(job.id, runId, {
          status: 'cancelled',
          error: 'Cancelled by user',
        });
        return;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      translationStore.updateJobIfActive(job.id, runId, {
        status: 'error',
        error: errorMsg
      });

      if (!isRunActive(job.id, runId)) {
        log('info', 'translation', 'Late response dropped',
          'Single-model exception side-effects skipped after run invalidation',
          { filePath: job.file.path, provider, jobId: job.id, runId }
        );
        return;
      }

      logAndToast.error({
        source: 'translation',
        title: 'Translation failed',
        details: errorMsg,
        context: { filePath: job.file.path, provider, jobId: job.id, runId }
      });
    }
  }

  /** Translate a single file with multiple models in parallel */
  async function translateJobMultiModel(
    job: TranslationJob,
    runConfig: TranslationRunConfig,
    versionNamePrefix?: string,
  ) {
    const { models, sourceLanguage, targetLanguage, batchCount } = runConfig;
    const runId = createRunId(job.id);

    // Validate API keys for all models
    for (const entry of models) {
      const apiKey = settingsStore.getLLMApiKey(entry.provider);
      if (!apiKey) {
        translationStore.updateJob(job.id, {
          status: 'error',
          error: `No API key configured for ${entry.provider}`
        });
        return;
      }
    }

    translationStore.startRun(job.id, runId);

    // Create AbortControllers and ModelJob entries for each model
    const signalByModelJobId = new Map<string, AbortSignal>();
    const initialModelJobs: ModelJob[] = models.map((entry, index) => {
      const modelJobId = createModelJobId(runId, index);
      const controller = new AbortController();
      signalByModelJobId.set(modelJobId, controller.signal);
      return {
        id: modelJobId,
        provider: entry.provider,
        model: entry.model,
        status: 'pending' as const,
        progress: 0,
        currentBatch: 0,
        totalBatches: 0,
        abortController: controller,
      };
    });

    // Set model jobs and mark the file as translating
    translationStore.setModelJobsIfActive(job.id, runId, initialModelJobs);
    if (!isRunActive(job.id, runId)) {
      log('info', 'translation', 'Late response dropped',
        'Multi-model dispatch skipped after run invalidation',
        { filePath: job.file.path, jobId: job.id, runId }
      );
      return;
    }
    translationStore.updateJobIfActive(job.id, runId, {
      status: 'translating',
      progress: 0,
      currentBatch: 0,
      totalBatches: 0,
      error: undefined,
    });

    log('info', 'translation', 'Translation run started',
      `${sourceLanguage} → ${targetLanguage} (${models.length} models)`,
      { filePath: job.file.path, jobId: job.id, runId }
    );

    await translateSubtitleMultiModel(
      job.file,
      initialModelJobs.map(modelJob => ({
        modelJobId: modelJob.id,
        provider: modelJob.provider,
        model: modelJob.model,
      })),
      sourceLanguage,
      targetLanguage,
      {
        batchCount,
        runId,
        batchConcurrency: 2,
        signalByModelJobId,

        // onModelProgress
        onModelProgress: (modelJobId: string, info: BatchProgressInfo | number) => {
          if (!isRunActive(job.id, runId)) return;

          if (typeof info === 'number') {
            translationStore.updateModelJobIfActive(job.id, runId, modelJobId, {
              status: 'translating',
              progress: info,
            });
          } else {
            translationStore.updateModelJobIfActive(job.id, runId, modelJobId, {
              status: 'translating',
              progress: info.progress,
              currentBatch: info.currentBatch,
              totalBatches: info.totalBatches,
            });
          }

          // Derive aggregate progress: average of all model progresses
          const currentJob = translationStore.jobs.find(j => j.id === job.id);
          if (currentJob?.modelJobs && currentJob.modelJobs.length > 0) {
            const avgProgress = Math.round(
              currentJob.modelJobs.reduce((sum, mj) => sum + mj.progress, 0) / currentJob.modelJobs.length
            );
            translationStore.updateJobIfActive(job.id, runId, { progress: avgProgress });
          }
        },

        // onModelComplete — create a version immediately for each completed model
        onModelComplete: async (modelJobId: string, result) => {
          if (!isRunActive(job.id, runId)) {
            log('info', 'translation', 'Late response dropped',
              'Model completion ignored after run invalidation',
              { filePath: job.file.path, jobId: job.id, runId, modelJobId }
            );
            return;
          }

          const modelJob = getModelJob(job.id, modelJobId);
          if (!modelJob) return;

          translationStore.updateModelJobIfActive(job.id, runId, modelJobId, {
            status: 'completed',
            progress: 100,
            result,
          });

          const provider = modelJob.provider;
          const model = modelJob.model;
          const modelDisplayName = getModelDisplayName(provider, model);
          const targetLangName = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage)?.name ?? targetLanguage;
          const cleanPrefix = versionNamePrefix?.trim();
          const versionName = cleanPrefix
            ? `${cleanPrefix} - ${modelDisplayName}`
            : `${modelDisplayName} - ${targetLangName}`;

          if (!isRunActive(job.id, runId)) {
            log('info', 'translation', 'Late response dropped',
              'Version creation skipped after run invalidation',
              { filePath: job.file.path, provider, jobId: job.id, runId, modelJobId }
            );
            return;
          }

          const version = createTranslationVersion(
            versionName,
            provider,
            model,
            sourceLanguage,
            targetLanguage,
            batchCount,
            result.translatedContent,
            result.usage,
            result.truncated,
          );
          translationStore.addTranslationVersion(job.id, version);

          if (!isRunActive(job.id, runId)) {
            log('info', 'translation', 'Late response dropped',
              'Version persistence skipped after run invalidation',
              { filePath: job.file.path, provider, jobId: job.id, runId, modelJobId }
            );
            return;
          }

          const persisted = await persistTranslationVersion(job.file.path, version);
          if (!persisted) {
            log('warning', 'translation', 'Translation version not persisted',
              'Version is available in memory only for this session',
              { filePath: job.file.path, provider, jobId: job.id, runId, modelJobId }
            );
          }

          if (!isRunActive(job.id, runId)) {
            log('info', 'translation', 'Late response dropped',
              'Model success side-effects skipped after run invalidation',
              { filePath: job.file.path, provider, jobId: job.id, runId, modelJobId }
            );
            return;
          }

          log('success', 'translation',
            `Model completed: ${modelDisplayName}`,
            `${sourceLanguage} → ${targetLanguage} for ${job.file.name}`,
            { filePath: job.file.path, provider, jobId: job.id, runId, modelJobId }
          );
          toast.success(`${modelDisplayName} completed: ${job.file.name}`);
        },

        // onModelError
        onModelError: (modelJobId: string, error: Error) => {
          if (!isRunActive(job.id, runId)) {
            log('info', 'translation', 'Late response dropped',
              'Model error ignored after run invalidation',
              { filePath: job.file.path, jobId: job.id, runId, modelJobId }
            );
            return;
          }

          const modelJob = getModelJob(job.id, modelJobId);
          if (!modelJob) return;

          translationStore.updateModelJobIfActive(job.id, runId, modelJobId, {
            status: 'error',
            error: error.message,
          });

          if (!isRunActive(job.id, runId)) {
            log('info', 'translation', 'Late response dropped',
              'Model error side-effects skipped after run invalidation',
              { filePath: job.file.path, jobId: job.id, runId, modelJobId }
            );
            return;
          }

          const modelDisplayName = getModelDisplayName(modelJob.provider, modelJob.model);
          log('error', 'translation',
            `Model failed: ${modelDisplayName}`,
            error.message,
            {
              filePath: job.file.path,
              provider: modelJob.provider,
              jobId: job.id,
              runId,
              modelJobId,
            }
          );
          toast.error(`${modelDisplayName} failed: ${error.message}`);
        },
      }
    );

    if (!isRunActive(job.id, runId)) {
      log('info', 'translation', 'Late response dropped',
        'Multi-model finalization ignored after run invalidation',
        { filePath: job.file.path, jobId: job.id, runId }
      );
      return;
    }

    // After all models settled, derive final aggregate status
    const currentJob = translationStore.jobs.find(j => j.id === job.id);
    if (currentJob?.modelJobs) {
      const allCancelled = currentJob.modelJobs.every(mj => mj.status === 'cancelled');
      const anyCompleted = currentJob.modelJobs.some(mj => mj.status === 'completed');
      const allSettled = currentJob.modelJobs.every(mj =>
        mj.status === 'completed' || mj.status === 'error' || mj.status === 'cancelled'
      );

      if (allSettled) {
        if (allCancelled) {
          translationStore.updateJobIfActive(job.id, runId, { status: 'cancelled', error: 'Cancelled by user' });
        } else if (anyCompleted) {
          translationStore.updateJobIfActive(job.id, runId, { status: 'completed', progress: 100 });
        } else {
          translationStore.updateJobIfActive(job.id, runId, { status: 'error', error: 'All models failed' });
        }
      }
    }
  }

  /** Dispatch to single-model or multi-model based on config */
  async function translateJobInternal(
    job: TranslationJob,
    runConfig: TranslationRunConfig,
    versionNameOverride?: string,
  ) {
    const { models } = runConfig;
    if (models.length > 0) {
      await translateJobMultiModel(job, runConfig, versionNameOverride);
    } else {
      await translateJobSingleModel(job, runConfig, versionNameOverride);
    }
  }

  async function translateScopedJob(
    job: TranslationJob,
    runConfig: TranslationRunConfig = createRunConfig(),
    versionNameOverride?: string,
  ) {
    translationStore.updateJob(job.id, {
      status: 'pending',
      progress: 0,
      currentBatch: 0,
      totalBatches: 0,
      error: undefined,
      activeRunId: null,
      abortController: undefined,
      modelJobs: undefined,
    });

    translationStore.setActiveScopeJobIds([job.id]);
    try {
      await translateJobInternal(job, runConfig, versionNameOverride);
    } finally {
      translationStore.clearActiveScopeJobIds();
    }
  }

  async function handleTranslateAll() {
    const targets = [...translateAllTargets];
    if (targets.length === 0) {
      toast.warning('No files to translate');
      return;
    }
    const runConfig = createRunConfig();

    for (const target of targets) {
      translationStore.updateJob(target.id, {
        status: 'pending',
        progress: 0,
        currentBatch: 0,
        totalBatches: 0,
        error: undefined,
        activeRunId: null,
        abortController: undefined,
        modelJobs: undefined,
      });
    }

    translationStore.setActiveScopeJobIds(targets.map((job) => job.id));
    translationStore.updateProgress({
      status: 'translating',
      currentFile: '',
      progress: 0,
      currentBatch: 0,
      totalBatches: 0
    });

    try {
      const maxParallel = Math.max(1, settingsStore.settings.translationSettings.maxParallelFiles);
      const queue = targets.map((job) => job.id);
      const activePromises = new Map<string, Promise<void>>();

      // Process a fixed snapshot of target IDs to avoid rerunning jobs in the same click.
      while (queue.length > 0 || activePromises.size > 0) {
        if ((translationStore.progress.status as string) === 'cancelled') {
          break;
        }

        while (activePromises.size < maxParallel && queue.length > 0) {
          if ((translationStore.progress.status as string) === 'cancelled') break;

          const jobId = queue.shift();
          if (!jobId) break;

          const job = translationStore.jobs.find((entry) => entry.id === jobId);
          if (!job) {
            continue;
          }

          const promise = translateJobInternal(job, runConfig).finally(() => {
            activePromises.delete(jobId);
          });
          activePromises.set(jobId, promise);
        }

        if (activePromises.size === 0) {
          // Yield to avoid a tight loop when remaining queued IDs were removed.
          await Promise.resolve();
          continue;
        }

        await Promise.race([...activePromises.values()]);
      }

      // Only set completed if not cancelled
      if ((translationStore.progress.status as string) !== 'cancelled') {
        translationStore.updateProgress({
          status: 'completed',
          progress: 100
        });
      }
    } finally {
      translationStore.clearActiveScopeJobIds();
    }
  }
  function handleCancelAll() {
    const cancellableJobs = translationStore.jobs.filter(
      j => j.status === 'translating' || j.status === 'pending'
    );

    for (const job of cancellableJobs) {
      log('info', 'translation', 'Cancel requested',
        'Cancel all requested by user',
        {
          filePath: job.file.path,
          provider: translationStore.config.provider,
          jobId: job.id,
          runId: job.activeRunId ?? 'none',
        }
      );
    }

    translationStore.cancelAllJobs();

    log('info', 'translation', 'Abort propagated',
      `Cancelled ${cancellableJobs.length} job(s)`,
      { provider: translationStore.config.provider }
    );

    toast.info('All translations cancelled');
  }

  function handleCancelJob(jobId: string) {
    const job = translationStore.jobs.find(j => j.id === jobId);
    if (job) {
      log('info', 'translation', 'Cancel requested',
        'Single-job cancel requested by user',
        {
          filePath: job.file.path,
          provider: translationStore.config.provider,
          jobId,
          runId: job.activeRunId ?? 'none',
        }
      );
    }

    translationStore.cancelJob(jobId);

    if (job) {
      log('info', 'translation', 'Abort propagated',
        'Single-job cancellation propagated to controllers',
        {
          filePath: job.file.path,
          provider: translationStore.config.provider,
          jobId,
          runId: job.activeRunId ?? 'none',
        }
      );
    }

    toast.info('Translation cancelled');
  }

  // Safe removal state
  let removeDialogOpen = $state(false);
  let removeTarget = $state.raw<{ mode: 'single'; jobId: string } | { mode: 'all' } | null>(null);

  function handleRequestRemoveJob(jobId: string) {
    const job = translationStore.jobs.find(j => j.id === jobId);
    if (!job) return;

    if (job.status !== 'translating') {
      translationStore.removeJob(jobId);
      return;
    }

    removeTarget = { mode: 'single', jobId };
    removeDialogOpen = true;
  }

  function handleRequestRemoveAll() {
    const hasActive = translationStore.jobs.some(j => j.status === 'translating');
    if (!hasActive) {
      translationStore.removeAllJobs();
      toast.info('All files cleared');
      return;
    }

    removeTarget = { mode: 'all' };
    removeDialogOpen = true;
  }

  function handleConfirmRemove() {
    const target = removeTarget;
    if (!target) return;

    removeDialogOpen = false;

    if (target.mode === 'single') {
      translationStore.cancelJob(target.jobId);
      translationStore.removeJob(target.jobId);
    } else {
      translationStore.cancelAllJobs();
      translationStore.removeAllJobs();
    }

    removeTarget = null;
  }

  let retryDialogOpen = $state(false);
  let retryDialogJobId = $state<string | null>(null);
  const retryDialogJob = $derived(
    retryDialogJobId ? translationStore.jobs.find((job) => job.id === retryDialogJobId) ?? null : null
  );

  function handleRetryRequest(job: TranslationJob): void {
    retryDialogJobId = job.id;
    retryDialogOpen = true;
  }

  async function handleRetryConfirm(opts: TranslationRetryConfirmPayload): Promise<void> {
    if (!retryDialogJobId) {
      return;
    }

    const retryJob = translationStore.jobs.find((job) => job.id === retryDialogJobId);
    if (!retryJob) {
      return;
    }

    const runConfig = createRunConfig({
      provider: opts.provider,
      model: opts.model,
      sourceLanguage: opts.sourceLanguage,
      targetLanguage: opts.targetLanguage,
      batchCount: opts.batchCount,
      models: opts.models,
    });

    await translateScopedJob(retryJob, runConfig, opts.versionName);
  }

  async function retryWithMoreBatches(job: TranslationJob) {
    // Double the batch count (minimum +1)
    const currentBatchCount = translationStore.config.batchCount;
    const newBatchCount = Math.max(currentBatchCount + 1, currentBatchCount * 2);

    toast.info(`Retrying with ${newBatchCount} batches...`);

    const runConfig = createRunConfig({ batchCount: newBatchCount });
    await translateScopedJob(job, runConfig);
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

  const translateAllTargets = $derived(selectTranslateAllTargets(translationStore.jobs));
  const translateAllTargetCount = $derived(translateAllTargets.length);
  const hasFiles = $derived(translationStore.hasFiles);
  const isTranslating = $derived(translationStore.isTranslating);
  const canTranslate = $derived(
    hasFiles &&
    translateAllTargetCount > 0 &&
    translationStore.config.model &&
    hasApiKey
  );
  const selectedJob = $derived(translationStore.selectedJob);

  // Active version for the selected job
  const selectedJobVersions = $derived(selectedJob?.translationVersions ?? []);
  const activeVersionId = $derived(selectedJob?.activeVersionId ?? null);
  const activeVersion = $derived(
    activeVersionId ? selectedJobVersions.find(v => v.id === activeVersionId) ?? null : null
  );
  // Content to display in the right panel: prefer active version, fall back to result
  const displayedContent = $derived(activeVersion?.translatedContent ?? selectedJob?.result?.translatedContent ?? '');

  // Debounced persistence for version edits
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  function debouncedPersistVersionEdit(jobId: string, versionId: string, content: string): void {
    // Update store immediately
    translationStore.updateVersionContent(jobId, versionId, content);

    // Debounce the disk write
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      const job = translationStore.jobs.find(j => j.id === jobId);
      if (!job) return;
      await saveTranslationData(job.file.path, {
        version: 1,
        filePath: job.file.path,
        translationVersions: job.translationVersions,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }, 500);
  }

  // Result dialog state
  let resultDialogOpen = $state(false);
  let resultDialogJobId = $state<string | null>(null);
  const resultDialogJob = $derived(resultDialogJobId ? translationStore.jobs.find(j => j.id === resultDialogJobId) ?? null : null);

  function openResultDialog(jobId: string): void {
    resultDialogJobId = jobId;
    resultDialogOpen = true;
  }

  async function handleDeleteTranslationVersion(versionId: string): Promise<void> {
    if (!resultDialogJob) return;
    const jobId = resultDialogJob.id;
    const filePath = resultDialogJob.file.path;

    // Remove from store (also switches active version to most recent remaining)
    translationStore.removeTranslationVersion(jobId, versionId);

    // Persist removal to disk
    const result = await removePersistedTranslationVersion(filePath, versionId);
    if (!result) {
      log('warning', 'translation', 'Version removal not persisted',
        'Disk sync failed, but version was removed from current session',
        { filePath }
      );
    }
  }
</script>

<div class="flex flex-col h-full">
  <!-- Top Section: Config and File List -->
  <div class="flex min-h-0 flex-1">
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
                  onclick={handleRequestRemoveAll}
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
        </Card.Header>
        <Card.Content class="p-2">
          {#if hasFiles}
            <div class="px-3">
              <TranslationFileList
                jobs={translationStore.jobs}
                selectedId={selectedJob?.id ?? null}
                onSelect={(id) => translationStore.selectJob(id)}
                onRemove={handleRequestRemoveJob}
                onCancel={handleCancelJob}
                onViewResult={(job) => openResultDialog(job.id)}
                onRetry={handleRetryRequest}
                disabled={isTranslating}
              />
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
            Translate ({translateAllTargetCount})
          </Button>
        {/if}
      </div>
    </div>

    <!-- Right Panel: Comparison View -->
    <div class="flex-2 flex flex-col min-h-0 overflow-scroll">
      {#if selectedJob}
        <div class="p-4 border-b flex items-center justify-between">
          <div class="flex items-center gap-2 min-w-0">
            <FileText class="size-5 text-primary shrink-0" />
            <h3 class="font-medium truncate">{selectedJob.file.name}</h3>
            <Badge variant={selectedJob.status === 'completed' ? 'default' : selectedJob.status === 'error' ? 'destructive' : 'secondary'}>
              {selectedJob.status}
            </Badge>
            {#if selectedJobVersions.length > 1}
              <Select.Root
                type="single"
                value={activeVersionId ?? undefined}
                onValueChange={(v) => {
                  if (selectedJob && v) {
                    translationStore.setActiveVersion(selectedJob.id, v);
                  }
                }}
              >
                <Select.Trigger class="h-7 text-xs w-auto min-w-[120px]">
                  {activeVersion?.name ?? 'Select version'}
                </Select.Trigger>
                <Select.Content>
                  {#each selectedJobVersions as version (version.id)}
                    <Select.Item value={version.id}>{version.name}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            {/if}
          </div>
          {#if displayedContent}
            <div class="flex gap-2 shrink-0">
              <Button
                variant="outline"
                size="icon-sm"
                onclick={() => handleCopyToClipboard(displayedContent)}
                title="Copy translation"
                aria-label="Copy translation"
              >
                <Copy class="size-4" />
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
                <span class="text-sm font-medium">
                  Translation
                  {#if activeVersion}
                    <span class="text-xs text-muted-foreground ml-1">({activeVersion.name})</span>
                  {/if}
                </span>
                <span class="text-xs text-muted-foreground">
                  {#if displayedContent}
                    {displayedContent.split('\n').length} lines
                  {/if}
                  {#if activeVersion?.usage}
                    <Tooltip.Root>
                      <Tooltip.Trigger>· {activeVersion.usage.totalTokens.toLocaleString()} tokens</Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>
                          {activeVersion.usage.promptTokens.toLocaleString()} in / {activeVersion.usage.completionTokens.toLocaleString()} out
                        </span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  {:else if selectedJob.result?.usage && !activeVersion}
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
                {:else if displayedContent}
                  <Textarea
                    class="w-full h-full p-4 resize-none font-mono text-sm border-0 focus-visible:ring-0 rounded-none bg-transparent"
                    value={displayedContent}
                    oninput={(e) => {
                      if (!selectedJob) return;
                      const newContent = e.currentTarget.value;
                      if (activeVersion && activeVersionId) {
                        // Edit the active version content with debounced persist
                        debouncedPersistVersionEdit(selectedJob.id, activeVersionId, newContent);
                      } else if (selectedJob.result) {
                        // Legacy: edit result directly (no version)
                        translationStore.updateJob(selectedJob.id, {
                          result: { ...selectedJob.result, translatedContent: newContent }
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

<TranslationResultDialog
  open={resultDialogOpen}
  onOpenChange={(v) => {
    resultDialogOpen = v;
    if (!v) resultDialogJobId = null;
  }}
  fileName={resultDialogJob?.file.name ?? ''}
  fileFormat={resultDialogJob?.file.format ?? 'srt'}
  versions={resultDialogJob?.translationVersions ?? []}
  onDeleteVersion={handleDeleteTranslationVersion}
/>

<TranslationRetryDialog
  open={retryDialogOpen}
  onOpenChange={(open) => {
    retryDialogOpen = open;
    if (!open) {
      retryDialogJobId = null;
    }
  }}
  fileName={retryDialogJob?.file.name ?? ''}
  existingVersions={retryDialogJob?.translationVersions ?? []}
  defaultProvider={translationStore.config.provider}
  defaultModel={translationStore.config.model}
  defaultSourceLanguage={translationStore.config.sourceLanguage}
  defaultTargetLanguage={translationStore.config.targetLanguage}
  defaultBatchCount={translationStore.config.batchCount}
  defaultModels={translationStore.config.models}
  isCompareMode={translationStore.config.models.length > 0}
  onConfirm={handleRetryConfirm}
  onNavigateToSettings={onNavigateToSettings}
/>

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

<AlertDialog.Root bind:open={removeDialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>
        {removeTarget?.mode === 'all' ? 'Remove all files while translating?' : 'Remove file while translating?'}
      </AlertDialog.Title>
      <AlertDialog.Description>
        {#if removeTarget?.mode === 'all'}
          One or more files are currently being translated. Removing all files will cancel active translations.
        {:else}
          This file is currently being translated. Removing it will cancel the active translation.
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel
        onclick={() => {
          removeDialogOpen = false;
          removeTarget = null;
        }}
      >
        Cancel
      </AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={handleConfirmRemove}
        class="bg-destructive text-white hover:bg-destructive/90"
      >
        Remove
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
