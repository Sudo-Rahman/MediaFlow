import type { ToolId } from './tool-import';

export type ImportIntent = 'primary' | 'merge-video' | 'merge-track';

export interface ImportPolicy {
  readonly intent: ImportIntent;
  readonly dialogTitle: string;
  readonly filterName: string;
  readonly formatLabel: string;
  /** Dot-prefixed, lower-case extensions. `null` means all extensions. */
  readonly extensions: readonly string[] | null;
  readonly excludeMediaflowSidecars: boolean;
}

const MEDIA_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.webm', '.m4v', '.mks', '.mka'] as const;
const VIDEO_EXTENSIONS = [...MEDIA_EXTENSIONS] as const;
const SUBTITLE_EXTENSIONS = ['.ass', '.ssa', '.srt', '.sub', '.idx', '.vtt', '.sup'] as const;
const AUDIO_EXTENSIONS = ['.aac', '.ac3', '.dts', '.flac', '.mp3', '.ogg', '.wav', '.eac3', '.opus'] as const;
const TRACK_EXTENSIONS = [...SUBTITLE_EXTENSIONS, ...AUDIO_EXTENSIONS] as const;
const TRANSCODE_EXTENSIONS = [
  '.mkv', '.mp4', '.mov', '.webm', '.m4v', '.avi', '.mxf',
  '.m4a', '.aac', '.mp3', '.flac', '.opus', '.wav', '.ogg', '.ac3', '.eac3', '.mka',
] as const;
const AUDIO_TO_SUBS_EXTENSIONS = [
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus', '.wma',
  '.ac3', '.dts', '.mka', '.webm', '.mp4', '.mkv',
] as const;
const TRANSLATION_EXTENSIONS = ['.srt', '.ass', '.vtt', '.ssa'] as const;
const VIDEO_OCR_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm'] as const;

function formatLabel(extensions: readonly string[]): string {
  return extensions.map((extension) => extension.slice(1).toUpperCase()).join(', ');
}

export const PRIMARY_IMPORT_POLICY: ImportPolicy = {
  intent: 'primary',
  dialogTitle: 'Select media files',
  filterName: 'Media files',
  formatLabel: formatLabel(MEDIA_EXTENSIONS),
  extensions: MEDIA_EXTENSIONS,
  excludeMediaflowSidecars: false,
};

export const MERGE_VIDEO_IMPORT_POLICY: ImportPolicy = {
  intent: 'merge-video',
  dialogTitle: 'Select video files',
  filterName: 'Video files',
  formatLabel: formatLabel(VIDEO_EXTENSIONS),
  extensions: VIDEO_EXTENSIONS,
  excludeMediaflowSidecars: false,
};

export const MERGE_TRACK_IMPORT_POLICY: ImportPolicy = {
  intent: 'merge-track',
  dialogTitle: 'Select track files',
  filterName: 'All tracks',
  formatLabel: formatLabel(TRACK_EXTENSIONS),
  extensions: TRACK_EXTENSIONS,
  excludeMediaflowSidecars: false,
};

/** Rename intentionally accepts every regular file, except MediaFlow sidecars. */
export const RENAME_IMPORT_POLICY: ImportPolicy = {
  intent: 'primary',
  dialogTitle: 'Select files to rename',
  filterName: 'All files',
  formatLabel: 'All files',
  extensions: null,
  excludeMediaflowSidecars: true,
};

export const IMPORT_POLICIES = {
  primary: PRIMARY_IMPORT_POLICY,
  'merge-video': MERGE_VIDEO_IMPORT_POLICY,
  'merge-track': MERGE_TRACK_IMPORT_POLICY,
  rename: RENAME_IMPORT_POLICY,
} as const;

function toolPolicy(
  extensions: readonly string[],
  dialogTitle: string,
  filterName: string,
): ImportPolicy {
  return {
    intent: 'primary',
    dialogTitle,
    filterName,
    formatLabel: formatLabel(extensions),
    extensions,
    excludeMediaflowSidecars: false,
  };
}

/** Tool-specific policies retain the formats each existing view supports. */
export const TOOL_IMPORT_POLICIES: Readonly<Record<ToolId, ImportPolicy>> = {
  extract: PRIMARY_IMPORT_POLICY,
  merge: MERGE_VIDEO_IMPORT_POLICY,
  transcode: toolPolicy(TRANSCODE_EXTENSIONS, 'Select media files', 'Media files'),
  translate: toolPolicy(TRANSLATION_EXTENSIONS, 'Select subtitle files', 'Subtitle files'),
  rename: RENAME_IMPORT_POLICY,
  'audio-to-subs': toolPolicy(AUDIO_TO_SUBS_EXTENSIONS, 'Select audio files', 'Audio files'),
  'video-ocr': toolPolicy(VIDEO_OCR_EXTENSIONS, 'Select video files', 'Video files'),
  'subtitle-ocr': toolPolicy(
    ['.mkv', '.m2ts', '.mp4', '.avi', '.mov', '.webm', '.m4v', '.mks', '.sup', '.idx', '.sub'],
    'Select subtitle OCR sources',
    'Subtitle OCR sources',
  ),
  info: PRIMARY_IMPORT_POLICY,
};

/** Return a canonical policy for an import intent. */
export function getImportPolicy(intent: ImportIntent): ImportPolicy {
  return IMPORT_POLICIES[intent];
}

/** Return the policy used by a tool for its ordinary file import. */
export function getToolImportPolicy(tool: ToolId, intent: ImportIntent = 'primary'): ImportPolicy {
  if (tool === 'rename') {
    return RENAME_IMPORT_POLICY;
  }
  if (tool === 'merge') {
    return getImportPolicy(intent === 'primary' ? 'merge-video' : intent);
  }
  return TOOL_IMPORT_POLICIES[tool];
}

/** Normalize a policy extension for dialog and filesystem comparisons. */
export function normalizeImportExtension(extension: string): string {
  const trimmed = extension.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

export function isImportPathAllowed(path: string, policy: ImportPolicy): boolean {
  const normalizedPath = path.replaceAll('\\', '/');
  const basename = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1).toLowerCase();
  if (policy.excludeMediaflowSidecars && basename.endsWith('.mediaflow.json')) {
    return false;
  }
  if (policy.extensions === null) {
    return true;
  }
  const extension = normalizeImportExtension(basename.slice(basename.lastIndexOf('.')));
  return policy.extensions.some((candidate) => normalizeImportExtension(candidate) === extension);
}

export function policyDialogFilter(policy: ImportPolicy): { name: string; extensions: string[] } | undefined {
  if (policy.extensions === null) {
    return undefined;
  }
  return {
    name: policy.filterName,
    extensions: policy.extensions.map((extension) => normalizeImportExtension(extension).slice(1)),
  };
}
