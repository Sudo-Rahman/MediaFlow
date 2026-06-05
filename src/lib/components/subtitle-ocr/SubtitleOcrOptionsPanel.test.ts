import { describe, expect, it } from 'vitest';

import { getSubtitleOcrCancelActionState } from './SubtitleOcrOptionsPanel.svelte';

describe('SubtitleOcrOptionsPanel cancel action', () => {
  it('disables the cancel action while cancellation is already pending', () => {
    expect(getSubtitleOcrCancelActionState(true)).toEqual({
      disabled: true,
      label: 'Cancelling...',
    });
  });

  it('keeps the cancel action available before cancellation is requested', () => {
    expect(getSubtitleOcrCancelActionState(false)).toEqual({
      disabled: false,
      label: 'Cancel Subtitle OCR',
    });
  });

  it('uses restore wording while preview restore is running', () => {
    expect(getSubtitleOcrCancelActionState(false, 'restore')).toEqual({
      disabled: false,
      label: 'Cancel Restore',
    });
  });

  it('uses restore wording while preview restore cancellation is pending', () => {
    expect(getSubtitleOcrCancelActionState(true, 'restore')).toEqual({
      disabled: true,
      label: 'Cancelling restore...',
    });
  });
});
