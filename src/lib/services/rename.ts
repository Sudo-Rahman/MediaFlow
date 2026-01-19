/**
 * Rename Service - Core renaming logic and rule processing
 */

import type {
  RenameFile,
  RenameRule,
  RuleType,
  PrefixConfig,
  SuffixConfig,
  ReplaceConfig,
  RegexConfig,
  RemoveConfig,
  CaseConfig,
  NumberConfig,
  MoveConfig,
  TimestampConfig,
  ClearConfig,
  TextConfig,
  RenameResult,
} from '$lib/types/rename';
import { invoke } from '@tauri-apps/api/core';

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Extract file name without extension
 */
export function getBaseName(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot > 0) {
    return filename.substring(0, lastDot);
  }
  return filename;
}

/**
 * Extract extension including the dot
 */
export function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot > 0) {
    return filename.substring(lastDot);
  }
  return '';
}

/**
 * Get filename from path (cross-platform)
 */
export function getFileNameFromPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Get directory from path (cross-platform)
 */
export function getDirectoryFromPath(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (lastSlash > 0) {
    return path.substring(0, lastSlash);
  }
  return '';
}

/**
 * Natural sort comparison for filenames
 * Handles numeric parts correctly: "file1" < "file2" < "file10"
 */
export function naturalCompare(a: string, b: string): number {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  return collator.compare(a, b);
}

/**
 * Apply prefix rule
 */
function applyPrefix(name: string, config: PrefixConfig): string {
  return config.text + name;
}

/**
 * Apply suffix rule
 */
function applySuffix(name: string, config: SuffixConfig): string {
  return name + config.text;
}

/**
 * Apply replace rule
 */
