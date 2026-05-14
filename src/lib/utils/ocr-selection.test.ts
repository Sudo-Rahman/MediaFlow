import { describe, expect, it } from 'vitest';

import type { OcrSegment, VideoOcrSelection } from '$lib/types';
import {
  DEFAULT_MAIN_SUBTITLE_REGION,
  assignOcrTimelineLanes,
  clampRegion,
  createOcrSegmentFromZone,
  createDefaultVideoOcrSelection,
  getActiveOcrZonesAtTime,
  getAllowedOcrExportFormats,
  validateVideoOcrSelection,
} from './ocr-selection';

describe('OCR selection helpers', () => {
  it('creates a full-duration main subtitle default selection', () => {
    const selection = createDefaultVideoOcrSelection(125_000);

    expect(selection.segments).toHaveLength(1);
    expect(selection.segments[0]).toMatchObject({
      startTimeMs: 0,
      endTimeMs: 125_000,
    });
    expect(selection.segments[0].zones[0]).toMatchObject({
      role: 'main_subtitle',
      region: DEFAULT_MAIN_SUBTITLE_REGION,
    });
  });

  it('rounds tiny positive default durations up to one millisecond', () => {
    expect(createDefaultVideoOcrSelection(0.4).segments[0].endTimeMs).toBe(1);
  });

  it('returns the union of zones from overlapping segments', () => {
    const selection: VideoOcrSelection = {
      segments: [
        segment('dialogue', 0, 5_000, 'main_subtitle'),
        segment('sign', 2_000, 3_000, 'on_screen_text'),
      ],
    };

    expect(getActiveOcrZonesAtTime(selection, 1_000).map((zone) => zone.role)).toEqual(['main_subtitle']);
    expect(getActiveOcrZonesAtTime(selection, 2_500).map((zone) => zone.role)).toEqual([
      'main_subtitle',
      'on_screen_text',
    ]);
  });

  it('requires ASS when positioned text exists', () => {
    expect(getAllowedOcrExportFormats({ segments: [segment('dialogue', 0, 5_000, 'main_subtitle')] }))
      .toEqual(['srt', 'vtt']);
    expect(getAllowedOcrExportFormats({ segments: [segment('sign', 0, 5_000, 'on_screen_text')] }))
      .toEqual(['ass']);
  });

  it('assigns overlapping timeline blocks to separate lanes', () => {
    const lanes = assignOcrTimelineLanes([
      block('a', 0, 5_000),
      block('b', 1_000, 2_000),
      block('c', 5_000, 8_000),
    ]);

    expect(lanes.find((entry) => entry.id === 'a')?.lane).toBe(0);
    expect(lanes.find((entry) => entry.id === 'b')?.lane).toBe(1);
    expect(lanes.find((entry) => entry.id === 'c')?.lane).toBe(0);
  });

  it('keeps role blocks independently lane-assigned by caller grouping', () => {
    const main = assignOcrTimelineLanes([block('main', 0, 5_000)]);
    const onscreen = assignOcrTimelineLanes([
      block('sign', 1_000, 4_000),
      block('board', 2_000, 3_000),
    ]);

    expect(main).toEqual([expect.objectContaining({ id: 'main', lane: 0 })]);
    expect(onscreen).toEqual([
      expect.objectContaining({ id: 'sign', lane: 0 }),
      expect.objectContaining({ id: 'board', lane: 1 }),
    ]);
  });

  it('reports invalid segments and regions', () => {
    const errors = validateVideoOcrSelection(
      {
        segments: [
          {
            id: 'bad',
            startTimeMs: 8_000,
            endTimeMs: 2_000,
            zones: [
              {
                id: 'zone-bad',
                role: 'main_subtitle',
                region: { x: -1, y: 0, width: 0.01, height: 0.25 },
              },
            ],
          },
        ],
      },
      10_000,
    );

    expect(errors).toContain('Segment bad must start before it ends.');
    expect(errors).toContain('Zone zone-bad must stay within the video frame.');
    expect(errors).toContain('Zone zone-bad is too small.');
  });

  it('requires at least one segment', () => {
    expect(validateVideoOcrSelection({ segments: [] }, 10_000)).toContain(
      'OCR selection must contain at least one segment.',
    );
  });

  it('reports non-positive and non-finite durations', () => {
    expect(validateVideoOcrSelection({ segments: [segment('zero', 0, 1, 'main_subtitle')] }, 0)).toContain(
      'Video duration must be a positive finite number.',
    );
    expect(validateVideoOcrSelection({ segments: [segment('negative', 0, 1, 'main_subtitle')] }, -10)).toContain(
      'Video duration must be a positive finite number.',
    );

    const errors = validateVideoOcrSelection(
      {
        segments: [
          {
            id: 'non-finite',
            startTimeMs: Number.NaN,
            endTimeMs: Number.POSITIVE_INFINITY,
            zones: [
              {
                id: 'zone',
                role: 'main_subtitle',
                region: DEFAULT_MAIN_SUBTITLE_REGION,
              },
            ],
          },
        ],
      },
      Number.NaN,
    );

    expect(errors).toContain('Video duration must be a positive finite number.');
    expect(errors).toContain('Segment non-finite must use finite start and end times.');
  });

  it('creates a valid minimal segment from negative and non-finite times', () => {
    expect(createOcrSegmentFromZone(-1_000, -500, DEFAULT_MAIN_SUBTITLE_REGION)).toMatchObject({
      startTimeMs: 0,
      endTimeMs: 1,
    });

    const nonFiniteSegment = createOcrSegmentFromZone(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      DEFAULT_MAIN_SUBTITLE_REGION,
    );

    expect(nonFiniteSegment.startTimeMs).toBe(0);
    expect(nonFiniteSegment.endTimeMs).toBe(1);
  });

  it('clamps OCR regions to finite frame-relative coordinates', () => {
    const overflowingRegion = clampRegion({
      x: 0.9,
      y: -1,
      width: 0.5,
      height: Number.POSITIVE_INFINITY,
    });

    expect(overflowingRegion).toMatchObject({
      x: 0.9,
      y: 0,
      height: 0,
    });
    expect(overflowingRegion.width).toBeCloseTo(0.1);
    expect(clampRegion({ x: Number.NaN, y: 0.5, width: -0.25, height: 0.75 })).toEqual({
      x: 0,
      y: 0.5,
      width: 0,
      height: 0.5,
    });
  });
});

function segment(id: string, startTimeMs: number, endTimeMs: number, role: 'main_subtitle' | 'on_screen_text'): OcrSegment {
  return {
    id,
    startTimeMs,
    endTimeMs,
    zones: [
      {
        id: `${id}-zone`,
        role,
        region: DEFAULT_MAIN_SUBTITLE_REGION,
      },
    ],
  };
}

function block(id: string, startTimeMs: number, endTimeMs: number) {
  return { id, startTimeMs, endTimeMs };
}
