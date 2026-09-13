import type { SubtitleOcrSourceItem, SubtitleOcrVobSubPair } from '$lib/types';
import { getFileName } from '$lib/utils/format';

export type SubtitleOcrImportKind =
  | 'container'
  | 'standalone_sup'
  | 'standalone_vobsub_part'
  | 'unsupported';

export interface VobSubPairCandidate {
  basePath: string;
  idxPath?: string;
  subPath?: string;
  complete: boolean;
}

export interface BuildStandaloneSubtitleOcrItemsResult {
  items: SubtitleOcrSourceItem[];
  warnings: string[];
}

export type ResolveVobSubPair = (path: string) => Promise<SubtitleOcrVobSubPair>;

const CONTAINER_EXTENSIONS = new Set([
  'mkv',
  'm2ts',
  'mp4',
  'avi',
  'mov',
  'webm',
  'm4v',
  'mks',
]);

function getExtension(path: string): string {
  const name = getFileName(path);
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(lastDot + 1).toLowerCase() : '';
}

function stripExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, '');
}

function buildId(prefix: string, key: string): string {
  return `${prefix}-${encodeURIComponent(key)}`;
}

export function getSubtitleOcrImportKind(path: string): SubtitleOcrImportKind {
  const extension = getExtension(path);
  if (extension === 'sup') return 'standalone_sup';
  if (extension === 'idx' || extension === 'sub') return 'standalone_vobsub_part';
  if (CONTAINER_EXTENSIONS.has(extension)) return 'container';
  return 'unsupported';
}

export function resolveVobSubPairCandidates(paths: string[]): VobSubPairCandidate[] {
  const byBase = new Map<string, VobSubPairCandidate>();

  for (const path of paths) {
    const extension = getExtension(path);
    if (extension !== 'idx' && extension !== 'sub') {
      continue;
    }

    const basePath = stripExtension(path);
    const baseKey = basePath.replaceAll('\\', '/').toLocaleLowerCase('en-US');
    const existing = byBase.get(baseKey) ?? { basePath, complete: false };
    if (extension === 'idx') {
      existing.idxPath = path;
    } else {
      existing.subPath = path;
    }
    existing.complete = Boolean(existing.idxPath && existing.subPath);
    byBase.set(baseKey, existing);
  }

  return [...byBase.values()].sort((a, b) => a.basePath.localeCompare(b.basePath));
}

function createSupItem(path: string): SubtitleOcrSourceItem {
  return {
    id: buildId('subtitle-ocr-sup', path),
    sourceKind: 'standalone_sup',
    sourcePath: path,
    displayName: getFileName(path),
    status: 'ready',
    ocrModelOverride: 'default',
    versions: [],
    activeVersionId: null,
  };
}

function createVobSubItem(pair: Required<Pick<SubtitleOcrVobSubPair, 'idxPath' | 'subPath'>>): SubtitleOcrSourceItem {
  return {
    id: buildId('subtitle-ocr-vobsub', `${pair.idxPath}::${pair.subPath}`),
    sourceKind: 'standalone_vobsub',
    sourcePath: pair.idxPath,
    pair,
    displayName: `${getFileName(pair.idxPath)}/${getFileName(pair.subPath)}`,
    status: 'ready',
    ocrModelOverride: 'default',
    versions: [],
    activeVersionId: null,
  };
}

function formatPairResolutionError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.replace(/\s+/g, ' ').trim();
  }

  const message = String(error).replace(/\s+/g, ' ').trim();
  return message || 'Could not resolve the matching .idx/.sub sidecar.';
}

export async function buildStandaloneSubtitleOcrItems(
  paths: string[],
  resolveVobSubPair: ResolveVobSubPair,
): Promise<BuildStandaloneSubtitleOcrItemsResult> {
  const items: SubtitleOcrSourceItem[] = [];
  const warnings: string[] = [];
  const vobSubPaths = paths.filter((path) => getSubtitleOcrImportKind(path) === 'standalone_vobsub_part');
  const pairCandidates = resolveVobSubPairCandidates(vobSubPaths);
  const consumedSupPaths = new Set<string>();

  for (const candidate of pairCandidates) {
    let idxPath = candidate.idxPath;
    let subPath = candidate.subPath;

    if (!idxPath && subPath) {
      try {
        const resolvedPair = await resolveVobSubPair(subPath);
        idxPath = resolvedPair.idxPath;
        subPath = resolvedPair.subPath;
      } catch (error) {
        warnings.push(`Missing VobSub pair for ${getFileName(subPath)}. ${formatPairResolutionError(error)}`);
        continue;
      }
    }

    if (!subPath && idxPath) {
      try {
        const resolvedPair = await resolveVobSubPair(idxPath);
        idxPath = resolvedPair.idxPath;
        subPath = resolvedPair.subPath;
      } catch (error) {
        warnings.push(`Missing VobSub pair for ${getFileName(idxPath)}. ${formatPairResolutionError(error)}`);
        continue;
      }
    }

    if (idxPath && subPath) {
      items.push(createVobSubItem({ idxPath, subPath }));
    }
  }

  for (const path of paths) {
    if (getSubtitleOcrImportKind(path) === 'standalone_sup' && !consumedSupPaths.has(path)) {
      items.push(createSupItem(path));
      consumedSupPaths.add(path);
    }
  }

  return { items, warnings };
}
