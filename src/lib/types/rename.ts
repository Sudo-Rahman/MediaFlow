// Types for the Rename Tool

/**
 * Sort options for files
 */
export type SortField = 'name' | 'size' | 'date';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

/**
 * File to be renamed
 */
export interface RenameFile {
  id: string;
  originalPath: string;
  originalName: string;
  extension: string;
  newName: string;
  selected: boolean;
  status: RenameFileStatus;
  error?: string;
  size?: number;
  modifiedAt?: Date;
  createdAt?: Date;
}

export type RenameFileStatus = 'pending' | 'processing' | 'success' | 'error' | 'conflict';

/**
 * Available rule types
 */
export type RuleType =
  | 'prefix'
  | 'suffix'
  | 'replace'
  | 'regex'
  | 'remove'
  | 'case'
  | 'number'
  | 'move'
  | 'timestamp'
  | 'clear'
  | 'text';

/**
 * Rule configuration types
 */
export interface PrefixConfig {
  text: string;
}

export interface SuffixConfig {
  text: string;
}

export interface ReplaceConfig {
  search: string;
  replace: string;
  caseSensitive: boolean;
}

export interface RegexConfig {
  pattern: string;
  replacement: string;
  flags: string;
}

export interface RemoveConfig {
  mode: 'first' | 'last' | 'range' | 'pattern';
  count: number;
  from: number;
  to: number;
  pattern: string;
}

export type CaseMode = 'upper' | 'lower' | 'title' | 'sentence' | 'capitalize';

export interface CaseConfig {
  mode: CaseMode;
}

export interface NumberConfig {
  position: 'prefix' | 'suffix' | 'replace';
  start: number;
  step: number;
  padding: number;
  separator: string;
}

export interface MoveConfig {
  from: number;
  length: number;
  to: number;
}

export type TimestampSource = 'current' | 'modified' | 'created';

export interface TimestampConfig {
  format: string;
  position: 'prefix' | 'suffix';
  separator: string;
  source: TimestampSource;
}

export interface ClearConfig {
  // Empty config - clears the entire filename
}

export interface TextConfig {
  text: string;
}

export type RuleConfig =
  | PrefixConfig
  | SuffixConfig
  | ReplaceConfig
  | RegexConfig
  | RemoveConfig
  | CaseConfig
  | NumberConfig
  | MoveConfig
  | TimestampConfig
  | ClearConfig
  | TextConfig;

/**
 * Rename rule
 */
export interface RenameRule {
  id: string;
  type: RuleType;
  enabled: boolean;
  config: RuleConfig;
}

/**
 * Operation mode
 */
export type RenameMode = 'rename' | 'copy';

/**
 * Progress tracking
 */
export interface RenameProgress {
  status: 'idle' | 'processing' | 'completed' | 'error' | 'cancelled';
  current: number;
  total: number;
  currentFile?: string;
}

/**
 * Result of a rename operation
 */
export interface RenameResult {
  id: string;
  success: boolean;
  originalPath: string;
  newPath?: string;
  error?: string;
}

/**
 * Default configurations for each rule type
 */
export const DEFAULT_RULE_CONFIGS: Record<RuleType, RuleConfig> = {
  prefix: { text: '' } as PrefixConfig,
  suffix: { text: '' } as SuffixConfig,
  replace: { search: '', replace: '', caseSensitive: false } as ReplaceConfig,
  regex: { pattern: '', replacement: '', flags: 'g' } as RegexConfig,
  remove: { mode: 'first', count: 1, from: 0, to: 0, pattern: '' } as RemoveConfig,
  case: { mode: 'lower' } as CaseConfig,
  number: { position: 'suffix', start: 1, step: 1, padding: 2, separator: '_' } as NumberConfig,
  move: { from: 0, length: 1, to: 0 } as MoveConfig,
  timestamp: { format: 'YYYY-MM-DD', position: 'prefix', separator: '_', source: 'current' } as TimestampConfig,
  clear: {} as ClearConfig,
  text: { text: '' } as TextConfig,
};

/**
 * Rule type labels for UI
 */
export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  prefix: 'Prefix',
  suffix: 'Suffix',
  replace: 'Replace',
  regex: 'Regex Replace',
  remove: 'Remove',
  case: 'Change Case',
  number: 'Numbering',
  move: 'Move/Swap',
  timestamp: 'Timestamp',
  clear: 'Clear',
  text: 'Text',
};

