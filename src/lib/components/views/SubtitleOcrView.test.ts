import { describe, expect, it } from 'vitest';

import { summarizeSubtitleOcrItems } from './subtitle-ocr-view-state';

describe('summarizeSubtitleOcrItems', () => {
  it('counts ready, retryable, and scanning items', () => {
    expect(summarizeSubtitleOcrItems([
      { status: 'ready', versions: [] },
      { status: 'completed', versions: [{}] },
      { status: 'scanning', versions: [] },
    ])).toEqual({ readyCount: 1, retryableCount: 1, scanningCount: 1 });
  });
});
