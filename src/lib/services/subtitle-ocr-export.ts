import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';

import {
  SUBTITLE_OCR_OUTPUT_FORMATS,
  type SubtitleOcrCue,
  type SubtitleOcrSourceItem,
} from '$lib/types';

import {
  buildUniqueExportFileName,
  runBatchExport,
  stripFileExtension,
  type RunBatchExportResult,
  type VersionedExportFormatOption,
  type VersionedExportGroup,
  type VersionedExportRequest,
} from './versioned-export';

export const SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS = ['ass', 'srt', 'vtt'] as const;

export type SubtitleOcrExportFormat = (typeof SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS)[number];

export interface RustSubtitleOcrCue {
  id: string;
  sourceCueIds: string[];
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  confidence: number;
}

export const SUBTITLE_OCR_EXPORT_FORMAT_OPTIONS: VersionedExportFormatOption[] =
  SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS.map((value) => {
    const option = SUBTITLE_OCR_OUTPUT_FORMATS.find((format) => format.value === value);
    return {
      value,
      label: option?.label ?? value.toUpperCase(),
    };
  });

function isSubtitleOcrExportFormat(format: string): format is SubtitleOcrExportFormat {
  return SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS.includes(format as SubtitleOcrExportFormat);
}

function formatVersionCount(count: number): string {
  return `${count} ${count === 1 ? 'version' : 'versions'}`;
}

function isExportableCue(cue: SubtitleOcrCue): boolean {
  return cue.text.trim().length > 0
    && Number.isFinite(cue.startTimeMs)
    && Number.isFinite(cue.endTimeMs)
    && cue.startTimeMs >= 0
    && cue.endTimeMs > cue.startTimeMs;
}

function getExportableCues(cues: readonly SubtitleOcrCue[]): SubtitleOcrCue[] {
  return cues.filter(isExportableCue);
}

export function toRustSubtitleOcrCues(cues: readonly SubtitleOcrCue[]): RustSubtitleOcrCue[] {
  return cues.map((cue) => ({
    id: cue.id,
    sourceCueIds: [...cue.sourceCueIds],
    startTimeMs: cue.startTimeMs,
    endTimeMs: cue.endTimeMs,
    text: cue.text,
    confidence: cue.confidence,
  }));
}

export function buildSubtitleOcrExportGroups(
  items: readonly SubtitleOcrSourceItem[],
): VersionedExportGroup[] {
  return items
    .map((item): VersionedExportGroup | null => {
      if (item.versions.length === 0) {
        return null;
      }

      return {
        fileId: item.id,
        fileName: item.displayName,
        fileBadge: formatVersionCount(item.versions.length),
        versions: item.versions.map((version) => ({
          key: `${item.id}:${version.id}`,
          versionId: version.id,
          versionName: version.name,
          createdAt: version.createdAt,
          allowedFormats: SUBTITLE_OCR_ALLOWED_EXPORT_FORMATS,
        })),
      };
    })
    .filter((group): group is VersionedExportGroup => group !== null);
}

export async function runSubtitleOcrBatchExport(
  request: VersionedExportRequest,
  items: readonly SubtitleOcrSourceItem[],
): Promise<RunBatchExportResult> {
  if (!isSubtitleOcrExportFormat(request.format)) {
    throw new Error('Invalid export format');
  }

  const targetFormat = request.format;
  const usedNames = new Set<string>();
  const itemsById = new Map(items.map((item) => [item.id, item]));

  return runBatchExport(request.targets, async (target) => {
    const item = itemsById.get(target.fileId);
    if (!item) {
      throw new Error(`Subtitle OCR source not found: ${target.fileId}`);
    }

    const version = item.versions.find((entry) => entry.id === target.versionId);
    if (!version) {
      throw new Error(`Subtitle OCR version not found: ${target.versionId}`);
    }

    const exportableCues = getExportableCues(version.finalCues);
    if (exportableCues.length === 0) {
      throw new Error('No valid Subtitle OCR cues to export');
    }

    const exportFileName = buildUniqueExportFileName(
      stripFileExtension(target.fileName),
      target.versionName,
      targetFormat,
      usedNames,
    );
    const outputPath = await join(request.outputDir, exportFileName);

    await invoke('export_subtitle_ocr_version', {
      cues: toRustSubtitleOcrCues(exportableCues),
      outputPath,
      format: targetFormat,
    });
  });
}
