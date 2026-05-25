import { describe, expect, it } from 'vitest';

import {
  PREVIEW_SEEK_THROTTLE_MS,
  getPreviewSeekThrottleDelay,
  getPreviewKeyboardAction,
  shouldApplySeekToken,
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

  it('applies delayed seek work only for the active seek token', () => {
    expect(shouldApplySeekToken(3, 3)).toBe(true);
    expect(shouldApplySeekToken(3, 4)).toBe(false);
    expect(shouldApplySeekToken(null, 4)).toBe(false);
  });

  it('throttles preview media seeks to the configured interval', () => {
    expect(PREVIEW_SEEK_THROTTLE_MS).toBe(120);
    expect(getPreviewSeekThrottleDelay(200, 100)).toBe(20);
    expect(getPreviewSeekThrottleDelay(250, 100)).toBe(0);
    expect(getPreviewSeekThrottleDelay(50, Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
