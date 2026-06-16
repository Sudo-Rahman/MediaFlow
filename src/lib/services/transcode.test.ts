import { describe, expect, it } from 'vitest';

import type { Track, TranscodeCapabilities, TranscodeFile, TranscodeProfile } from '$lib/types';
import {
  buildDefaultVideoSettings,
  createTranscodeRequest,
  getEffectiveVideoResolution,
  getTranscodeCompatibilityIssues,
  getVideoResolutionPairedDimension,
  getVideoResolutionPresetOptions,
  getVideoResolutionPresetValue,
  normalizeVideoResolutionSettings,
} from './transcode';

function videoTrack(width: number, height: number): Track {
  return {
    id: 0,
    index: 0,
    type: 'video',
    codec: 'h264',
    width,
    height,
  };
}

const metadataSchema = {
  supportsContainerTitle: true,
  supportsTrackTitle: true,
  supportsLanguage: true,
  supportsDefault: true,
  supportsForced: true,
  clearsMatroskaStatistics: true,
};

function capabilities(): TranscodeCapabilities {
  return {
    ffmpegVersion: 'test-ffmpeg',
    hwaccels: [],
    containers: [
      {
        id: 'mkv',
        label: 'MKV',
        extension: '.mkv',
        kind: 'video',
        muxerName: 'matroska',
        supportedVideoEncoderIds: ['libx264'],
        supportedAudioEncoderIds: ['aac'],
        supportedSubtitleEncoderIds: ['srt'],
        supportedSubtitleModes: ['disable', 'copy', 'convert_text'],
        defaultVideoEncoderId: 'libx264',
        defaultAudioEncoderId: 'aac',
        defaultSubtitleEncoderId: 'srt',
        metadataSchema,
      },
    ],
    videoEncoders: [],
    audioEncoders: [],
    subtitleEncoders: [],
    defaultAnalysisFrameCount: 6,
  };
}

function transcodeFile(profile: TranscodeProfile): TranscodeFile {
  return {
    id: 'file-1',
    path: '/tmp/source.mkv',
    name: 'source.mkv',
    size: 1024,
    duration: 60,
    bitrate: 1_000_000,
    format: 'matroska',
    tracks: [videoTrack(1920, 1080)],
    status: 'ready',
    error: undefined,
    rawData: undefined,
    createdAt: undefined,
    modifiedAt: undefined,
    hasVideo: true,
    hasAudio: false,
    profile,
    metadata: { trackEdits: [] },
    analysisFrames: [],
    aiStatus: 'idle',
    aiError: undefined,
    aiRecommendation: undefined,
    lastOutputPath: undefined,
  };
}

function profileWithResolution(resolution: TranscodeProfile['video']['resolution']): TranscodeProfile {
  return {
    containerId: 'mkv',
    video: {
      mode: 'transcode',
      encoderId: 'libx264',
      qualityMode: 'crf',
      crf: 20,
      resolution,
      additionalArgs: [],
    },
    audio: {
      mode: 'disable',
      additionalArgs: [],
      trackOverrides: [],
    },
    subtitles: {
      mode: 'disable',
      additionalArgs: [],
    },
  };
}

