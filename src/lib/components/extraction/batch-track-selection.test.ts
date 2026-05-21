import { describe, expect, test } from 'vitest';

import {
  applyLanguageTokenSelection,
  getSelectedLanguageTokens,
} from './batch-track-selection';
import type { VideoFile } from '$lib/types';

const files: VideoFile[] = [
  {
    path: '/media/movie.mkv',
    name: 'movie.mkv',
    size: 1,
    status: 'ready',
    tracks: [
      { id: 1, index: 0, type: 'video', codec: 'hevc' },
      { id: 2, index: 1, type: 'audio', codec: 'opus', language: 'eng' },
      { id: 3, index: 2, type: 'subtitle', codec: 'ass', language: 'eng' },
      { id: 4, index: 3, type: 'subtitle', codec: 'ass', language: 'ita' },
    ],
  },
];

describe('batch track language tokens', () => {
  test('adds tracks for a newly selected language token and preserves unrelated selections', () => {
    const currentSelection = new Map<string, number[]>([['/media/movie.mkv', [1]]]);

    const selection = applyLanguageTokenSelection(files, currentSelection, ['subtitle:eng']);

    expect(selection.get('/media/movie.mkv')).toEqual([1, 3]);
    expect(getSelectedLanguageTokens(files, selection)).toEqual(['subtitle:eng']);
  });

  test('removes tracks for a deselected language token and keeps other tracks selected', () => {
    const currentSelection = new Map<string, number[]>([['/media/movie.mkv', [1, 3, 4]]]);

    const selection = applyLanguageTokenSelection(files, currentSelection, ['subtitle:ita']);

    expect(selection.get('/media/movie.mkv')).toEqual([1, 4]);
    expect(getSelectedLanguageTokens(files, selection)).toEqual(['subtitle:ita']);
  });

  test('removes the file selection when the only selected language token is deselected', () => {
    const currentSelection = new Map<string, number[]>([['/media/movie.mkv', [3]]]);

    const selection = applyLanguageTokenSelection(files, currentSelection, []);

    expect(selection.has('/media/movie.mkv')).toBe(false);
    expect(getSelectedLanguageTokens(files, selection)).toEqual([]);
  });

  test('preserves selections for files outside the current selector scope', () => {
    const currentSelection = new Map<string, number[]>([
      ['/media/movie.mkv', []],
      ['/media/other.mkv', [9]],
    ]);

    const selection = applyLanguageTokenSelection(files, currentSelection, ['audio:eng']);

    expect(selection.get('/media/movie.mkv')).toEqual([2]);
    expect(selection.get('/media/other.mkv')).toEqual([9]);
  });
});