function applyReplace(name: string, config: ReplaceConfig): string {
  if (!config.search) return name;
  
  if (config.caseSensitive) {
    return name.split(config.search).join(config.replace);
  } else {
    const regex = new RegExp(escapeRegExp(config.search), 'gi');
    return name.replace(regex, config.replace);
  }
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply regex rule
 */
function applyRegex(name: string, config: RegexConfig): string {
  if (!config.pattern) return name;
  
  try {
    const regex = new RegExp(config.pattern, config.flags || 'g');
    return name.replace(regex, config.replacement);
  } catch {
    // Invalid regex, return unchanged
    return name;
  }
}

/**
 * Apply remove rule
 */
function applyRemove(name: string, config: RemoveConfig): string {
  switch (config.mode) {
    case 'first':
      return name.substring(config.count);
    
    case 'last':
      return name.substring(0, Math.max(0, name.length - config.count));
    
    case 'range':
      const from = Math.max(0, config.from);
      const to = Math.min(name.length, config.to);
      if (from >= to) return name;
      return name.substring(0, from) + name.substring(to);
    
    case 'pattern':
      if (!config.pattern) return name;
      try {
        const regex = new RegExp(config.pattern, 'g');
        return name.replace(regex, '');
      } catch {
        return name;
      }
    
    default:
      return name;
  }
}

/**
 * Apply case rule
 */
function applyCase(name: string, config: CaseConfig): string {
  switch (config.mode) {
    case 'upper':
      return name.toUpperCase();
    
    case 'lower':
      return name.toLowerCase();
    
    case 'title':
      return name.replace(/\b\w/g, (char) => char.toUpperCase());
    
    case 'sentence':
      return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    
    case 'capitalize':
      return name.split(/(\s+)/).map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join('');
    
    default:
      return name;
  }
}

/**
 * Apply number rule
 */
function applyNumber(name: string, config: NumberConfig, index: number): string {
  const num = config.start + (index * config.step);
  const paddedNum = String(num).padStart(config.padding, '0');
  
  switch (config.position) {
    case 'prefix':
      return paddedNum + config.separator + name;
    
    case 'suffix':
      return name + config.separator + paddedNum;
    
    case 'replace':
      return paddedNum;
    
    default:
      return name;
  }
}

/**
 * Apply move rule
 */
function applyMove(name: string, config: MoveConfig): string {
  const from = Math.max(0, Math.min(config.from, name.length));
  const length = Math.max(0, config.length);
  const to = Math.max(0, Math.min(config.to, name.length));
  
  if (from + length > name.length) return name;
  if (from === to) return name;
  
  const segment = name.substring(from, from + length);
  const withoutSegment = name.substring(0, from) + name.substring(from + length);
  
  // Adjust 'to' position if it was after the removed segment
  const adjustedTo = to > from ? to - length : to;
  
  return withoutSegment.substring(0, adjustedTo) + segment + withoutSegment.substring(adjustedTo);
}

/**
 * Format timestamp
 */
function formatTimestamp(date: Date, format: string): string {
  const pad = (n: number, len: number = 2) => String(n).padStart(len, '0');
  
  return format
    .replace('YYYY', String(date.getFullYear()))
    .replace('YY', String(date.getFullYear()).slice(-2))
    .replace('MM', pad(date.getMonth() + 1))
    .replace('DD', pad(date.getDate()))
    .replace('HH', pad(date.getHours()))
    .replace('mm', pad(date.getMinutes()))
    .replace('ss', pad(date.getSeconds()));
}

/**
 * Apply timestamp rule
 */
function applyTimestamp(name: string, config: TimestampConfig, file?: RenameFile): string {
  let date: Date;
  
  switch (config.source) {
    case 'modified':
      date = file?.modifiedAt || new Date();
      break;
    case 'created':
      date = file?.createdAt || new Date();
      break;
    case 'current':
    default:
      date = new Date();
  }
  
  const timestamp = formatTimestamp(date, config.format);
  
  switch (config.position) {
    case 'prefix':
      return timestamp + config.separator + name;
    case 'suffix':
      return name + config.separator + timestamp;
    default:
      return name;
  }
}

/**
 * Apply clear rule - removes entire filename
 */
function applyClear(_name: string, _config: ClearConfig): string {
  return '';
}

/**
 * Apply text rule - replaces with static text
 */
function applyText(_name: string, config: TextConfig): string {
  return config.text;
}

/**
 * Apply a single rule to a name
 */
export function applyRule(
  name: string,
  rule: RenameRule,
  index: number,
  file?: RenameFile
): string {
  if (!rule.enabled) return name;
  
  switch (rule.type) {
    case 'prefix':
      return applyPrefix(name, rule.config as PrefixConfig);
    case 'suffix':
      return applySuffix(name, rule.config as SuffixConfig);
    case 'replace':
      return applyReplace(name, rule.config as ReplaceConfig);
    case 'regex':
      return applyRegex(name, rule.config as RegexConfig);
    case 'remove':
      return applyRemove(name, rule.config as RemoveConfig);
    case 'case':
      return applyCase(name, rule.config as CaseConfig);
    case 'number':
      return applyNumber(name, rule.config as NumberConfig, index);
    case 'move':
      return applyMove(name, rule.config as MoveConfig);
    case 'timestamp':
      return applyTimestamp(name, rule.config as TimestampConfig, file);
    case 'clear':
      return applyClear(name, rule.config as ClearConfig);
    case 'text':
      return applyText(name, rule.config as TextConfig);
    default:
      return name;
  }
}

/**
 * Apply all enabled rules to a name
 */
export function applyAllRules(
  name: string,
  rules: RenameRule[],
  index: number,
  file?: RenameFile
): string {
  let result = name;
  
  for (const rule of rules) {
    if (rule.enabled) {
      result = applyRule(result, rule, index, file);
    }
  }
  
  return result;
}

/**
 * Detect conflicts (duplicate new names)
 * Returns a map of conflicting names to the file IDs that share that name
 */
export function detectConflicts(files: RenameFile[]): Map<string, string[]> {
  const nameCount = new Map<string, string[]>();
  
  for (const file of files) {
    if (!file.selected) continue;
    
    const fullName = file.newName + file.extension;
    const existing = nameCount.get(fullName) || [];
    existing.push(file.id);
    nameCount.set(fullName, existing);
  }
  
  // Filter to only conflicting names (more than one file)
  const conflicts = new Map<string, string[]>();
  for (const [name, ids] of nameCount) {
    if (ids.length > 1) {
      conflicts.set(name, ids);
    }
  }
  
  return conflicts;
}

/**
 * Create a RenameFile from a file path
 */
export function createRenameFile(
  path: string,
  size?: number,
  modifiedAt?: Date,
  createdAt?: Date
): RenameFile {
  const filename = getFileNameFromPath(path);
  const baseName = getBaseName(filename);
  const extension = getExtension(filename);
  
  return {
    id: generateId(),
    originalPath: path,
    originalName: baseName,
    extension,
    newName: baseName,
    selected: true,
    status: 'pending',
    size,
    modifiedAt,
    createdAt,
  };
}

/**
 * Rename a single file on disk
 */
export async function renameFileOnDisk(
  oldPath: string,
  newPath: string
): Promise<RenameResult> {
  try {
    await invoke('rename_file', { oldPath, newPath });
    return {
      id: '',
      success: true,
      originalPath: oldPath,
      newPath,
    };
  } catch (error) {
    return {
      id: '',
      success: false,
      originalPath: oldPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Copy a file to a new location with a new name
 */
export async function copyFileWithNewName(
  sourcePath: string,
  destPath: string
): Promise<RenameResult> {
  try {
    await invoke('copy_file', { sourcePath, destPath });
    return {
      id: '',
      success: true,
      originalPath: sourcePath,
      newPath: destPath,
    };
  } catch (error) {
    return {
      id: '',
      success: false,
      originalPath: sourcePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Build the new full path for a file
 */
export function buildNewPath(file: RenameFile, outputDir?: string): string {
  const dir = outputDir || getDirectoryFromPath(file.originalPath);
  const separator = file.originalPath.includes('\\') ? '\\' : '/';
  return dir + separator + file.newName + file.extension;
}

/**
 * Validate a filename (check for invalid characters)
 */
export function validateFilename(name: string): { valid: boolean; error?: string } {
  // Check for empty name
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Filename cannot be empty' };
  }
  
  // Check for invalid characters (Windows restrictions)
  const invalidChars = /[<>:"/\\|?*\x00-\x1F]/;
  if (invalidChars.test(name)) {
    return { valid: false, error: 'Filename contains invalid characters' };
  }
  
  // Check for reserved names (Windows)
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (reservedNames.test(name)) {
    return { valid: false, error: 'Filename is a reserved system name' };
  }
  
  // Check for names ending with dot or space (Windows)
  if (name.endsWith('.') || name.endsWith(' ')) {
    return { valid: false, error: 'Filename cannot end with a dot or space' };
  }
  
  return { valid: true };
}

/**
 * Get a summary description for a rule
 */
export function getRuleSummary(rule: RenameRule): string {
  switch (rule.type) {
    case 'prefix': {
      const config = rule.config as PrefixConfig;
      return config.text ? `"${config.text}"` : 'No prefix set';
    }
    case 'suffix': {
      const config = rule.config as SuffixConfig;
      return config.text ? `"${config.text}"` : 'No suffix set';
    }
    case 'replace': {
      const config = rule.config as ReplaceConfig;
      return config.search ? `"${config.search}" → "${config.replace}"` : 'No search term';
    }
    case 'regex': {
      const config = rule.config as RegexConfig;
      return config.pattern ? `/${config.pattern}/${config.flags}` : 'No pattern';
    }
    case 'remove': {
      const config = rule.config as RemoveConfig;
      switch (config.mode) {
        case 'first': return `First ${config.count} chars`;
        case 'last': return `Last ${config.count} chars`;
        case 'range': return `Chars ${config.from}-${config.to}`;
        case 'pattern': return config.pattern ? `Pattern: ${config.pattern}` : 'No pattern';
      }
      break;
    }
    case 'case': {
      const config = rule.config as CaseConfig;
      const modeLabels: Record<string, string> = {
        upper: 'UPPERCASE',
        lower: 'lowercase',
        title: 'Title Case',
        sentence: 'Sentence case',
        capitalize: 'Capitalize Each',
      };
      return modeLabels[config.mode] || config.mode;
    }
    case 'number': {
      const config = rule.config as NumberConfig;
      const example = String(config.start).padStart(config.padding, '0');
      return `${config.position}: ${example}, ${example}, ...`;
    }
    case 'move': {
      const config = rule.config as MoveConfig;
      return `Move ${config.length} chars from ${config.from} to ${config.to}`;
    }
    case 'timestamp': {
      const config = rule.config as TimestampConfig;
      return `${config.position}: ${config.format}`;
    }
    case 'clear': {
      return 'Remove filename';
    }
    case 'text': {
      const config = rule.config as TextConfig;
      return config.text ? `"${config.text}"` : 'No text set';
    }
  }
  return '';
}
