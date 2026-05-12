import type { OcrVersion } from '$lib/types/video-ocr';

interface VersionLoadKeyFile {
  id: string;
  ocrVersions: readonly Pick<OcrVersion, 'id' | 'createdAt'>[];
}

export function buildOcrResultVersionLoadKey(file: VersionLoadKeyFile | null): string | null {
  if (!file) {
    return null;
  }

  const versionsKey = file.ocrVersions
    .map((version) => `${version.id}:${version.createdAt}`)
    .join('|');

  return `${file.id}:${file.ocrVersions.length}:${versionsKey}`;
}

export function createOcrResultVersionSnapshot(versions: readonly OcrVersion[]): OcrVersion[] {
  return versions.map((version) => ({
    ...version,
    rawOcr: [],
  }));
}
