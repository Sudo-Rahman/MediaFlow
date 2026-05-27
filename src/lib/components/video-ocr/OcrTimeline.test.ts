import { describe, expect, it } from 'vitest';

import {
  attachOcrTimelineDragListeners,
  shouldCancelTimelineSeekOnPointerEnd,
  shouldCommitTimelineSeekOnPointerEnd,
  shouldSyncTimelinePlaybackFromCurrentTime,
} from './OcrTimeline.svelte';

describe('OcrTimeline seek interactions', () => {
  it('commits seek drags only on pointerup', () => {
    expect(shouldCommitTimelineSeekOnPointerEnd('pointerup', 'seek')).toBe(true);
    expect(shouldCommitTimelineSeekOnPointerEnd('pointercancel', 'seek')).toBe(false);
    expect(shouldCommitTimelineSeekOnPointerEnd('pointerup', 'move')).toBe(false);
  });

  it('cancels active seek drags when cleanup has no pointerup event', () => {
    expect(shouldCancelTimelineSeekOnPointerEnd('pointercancel', 'seek', false)).toBe(true);
    expect(shouldCancelTimelineSeekOnPointerEnd('pointercancel', 'seek', true)).toBe(true);
    expect(shouldCancelTimelineSeekOnPointerEnd('pointerup', 'seek', true)).toBe(false);
    expect(shouldCancelTimelineSeekOnPointerEnd('pointercancel', 'move', false)).toBe(false);
  });

  it('does not resync playhead from stale props while seek dragging', () => {
    expect(shouldSyncTimelinePlaybackFromCurrentTime(false)).toBe(true);
    expect(shouldSyncTimelinePlaybackFromCurrentTime(true)).toBe(false);
  });

  it('removes active window drag listeners during cleanup', () => {
    const addedListeners: Array<{
      type: string;
      listener: EventListener;
      options?: AddEventListenerOptions;
    }> = [];
    const removedListeners: Array<{ type: string; listener: EventListener }> = [];
    const target = {
      addEventListener: (type: string, listener: EventListener, options?: AddEventListenerOptions) => {
        addedListeners.push({ type, listener, options });
      },
      removeEventListener: (type: string, listener: EventListener) => {
        removedListeners.push({ type, listener });
      },
    };
    const listeners = {
      pointermove: () => undefined,
      pointerup: () => undefined,
      pointercancel: () => undefined,
    };

    const cleanup = attachOcrTimelineDragListeners(target, listeners);

    expect(addedListeners).toEqual([
      { type: 'pointermove', listener: listeners.pointermove, options: undefined },
      { type: 'pointerup', listener: listeners.pointerup, options: { once: true } },
      { type: 'pointercancel', listener: listeners.pointercancel, options: { once: true } },
    ]);

    cleanup();
    cleanup();

    expect(removedListeners).toEqual([
      { type: 'pointermove', listener: listeners.pointermove },
      { type: 'pointerup', listener: listeners.pointerup },
      { type: 'pointercancel', listener: listeners.pointercancel },
    ]);
  });
});
