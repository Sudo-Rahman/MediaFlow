import type {
  SubtitleFile,
  TranslationConfig,
  TranslationProgress,
  TranslationResult,
  TranslationJob,
  TranslationVersion,
  ModelJob,
  LLMProvider,
  LanguageCode
} from '$lib/types';

// Generate unique ID
function generateId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Translation state
let jobs = $state<TranslationJob[]>([]);
let config = $state<TranslationConfig>({
  sourceLanguage: 'auto',
  targetLanguage: 'fr',
  provider: 'google',
  model: 'gemini-2.5-flash',
  batchCount: 1, // Default: no splitting
  models: [],
});
let globalProgress = $state<TranslationProgress>({
  status: 'idle',
  currentFile: '',
  progress: 0,
  currentBatch: 0,
  totalBatches: 0
});

// For backward compatibility - returns first file
let selectedJobId = $state<string | null>(null);

export const translationStore = {
  get jobs() {
    return jobs;
  },

  get config() {
    return config;
  },

  get progress() {
    return globalProgress;
  },

  get selectedJob(): TranslationJob | null {
    if (!selectedJobId) return jobs[0] || null;
    return jobs.find(j => j.id === selectedJobId) || null;
  },

  // Backward compatibility getters
  get subtitleFile(): SubtitleFile | null {
    const job = this.selectedJob;
    return job?.file || null;
  },

  get result(): TranslationResult | null {
    const job = this.selectedJob;
    return job?.result || null;
  },

  get isTranslating() {
    return jobs.some(j => j.status === 'translating');
  },

  get hasFile() {
    return jobs.length > 0;
  },

  get hasFiles() {
    return jobs.length > 0;
  },

  get pendingJobs() {
    return jobs.filter(j => j.status === 'pending');
  },

  get completedJobs() {
    return jobs.filter(j => j.status === 'completed');
  },

  get activeJobs() {
    return jobs.filter(j => j.status === 'translating');
  },

  // Add a single file
  addFile(file: SubtitleFile): string {
    const id = generateId();
    const job: TranslationJob = {
      id,
      file,
      status: 'pending',
      progress: 0,
      currentBatch: 0,
      totalBatches: 0,
      translationVersions: [],
      activeVersionId: null,
    };
    jobs = [...jobs, job];
    if (!selectedJobId) {
      selectedJobId = id;
    }
    return id;
  },

  // Add multiple files
  addFiles(files: SubtitleFile[]): string[] {
    const ids: string[] = [];
    for (const file of files) {
      ids.push(this.addFile(file));
    }
    return ids;
  },

  // Remove a job
  removeJob(jobId: string) {
    const job = jobs.find(j => j.id === jobId);
    if (job?.abortController) {
      job.abortController.abort();
    }
    // Cancel any active model jobs
    if (job?.modelJobs) {
      for (const mj of job.modelJobs) {
        if (mj.abortController) {
          mj.abortController.abort();
        }
      }
    }
    jobs = jobs.filter(j => j.id !== jobId);
    if (selectedJobId === jobId) {
      selectedJobId = jobs[0]?.id || null;
    }
  },

  // Remove all jobs
  removeAllJobs() {
    for (const job of jobs) {
      if (job.abortController) {
        job.abortController.abort();
      }
    }
    jobs = [];
    selectedJobId = null;
    globalProgress = { status: 'idle', currentFile: '', progress: 0, currentBatch: 0, totalBatches: 0 };
  },

  // Select a job
  selectJob(jobId: string) {
    selectedJobId = jobId;
    // Set activeVersionId to the most recent version when selecting a job with versions
    const job = jobs.find(j => j.id === jobId);
    if (job && job.translationVersions.length > 0 && !job.activeVersionId) {
      const mostRecent = job.translationVersions[job.translationVersions.length - 1];
      this.updateJob(jobId, { activeVersionId: mostRecent.id });
    }
  },

  // Update job status
  updateJob(jobId: string, updates: Partial<TranslationJob>) {
    jobs = jobs.map(j =>
      j.id === jobId ? { ...j, ...updates } : j
    );
  },

  // Set abort controller for a job
  setJobAbortController(jobId: string, controller: AbortController) {
    jobs = jobs.map(j =>
      j.id === jobId ? { ...j, abortController: controller } : j
    );
  },

  // Cancel a specific job
  cancelJob(jobId: string) {
    const job = jobs.find(j => j.id === jobId);
    if (job?.abortController) {
      job.abortController.abort();
    }
    // Cancel all model jobs
    if (job?.modelJobs) {
      for (const mj of job.modelJobs) {
        if (mj.abortController && (mj.status === 'pending' || mj.status === 'translating')) {
          mj.abortController.abort();
        }
      }
      // Mark all pending/translating model jobs as cancelled
      this.updateJob(jobId, {
        status: 'cancelled',
        error: 'Cancelled by user',
        modelJobs: job.modelJobs.map(mj =>
          mj.status === 'pending' || mj.status === 'translating'
            ? { ...mj, status: 'cancelled' as const, error: 'Cancelled by user' }
            : mj
        ),
      });
    } else {
      this.updateJob(jobId, { status: 'cancelled', error: 'Cancelled by user' });
    }
  },

  // Cancel all jobs
  cancelAllJobs() {
    for (const job of jobs) {
      if (job.status === 'translating' || job.status === 'pending') {
        this.cancelJob(job.id);
      }
    }
    globalProgress = { ...globalProgress, status: 'cancelled' };
  },

  // Backward compatibility - set single file
  setSubtitleFile(file: SubtitleFile | null) {
    jobs = [];
    selectedJobId = null;
    if (file) {
      this.addFile(file);
    }
    globalProgress = { status: 'idle', currentFile: '', progress: 0, currentBatch: 0, totalBatches: 0 };
  },

  setSourceLanguage(lang: LanguageCode) {
    config = { ...config, sourceLanguage: lang };
  },

  setTargetLanguage(lang: LanguageCode) {
    config = { ...config, targetLanguage: lang };
  },

  setProvider(provider: LLMProvider) {
    config = { ...config, provider, model: '' };
  },

  setModel(model: string) {
    config = { ...config, model };
  },

  setBatchCount(count: number) {
    config = { ...config, batchCount: Math.max(1, count) };
  },

  setModels(models: Array<{ provider: LLMProvider; model: string }>) {
    config = { ...config, models };
  },

  addModel(provider: LLMProvider, model: string) {
    const exists = config.models.some(m => m.provider === provider && m.model === model);
    if (!exists) {
      config = { ...config, models: [...config.models, { provider, model }] };
    }
  },

  removeModel(provider: LLMProvider, model: string) {
    config = { ...config, models: config.models.filter(m => !(m.provider === provider && m.model === model)) };
  },

  updateProgress(updates: Partial<TranslationProgress>) {
    globalProgress = { ...globalProgress, ...updates };
  },

  setResult(translationResult: TranslationResult) {
    // Find matching job and update it
    const job = jobs.find(j => j.file.path === translationResult.originalFile.path);
    if (job) {
      this.updateJob(job.id, {
        result: translationResult,
        status: translationResult.success ? 'completed' : 'error',
        progress: 100
      });
    }
  },

  // ============================================================================
  // VERSION MANAGEMENT
  // ============================================================================

  get activeVersion(): TranslationVersion | undefined {
    const job = this.selectedJob;
    if (!job || !job.activeVersionId) return undefined;
    return job.translationVersions.find(v => v.id === job.activeVersionId);
  },

  addTranslationVersion(jobId: string, version: TranslationVersion): void {
    jobs = jobs.map(j => {
      if (j.id !== jobId) return j;
      return {
        ...j,
        translationVersions: [...j.translationVersions, version],
        activeVersionId: version.id,
      };
    });
  },

  removeTranslationVersion(jobId: string, versionId: string): void {
    jobs = jobs.map(j => {
      if (j.id !== jobId) return j;
      const filtered = j.translationVersions.filter(v => v.id !== versionId);
      const newActiveId = j.activeVersionId === versionId
        ? (filtered.length > 0 ? filtered[filtered.length - 1].id : null)
        : j.activeVersionId;
      return {
        ...j,
        translationVersions: filtered,
        activeVersionId: newActiveId,
        // If no versions remain, revert to unprocessed state
        ...(filtered.length === 0 ? { status: 'pending' as const, result: undefined, progress: 0 } : {}),
      };
    });
  },

  setTranslationVersions(jobId: string, versions: TranslationVersion[]): void {
    jobs = jobs.map(j => {
      if (j.id !== jobId) return j;
      return {
        ...j,
        translationVersions: versions,
        activeVersionId: versions.length > 0 ? versions[versions.length - 1].id : null,
      };
    });
  },

  getTranslationVersionCount(jobId: string): number {
    const job = jobs.find(j => j.id === jobId);
    return job?.translationVersions.length ?? 0;
  },

  setActiveVersion(jobId: string, versionId: string | null): void {
    this.updateJob(jobId, { activeVersionId: versionId });
  },

  updateVersionContent(jobId: string, versionId: string, content: string): void {
    jobs = jobs.map(j => {
      if (j.id !== jobId) return j;
      return {
        ...j,
        translationVersions: j.translationVersions.map(v =>
          v.id === versionId ? { ...v, translatedContent: content } : v
        ),
      };
    });
  },

  // ============================================================================
  // MULTI-MODEL SUPPORT
  // ============================================================================

  setModelJobs(jobId: string, modelJobs: ModelJob[]): void {
    this.updateJob(jobId, { modelJobs });
  },

  updateModelJob(jobId: string, modelKey: string, updates: Partial<ModelJob>): void {
    jobs = jobs.map(j => {
      if (j.id !== jobId || !j.modelJobs) return j;
      return {
        ...j,
        modelJobs: j.modelJobs.map(mj =>
          `${mj.provider}/${mj.model}` === modelKey ? { ...mj, ...updates } : mj
        ),
      };
    });
  },

  reset() {
    // Cancel all active jobs first
    this.cancelAllJobs();
    jobs = [];
    selectedJobId = null;
    config = {
      sourceLanguage: 'auto',
      targetLanguage: 'fr',
      provider: 'google',
      model: 'gemini-2.5-flash',
      batchCount: 1,
      models: [],
    };
    globalProgress = { status: 'idle', currentFile: '', progress: 0, currentBatch: 0, totalBatches: 0 };
  },

  clearResult() {
    const job = this.selectedJob;
    if (job) {
      this.updateJob(job.id, { result: undefined, status: 'pending', progress: 0 });
    }
    globalProgress = { status: 'idle', currentFile: '', progress: 0, currentBatch: 0, totalBatches: 0 };
  },

  clearAllResults() {
    jobs = jobs.map(j => ({
      ...j,
      result: undefined,
      status: 'pending' as const,
      progress: 0,
      currentBatch: 0,
      totalBatches: 0
    }));
    globalProgress = { status: 'idle', currentFile: '', progress: 0, currentBatch: 0, totalBatches: 0 };
  }
};
