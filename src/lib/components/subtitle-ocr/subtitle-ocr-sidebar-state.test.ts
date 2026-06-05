import { describe, expect, it } from 'vitest';

import { shouldShowSubtitleOcrItemCancelAction } from './subtitle-ocr-sidebar-state';

describe('shouldShowSubtitleOcrItemCancelAction', () => {
  it('shows cancel for an actively processing item', () => {
    expect(shouldShowSubtitleOcrItemCancelAction('ocr_processing', true, false)).toBe(true);
    expect(shouldShowSubtitleOcrItemCancelAction('ai_cleaning', true, false)).toBe(true);
  });

  it('shows cancel for a queued item in the current processing scope', () => {
    expect(shouldShowSubtitleOcrItemCancelAction('ready', true, true)).toBe(true);
  });

  it('keeps remove for idle items outside the processing scope', () => {
    expect(shouldShowSubtitleOcrItemCancelAction('ready', false, false)).toBe(false);
    expect(shouldShowSubtitleOcrItemCancelAction('completed', true, false)).toBe(false);
  });
});
