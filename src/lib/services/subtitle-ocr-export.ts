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
  placement: 'top' | 'bottom';
  placementSourceCount?: number;
  topPlacementSourceCount?: number;
}

interface ExportSubtitleOcrVersionRequest {
  cues: readonly SubtitleOcrCue[];
  outputPath: string;
  format: SubtitleOcrExportFormat;
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

export function countExportableSubtitleOcrCues(cues: readonly SubtitleOcrCue[]): number {
  return getExportableCues(cues).length;
}

export function toRustSubtitleOcrCues(cues: readonly SubtitleOcrCue[]): RustSubtitleOcrCue[] {
  return cues.map((cue) => {
    const rustCue: RustSubtitleOcrCue = {
      id: cue.id,
      sourceCueIds: [...cue.sourceCueIds],
      startTimeMs: cue.startTimeMs,
      endTimeMs: cue.endTimeMs,
      text: cue.text,
      confidence: cue.confidence,
      placement: cue.placement === 'top' ? 'top' : 'bottom',
    };

    const placementSourceCount = cue.placementSourceCount;
    if (typeof placementSourceCount === 'number'
      && Number.isInteger(placementSourceCount)
      && placementSourceCount >= 0) {
      rustCue.placementSourceCount = placementSourceCount;
    }

    const topPlacementSourceCount = cue.topPlacementSourceCount;
    if (typeof topPlacementSourceCount === 'number'
      && Number.isInteger(topPlacementSourceCount)
      && topPlacementSourceCount >= 0) {
      rustCue.topPlacementSourceCount = topPlacementSourceCount;
    }

    return rustCue;
  });
}

function formatSrtTime(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1_000);
  const millis = safeMs % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function formatVttTime(ms: number): string {
  return formatSrtTime(ms).replace(',', '.');
}

function formatAssTime(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const centiseconds = Math.floor((safeMs % 1_000) / 10);
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1_000);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function formatAssText(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\n/g, '\\N');
}

function formatAssCueText(cue: SubtitleOcrCue): string {
  const text = formatAssText(cue.text);
  return cue.placement === 'top' ? `{\\an8}${text}` : text;
}

export function buildSubtitleOcrPreview(
  cues: readonly SubtitleOcrCue[],
  format: SubtitleOcrExportFormat,
): string {
  const exportableCues = getExportableCues(cues);
  if (exportableCues.length === 0) {
    return '';
  }

  switch (format) {
    case 'ass': {
      const events = exportableCues
        .map((cue) => (
          `Dialogue: 0,${formatAssTime(cue.startTimeMs)},${formatAssTime(cue.endTimeMs)},Default,,0,0,0,,${formatAssCueText(cue)}`
        ))
        .join('\n');

      return [
        '[Script Info]',
        'ScriptType: v4.00+',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,40,1',
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        events,
      ].join('\n');
    }
    case 'vtt':
      return `WEBVTT\n\n${exportableCues
        .map((cue) => `${formatVttTime(cue.startTimeMs)} --> ${formatVttTime(cue.endTimeMs)}\n${cue.text}\n`)
        .join('\n')}`;
    case 'srt':
      return exportableCues
        .map((cue, index) => `${index + 1}\n${formatSrtTime(cue.startTimeMs)} --> ${formatSrtTime(cue.endTimeMs)}\n${cue.text}\n`)
        .join('\n');
  }
}

export async function exportSubtitleOcrVersion({
  cues,
  outputPath,
  format,
}: ExportSubtitleOcrVersionRequest): Promise<void> {
  if (!isSubtitleOcrExportFormat(format)) {
    throw new Error('Invalid export format');
  }

  const exportableCues = getExportableCues(cues);
  if (exportableCues.length === 0) {
    throw new Error('No valid Subtitle OCR cues to export');
  }

  await invoke('export_subtitle_ocr_version', {
    cues: toRustSubtitleOcrCues(exportableCues),
    outputPath,
    format,
  });
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

    const exportFileName = buildUniqueExportFileName(
      stripFileExtension(target.fileName),
      target.versionName,
      targetFormat,
      usedNames,
    );
    const outputPath = await join(request.outputDir, exportFileName);

    await exportSubtitleOcrVersion({
      cues: version.finalCues,
      outputPath,
      format: targetFormat,
    });
  });
}
