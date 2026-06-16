import { describe, expect, it } from 'vitest';

import type {
  Track,
  TranscodeAdditionalArg,
  TranscodeAiSuccessResponse,
  TranscodeCapabilities,
  TranscodeEncoderOption,
  TranscodeFile,
  TranscodeProfile,
} from '$lib/types';
import {
  getEffectiveAudioSettingsForTrack,
  getSuggestedTranscodeOverrideFlags,
} from './transcode';
import {
  buildTranscodeAiCapabilityPayload,
  sanitizeTranscodeAiProfileResponse,
} from './transcode-ai';

function option(flag: string, valueKind: TranscodeEncoderOption['valueKind'] = 'string'): TranscodeEncoderOption {
  return {
    flag,
    valueKind,
    description: `${flag} option`,
    defaultValue: undefined,
    min: undefined,
    max: undefined,
    choices: [],
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
    hwaccels: ['videotoolbox'],
    containers: [
      {
        id: 'mkv',
        label: 'MKV',
        extension: '.mkv',
        kind: 'video',
        muxerName: 'matroska',
        supportedVideoEncoderIds: ['libx264'],
        supportedAudioEncoderIds: ['aac', 'flac', 'libopus'],
        supportedSubtitleEncoderIds: ['srt'],
        supportedSubtitleModes: ['disable', 'copy', 'convert_text'],
        defaultVideoEncoderId: 'libx264',
        defaultAudioEncoderId: 'aac',
        defaultSubtitleEncoderId: 'srt',
        metadataSchema,
      },
    ],
    videoEncoders: [
      {
        id: 'libx264',
        codec: 'h264',
        label: 'H.264 (libx264)',
        isHardware: false,
        supportedPixelFormats: ['yuv420p'],
        supportedProfiles: ['high'],
        supportedLevels: ['4.1'],
        supportedBitDepths: [8],
        supportsPreset: true,
        supportsCrf: true,
        supportsQp: false,
        supportsBitrate: true,
        options: [option('-tune'), option('-bf', 'int'), option('-x264-params', 'dictionary')],
      },
    ],
    audioEncoders: [
      {
        id: 'aac',
        codec: 'aac',
        label: 'AAC',
        supportsBitrate: true,
        supportsChannels: true,
        supportsSampleRate: true,
        options: [option('-cutoff', 'int')],
      },
      {
        id: 'flac',
        codec: 'flac',
        label: 'FLAC',
        supportsBitrate: false,
        supportsChannels: true,
        supportsSampleRate: true,
        options: [option('-compression_level', 'int')],
      },
      {
        id: 'libopus',
        codec: 'opus',
        label: 'Opus',
        supportsBitrate: true,
        supportsChannels: true,
        supportsSampleRate: true,
        options: [option('-application'), option('-frame_duration', 'float')],
      },
    ],
    subtitleEncoders: [
      {
        id: 'srt',
        codec: 'srt',
        label: 'SubRip',
        kind: 'text',
        options: [option('-fix_sub_duration', 'boolean')],
      },
    ],
    defaultAnalysisFrameCount: 6,
  };
}

function track(partial: Partial<Track> & Pick<Track, 'id' | 'index' | 'type' | 'codec'>): Track {
  return partial;
}

function profile(overrides: Partial<TranscodeProfile> = {}): TranscodeProfile {
  return {
    containerId: 'mkv',
    video: {
      mode: 'transcode',
      encoderId: 'libx264',
      profile: 'high',
      level: '4.1',
      pixelFormat: 'yuv420p',
      qualityMode: 'crf',
      crf: 20,
      qp: undefined,
      bitrateKbps: undefined,
      preset: 'medium',
      resolution: { mode: 'source' },
      additionalArgs: [],
    },
    audio: {
      mode: 'copy',
      encoderId: undefined,
      bitrateKbps: undefined,
      channels: undefined,
      sampleRate: undefined,
      additionalArgs: [],
      trackOverrides: [],
    },
    subtitles: {
      mode: 'disable',
      encoderId: undefined,
      additionalArgs: [],
    },
    ...overrides,
  };
}

