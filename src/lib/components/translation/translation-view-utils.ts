import type { LanguageCode, LLMProvider, TranslationJob } from '$lib/types';
import { LLM_PROVIDERS } from '$lib/types';

export const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.vtt', '.ssa'] as const;
export const SUBTITLE_FORMATS = SUBTITLE_EXTENSIONS.map((extension) => extension.slice(1).toUpperCase());
export const PENDING_TRANSLATION_VERSION_ID = '__pending_translation__';

export function createModelJobId(runId: string, index: number): string {
  return `${runId}_model_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createRunId(jobId: string): string {
  return `${jobId}_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTokenCountCacheKey(
  filePath: string,
  sourceLanguage: LanguageCode,
  targetLanguage: LanguageCode,
  generation = 0,
): string {
  return `${filePath}::${generation}::${sourceLanguage}::${targetLanguage}`;
}

export function getModelDisplayName(provider: string, model: string): string {
  const providerConfig = LLM_PROVIDERS[provider as LLMProvider];
  if (!providerConfig) {
    return model;
  }

  const foundModel = providerConfig.models.find((entry) => entry.id === model);
  return foundModel?.name ?? model;
}

export function getPendingTranslationVersionName(completedVersionCount: number): string {
  return `Version ${completedVersionCount + 1}`;
}

export function isPendingTranslationVersionId(versionId: string | null | undefined): boolean {
  return versionId === PENDING_TRANSLATION_VERSION_ID;
}

export function isPrimaryRetryableStatus(status: TranslationJob['status']): boolean {
  return status === 'pending' || status === 'error' || status === 'cancelled';
}

export function selectTranslateAllTargets(jobs: TranslationJob[]): TranslationJob[] {
  const primaryTargets = jobs.filter((job) => isPrimaryRetryableStatus(job.status));
  if (primaryTargets.length > 0) {
    return primaryTargets;
  }

  return jobs.filter((job) => job.status === 'completed');
}
