import { describe, expect, it } from 'vitest';

import type { Track, TranscodeProfile } from '$lib/types';
import {
  buildDefaultVideoSettings,
  getEffectiveVideoResolution,
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