function file(profileOverride: Partial<TranscodeProfile> = {}): TranscodeFile {
  const currentProfile = profile(profileOverride);
  return {
    id: 'file-1',
    path: '/tmp/source.mkv',
    name: 'source.mkv',
    size: 1024,
    duration: 10,
    bitrate: 1_000_000,
    format: 'matroska',
    tracks: [
      track({ id: 0, index: 0, type: 'video', codec: 'h264', width: 1920, height: 1080 }),
      track({ id: 1, index: 1, type: 'audio', codec: 'aac', bitrate: 96_000, channels: 2, sampleRate: 48_000 }),
      track({ id: 2, index: 2, type: 'audio', codec: 'ac3', bitrate: 384_000, channels: 6, sampleRate: 48_000 }),
      track({ id: 3, index: 3, type: 'subtitle', codec: 'subrip', language: 'eng' }),
    ],
    status: 'ready',
    error: undefined,
    rawData: undefined,
    createdAt: undefined,
    modifiedAt: undefined,
    hasVideo: true,
    hasAudio: true,
    profile: currentProfile,
    metadata: { trackEdits: [] },
    analysisFrames: [],
    aiStatus: 'idle',
    aiError: undefined,
    aiRecommendation: undefined,
    lastOutputPath: undefined,
  };
}

function response(partial: Partial<TranscodeAiSuccessResponse>): TranscodeAiSuccessResponse {
  return {
    status: 'ok',
    containerId: 'mkv',
    video: { mode: 'transcode', encoderId: 'libx264', qualityMode: 'crf', crf: 20, preset: 'medium' },
    audio: { mode: 'copy' },
    subtitles: { mode: 'disable' },
    rationale: 'test',
    ...partial,
  };
}

