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

const CONTAINER_EXTENSIONS = new Set([
  'mkv',
  'm2ts',
  'vob',
  'mp4',
  'avi',
  'mov',
  'webm',
  'm4v',
  'mks',
]);

function getExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

function stripExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, '');
}

function buildId(prefix: string, key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  }
  return `${prefix}-${Math.abs(hash).toString(36)}`;
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
    const existing = byBase.get(basePath) ?? { basePath, complete: false };
    if (extension === 'idx') {
      existing.idxPath = path;
    } else {
      existing.subPath = path;
    }
    existing.complete = Boolean(existing.idxPath && existing.subPath);
    byBase.set(basePath, existing);
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

export async function buildStandaloneSubtitleOcrItems(
  paths: string[],
  exists: (path: string) => Promise<boolean>,
): Promise<BuildStandaloneSubtitleOcrItemsResult> {
  const items: SubtitleOcrSourceItem[] = [];
  const warnings: string[] = [];
  const vobSubPaths = paths.filter((path) => getSubtitleOcrImportKind(path) === 'standalone_vobsub_part');
  const pairCandidates = resolveVobSubPairCandidates(vobSubPaths);
  const consumedVobSubPaths = new Set<string>();

  for (const candidate of pairCandidates) {
    let idxPath = candidate.idxPath;
    let subPath = candidate.subPath;

    if (!idxPath && subPath) {
      const expectedIdx = `${candidate.basePath}.idx`;
      if (await exists(expectedIdx)) {
        idxPath = expectedIdx;
      } else {
        warnings.push(`Missing VobSub pair for ${getFileName(subPath)}. Expected ${expectedIdx}.`);
        consumedVobSubPaths.add(subPath);
        continue;
      }
    }

    if (!subPath && idxPath) {
      const expectedSub = `${candidate.basePath}.sub`;
      if (await exists(expectedSub)) {
        subPath = expectedSub;
      } else {
        warnings.push(`Missing VobSub pair for ${getFileName(idxPath)}. Expected ${expectedSub}.`);
        consumedVobSubPaths.add(idxPath);
        continue;
      }
    }

    if (idxPath && subPath) {
      items.push(createVobSubItem({ idxPath, subPath }));
      consumedVobSubPaths.add(idxPath);
      consumedVobSubPaths.add(subPath);
    }
  }

  for (const path of paths) {
    if (getSubtitleOcrImportKind(path) === 'standalone_sup') {
      items.push(createSupItem(path));
    }
    if (consumedVobSubPaths.has(path)) {
      continue;
    }
  }

  return { items, warnings };
}
