import { describe, expect, it } from 'vitest';

import {
  shouldCommitSeekOnPointerEnd,
  shouldRenderVolumePopoverInline,
  shouldSyncSeekUiFromCurrentTime,
} from './PreviewPlayerControls.svelte';

describe('PreviewPlayerControls', () => {
  it('keeps the volume popover in its normal portal while expanded preview is active', () => {
    expect(shouldRenderVolumePopoverInline(true)).toBe(false);
  });

  it('keeps the default popover portal outside expanded preview', () => {
    expect(shouldRenderVolumePopoverInline(false)).toBe(false);
  });

  it('commits seek drags only on pointerup', () => {
    expect(shouldCommitSeekOnPointerEnd('pointerup')).toBe(true);
    expect(shouldCommitSeekOnPointerEnd('pointercancel')).toBe(false);
  });

  it('does not resync seek UI from stale props while dragging', () => {
    expect(shouldSyncSeekUiFromCurrentTime(null)).toBe(true);
    expect(shouldSyncSeekUiFromCurrentTime(12)).toBe(false);
  });
});
