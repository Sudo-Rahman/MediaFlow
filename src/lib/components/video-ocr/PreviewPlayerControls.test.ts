import { describe, expect, it } from 'vitest';

import {
  shouldCommitSeekOnPointerEnd,
  shouldSyncSeekUiFromCurrentTime,
} from './PreviewPlayerControls.svelte';

describe('PreviewPlayerControls', () => {
  it('commits seek drags only on pointerup', () => {
    expect(shouldCommitSeekOnPointerEnd('pointerup')).toBe(true);
    expect(shouldCommitSeekOnPointerEnd('pointercancel')).toBe(false);
  });

  it('does not resync seek UI from stale props while dragging', () => {
    expect(shouldSyncSeekUiFromCurrentTime(null)).toBe(true);
    expect(shouldSyncSeekUiFromCurrentTime(12)).toBe(false);
  });
});
