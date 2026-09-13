import { describe, expect, it } from 'vitest';

import { buildProbedFileUpdate } from './audio-track-utils';

describe('audio track import probing', () => {
  it('marks a successful probe with no audio tracks as an error', () => {
    const update = buildProbedFileUpdate(
      {
        id: 'audio-1',
        path: '/media/video.mkv',
        name: 'video.mkv',
        size: 10,
        status: 'scanning',
        transcriptionVersions: [],
      },
      {
        path: '/media/video.mkv',
        name: 'video.mkv',
        size: 10,
        tracks: [],
        status: 'ready',
      },
      [],
    );

    expect(update).toEqual({
      status: 'error',
      error: 'No audio tracks found in this file.',
      audioTrackCount: 0,
    });
  });
});
