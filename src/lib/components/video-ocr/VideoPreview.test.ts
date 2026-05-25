import { describe, expect, it } from 'vitest';

import {
  getPreviewKeyboardAction,
  shouldTogglePreviewPlaybackFromClick,
} from './VideoPreview.svelte';

describe('VideoPreview interactions', () => {
  it('maps space to playback toggle', () => {
    expect(getPreviewKeyboardAction(' ', false)).toBe('toggle-playback');
  });

  it('maps horizontal arrows to ten second skips', () => {
    expect(getPreviewKeyboardAction('ArrowLeft', false)).toBe('skip-backward');
    expect(getPreviewKeyboardAction('ArrowRight', false)).toBe('skip-forward');
  });

  it('ignores playback shortcuts while preview interactions are disabled', () => {
    expect(getPreviewKeyboardAction(' ', true)).toBeNull();
    expect(getPreviewKeyboardAction('ArrowLeft', true)).toBeNull();
    expect(getPreviewKeyboardAction('ArrowRight', true)).toBeNull();
  });

  it('toggles playback only for primary surface clicks', () => {
    expect(shouldTogglePreviewPlaybackFromClick(0, false)).toBe(true);
    expect(shouldTogglePreviewPlaybackFromClick(2, false)).toBe(false);
    expect(shouldTogglePreviewPlaybackFromClick(0, true)).toBe(false);
  });
});
