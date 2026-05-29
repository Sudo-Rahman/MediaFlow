import type {
  SubtitleOcrModelOverride,
  SubtitleOcrSourceItem,
  SubtitleOcrTrackMetadata,
} from '$lib/types';
import { getFileName } from '$lib/utils/format';

export type SubtitleOcrImportTrack = SubtitleOcrTrackMetadata;

function buildTrackItemId(sourcePath: string, streamIndex: number): string {
  return `subtitle-ocr-track-${encodeURIComponent(`${sourcePath}::${streamIndex}`)}`;
}

export function toggleTrackSelection(selected: Set<number>, streamIndex: number): Set<number> {
  const next = new Set(selected);
  if (next.has(streamIndex)) {
    next.delete(streamIndex);
  } else {
    next.add(streamIndex);
  }

  return next;
}

export function selectAllTrackSelection(tracks: readonly SubtitleOcrImportTrack[]): Set<number> {
  return new Set(tracks.map((track) => track.streamIndex));
}

export function selectForcedTrackSelection(tracks: readonly SubtitleOcrImportTrack[]): Set<number> {
  return new Set(
    tracks
      .filter((track) => track.forced === true)
      .map((track) => track.streamIndex),
  );
}

export function clearTrackSelection(): Set<number> {
  return new Set();
}

export function buildSubtitleOcrTrackItem(
  sourcePath: string,
  track: SubtitleOcrImportTrack,
  ocrModelOverride: SubtitleOcrModelOverride = 'default',
): SubtitleOcrSourceItem {
  return {
    id: buildTrackItemId(sourcePath, track.streamIndex),
    sourceKind: 'container_track',
    sourcePath,
    track: { ...track },
    displayName: getFileName(sourcePath),
    status: 'ready',
    ocrModelOverride,
    versions: [],
    activeVersionId: null,
  };
}

export function resolveImportButtonLabel(count: number): string {
  if (count === 1) {
    return 'Import 1 track';
  }

  if (count > 1) {
    return `Import ${count} tracks`;
  }

  return 'Import selected tracks';
}
