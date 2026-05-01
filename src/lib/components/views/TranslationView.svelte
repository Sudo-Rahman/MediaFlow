<script lang="ts" module>
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
  import { SUPPORTED_LANGUAGES } from '$lib/types';
  import type { ImportSelectionMode, ImportSourceId, VersionedImportItem } from '$lib/types/tool-import';

  import { ToolImportSourceDialog } from '$lib/components/shared';

  import {
    TranslationRemoveDialog,
    TranslationRetryDialog,
    TranslationResultDialog,
    TranslationSidebar,
    TranslationWorkspace,
  } from '$lib/components/translation';
  import {
    createModelJobId,
    createRunId,
    createTokenCountCacheKey,
    getPendingTranslationVersionName,
    getModelDisplayName,
    isPendingTranslationVersionId,
    PENDING_TRANSLATION_VERSION_ID,
    selectTranslateAllTargets,
    SUBTITLE_EXTENSIONS,
  } from '$lib/components/translation/translation-view-utils';

  interface TranslationViewProps {
    onNavigateToSettings?: () => void;
  }

  let { onNavigateToSettings }: TranslationViewProps = $props();

  let sourceDialogOpen = $state(false);
  let sourceDialogSourceId = $state<ImportSourceId | null>(null);
  let sourceDialogLabel = $state('');
  let sourceDialogItems = $state<VersionedImportItem[]>([]);

  // Reactive state for API key check - use $derived to react to settings changes
  const hasApiKey = $derived(
    settingsStore.isLoaded && !!settingsStore.getLLMApiKey(translationStore.config.provider)
  );

  // Token count cache by file path + language pair.
  let tokenCountCache = $state<Map<string, number>>(new Map());
  let tokenCountGenerations = $state<Map<string, number>>(new Map());
  let pendingTokenCountKeys = $state<Set<string>>(new Set());
  const selectedTokenCountKey = $derived.by(() => {
    const selectedJob = translationStore.selectedJob;
    if (!selectedJob) {
      return null;
    }

    const generation = tokenCountGenerations.get(selectedJob.file.path) ?? 0;

    return createTokenCountCacheKey(
      selectedJob.file.path,
      translationStore.config.sourceLanguage,
      translationStore.config.targetLanguage,
      generation,
    );
  });
  const tokenCount = $derived.by(() => {
    if (!selectedTokenCountKey) {
      return null;
    }

    return tokenCountCache.get(selectedTokenCountKey) ?? null;
  });
  const isCountingTokens = $derived.by(() => {
    if (!selectedTokenCountKey) {
      return false;
    }

    return pendingTokenCountKeys.has(selectedTokenCountKey);
  });

  $effect(() => {
    const job = translationStore.selectedJob;
    const cacheKey = selectedTokenCountKey;

    if (!job || !cacheKey || tokenCountCache.has(cacheKey) || pendingTokenCountKeys.has(cacheKey)) {
      return;
    }

    const { sourceLanguage, targetLanguage } = translationStore.config;
    const nextPendingKeys = new Set(pendingTokenCountKeys);
    nextPendingKeys.add(cacheKey);
    pendingTokenCountKeys = nextPendingKeys;

    untrack(() => {
      const fullPrompt = buildFullPromptForTokenCount(
        job.file.content,
        sourceLanguage,
        targetLanguage,
      );

      countTokens(fullPrompt)
        .then((count) => {
          const nextTokenCountCache = new Map(tokenCountCache);
          nextTokenCountCache.set(cacheKey, count);
          tokenCountCache = nextTokenCountCache;
        })
        .catch(() => {
          // Ignore tokenizer failures in the UI.
        })
        .finally(() => {
          const updatedPendingKeys = new Set(pendingTokenCountKeys);
          updatedPendingKeys.delete(cacheKey);
          pendingTokenCountKeys = updatedPendingKeys;
        });
    });
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

  function clearTokenCountCacheForPath(filePath: string): void {
    const nextGenerations = new Map(tokenCountGenerations);
    nextGenerations.set(filePath, (nextGenerations.get(filePath) ?? 0) + 1);
    tokenCountGenerations = nextGenerations;
    tokenCountCache = new Map(
      [...tokenCountCache].filter(([cacheKey]) => !cacheKey.startsWith(`${filePath}::`)),
    );
    pendingTokenCountKeys = new Set(
      [...pendingTokenCountKeys].filter((cacheKey) => !cacheKey.startsWith(`${filePath}::`)),
    );
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

      clearTokenCountCacheForPath(path);
      translationStore.addFile(subtitleFile);
      deferPersistedTranslationHydration(path);

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

  function deferPersistedTranslationHydration(path: string): void {
    const hydrate = async () => {
      const existingData = await loadTranslationData(path);
      if (existingData && existingData.translationVersions.length > 0) {
        const job = translationStore.jobs.find(j => j.file.path === path);
        if (job) {
          translationStore.setTranslationVersions(job.id, existingData.translationVersions);
        }
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void hydrate();
      });
    });
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

      clearTokenCountCacheForPath(file.path);
      translationStore.addFile(file);
      existingPaths.add(file.path);
      imported++;
      deferPersistedTranslationHydration(file.path);
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

  function isRunActive(jobId: string, runId: string): boolean {
    return translationStore.isRunActive(jobId, runId);
  }

  function getModelJob(jobId: string, modelJobId: string): ModelJob | undefined {
    return translationStore.jobs
      .find(j => j.id === jobId)
      ?.modelJobs?.find(mj => mj.id === modelJobId);
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
      activeVersionId: PENDING_TRANSLATION_VERSION_ID,
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
      activeVersionId: PENDING_TRANSLATION_VERSION_ID,
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

  const translateAllTargets = $derived(selectTranslateAllTargets(translationStore.jobs));
  const translateAllTargetCount = $derived(translateAllTargets.length);
  const hasFiles = $derived(translationStore.hasFiles);
  const isTranslating = $derived(translationStore.isTranslating);
  const canTranslate = $derived(
    hasFiles &&
    translateAllTargetCount > 0 &&
    !!translationStore.config.model &&
    hasApiKey
  );
  const selectedJob = $derived(translationStore.selectedJob);

  // Active version for the selected job
  const selectedJobVersions = $derived(selectedJob?.translationVersions ?? []);
  const activeVersionId = $derived(selectedJob?.activeVersionId ?? null);
  const isPendingVersionSelected = $derived(isPendingTranslationVersionId(activeVersionId));
  const pendingVersionName = $derived(
    selectedJob?.status === 'translating'
      ? getPendingTranslationVersionName(selectedJobVersions.length)
      : null
  );
  const activeVersion = $derived(
    activeVersionId && !isPendingVersionSelected
      ? selectedJobVersions.find(v => v.id === activeVersionId) ?? null
      : null
  );
  // Content to display in the right panel: prefer active version, fall back to result
  const displayedContent = $derived(
    isPendingVersionSelected ? '' : activeVersion?.translatedContent ?? selectedJob?.result?.translatedContent ?? ''
  );

  // Debounced persistence for version edits
  let persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function debouncedPersistVersionEdit(jobId: string, versionId: string, content: string): void {
    translationStore.updateVersionContent(jobId, versionId, content);

    const timerKey = `${jobId}:${versionId}`;
    const existingTimer = persistTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const nextTimer = setTimeout(async () => {
      const job = translationStore.jobs.find(j => j.id === jobId);
      if (!job) {
        persistTimers.delete(timerKey);
        return;
      }

      try {
        await saveTranslationData(job.file.path, {
          version: 1,
          filePath: job.file.path,
          translationVersions: job.translationVersions,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } finally {
        persistTimers.delete(timerKey);
      }
    }, 500);

    persistTimers.set(timerKey, nextTimer);
  }

  function handleSelectedVersionChange(versionId: string): void {
    if (!selectedJob) {
      return;
    }

    translationStore.setActiveVersion(selectedJob.id, versionId);
  }

  function handleSelectedContentEdit(content: string): void {
    if (!selectedJob) {
      return;
    }

    if (activeVersion && activeVersionId) {
      debouncedPersistVersionEdit(selectedJob.id, activeVersionId, content);
      return;
    }

    if (selectedJob.result) {
      translationStore.updateJob(selectedJob.id, {
        result: { ...selectedJob.result, translatedContent: content },
      });
    }
  }

  let resultDialogOpen = $state(false);
  let resultDialogJobId = $state<string | null>(null);
  const resultDialogJob = $derived(resultDialogJobId ? translationStore.jobs.find(j => j.id === resultDialogJobId) ?? null : null);

  function openResultDialog(jobId: string): void {
    resultDialogJobId = jobId;
    resultDialogOpen = true;
  }

  function handleResultDialogOpenChange(open: boolean): void {
    resultDialogOpen = open;
    if (!open) {
      resultDialogJobId = null;
    }
  }

  function handleRetryDialogOpenChange(open: boolean): void {
    retryDialogOpen = open;
    if (!open) {
      retryDialogJobId = null;
    }
  }

  function handleSourceDialogOpenChange(open: boolean): void {
    sourceDialogOpen = open;
    if (!open) {
      sourceDialogSourceId = null;
      sourceDialogItems = [];
      sourceDialogLabel = '';
    }
  }

  function handleRemoveDialogOpenChange(open: boolean): void {
    removeDialogOpen = open;
    if (!open && removeTarget) {
      removeTarget = null;
    }
  }

  function handleCancelRemoveDialog(): void {
    removeDialogOpen = false;
    removeTarget = null;
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
  <div class="flex min-h-0 flex-1">
    <TranslationSidebar
      jobs={translationStore.jobs}
      selectedJobId={selectedJob?.id ?? null}
      {hasFiles}
      {isTranslating}
      {canTranslate}
      {translateAllTargetCount}
      batchCount={translationStore.config.batchCount}
      onSelectJob={(jobId) => translationStore.selectJob(jobId)}
      onRequestRemoveJob={handleRequestRemoveJob}
      onRequestRemoveAll={handleRequestRemoveAll}
      onCancelJob={handleCancelJob}
      onOpenResult={(job) => openResultDialog(job.id)}
      onRetryJob={handleRetryRequest}
      onImportClick={handleImportClick}
      onImportFromSource={handleImportFromSource}
      onBatchCountChange={(value) => translationStore.setBatchCount(value)}
      onTranslateAll={handleTranslateAll}
      onCancelAll={handleCancelAll}
      {onNavigateToSettings}
    />

    <TranslationWorkspace
      {selectedJob}
      {selectedJobVersions}
      {activeVersionId}
      {activeVersion}
      {displayedContent}
      {tokenCount}
      {isCountingTokens}
      {isTranslating}
      {isPendingVersionSelected}
      {pendingVersionName}
      onSelectVersion={handleSelectedVersionChange}
      onCopyContent={handleCopyToClipboard}
      onEditContent={handleSelectedContentEdit}
      onRetryWithMoreBatches={retryWithMoreBatches}
    />
  </div>
</div>

<TranslationResultDialog
  open={resultDialogOpen}
  onOpenChange={handleResultDialogOpenChange}
  fileName={resultDialogJob?.file.name ?? ''}
  fileFormat={resultDialogJob?.file.format ?? 'srt'}
  versions={resultDialogJob?.translationVersions ?? []}
  onDeleteVersion={handleDeleteTranslationVersion}
/>

<TranslationRetryDialog
  open={retryDialogOpen}
  onOpenChange={handleRetryDialogOpenChange}
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
  onOpenChange={handleSourceDialogOpenChange}
  sourceLabel={sourceDialogLabel}
  items={sourceDialogItems}
  onConfirm={handleConfirmVersionImport}
/>

<TranslationRemoveDialog
  open={removeDialogOpen}
  targetMode={removeTarget?.mode ?? null}
  onOpenChange={handleRemoveDialogOpenChange}
  onCancel={handleCancelRemoveDialog}
  onConfirm={handleConfirmRemove}
/>
