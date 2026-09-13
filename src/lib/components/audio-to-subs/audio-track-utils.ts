import type { ScannedFile } from '$lib/services/ffprobe';
import type { AudioFile, AudioTrackInfo, BatchTrackStrategy } from '$lib/types';
import { resolveDeepgramTrackLanguage } from '$lib/utils/audio-language';

export interface ProbedAudioFile {
  file: AudioFile;
  probeResult: ScannedFile;
  audioTracks: AudioTrackInfo[];
  needsTranscoding: boolean;
}

export function extractAudioTracks(probeResult: ScannedFile): AudioTrackInfo[] {
  return probeResult.tracks
    .filter((track) => track.type === 'audio')
    .map((track, index) => ({
      index,
      codec: track.codec || 'unknown',
      channels: track.channels ?? 2,
      sampleRate: track.sampleRate ?? 48_000,
      bitrate: track.bitrate,
      language: track.language,
      title: track.title,
      isDefault: track.default,
    }));
}

export function buildProbedFileUpdate(
  file: AudioFile,
  probeResult: ScannedFile,
  audioTracks: AudioTrackInfo[],
  trackIndex: number = 0,
): Partial<AudioFile> {
  const selectedTrack = audioTracks[trackIndex];

  if (audioTracks.length === 0) {
    return {
      status: 'error',
      error: 'No audio tracks found in this file.',
      audioTrackCount: 0,
    };
  }

  return {
    duration: probeResult.duration,
    format: selectedTrack?.codec,
    channels: selectedTrack?.channels,
    sampleRate: selectedTrack?.sampleRate,
    bitrate: selectedTrack?.bitrate || probeResult.bitrate,
    size:
      selectedTrack?.bitrate && probeResult.duration
        ? Math.round((selectedTrack.bitrate * probeResult.duration) / 8)
        : probeResult.size || file.size,
    status: 'ready',
    selectedTrackIndex: trackIndex,
    audioTrackLanguage: selectedTrack?.language,
    audioTrackTitle: selectedTrack?.title,
    audioTrackCount: audioTracks.length,
  };
}

export function collectResolvedTrackLanguages(files: ProbedAudioFile[]): string[] {
  const languages = new Set<string>();

  for (const file of files) {
    for (const track of file.audioTracks) {
      const resolvedLanguage = resolveDeepgramTrackLanguage(track.language);
      if (resolvedLanguage) {
        languages.add(resolvedLanguage);
      }
    }
  }

  return Array.from(languages);
}

export function resolveTrackIndex(strategy: BatchTrackStrategy, tracks: AudioTrackInfo[]): number {
  switch (strategy.type) {
    case 'default': {
      const defaultTrack = tracks.find((track) => track.isDefault);
      return defaultTrack?.index ?? 0;
    }
    case 'language': {
      const languageTrack = tracks.find(
        (track) => resolveDeepgramTrackLanguage(track.language) === strategy.language.toLowerCase(),
      );
      return languageTrack?.index ?? 0;
    }
    case 'first':
      return 0;
    case 'index':
      return Math.min(strategy.index, tracks.length - 1);
    case 'individual':
    default:
      return 0;
  }
}