describe('transcode video resolution helpers', () => {
  it('defaults video resolution to the original source', () => {
    const settings = buildDefaultVideoSettings(null, 'mp4', true);

    expect(settings.resolution).toEqual({ mode: 'source' });
  });

  it('normalizes legacy video settings without a resolution field', () => {
    const legacyVideo = {
      mode: 'transcode',
      encoderId: 'libx264',
      qualityMode: 'crf',
      crf: 20,
      additionalArgs: [],
    } as unknown as TranscodeProfile['video'];

    expect(normalizeVideoResolutionSettings(legacyVideo.resolution)).toEqual({ mode: 'source' });
  });

  it('exposes standard fit presets and custom fit', () => {
    const options = getVideoResolutionPresetOptions();

    expect(options.map((option) => option.label)).toEqual([
      'Original',
      'Fit 4K',
      'Fit 1440p',
      'Fit 1080p',
      'Fit 720p',
      'Fit 480p',
      'Custom fit',
    ]);
    expect(options.find((option) => option.value === 'fit-1080p')?.resolution).toEqual({
      mode: 'fit',
      maxWidth: 1920,
      maxHeight: 1080,
    });
  });

  it('preserves explicit custom fit selection even when dimensions match a preset', () => {
    const resolution = normalizeVideoResolutionSettings({
      mode: 'fit',
      maxWidth: 1920,
      maxHeight: 1080,
      selection: 'custom',
    });

    expect(resolution).toEqual({
      mode: 'fit',
      maxWidth: 1920,
      maxHeight: 1080,
      selection: 'custom',
    });
    expect(getVideoResolutionPresetValue(resolution)).toBe('custom');
  });

  it('does not rewrite in-progress custom fit dimensions while typing', () => {
    expect(normalizeVideoResolutionSettings({
      mode: 'fit',
      maxWidth: 3,
      maxHeight: 1,
      selection: 'custom',
      keepRatio: true,
    })).toEqual({
      mode: 'fit',
      maxWidth: 3,
      maxHeight: 1,
      selection: 'custom',
      keepRatio: true,
    });
  });

  it('reports custom fit bounds that the backend would reject before launch', () => {
    const issues = getTranscodeCompatibilityIssues(transcodeFile(profileWithResolution({
      mode: 'fit',
      maxWidth: 1001,
      maxHeight: 1,
      selection: 'custom',
    })), capabilities());

    expect(issues).toEqual(expect.arrayContaining([
      'Video resolution width must be an even integer of at least 2.',
      'Video resolution height must be an even integer of at least 2.',
    ]));
  });

  it('normalizes request resolution bounds to backend-compatible even values', () => {
    const request = createTranscodeRequest(transcodeFile(profileWithResolution({
      mode: 'fit',
      maxWidth: 1001,
      maxHeight: 1,
      selection: 'custom',
    })), '/tmp/output.mkv');

    expect(request.video.resolution).toEqual({
      mode: 'fit',
      maxWidth: 1000,
      maxHeight: 2,
      selection: 'custom',
    });
  });

  it('calculates the paired custom dimension from the source aspect ratio', () => {
    expect(getVideoResolutionPairedDimension('width', 3840, videoTrack(1920, 1080))).toBe(2160);
    expect(getVideoResolutionPairedDimension('height', 2160, videoTrack(1920, 1080))).toBe(3840);
    expect(getVideoResolutionPairedDimension('width', 1280, videoTrack(1920, 804))).toBe(536);
  });

  it('keeps paired custom dimensions compatible with even backend bounds', () => {
    expect(getVideoResolutionPairedDimension('width', 1000, videoTrack(1920, 1080))).toBe(562);
    expect(getVideoResolutionPairedDimension('height', 1000, videoTrack(1920, 1080))).toBe(1778);
  });

  it('preserves aspect ratio and allows upscaling when resolving fit output', () => {
    expect(getEffectiveVideoResolution(
      { mode: 'fit', maxWidth: 1280, maxHeight: 720 },
      videoTrack(1920, 1080),
    )).toEqual({ width: 1280, height: 720 });

    expect(getEffectiveVideoResolution(
      { mode: 'fit', maxWidth: 1280, maxHeight: 720 },
      videoTrack(1920, 804),
    )).toEqual({ width: 1280, height: 536 });

    expect(getEffectiveVideoResolution(
      { mode: 'fit', maxWidth: 3840, maxHeight: 2160 },
      videoTrack(1920, 1080),
    )).toEqual({ width: 3840, height: 2160 });
  });

  it('previews single-bound fit output with the same scale the backend will use', () => {
    expect(getEffectiveVideoResolution(
      { mode: 'fit', maxWidth: 3840 },
      videoTrack(1920, 1080),
    )).toEqual({ width: 3840, height: 2160 });

    expect(getEffectiveVideoResolution(
      { mode: 'fit', maxHeight: 2160 },
      videoTrack(1920, 1080),
    )).toEqual({ width: 3840, height: 2160 });

    expect(getEffectiveVideoResolution(
      { mode: 'fit', maxWidth: 1280 },
      videoTrack(1920, 1080),
    )).toEqual({ width: 1280, height: 720 });
  });
});
