import { describe, expect, it } from 'vitest';

import type { OcrSegment, OcrVersion, VideoOcrSelection } from '$lib/types';
import {
  DEFAULT_MAIN_SUBTITLE_REGION,
  assignOcrTimelineLanes,
  clampRegion,
  createOcrSegmentFromZone,
  createDefaultVideoOcrSelection,
  createOcrTimelineViewport,
  createOcrTimelineTicks,
  createOcrTimelineMinorTicks,
  getOcrTimelineWheelIntent,
  getActiveOcrZonesAtTime,
  getAllowedOcrExportFormats,
  getAllowedOcrVersionExportFormats,
  normalizeOcrZoneLabels,
  panOcrTimelineViewport,
  zoomOcrTimelineViewport,
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

  it('allows ASS for subtitles and requires ASS when positioned text exists', () => {
    expect(getAllowedOcrExportFormats({ segments: [segment('dialogue', 0, 5_000, 'main_subtitle')] }))
      .toEqual(['srt', 'vtt', 'ass']);
    expect(getAllowedOcrExportFormats({ segments: [segment('sign', 0, 5_000, 'on_screen_text')] }))
      .toEqual(['ass']);
  });

  it('derives export formats from OCR version subtitle roles', () => {
    expect(getAllowedOcrVersionExportFormats(versionWithRole('main_subtitle'))).toEqual(['srt', 'vtt', 'ass']);
    expect(getAllowedOcrVersionExportFormats(versionWithRole('on_screen_text'))).toEqual(['ass']);
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

  it('numbers default OCR zone labels across the selection', () => {
    const selection: VideoOcrSelection = {
      segments: [
        segment('first', 0, 5_000, 'main_subtitle'),
        segment('second', 5_000, 10_000, 'on_screen_text'),
      ],
    };

    const normalized = normalizeOcrZoneLabels(selection);

    expect(normalized.segments.flatMap((entry) => entry.zones.map((zone) => zone.label))).toEqual([
      'Zone 1',
      'Zone 2',
    ]);
  });

  it('renumbers only default OCR zone labels and preserves custom names', () => {
    const selection: VideoOcrSelection = {
      segments: [
        {
          ...segment('first', 0, 5_000, 'main_subtitle'),
          zones: [
            {
              ...segment('first', 0, 5_000, 'main_subtitle').zones[0],
              label: 'Zone 8',
            },
          ],
        },
        {
          ...segment('second', 5_000, 10_000, 'on_screen_text'),
          zones: [
            {
              ...segment('second', 5_000, 10_000, 'on_screen_text').zones[0],
              label: 'Shop sign',
            },
          ],
        },
        segment('third', 10_000, 15_000, 'main_subtitle'),
      ],
    };

    const normalized = normalizeOcrZoneLabels(selection);

    expect(normalized.segments.flatMap((entry) => entry.zones.map((zone) => zone.label))).toEqual([
      'Zone 1',
      'Shop sign',
      'Zone 2',
    ]);
  });

  it('creates a clamped OCR timeline viewport with a 10 second minimum window', () => {
    expect(createOcrTimelineViewport(120_000, 50_000, 2_000)).toEqual({
      startTimeMs: 50_000,
      endTimeMs: 60_000,
    });

    expect(createOcrTimelineViewport(120_000, 118_000, 10_000)).toEqual({
      startTimeMs: 110_000,
      endTimeMs: 120_000,
    });
  });

  it('zooms an OCR timeline viewport around the pointer anchor', () => {
    const viewport = createOcrTimelineViewport(120_000, 0, 120_000);

    expect(zoomOcrTimelineViewport(viewport, 120_000, 60_000, 0.5)).toEqual({
      startTimeMs: 30_000,
      endTimeMs: 90_000,
    });
  });

  it('pans an OCR timeline viewport without leaving the video duration', () => {
    const viewport = createOcrTimelineViewport(120_000, 30_000, 30_000);

    expect(panOcrTimelineViewport(viewport, 120_000, 20_000)).toEqual({
      startTimeMs: 50_000,
      endTimeMs: 80_000,
    });

    expect(panOcrTimelineViewport(viewport, 120_000, -60_000)).toEqual({
      startTimeMs: 0,
      endTimeMs: 30_000,
    });
  });

  it('keeps vertical trackpad scrolling separate from timeline zoom', () => {
    expect(
      getOcrTimelineWheelIntent({
        deltaX: 0,
        deltaY: 120,
        ctrlKey: false,
        viewportWindowMs: 30_000,
        durationMs: 120_000,
      }),
    ).toEqual({ type: 'none' });

    expect(
      getOcrTimelineWheelIntent({
        deltaX: 0,
        deltaY: 120,
        ctrlKey: true,
        viewportWindowMs: 30_000,
        durationMs: 120_000,
      }),
    ).toEqual({ type: 'zoom', zoomFactor: expect.any(Number) });
  });

  it('builds evenly spaced OCR timeline ticks for the visible viewport', () => {
    const ticks = createOcrTimelineTicks({ startTimeMs: 30_000, endTimeMs: 90_000 });

    expect(ticks.map((tick) => tick.timeMs)).toEqual([30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000]);
    expect(ticks.map((tick) => tick.label)).toEqual(['0:30', '0:40', '0:50', '1:00', '1:10', '1:20', '1:30']);
  });

  it('builds unlabeled minor OCR timeline ticks between major ticks', () => {
    const ticks = createOcrTimelineMinorTicks({ startTimeMs: 30_000, endTimeMs: 50_000 });

    expect(ticks.map((tick) => tick.timeMs)).toEqual([
      31_000,
      32_000,
      33_000,
      34_000,
      36_000,
      37_000,
      38_000,
      39_000,
      41_000,
      42_000,
      43_000,
      44_000,
      46_000,
      47_000,
      48_000,
      49_000,
    ]);
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

function versionWithRole(role: 'main_subtitle' | 'on_screen_text'): Pick<OcrVersion, 'finalSubtitles'> {
  return {
    finalSubtitles: [
      {
        id: `${role}-sub`,
        text: 'Text',
        startTime: 0,
        endTime: 1000,
        confidence: 0.95,
        role,
        region: DEFAULT_MAIN_SUBTITLE_REGION,
      },
    ],
  };
}
