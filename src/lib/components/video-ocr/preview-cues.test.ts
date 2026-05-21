import { describe, expect, it } from 'vitest';

import type { OcrSubtitle, VideoOcrSelection } from '$lib/types';
import {
  buildActiveCueSummary,
  formatCueConfidence,
  roleLabelForCue,
} from './preview-cues';

const selection: VideoOcrSelection = {
  segments: [
    {
      id: 'segment-main',
      startTimeMs: 1_000,
      endTimeMs: 5_000,
      zones: [
        {
          id: 'zone-main-1',
          role: 'main_subtitle',
          label: 'Main line',
          region: { x: 0.1, y: 0.75, width: 0.8, height: 0.12 },
        },
        {
          id: 'zone-main-2',
          role: 'main_subtitle',
          label: 'Alt line',
          region: { x: 0.15, y: 0.86, width: 0.7, height: 0.1 },
        },
        {
          id: 'zone-text',
          role: 'on_screen_text',
          label: 'Sign',
          region: { x: 0.65, y: 0.35, width: 0.2, height: 0.1 },
        },
      ],
    },
  ],
};

const subtitles: OcrSubtitle[] = [
  {
    id: 'cue-main-1',
    text: 'Primary subtitle text',
    startTime: 1_000,
    endTime: 4_000,
    confidence: 0.923,
    segmentId: 'segment-main',
    zoneId: 'zone-main-1',
    role: 'main_subtitle',
  },
  {
    id: 'cue-main-2',
    text: 'Second subtitle line',
    startTime: 1_000,
    endTime: 4_000,
    confidence: 0.881,
    segmentId: 'segment-main',
    zoneId: 'zone-main-2',
    role: 'main_subtitle',
  },
  {
    id: 'cue-text',
    text: 'pupu',
    startTime: 1_000,
    endTime: 4_000,
    confidence: 0.794,
    segmentId: 'segment-main',
    zoneId: 'zone-text',
    role: 'on_screen_text',
  },
];

describe('preview cue helpers', () => {
  it('prioritizes the selected zone when it has an active cue', () => {
    const summary = buildActiveCueSummary({
      subtitles,
      selection,
      timeMs: 2_000,
      selectedZoneId: 'zone-main-2',
    });

    expect(summary.primaryCue?.subtitle.id).toBe('cue-main-2');
    expect(summary.activeCues.map((cue) => cue.subtitle.id)).toEqual([
      'cue-main-1',
      'cue-main-2',
      'cue-text',
    ]);
    expect(summary.extraCueCount).toBe(2);
  });

  it('falls back to the first active main subtitle cue by selection order', () => {
    const summary = buildActiveCueSummary({
      subtitles,
      selection,
      timeMs: 2_000,
      selectedZoneId: null,
    });

    expect(summary.primaryCue?.subtitle.id).toBe('cue-main-1');
    expect(summary.extraCueCount).toBe(2);
  });

  it('falls back to on-screen text when no main subtitle cue is active', () => {
    const summary = buildActiveCueSummary({
      subtitles: subtitles.filter((subtitle) => subtitle.role === 'on_screen_text'),
      selection,
      timeMs: 2_000,
      selectedZoneId: null,
    });

    expect(summary.primaryCue?.subtitle.id).toBe('cue-text');
    expect(summary.primaryCue ? roleLabelForCue(summary.primaryCue) : '').toBe('On-screen text - Sign');
    expect(summary.extraCueCount).toBe(0);
  });

  it('returns no primary cue when nothing is active at the current time', () => {
    const summary = buildActiveCueSummary({
      subtitles,
      selection,
      timeMs: 6_000,
      selectedZoneId: 'zone-main-1',
    });

    expect(summary.primaryCue).toBeNull();
    expect(summary.activeCues).toEqual([]);
    expect(summary.extraCueCount).toBe(0);
  });

  it('formats confidence values as percentages', () => {
    expect(formatCueConfidence(0.923)).toBe('92%');
    expect(formatCueConfidence(2)).toBe('100%');
    expect(formatCueConfidence(-1)).toBe('0%');
  });
});
