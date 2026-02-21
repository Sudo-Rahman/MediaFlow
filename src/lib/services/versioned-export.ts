export type VersionedExportMode = 'latest_per_file' | 'all_versions' | 'custom';

export interface VersionedExportVersion {
  key: string;
  versionId: string;
  versionName: string;
  createdAt: string;
}

export interface VersionedExportGroup {
  fileId: string;
  fileName: string;
  fileBadge?: string;
  versions: VersionedExportVersion[];
}

export interface VersionedExportTarget {
  fileId: string;
  fileName: string;
  versionKey: string;
  versionId: string;
  versionName: string;
}

export interface VersionedExportFormatOption {
  value: string;
  label: string;
}

export interface VersionedExportRequest {
  mode: VersionedExportMode;
  format: string;
  outputDir: string;
  targets: VersionedExportTarget[];
}

export interface RunBatchExportResult {
  successCount: number;
  failCount: number;
  failures: VersionedExportFailure[];
}

export interface VersionedExportFailure {
  fileId: string;
  fileName: string;
  versionId: string;
  versionName: string;
  message: string;
}

export function sanitizeExportNameSegment(name: string, fallback = 'version'): string {
  const sanitized = name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();

  return sanitized.length > 0 ? sanitized : fallback;
}

export function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

function sanitizeBaseFileName(baseName: string): string {
  const trimmed = baseName
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ');

  return trimmed.length > 0 ? trimmed : 'file';
}

export function buildUniqueExportFileName(
  baseName: string,
  versionName: string,
  extension: string,
  usedNames: Set<string>,
): string {
  const safeBaseName = sanitizeBaseFileName(baseName);
  const safeVersionName = sanitizeExportNameSegment(versionName);
  const safeExtension = extension.replace(/^\./, '').toLowerCase() || 'txt';
  const candidateBase = `${safeBaseName}_${safeVersionName}`;

  let index = 1;
  let candidate = `${candidateBase}.${safeExtension}`;

  while (usedNames.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${candidateBase}_${index}.${safeExtension}`;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return 'Unknown export error';
}

export async function runBatchExport<T extends VersionedExportTarget>(
  targets: readonly T[],
  exportTarget: (target: T) => Promise<void>,
): Promise<RunBatchExportResult> {
  let successCount = 0;
  let failCount = 0;
  const failures: VersionedExportFailure[] = [];

  for (const target of targets) {
    try {
      await exportTarget(target);
      successCount += 1;
    } catch (error) {
      failCount += 1;
      failures.push({
        fileId: target.fileId,
        fileName: target.fileName,
        versionId: target.versionId,
        versionName: target.versionName,
        message: getErrorMessage(error),
      });
    }
  }

  return { successCount, failCount, failures };
}
