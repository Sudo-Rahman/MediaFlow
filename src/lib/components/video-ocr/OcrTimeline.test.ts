import { describe, expect, it } from 'vitest';

import {
  shouldCommitTimelineSeekOnPointerEnd,
  shouldSyncTimelinePlaybackFromCurrentTime,
} from './OcrTimeline.svelte';

describe('OcrTimeline seek interactions', () => {
  it('commits seek drags only on pointerup', () => {
    expect(shouldCommitTimelineSeekOnPointerEnd('pointerup', 'seek')).toBe(true);
    expect(shouldCommitTimelineSeekOnPointerEnd('pointercancel', 'seek')).toBe(false);
    expect(shouldCommitTimelineSeekOnPointerEnd('pointerup', 'move')).toBe(false);
  });

  it('does not resync playhead from stale props while seek dragging', () => {
    expect(shouldSyncTimelinePlaybackFromCurrentTime(false)).toBe(true);
    expect(shouldSyncTimelinePlaybackFromCurrentTime(true)).toBe(false);
  });
});
