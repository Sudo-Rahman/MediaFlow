import { describe, expect, it } from 'vitest';

import type { MergeTrack, MergeTrackConfig } from '$lib/types';
import { isMkvMergeDisplayTrack, prepareMkvMergeSourceTracks } from './merge-compat';

function track(partial: Partial<MergeTrack>): MergeTrack {
  return {
    id: 'track-1',
    sourceFileId: 'video-1',
    originalIndex: 0,
    type: 'video',
    codec: 'h264',
    ...partial,
  };
}

function config(partial: Partial<MergeTrackConfig> = {}): MergeTrackConfig {
  return {
    trackId: 'track-1',
    enabled: true,
    delayMs: 0,
    order: 0,
    ...partial,
  };
}

describe('prepareMkvMergeSourceTracks', () => {
  it('excludes enabled data source tracks and reports skipped stream labels', () => {
    const result = prepareMkvMergeSourceTracks(
      [
        track({ originalIndex: 0, type: 'video', codec: 'h264' }),
        track({ id: 'track-2', originalIndex: 6, type: 'data', codec: 'bin_data' }),
      ],
      () => config(),
    );

    expect(result.sourceTrackConfigs.map((sourceTrack) => sourceTrack.originalIndex)).toEqual([0]);
    expect(result.skippedDataStreams).toEqual(['#6 bin_data']);
    expect(result.blockingError).toBeUndefined();
  });

  it('blocks enabled mov_text subtitles before invoking FFmpeg', () => {
    const result = prepareMkvMergeSourceTracks(
      [track({ originalIndex: 2, type: 'subtitle', codec: 'mov_text' })],
      () => config(),
    );

    expect(result.sourceTrackConfigs).toEqual([]);
    expect(result.blockingError).toBe(
      'MKV merge cannot copy subtitle track #2 (mov_text). Disable this track or convert subtitles with Transcode before merging.',
    );
  });

  it('blocks enabled tx3g subtitles before invoking FFmpeg', () => {
    const result = prepareMkvMergeSourceTracks(
      [track({ originalIndex: 3, type: 'subtitle', codec: 'tx3g' })],
      () => config(),
    );

    expect(result.sourceTrackConfigs).toEqual([]);
    expect(result.blockingError).toBe(
      'MKV merge cannot copy subtitle track #3 (tx3g). Disable this track or convert subtitles with Transcode before merging.',
    );
  });

  it('allows disabled mov_text subtitles to be passed through as disabled source config', () => {
    const result = prepareMkvMergeSourceTracks(
      [track({ originalIndex: 2, type: 'subtitle', codec: 'mov_text' })],
      () => config({ enabled: false }),
    );

    expect(result.sourceTrackConfigs).toHaveLength(1);
    expect(result.sourceTrackConfigs[0]?.config.enabled).toBe(false);
    expect(result.blockingError).toBeUndefined();
  });
});

describe('isMkvMergeDisplayTrack', () => {
  it('hides data source tracks from Merge UI surfaces', () => {
    expect(isMkvMergeDisplayTrack(track({ type: 'data', codec: 'bin_data' }))).toBe(false);
    expect(isMkvMergeDisplayTrack(track({ type: 'video', codec: 'h264' }))).toBe(true);
    expect(isMkvMergeDisplayTrack(track({ type: 'audio', codec: 'aac' }))).toBe(true);
    expect(isMkvMergeDisplayTrack(track({ type: 'subtitle', codec: 'subrip' }))).toBe(true);
  });
});
