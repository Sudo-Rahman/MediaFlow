import type { OcrVersion } from '$lib/types/video-ocr';

interface VersionLoadKeyFile {
  id: string;
  ocrVersions: readonly Pick<OcrVersion, 'id' | 'createdAt' | 'name' | 'finalSubtitles'>[];
}

function updateHash(hash: number, value: string): number {
  let nextHash = hash;
  for (let i = 0; i < value.length; i += 1) {
    nextHash = Math.imul(nextHash ^ value.charCodeAt(i), 16_777_619);
  }
  return nextHash >>> 0;
}

function buildSubtitleKey(version: Pick<OcrVersion, 'finalSubtitles'>): string {
  let hash = 2_166_136_261;

  for (const subtitle of version.finalSubtitles) {
    hash = updateHash(hash, [
      subtitle.id,
      subtitle.startTime,
      subtitle.endTime,
      subtitle.confidence,
      subtitle.text,
    ].join('\u001f'));
  }

  return `${version.finalSubtitles.length}:${hash.toString(36)}`;
}

export function buildOcrResultVersionLoadKey(file: VersionLoadKeyFile | null): string | null {
  if (!file) {
    return null;
  }

  const versionsKey = file.ocrVersions
    .map((version) => [
      version.id,
      version.createdAt,
      version.name,
      buildSubtitleKey(version),
    ].join(':'))
    .join('|');

  return `${file.id}:${file.ocrVersions.length}:${versionsKey}`;
}

export function createOcrResultVersionSnapshot(versions: readonly OcrVersion[]): OcrVersion[] {
  return versions.map((version) => ({
    ...version,
    rawOcr: [],
  }));
}
