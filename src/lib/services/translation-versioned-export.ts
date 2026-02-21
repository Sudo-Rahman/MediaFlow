import { join } from '@tauri-apps/api/path';
import { writeTextFile } from '@tauri-apps/plugin-fs';

import type { TranslationJob } from '$lib/types';
import {
  buildUniqueExportFileName,
  runBatchExport,
  stripFileExtension,
  type RunBatchExportResult,
  type VersionedExportFormatOption,
  type VersionedExportGroup,
  type VersionedExportRequest,
} from './versioned-export';

const LEGACY_RESULT_VERSION_ID = 'legacy_result';
const SOURCE_FORMAT_VALUE = 'source';

interface TranslationExportSource {
  content: string;
  extension: TranslationJob['file']['format'];
}

export const TRANSLATION_EXPORT_FORMAT_OPTIONS: VersionedExportFormatOption[] = [
  { value: SOURCE_FORMAT_VALUE, label: 'Keep source format (per file)' },
];

export function buildTranslationExportGroups(jobs: TranslationJob[]): VersionedExportGroup[] {
  return jobs
    .map((job): VersionedExportGroup | null => {
      const versionEntries = job.translationVersions.map((version) => ({
        key: `${job.id}:${version.id}`,
        versionId: version.id,
        versionName: version.name,
        createdAt: version.createdAt,
      }));

      const fallbackContent = job.result?.translatedContent?.trim();
      if (versionEntries.length === 0 && fallbackContent) {
        versionEntries.push({
          key: `${job.id}:${LEGACY_RESULT_VERSION_ID}`,
          versionId: LEGACY_RESULT_VERSION_ID,
          versionName: 'Current result',
          createdAt: '',
        });
      }

      if (versionEntries.length === 0) {
        return null;
      }

      return {
        fileId: job.id,
        fileName: job.file.name,
        fileBadge: job.file.format.toUpperCase(),
        versions: versionEntries,
      };
    })
    .filter((group): group is VersionedExportGroup => group !== null);
}

function resolveTranslationSource(job: TranslationJob, versionId: string): TranslationExportSource {
  if (versionId === LEGACY_RESULT_VERSION_ID) {
    const content = job.result?.translatedContent;
    if (!content || content.trim().length === 0) {
      throw new Error('Current result not found');
    }

    return {
      content,
      extension: job.file.format,
    };
  }

  const version = job.translationVersions.find((entry) => entry.id === versionId);
  if (!version) {
    throw new Error(`Translation version not found: ${versionId}`);
  }

  if (version.translatedContent.trim().length === 0) {
    throw new Error('Translation content is empty');
  }

  return {
    content: version.translatedContent,
    extension: job.file.format,
  };
}

export async function exportTranslationVersions(
  request: VersionedExportRequest,
  jobs: TranslationJob[],
): Promise<RunBatchExportResult> {
  if (request.format !== SOURCE_FORMAT_VALUE) {
    throw new Error('Invalid export format');
  }

  const usedNames = new Set<string>();
  const jobsById = new Map(jobs.map((job) => [job.id, job]));

  return runBatchExport(request.targets, async (target) => {
    const job = jobsById.get(target.fileId);
    if (!job) {
      throw new Error(`Translation file not found: ${target.fileId}`);
    }

    const source = resolveTranslationSource(job, target.versionId);
    const exportFileName = buildUniqueExportFileName(
      stripFileExtension(target.fileName),
      target.versionName,
      source.extension,
      usedNames,
    );
    const outputPath = await join(request.outputDir, exportFileName);
    await writeTextFile(outputPath, source.content);
  });
}
