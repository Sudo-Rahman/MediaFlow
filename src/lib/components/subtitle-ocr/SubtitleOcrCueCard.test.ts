import { describe, expect, it } from 'vitest';

import {
  canEditSubtitleOcrCueText,
  canNavigateSubtitleOcrCue,
  shouldCommitSubtitleOcrCueText,
} from './SubtitleOcrCueCard.svelte';

describe('SubtitleOcrCueCard controls', () => {
  it('keeps cue navigation available when only text editing is read-only', () => {
    expect(canNavigateSubtitleOcrCue({ disabled: false, hasHandler: true })).toBe(true);
    expect(canEditSubtitleOcrCueText({ disabled: false, textDisabled: true })).toBe(false);
  });

  it('blocks navigation and editing when the whole cue card is disabled', () => {
    expect(canNavigateSubtitleOcrCue({ disabled: true, hasHandler: true })).toBe(false);
    expect(canEditSubtitleOcrCueText({ disabled: true, textDisabled: false })).toBe(false);
  });

  it('commits recognized text only when editable text changed', () => {
    expect(shouldCommitSubtitleOcrCueText({
      disabled: false,
      textDisabled: false,
      currentText: 'before',
      nextText: 'after',
    })).toBe(true);
    expect(shouldCommitSubtitleOcrCueText({
      disabled: false,
      textDisabled: false,
      currentText: 'same',
      nextText: 'same',
    })).toBe(false);
    expect(shouldCommitSubtitleOcrCueText({
      disabled: false,
      textDisabled: true,
      currentText: 'before',
      nextText: 'after',
    })).toBe(false);
  });
});
