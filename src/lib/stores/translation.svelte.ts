import type {
  SubtitleFile,
  TranslationConfig,
  TranslationProgress,
  TranslationResult,
  TranslationJob,
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
  batchCount: 1 // Default: no splitting
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
      totalBatches: 0
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
    this.updateJob(jobId, { status: 'cancelled', error: 'Cancelled by user' });
  },

  // Cancel all jobs
  cancelAllJobs() {
    for (const job of jobs) {
      if (job.status === 'translating' || job.status === 'pending') {
        if (job.abortController) {
          job.abortController.abort();
        }
        this.updateJob(job.id, { status: 'cancelled', error: 'Cancelled by user' });
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
      batchCount: 1
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