/**
 * Rule type descriptions for UI
 */
export const RULE_TYPE_DESCRIPTIONS: Record<RuleType, string> = {
  prefix: 'Add text at the beginning',
  suffix: 'Add text before extension',
  replace: 'Find and replace text',
  regex: 'Replace using regular expressions',
  remove: 'Remove characters or patterns',
  case: 'Change text case (upper/lower/title)',
  number: 'Add sequential numbering',
  move: 'Move a segment to another position',
  timestamp: 'Add date/time stamp',
  clear: 'Remove entire filename',
  text: 'Set filename to static text',
};

/**
 * Rule preset - a saved collection of rules
 */
export interface RulePreset {
  id: string;
  name: string;
  description: string;
  rules: Omit<RenameRule, 'id'>[];
  isBuiltIn: boolean;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Built-in presets for common renaming patterns
 */
export const BUILT_IN_PRESETS: RulePreset[] = [
  {
    id: 'builtin-clean-filenames',
    name: 'Clean Filenames',
    description: 'Remove special characters and clean up spaces',
    isBuiltIn: true,
    rules: [
      {
        type: 'regex',
        enabled: true,
        config: { pattern: '[\\[\\]\\(\\)\\{\\}]', replacement: '', flags: 'g' } as RegexConfig,
      },
      {
        type: 'replace',
        enabled: true,
        config: { search: '_', replace: ' ', caseSensitive: false } as ReplaceConfig,
      },
      {
        type: 'regex',
        enabled: true,
        config: { pattern: '\\s+', replacement: ' ', flags: 'g' } as RegexConfig,
      },
      {
        type: 'regex',
        enabled: true,
        config: { pattern: '^\\s+|\\s+$', replacement: '', flags: 'g' } as RegexConfig,
      },
    ],
  },
  {
    id: 'builtin-lowercase',
    name: 'Lowercase All',
    description: 'Convert all filenames to lowercase',
    isBuiltIn: true,
    rules: [
      {
        type: 'case',
        enabled: true,
        config: { mode: 'lower' } as CaseConfig,
      },
    ],
  },
  {
    id: 'builtin-sequence-prefix',
    name: 'Add Sequence Numbers',
    description: 'Add sequential numbers as prefix (01_, 02_, ...)',
    isBuiltIn: true,
    rules: [
      {
        type: 'number',
        enabled: true,
        config: { position: 'prefix', start: 1, step: 1, padding: 2, separator: '_' } as NumberConfig,
      },
    ],
  },
  {
    id: 'builtin-date-prefix',
    name: 'Add Date Prefix',
    description: 'Add current date as prefix (YYYY-MM-DD_)',
    isBuiltIn: true,
    rules: [
      {
        type: 'timestamp',
        enabled: true,
        config: { format: 'YYYY-MM-DD', position: 'prefix', separator: '_', source: 'current' } as TimestampConfig,
      },
    ],
  },
  {
    id: 'builtin-title-case',
    name: 'Title Case',
    description: 'Capitalize first letter of each word',
    isBuiltIn: true,
    rules: [
      {
        type: 'replace',
        enabled: true,
        config: { search: '_', replace: ' ', caseSensitive: false } as ReplaceConfig,
      },
      {
        type: 'replace',
        enabled: true,
        config: { search: '-', replace: ' ', caseSensitive: false } as ReplaceConfig,
      },
      {
        type: 'case',
        enabled: true,
        config: { mode: 'title' } as CaseConfig,
      },
    ],
  },
  {
    id: 'builtin-url-friendly',
    name: 'URL Friendly',
    description: 'Make filenames safe for URLs (lowercase, hyphens)',
    isBuiltIn: true,
    rules: [
      {
        type: 'case',
        enabled: true,
        config: { mode: 'lower' } as CaseConfig,
      },
      {
        type: 'replace',
        enabled: true,
        config: { search: ' ', replace: '-', caseSensitive: false } as ReplaceConfig,
      },
      {
        type: 'replace',
        enabled: true,
        config: { search: '_', replace: '-', caseSensitive: false } as ReplaceConfig,
      },
      {
        type: 'regex',
        enabled: true,
        config: { pattern: '[^a-z0-9\\-]', replacement: '', flags: 'g' } as RegexConfig,
      },
      {
        type: 'regex',
        enabled: true,
        config: { pattern: '-+', replacement: '-', flags: 'g' } as RegexConfig,
      },
    ],
  },
];
