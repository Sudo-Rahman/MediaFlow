import type { SubtitleFile } from './translation';

export type ToolId =
  | 'extract'
  | 'merge'
  | 'transcode'
  | 'translate'
  | 'rename'
  | 'audio-to-subs'
  | 'video-ocr'
  | 'info';

export type ImportableKind =
  | 'media'
  | 'track_audio'
  | 'track_subtitle'
  | 'track_video'
  | 'subtitle'
  | 'audio'
  | 'generic_file';

export type ImportSourceId =
  | 'extraction_outputs'
  | 'merge_outputs'
  | 'ocr_versions'
  | 'audio_to_subs_versions'
  | 'extraction_media'
  | 'merge_media';

export type ImportItemType = 'path' | 'versioned';

export interface ImportItemBase {
  key: string;
  sourceId: ImportSourceId;
  sourceTool: ToolId;
  name: string;
  kind: ImportableKind;
  createdAt: number;
}

export interface PathImportItem extends ImportItemBase {
  itemType: 'path';
  path: string;
}

export interface VersionedImportItem extends ImportItemBase {
  itemType: 'versioned';
  mediaPath: string;
  mediaName: string;
  versionId: string;
  versionName: string;
  versionCreatedAt: string;
  persisted: 'memory' | 'mediaflow';
  allowedFormats?: readonly string[];
  subtitleFile: SubtitleFile;
}

export type ImportItem = PathImportItem | VersionedImportItem;

export interface ImportSourceSnapshot {
  sourceId: ImportSourceId;
  sourceTool: ToolId;
  label: string;
  itemType: ImportItemType;
  items: ImportItem[];
  updatedAt: number;
}

export interface ImportMenuOption {
  sourceId: ImportSourceId;
  label: string;
  count: number;
  requiresDialog: boolean;
}

export type ImportSelectionMode = 'latest_per_file' | 'all_versions' | 'custom';

export interface ResolveImportRequest {
  targetTool: ToolId;
  sourceId: ImportSourceId;
  selectionMode?: ImportSelectionMode;
  selectedKeys?: string[];
}

export interface ResolvedImportPayload {
  paths: string[];
  subtitleFiles: SubtitleFile[];
}
