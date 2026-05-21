import type { MergeTrack, MergeTrackConfig } from '$lib/types';

const MKV_UNSUPPORTED_SUBTITLE_COPY_CODECS = new Set(['mov_text', 'tx3g']);

export interface MkvMergeSourceTrackConfig {
  originalIndex: number;
  type: MergeTrack['type'];
  config: MergeTrackConfig;
}

export interface MkvMergeSourceTrackPreparation {
  sourceTrackConfigs: MkvMergeSourceTrackConfig[];
  skippedDataStreams: string[];
  blockingError?: string;
}

function createDefaultSourceTrackConfig(track: MergeTrack): MergeTrackConfig {
  return {
    trackId: track.id,
    enabled: true,
    language: track.language,
    title: track.title,
    default: track.default,
    forced: track.forced,
    delayMs: 0,
    order: 0,
  };
}

function streamLabel(track: Pick<MergeTrack, 'originalIndex' | 'codec' | 'title'>): string {
  const codec = track.codec || 'unknown';
  const title = track.title?.trim();
  return title ? `#${track.originalIndex} ${codec} (${title})` : `#${track.originalIndex} ${codec}`;
}

export function isMkvMergeDisplayTrack(track: Pick<MergeTrack, 'type'>): boolean {
  return track.type !== 'data';
}

export function prepareMkvMergeSourceTracks(
  tracks: MergeTrack[],
  getConfig: (track: MergeTrack) => MergeTrackConfig | undefined,
): MkvMergeSourceTrackPreparation {
  const sourceTrackConfigs: MkvMergeSourceTrackConfig[] = [];
  const skippedDataStreams: string[] = [];

  for (const track of tracks) {
    const config = getConfig(track) ?? createDefaultSourceTrackConfig(track);

    if (!isMkvMergeDisplayTrack(track)) {
      if (config.enabled) {
        skippedDataStreams.push(streamLabel(track));
      }
      continue;
    }

    const codec = track.codec.toLowerCase();
    if (config.enabled && track.type === 'subtitle' && MKV_UNSUPPORTED_SUBTITLE_COPY_CODECS.has(codec)) {
      return {
        sourceTrackConfigs: [],
        skippedDataStreams,
        blockingError: `MKV merge cannot copy subtitle track #${track.originalIndex} (${track.codec}). Disable this track or convert subtitles with Transcode before merging.`,
      };
    }

    sourceTrackConfigs.push({
      originalIndex: track.originalIndex,
      type: track.type,
      config,
    });
  }

  return { sourceTrackConfigs, skippedDataStreams };
}
