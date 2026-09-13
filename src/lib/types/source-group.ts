/**
 * Describes the root that caused an imported file to be discovered.
 *
 * `groupKey` is the stable identity used for comparisons. `selectedRoot` and
 * `relativePath` deliberately retain display paths so that callers never
 * lose the path spelling chosen by the user.
 */
export type SourceRootKind = 'file' | 'folder';

export interface SourceGroup {
  readonly groupKey: string;
  readonly selectedRoot: string;
  readonly selectedRootKind: SourceRootKind;
  readonly relativePath: string;
}

export interface ExpandedImportFile {
  readonly path: string;
  readonly sourceGroup: SourceGroup;
}

export type ImportWarningCode =
  | 'duplicate'
  | 'overlap'
  | 'symlink-root'
  | 'symlink-entry'
  | 'non-regular-root'
  | 'non-regular-entry';

export interface ImportWarning {
  readonly code: ImportWarningCode;
  readonly path: string;
  readonly relatedPath: string | null;
  readonly count: number;
  readonly message: string;
}

export interface ImportExpansion {
  readonly files: readonly ExpandedImportFile[];
  readonly warnings: readonly ImportWarning[];
}

/** Normalize separators and lexical dot segments for identity comparisons. */
export function normalizePathForIdentity(path: string): string {
  const input = path.replaceAll('\\', '/');
  const windowsDrive = /^[A-Za-z]:/.test(input);
  const uncPath = input.startsWith('//');
  const absolute = input.startsWith('/') || windowsDrive;
  const prefix = windowsDrive ? `${input.slice(0, 2)}/` : uncPath ? '//' : absolute ? '/' : '';
  const body = windowsDrive ? input.slice(2) : uncPath ? input.slice(2) : input;
  const parts: string[] = [];

  for (const part of body.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (parts.length > 0 && parts.at(-1) !== '..') {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }

  const joined = parts.join('/');
  let normalized = `${prefix}${joined}`;
  if (!normalized) {
    normalized = absolute ? prefix || '/' : '.';
  }

  // Drive-letter and UNC paths are case-insensitive on Windows. Applying the
  // fold based on the path spelling also makes these helpers testable on macOS.
  return windowsDrive || uncPath ? normalized.toLocaleLowerCase('en-US') : normalized;
}

/** Return the final path component without depending on a Node-only path API. */
export function getImportPathBasename(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  const separator = normalized.lastIndexOf('/');
  return separator >= 0 ? normalized.slice(separator + 1) : normalized;
}

/** Return a lexical parent path for both POSIX and Windows-style spellings. */
export function getImportPathParent(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  const separator = normalized.lastIndexOf('/');
  if (separator < 0) {
    return '.';
  }
  if (separator === 0) {
    return '/';
  }
  if (separator === 2 && /^[A-Za-z]:\//.test(normalized)) {
    return normalized.slice(0, 3);
  }
  if (separator <= 1 && normalized.startsWith('//')) {
    return normalized.slice(0, separator + 1);
  }
  return normalized.slice(0, separator);
}

/**
 * Build the fallback group for a directly selected file.
 *
 * Direct files share a parent `groupKey`, while retaining the file itself as
 * the selected root. This lets sibling files be grouped without losing the
 * fact that the user selected an individual file.
 */
export function sourceGroupForDirectFile(path: string): SourceGroup {
  const parent = getImportPathParent(path);
  return {
    groupKey: normalizePathForIdentity(parent),
    selectedRoot: path,
    selectedRootKind: 'file',
    relativePath: getImportPathBasename(path),
  };
}

/** Build a folder-shaped fallback when a caller only has a direct file path. */
export function sourceGroupForDirectFileParent(path: string): SourceGroup {
  const parent = getImportPathParent(path);
  return {
    groupKey: normalizePathForIdentity(parent),
    selectedRoot: parent,
    selectedRootKind: 'folder',
    relativePath: getImportPathBasename(path),
  };
}

/** Use an existing group when present, otherwise derive a direct-file fallback. */
export function resolveSourceGroup(
  path: string,
  sourceGroup: SourceGroup | null | undefined,
): SourceGroup {
  return sourceGroup ?? sourceGroupForDirectFileParent(path);
}

/** Compare source groups by their canonical grouping identity. */
export function sameSourceGroup(
  left: SourceGroup | null | undefined,
  right: SourceGroup | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }
  return normalizePathForIdentity(left.groupKey) === normalizePathForIdentity(right.groupKey);
}
