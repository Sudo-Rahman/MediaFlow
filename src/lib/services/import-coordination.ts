import {
  expandImportRoots,
  pickImportFiles,
  pickImportFolders,
} from './file-import';
import type { LogSource } from '$lib/stores/logs.svelte';
import type { ImportIntent, ImportPolicy } from '$lib/types/import-policy';
import { getImportPolicy, getToolImportPolicy } from '$lib/types/import-policy';
import {
  resolveSourceGroup,
  type ExpandedImportFile,
  type ImportExpansion,
  type ImportWarning,
} from '$lib/types/source-group';
import type { ToolId } from '$lib/types/tool-import';
import { logAndToast } from '$lib/utils/log-toast';

export type ImportPickerKind = 'files' | 'folders';

export function summarizeImportWarnings(warnings: readonly ImportWarning[]): string {
  const counts = new Map<string, number>();
  for (const warning of warnings) {
    const key = warning.message.trim() || 'Import warning';
    counts.set(key, (counts.get(key) ?? 0) + Math.max(1, warning.count));
  }

  return [...counts.entries()]
    .map(([message, count]) => `${message} (${count})`)
    .join('; ');
}

/** Expand one import gesture and report all non-fatal native warnings once. */
export async function expandToolImportRoots(
  roots: readonly string[],
  policy: ImportPolicy,
  source: LogSource,
): Promise<ExpandedImportFile[]> {
  if (roots.length === 0) {
    return [];
  }

  let expansion: ImportExpansion;
  try {
    expansion = await expandImportRoots(roots, policy);
  } catch {
    logAndToast.warning({
      source,
      title: 'Import expansion failed',
      details: 'The selected imports could not be read. No files were imported.',
      showAction: false,
    });
    return [];
  }

  if (expansion.warnings.length > 0 || expansion.files.length === 0) {
    logAndToast.warning({
      source,
      title: expansion.warnings.length > 0
        ? 'Some imports were skipped'
        : 'No supported imports found',
      details: expansion.warnings.length > 0
        ? summarizeImportWarnings(expansion.warnings)
        : 'No files matching the selected import policy were found.',
      showAction: false,
    });
  }

  return [...expansion.files];
}

/** Pick files or folders, then apply the same recursive expansion as drops. */
export async function pickAndExpandToolImport(
  policy: ImportPolicy,
  source: LogSource,
  picker: ImportPickerKind,
): Promise<ExpandedImportFile[]> {
  const roots = picker === 'files'
    ? await pickImportFiles(policy)
    : await pickImportFolders(policy);
  return expandToolImportRoots(roots, policy, source);
}

/** Expand a mixed Merge drop using the union of the canonical video/track policies. */
export async function expandMergeMixedImportRoots(
  roots: readonly string[],
  source: LogSource = 'merge',
): Promise<ExpandedImportFile[]> {
  const videoPolicy = getImportPolicy('merge-video');
  const trackPolicy = getImportPolicy('merge-track');
  const extensions = [...new Set([
    ...(videoPolicy.extensions ?? []),
    ...(trackPolicy.extensions ?? []),
  ])];
  return expandToolImportRoots(
    roots,
    {
      ...videoPolicy,
      extensions,
    },
    source,
  );
}

/** Resolve a policy at a tool call site while keeping UI policy-free. */
export function toolImportPolicy(tool: ToolId, intent: ImportIntent = 'primary'): ImportPolicy {
  return getToolImportPolicy(tool, intent);
}

/** Preserve provenance for source snapshots that predate ExpandedImportFile. */
export function expandedFilesFromPaths(paths: readonly string[]): ExpandedImportFile[] {
  return paths.map((path) => ({
    path,
    sourceGroup: resolveSourceGroup(path, undefined),
  }));
}
