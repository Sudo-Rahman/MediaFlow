import { describe, expect, it } from 'vitest';

import type { OcrVersion } from '$lib/types';
import { DEFAULT_OCR_CONFIG } from '$lib/types';

import { createOcrPreviewVersionOptions } from './ocr-version-selector';

function version(id: string, name: string, createdAt: string): OcrVersion {
  return {
    id,
    name,
    createdAt,
    mode: 'full_pipeline',
    configSnapshot: DEFAULT_OCR_CONFIG,
    rawOcr: [],
    finalSubtitles: [],
  };
}

describe('OCR preview version selector helpers', () => {
  it('lists the active draft before completed versions', () => {
    const options = createOcrPreviewVersionOptions({
      versions: [
        version('version-1', 'Version 1', '2026-05-20T10:00:00.000Z'),
        version('version-2', 'Version 2', '2026-05-20T11:00:00.000Z'),
      ],
      showDraft: true,
      draftName: 'Draft Version 3',
    });

    expect(options.map((option) => ({ id: option.id, label: option.label, draft: option.draft }))).toEqual([
      { id: null, label: 'Draft Version 3', draft: true },
      { id: 'version-2', label: 'Version 2', draft: false },
      { id: 'version-1', label: 'Version 1', draft: false },
    ]);
  });
});