describe('transcode AI profile helpers', () => {
  it('builds a compact payload with presets, encoder options, and all audio tracks', () => {
    const payload = buildTranscodeAiCapabilityPayload(file(), capabilities());

    expect(payload.videoResolution.supportsFit).toBe(true);
    expect(payload.videoResolution.allowsUpscale).toBe(true);
    expect(payload.videoResolution.presets.map((preset) => preset.value)).toContain('fit-1080p');
    expect(payload.overridePolicy.overrideFlagsAreRuntimeDiscoveredFromEncoderOptions).toBe(true);
    expect('commonOverrideFlags' in payload.overridePolicy).toBe(false);
    expect(payload.videoEncoders[0]?.presetControl?.values).toContain('medium');
    expect(payload.videoEncoders[0]?.allowedOverrideFlags).toContain('-x264-params');
    expect(payload.audioEncoders.find((encoder) => encoder.id === 'libopus')?.allowedOverrideFlags)
      .toContain('-application');
    expect(payload.sourceTracks.audio.map((audioTrack) => audioTrack.trackId)).toEqual([1, 2]);
  });

  it('derives suggested override shortcuts from encoder option metadata', () => {
    expect(getSuggestedTranscodeOverrideFlags([
      option('-plain'),
      option('-runtime-dictionary', 'dictionary'),
      {
        ...option('-runtime-choice'),
        choices: [{ value: 'fast', description: 'Fast mode' }],
      },
    ], 2)).toEqual(['-runtime-dictionary', '-runtime-choice']);
  });

  it('preserves manual overrides and replaces old AI overrides', () => {
    const manualArg: TranscodeAdditionalArg = {
      id: 'manual',
      flag: '-tune',
      value: 'film',
      enabled: true,
    };
    const oldAiArg: TranscodeAdditionalArg = {
      id: 'old-ai',
      flag: '-bf',
      value: '2',
      enabled: true,
      source: 'ai',
    };
    const sourceFile = file({
      video: {
        ...profile().video,
        additionalArgs: [manualArg, oldAiArg],
      },
    });

    const result = sanitizeTranscodeAiProfileResponse(response({
      video: {
        mode: 'transcode',
        encoderId: 'libx264',
        qualityMode: 'crf',
        crf: 18,
        additionalArgs: [{ flag: '-bf', value: 3, reason: 'B-frames improve compression' }] as unknown as TranscodeAdditionalArg[],
      },
    }), sourceFile, capabilities());

    expect(result.profile.video.additionalArgs).toHaveLength(2);
    expect(result.profile.video.additionalArgs.find((arg) => arg.id === 'manual')).toMatchObject({
      flag: '-tune',
      value: 'film',
    });
    expect(result.profile.video.additionalArgs.find((arg) => arg.id === 'old-ai')).toBeUndefined();
    expect(result.profile.video.additionalArgs.find((arg) => arg.flag === '-bf')).toMatchObject({
      value: '3',
      source: 'ai',
    });
  });

  it('rejects unsupported AI flags and invalid audio track ids with warnings', () => {
    const result = sanitizeTranscodeAiProfileResponse(response({
      video: {
        mode: 'transcode',
        encoderId: 'libx264',
        qualityMode: 'crf',
        crf: 19,
        additionalArgs: [
          { flag: '-map', value: '0' },
          { flag: '-not-real', value: '1' },
        ] as unknown as TranscodeAdditionalArg[],
      },
      audio: {
        mode: 'copy',
        trackOverrides: [{ trackId: 999, mode: 'transcode', encoderId: 'aac' }] as unknown as TranscodeProfile['audio']['trackOverrides'],
      },
    }), file(), capabilities());

    expect(result.profile.video.additionalArgs).toEqual([]);
    expect(result.profile.audio.trackOverrides).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('blocked FFmpeg control flag'),
      expect.stringContaining('not exposed by the selected encoder'),
      expect.stringContaining('unknown trackId'),
    ]));
  });

  it('accepts sanitized AI video resolution recommendations', () => {
    const result = sanitizeTranscodeAiProfileResponse(response({
      video: {
        mode: 'transcode',
        encoderId: 'libx264',
        qualityMode: 'crf',
        crf: 19,
        resolution: { mode: 'fit', maxWidth: 1280, maxHeight: 720 },
      },
    }), file(), capabilities());

    expect(result.profile.video.resolution).toEqual({
      mode: 'fit',
      maxWidth: 1280,
      maxHeight: 720,
    });
  });

  it('normalizes AI video resolution bounds to backend-compatible values', () => {
    const result = sanitizeTranscodeAiProfileResponse(response({
      video: {
        mode: 'transcode',
        encoderId: 'libx264',
        qualityMode: 'crf',
        crf: 19,
        resolution: { mode: 'fit', maxWidth: 1001, maxHeight: 1 },
      },
    }), file(), capabilities());

    expect(result.profile.video.resolution).toEqual({
      mode: 'fit',
      maxWidth: 1000,
      maxHeight: 2,
    });
  });

  it('clamps lossy audio per track and rejects lossless upgrades', () => {
    const capped = sanitizeTranscodeAiProfileResponse(response({
      audio: {
        mode: 'transcode',
        encoderId: 'aac',
        bitrateKbps: 320,
      },
    }), file(), capabilities()).profile;

    expect(getEffectiveAudioSettingsForTrack(capped.audio, 1).bitrateKbps).toBeLessThanOrEqual(96);
    expect(getEffectiveAudioSettingsForTrack(capped.audio, 2).bitrateKbps).toBeLessThanOrEqual(384);

    const noLosslessUpgrade = sanitizeTranscodeAiProfileResponse(response({
      audio: {
        mode: 'transcode',
        encoderId: 'flac',
      },
    }), file(), capabilities()).profile;

    expect(getEffectiveAudioSettingsForTrack(noLosslessUpgrade.audio, 1).mode).toBe('copy');
    expect(getEffectiveAudioSettingsForTrack(noLosslessUpgrade.audio, 2).mode).toBe('copy');
  });

  it('applies AI multitrack audio overrides with sanitized per-track flags', () => {
    const result = sanitizeTranscodeAiProfileResponse(response({
      audio: {
        mode: 'copy',
        trackOverrides: [
          {
            trackId: 2,
            mode: 'transcode',
            encoderId: 'libopus',
            bitrateKbps: 96,
            additionalArgs: [{ flag: '-application', value: 'audio', reason: 'Opus music mode' }],
          },
        ] as unknown as TranscodeProfile['audio']['trackOverrides'],
      },
    }), file(), capabilities());

    const override = result.profile.audio.trackOverrides.find((item) => item.trackId === 2);
    expect(override).toMatchObject({
      mode: 'transcode',
      encoderId: 'libopus',
      bitrateKbps: 96,
      source: 'ai',
    });
    expect(override?.additionalArgs[0]).toMatchObject({
      flag: '-application',
      value: 'audio',
      source: 'ai',
    });
  });
});
