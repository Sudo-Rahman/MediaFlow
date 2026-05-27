import { describe, expect, it } from 'vitest';

import {
  attachOcrTimelineDragListeners,
  getOcrTimelineSegmentEditForPointerTime,
  shouldCancelTimelineSeekOnPointerEnd,
  shouldCommitTimelineSegmentEditOnPointerEnd,
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

  it('calculates move and trim edits from pointer time', () => {
    expect(getOcrTimelineSegmentEditForPointerTime(
      { type: 'move', segmentId: 'segment-1', durationMs: 2_000, offsetMs: 500 },
      5_000,
      10_000,
    )).toEqual({
      segmentId: 'segment-1',
      startTimeMs: 4_500,
      endTimeMs: 6_500,
      seekTimeMs: 4_500,
    });

    expect(getOcrTimelineSegmentEditForPointerTime(
      { type: 'trim-start', segmentId: 'segment-1', startTimeMs: 1_000, endTimeMs: 4_000 },
      4_500,
      10_000,
    )).toEqual({
      segmentId: 'segment-1',
      startTimeMs: 3_999,
      endTimeMs: 4_000,
      seekTimeMs: 3_999,
    });

    expect(getOcrTimelineSegmentEditForPointerTime(
      { type: 'trim-end', segmentId: 'segment-1', startTimeMs: 1_000, endTimeMs: 4_000 },
      12_000,
      10_000,
    )).toEqual({
      segmentId: 'segment-1',
      startTimeMs: 1_000,
      endTimeMs: 10_000,
      seekTimeMs: 10_000,
    });
  });

  it('commits segment drag edits only on pointerup after preview updates', () => {
    expect(shouldCommitTimelineSegmentEditOnPointerEnd('pointerup', 'move', true, true)).toBe(true);
    expect(shouldCommitTimelineSegmentEditOnPointerEnd('pointercancel', 'move', true, true)).toBe(false);
    expect(shouldCommitTimelineSegmentEditOnPointerEnd('pointerup', 'seek', true, true)).toBe(false);
    expect(shouldCommitTimelineSegmentEditOnPointerEnd('pointerup', 'trim-start', false, true)).toBe(false);
    expect(shouldCommitTimelineSegmentEditOnPointerEnd('pointerup', 'trim-end', true, false)).toBe(false);
  });
});
