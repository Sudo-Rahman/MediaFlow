import type {
  SubtitleOcrModelOverride,
  SubtitleOcrSourceItem,
  SubtitleOcrTrackMetadata,
} from '$lib/types';
import { getFileName } from '$lib/utils/format';

export type SubtitleOcrImportTrack = SubtitleOcrTrackMetadata;

interface ImportSelectedSubtitleOcrTracksOptions {
  sourcePath: string;
  sourceDuration?: number;
  tracks: readonly SubtitleOcrImportTrack[];
  selectedTrackIndices: ReadonlySet<number>;
  getTrackOverride: (streamIndex: number) => SubtitleOcrModelOverride;
  closeDialog: () => void;
  onImport: (items: SubtitleOcrSourceItem[]) => void | Promise<void>;
}

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
  sourceDuration?: number,
): SubtitleOcrSourceItem {
  return {
    id: buildTrackItemId(sourcePath, track.streamIndex),
    sourceKind: 'container_track',
    sourcePath,
    track: { ...track },
    displayName: getFileName(sourcePath),
    status: 'ready',
    ...(sourceDuration !== undefined ? { duration: sourceDuration } : {}),
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

export async function importSelectedSubtitleOcrTracks({
  sourcePath,
  sourceDuration,
  tracks,
  selectedTrackIndices,
  getTrackOverride,
  closeDialog,
  onImport,
}: ImportSelectedSubtitleOcrTracksOptions): Promise<void> {
  const items = tracks
    .filter((track) => selectedTrackIndices.has(track.streamIndex))
    .map((track) => buildSubtitleOcrTrackItem(
      sourcePath,
      track,
      getTrackOverride(track.streamIndex),
      sourceDuration,
    ));

  closeDialog();
  await onImport(items);
}
