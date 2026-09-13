import { invoke } from '@tauri-apps/api/core';
import { open, type DialogFilter } from '@tauri-apps/plugin-dialog';

import {
  getImportPolicy,
  policyDialogFilter,
  type ImportPolicy,
} from '$lib/types/import-policy';
import type { ImportExpansion } from '$lib/types/source-group';

function normalizeDialogSelection(selected: string | string[] | null): string[] {
  if (selected === null) {
    return [];
  }
  return Array.isArray(selected) ? selected : [selected];
}

function buildFileDialogOptions(policy: ImportPolicy): {
  multiple: true;
  title: string;
  filters?: DialogFilter[];
} {
  const filter = policyDialogFilter(policy);
  return {
    multiple: true,
    title: policy.dialogTitle,
    ...(filter ? { filters: [filter] } : {}),
  };
}

/** Open a multi-file picker using the policy's title and extension filter. */
export async function pickImportFiles(policy: ImportPolicy = getImportPolicy('primary')): Promise<string[]> {
  const selected = await open(buildFileDialogOptions(policy));
  return normalizeDialogSelection(selected);
}

/** Open a recursive multi-folder picker using the policy's title. */
export async function pickImportFolders(policy: ImportPolicy = getImportPolicy('primary')): Promise<string[]> {
  const selected = await open({
    directory: true,
    multiple: true,
    recursive: true,
    title: policy.dialogTitle,
  });
  return normalizeDialogSelection(selected);
}

/** Expand selected files/folders through the native filesystem command. */
export async function expandImportRoots(
  roots: readonly string[],
  policy: ImportPolicy = getImportPolicy('primary'),
): Promise<ImportExpansion> {
  return invoke<ImportExpansion>('expand_import_roots', {
    roots: [...roots],
    extensions: policy.extensions === null ? null : [...policy.extensions],
    excludeMediaflowSidecars: policy.excludeMediaflowSidecars,
  });
}
