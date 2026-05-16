import { describe, expect, it } from 'vitest';

import { buildFormattedOcrPreview } from './ocr-preview-format';
import type { OcrSubtitle } from '$lib/types/video-ocr';

describe('buildFormattedOcrPreview', () => {
  it('includes ASS position tags for subtitles with regions', () => {
    const subtitles: OcrSubtitle[] = [
      {
        id: 'sub-positioned',
        text: 'Exit',
        startTime: 1000,
        endTime: 2500,
        confidence: 0.92,
        segmentId: 'segment-sign',
        zoneId: 'zone-sign',
        role: 'on_screen_text',
        region: {
          x: 0.7,
          y: 0.1,
          width: 0.2,
          height: 0.1,
        },
      },
    ];

    const preview = buildFormattedOcrPreview('ass', subtitles);

    expect(preview).toContain('PlayResX: 1920');
    expect(preview).toContain('PlayResY: 1080');
    expect(preview).toContain(
      'Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\pos(1536,248)}Exit'
    );
  });
});
