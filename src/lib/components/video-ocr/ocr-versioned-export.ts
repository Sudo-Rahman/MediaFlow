import { ocrVersionToSubtitleFile } from '$lib/services/subtitle-interop';
import type { OcrOutputFormat, OcrVersion, OcrVideoFile } from '$lib/types/video-ocr';
import type { VersionedImportItem } from '$lib/types/tool-import';
import { getAllowedOcrVersionExportFormats } from '$lib/utils';

type PublishedOcrVersionedImportItem = Omit<VersionedImportItem, 'sourceId' | 'sourceTool' | 'itemType'>;

const DEFAULT_OCR_RESULT_FORMATS: OcrOutputFormat[] = ['srt', 'vtt', 'ass'];

export function buildOcrVersionKey(videoPath: string, versionId: string): string {
  return `${videoPath}::${versionId}`;
}

export function getOcrResultVersionAllowedFormats(
  version: Pick<OcrVersion, 'finalSubtitles'> | null | undefined,
): OcrOutputFormat[] {
  return version ? getAllowedOcrVersionExportFormats(version) : DEFAULT_OCR_RESULT_FORMATS;
}

export function createOcrVersionedImportItems(
  files: readonly OcrVideoFile[],
  persistedOcrVersionKeys: ReadonlySet<string>,
): PublishedOcrVersionedImportItem[] {
  return files.flatMap((file) =>
    file.ocrVersions.map((version) => ({
      key: `video-ocr:${file.path}:${version.id}`,
      name: `${file.name} - ${version.name}`,
      kind: 'subtitle' as const,
      createdAt: Date.parse(version.createdAt) || Date.now(),
      mediaPath: file.path,
      mediaName: file.name,
      versionId: version.id,
      versionName: version.name,
      versionCreatedAt: version.createdAt,
      persisted: persistedOcrVersionKeys.has(buildOcrVersionKey(file.path, version.id))
        ? 'mediaflow' as const
        : 'memory' as const,
      allowedFormats: getAllowedOcrVersionExportFormats(version),
      subtitleFile: ocrVersionToSubtitleFile(file.path, file.name, version),
    })),
  );
}
