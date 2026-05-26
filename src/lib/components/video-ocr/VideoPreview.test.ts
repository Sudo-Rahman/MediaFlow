import { describe, expect, it } from 'vitest';

import {
  PREVIEW_SEEK_THROTTLE_MS,
  createPreviewChangeTimes,
  getPreviewSeekThrottleDelay,
  getPreviewKeyboardAction,
  shouldRenderPreviewOverlayInline,
  shouldSuppressPostSeekPlaybackSync,
  shouldApplySeekToken,
  shouldTogglePreviewFullscreenFromDoubleClick,
  shouldTogglePreviewPlaybackFromClick,
} from './VideoPreview.svelte';
import type { OcrSubtitle, VideoOcrSelection } from '$lib/types';

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

  it('toggles fullscreen only from primary double-clicks while preview interactions are enabled', () => {
    expect(shouldTogglePreviewFullscreenFromDoubleClick(0, false)).toBe(true);
    expect(shouldTogglePreviewFullscreenFromDoubleClick(2, false)).toBe(false);
    expect(shouldTogglePreviewFullscreenFromDoubleClick(0, true)).toBe(false);
  });

  it('renders preview overlays inline while fullscreen is active', () => {
    expect(shouldRenderPreviewOverlayInline(true)).toBe(true);
    expect(shouldRenderPreviewOverlayInline(false)).toBe(false);
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

  it('suppresses stale playback syncs during the post-seek guard window', () => {
    expect(shouldSuppressPostSeekPlaybackSync(1.85, 351.864, 1_200, 2_000, 1)).toBe(true);
  });

  it('accepts playback frames close to the confirmed seek target during the guard window', () => {
    expect(shouldSuppressPostSeekPlaybackSync(351.935, 351.864, 1_200, 2_000, 1)).toBe(false);
  });

  it('accepts playback syncs after the post-seek guard window expires', () => {
    expect(shouldSuppressPostSeekPlaybackSync(1.85, 351.864, 2_001, 2_000, 1)).toBe(false);
  });

  it('keeps normal playback sync behavior when there is no recent confirmed seek', () => {
    expect(shouldSuppressPostSeekPlaybackSync(1.85, null, 1_200, 2_000, 1)).toBe(false);
  });

  it('builds preview change buckets from the active subtitles instead of the latest file version', () => {
    const selection: VideoOcrSelection = {
      segments: [
        {
          id: 'segment-1',
          startTimeMs: 1_000,
          endTimeMs: 5_000,
          zones: [
            {
              id: 'zone-1',
              role: 'main_subtitle',
              region: { x: 0, y: 0.75, width: 1, height: 0.25 },
            },
          ],
        },
      ],
    };
    const activeSubtitles: OcrSubtitle[] = [
      {
        id: 'active-subtitle',
        text: 'Active version',
        startTime: 2_000,
        endTime: 3_000,
        confidence: 0.9,
      },
    ];

    expect(createPreviewChangeTimes(10, selection, activeSubtitles)).toEqual([
      0,
      1_000,
      2_000,
      3_001,
      5_000,
      10_000,
    ]);
  });
});
