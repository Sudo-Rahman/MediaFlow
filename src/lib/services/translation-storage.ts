/**
 * Translation Storage Service
 * Handles persistence of translation versions to .rsext.json files
 */

import type { TranslationPersistenceData, TranslationVersion, LLMProvider, LanguageCode, TranslationUsage } from '$lib/types';
import { loadRsextData, saveRsextData } from './rsext-storage';
import { log } from '$lib/utils/log-toast';

// ============================================================================
// VERSION ID GENERATION
// ============================================================================

function generateVersionId(): string {
  return `tv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// DATA OPERATIONS
// ============================================================================

/**
 * Load translation data for a subtitle file
 */
export async function loadTranslationData(filePath: string): Promise<TranslationPersistenceData | null> {
  try {
    const rsextData = await loadRsextData(filePath);
    return rsextData?.translation ?? null;
  } catch (error) {
    log('warning', 'translation', 'Failed to load translation data', `${error}`);
    return null;
  }
}

/**
 * Save translation data, preserving other tool data in .rsext.json
 */
export async function saveTranslationData(
  filePath: string,
  data: TranslationPersistenceData,
): Promise<boolean> {
  try {
    const existing = await loadRsextData(filePath);
    const now = new Date().toISOString();

    return saveRsextData(filePath, {
      version: 1,
      audioToSubs: existing?.audioToSubs,
      videoOcr: existing?.videoOcr,
      translation: {
        ...data,
        version: 1,
        filePath,
        createdAt: data.createdAt || now,
        updatedAt: now,
      },
    });
  } catch (error) {
    log('error', 'translation', 'Failed to save translation data', `${error}`);
    return false;
  }
}

/**
 * Delete translation data, preserving other tool data if present
 */
export async function deleteTranslationData(filePath: string): Promise<boolean> {
  try {
    const existing = await loadRsextData(filePath);
    if (!existing?.translation) {
      return true;
    }

    if (existing.audioToSubs || existing.videoOcr) {
      return saveRsextData(filePath, {
        version: 1,
        audioToSubs: existing.audioToSubs,
        videoOcr: existing.videoOcr,
      });
    }

    // No other tool data -- delete the entire file
    const { deleteRsextData } = await import('./rsext-storage');
    return deleteRsextData(filePath);
  } catch (error) {
    log('error', 'translation', 'Failed to delete translation data', `${error}`);
    return false;
  }
}

// ============================================================================
// VERSION MANAGEMENT
// ============================================================================

/**
 * Factory: create a new TranslationVersion object
 */
export function createTranslationVersion(
  name: string,
  provider: LLMProvider,
  model: string,
  sourceLanguage: LanguageCode,
  targetLanguage: LanguageCode,
  batchCount: number,
  translatedContent: string,
  usage?: TranslationUsage,
  truncated?: boolean,
): TranslationVersion {
  return {
    id: generateVersionId(),
    name,
    createdAt: new Date().toISOString(),
    provider,
    model,
    sourceLanguage,
    targetLanguage,
    batchCount,
    translatedContent,
    usage,
    truncated,
  };
}

/**
 * Generate default version name (Version 1, Version 2, etc.)
 */
export function generateTranslationVersionName(existingVersions: TranslationVersion[]): string {
  return `Version ${existingVersions.length + 1}`;
}

/**
 * Add a single version (load + append + save)
 */
export async function addTranslationVersion(
  filePath: string,
  version: TranslationVersion,
): Promise<TranslationPersistenceData | null> {
  const now = new Date().toISOString();
  let data = await loadTranslationData(filePath);

  if (!data) {
    data = {
      version: 1,
      filePath,
      translationVersions: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  data.translationVersions = [...data.translationVersions, version];
  data.updatedAt = now;

  const success = await saveTranslationData(filePath, data);
  return success ? data : null;
}

/**
 * Remove a single version (load + filter + save)
 */
export async function removeTranslationVersion(
  filePath: string,
  versionId: string,
): Promise<TranslationPersistenceData | null> {
  const data = await loadTranslationData(filePath);
  if (!data) return null;

  data.translationVersions = data.translationVersions.filter(v => v.id !== versionId);
  data.updatedAt = new Date().toISOString();

  // If no versions remain, delete translation data entirely
  if (data.translationVersions.length === 0) {
    await deleteTranslationData(filePath);
    return { ...data, translationVersions: [] };
  }

  const success = await saveTranslationData(filePath, data);
  return success ? data : null;
}

/**
 * Get all versions for a file
 */
export async function getAllTranslationVersions(filePath: string): Promise<TranslationVersion[]> {
  const data = await loadTranslationData(filePath);
  return data?.translationVersions ?? [];
}
