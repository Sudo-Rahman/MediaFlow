import { describe, expect, it } from 'vitest';

import { DEFAULT_SUBTITLE_OCR_CONFIG, type SubtitleOcrVersion } from '$lib/types';
import {
  buildSubtitleOcrVersionOptions,
  toCompactSubtitleOcrVersionLabel,
} from './subtitle-ocr-version-selector';

function version(id: string, name: string): SubtitleOcrVersion {
  return {
    id,
    name,
    createdAt: '2026-05-28T00:00:00.000Z',
    mode: 'full_ocr',
    configSnapshot: DEFAULT_SUBTITLE_OCR_CONFIG,
    effectiveOcrModel: DEFAULT_SUBTITLE_OCR_CONFIG.ocrModel,
    sourceSnapshot: {
      sourceKind: 'standalone_sup',
      sourcePath: '/subs/source.sup',
      ocrModelOverride: 'default',
    },
    bitmaps: [],
    rawOcr: [],
    stabilizedCues: [],
    finalCues: [],
    aiCleanupApplied: false,
  };
}

describe('subtitle OCR version selector helpers', () => {
  it('adds the running draft after completed versions', () => {
    const options = buildSubtitleOcrVersionOptions({
      versions: [version('v1', 'Version 1')],
      processingDraft: {
        runId: 'run-2',
        name: 'Version 2 Draft',
        startedAt: '2026-05-28T00:00:01.000Z',
        bitmaps: [],
        rawOcr: [],
        finalCues: [],
      },
    });

    expect(options.map((option) => option.id)).toEqual(['v1', 'processing-draft:run-2']);
    expect(options[1]).toMatchObject({
      label: 'Version 2 Draft',
      processingDraft: true,
    });
  });

  it('compacts processing draft labels as Vn Draft', () => {
    expect(toCompactSubtitleOcrVersionLabel('Version 12 Draft')).toBe('V12 Draft');
    expect(toCompactSubtitleOcrVersionLabel('Version 3')).toBe('V3');
  });
});
