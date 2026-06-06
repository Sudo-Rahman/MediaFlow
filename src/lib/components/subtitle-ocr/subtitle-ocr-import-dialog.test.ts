import { describe, expect, it } from 'vitest';

import type { SubtitleOcrTrackMetadata } from '$lib/types';
import {
  buildSubtitleOcrTrackItem,
  clearTrackSelection,
  importSelectedSubtitleOcrTracks,
  resolveImportButtonLabel,
  selectAllTrackSelection,
  selectForcedTrackSelection,
  toggleTrackSelection,
} from './subtitle-ocr-import-dialog-state';

const track = {
  streamIndex: 7,
  codec: 'hdmv_pgs_subtitle',
  codecLabel: 'PGS',
  language: 'jpn',
  title: 'Signs and songs',
  forced: true,
  default: false,
} satisfies SubtitleOcrTrackMetadata;

describe('subtitle OCR import dialog state', () => {
  it('toggles track selection without mutating the original set', () => {
    const selected = new Set([1, 3]);

    const added = toggleTrackSelection(selected, 7);
    const removed = toggleTrackSelection(added, 3);

    expect([...selected]).toEqual([1, 3]);
    expect([...added].sort((a, b) => a - b)).toEqual([1, 3, 7]);
    expect([...removed].sort((a, b) => a - b)).toEqual([1, 7]);
  });

  it('builds quick-action selections for all, forced-only, and clear', () => {
    const tracks: SubtitleOcrTrackMetadata[] = [
      { ...track, streamIndex: 1, forced: false },
      { ...track, streamIndex: 2, forced: true },
      { ...track, streamIndex: 3, forced: true },
    ];

    expect([...selectAllTrackSelection(tracks)]).toEqual([1, 2, 3]);
    expect([...selectForcedTrackSelection(tracks)]).toEqual([2, 3]);
    expect([...clearTrackSelection()]).toEqual([]);
  });

  it('builds a ready container track item with a default OCR model override', () => {
    const item = buildSubtitleOcrTrackItem('/media/Movie.mkv', track);

    expect(item).toMatchObject({
      id: 'subtitle-ocr-track-%2Fmedia%2FMovie.mkv%3A%3A7',
      sourceKind: 'container_track',
      sourcePath: '/media/Movie.mkv',
      displayName: 'Movie.mkv',
      status: 'ready',
      ocrModelOverride: 'default',
      versions: [],
      activeVersionId: null,
      track,
    });
  });

  it('honors an explicit OCR model override', () => {
    const item = buildSubtitleOcrTrackItem('/media/Movie.mkv', track, 'latin');

    expect(item.ocrModelOverride).toBe('latin');
  });

  it('copies the source duration onto imported container track items', () => {
    const item = buildSubtitleOcrTrackItem('/media/Movie.mkv', track, 'default', 7421.25);

    expect(item.duration).toBe(7421.25);
  });

  it('resolves import button labels from selected track count', () => {
    expect(resolveImportButtonLabel(0)).toBe('Import selected tracks');
    expect(resolveImportButtonLabel(1)).toBe('Import 1 track');
    expect(resolveImportButtonLabel(3)).toBe('Import 3 tracks');
  });

  it('closes the import dialog before waiting for imported tracks to hydrate', async () => {
    const events: string[] = [];
    let finishImport!: () => void;
    const importPromise = new Promise<void>((resolve) => {
      finishImport = resolve;
    });

    const pending = importSelectedSubtitleOcrTracks({
      sourcePath: '/media/Movie.mkv',
      sourceDuration: 7421.25,
      tracks: [track],
      selectedTrackIndices: new Set([track.streamIndex]),
      getTrackOverride: () => 'default',
      closeDialog: () => {
        events.push('close');
      },
      onImport: async (items) => {
        events.push('import-start');
        expect(items[0]?.duration).toBe(7421.25);
        await importPromise;
        events.push('import-finish');
      },
    });

    expect(events).toEqual(['close', 'import-start']);

    finishImport();
    await pending;

    expect(events).toEqual(['close', 'import-start', 'import-finish']);
  });
});
