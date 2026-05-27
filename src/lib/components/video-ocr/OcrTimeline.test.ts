import { describe, expect, it } from 'vitest';

import {
  attachOcrTimelineDragListeners,
  formatOcrTimelinePreciseTime,
  getOcrTimelineAutoPanEdgeWidth,
  getOcrTimelineAutoPanIntent,
  getOcrTimelineSegmentEditForPointerTime,
  getOcrTimelineRollbackSegmentEdit,
  isValidOcrTimelineCutTime,
  shouldCancelTimelineSeekOnPointerEnd,
  shouldCommitTimelineSegmentEditOnPointerEnd,
  shouldCommitTimelineSeekOnPointerEnd,
  shouldRollbackTimelineSegmentEditOnPointerEnd,
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
      {
        type: 'move',
        segmentId: 'segment-1',
        startTimeMs: 1_000,
        endTimeMs: 3_000,
        durationMs: 2_000,
        offsetMs: 500,
      },
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

  it('rolls back previewed segment edits on pointercancel', () => {
    expect(shouldRollbackTimelineSegmentEditOnPointerEnd('pointercancel', 'move', true)).toBe(true);
    expect(shouldRollbackTimelineSegmentEditOnPointerEnd('pointerup', 'move', true)).toBe(false);
    expect(shouldRollbackTimelineSegmentEditOnPointerEnd('pointercancel', 'move', false)).toBe(false);
    expect(shouldRollbackTimelineSegmentEditOnPointerEnd('pointercancel', 'seek', true)).toBe(false);

    expect(getOcrTimelineRollbackSegmentEdit({
      type: 'move',
      segmentId: 'segment-1',
      startTimeMs: 1_000,
      endTimeMs: 3_000,
      durationMs: 2_000,
      offsetMs: 400,
    })).toEqual({
      segmentId: 'segment-1',
      startTimeMs: 1_000,
      endTimeMs: 3_000,
      seekTimeMs: 1_000,
    });

    expect(getOcrTimelineRollbackSegmentEdit({
      type: 'trim-end',
      segmentId: 'segment-1',
      startTimeMs: 1_000,
      endTimeMs: 3_000,
    })).toEqual({
      segmentId: 'segment-1',
      startTimeMs: 1_000,
      endTimeMs: 3_000,
      seekTimeMs: 3_000,
    });
  });

  it('computes clamped auto-pan edge widths', () => {
    expect(getOcrTimelineAutoPanEdgeWidth(300)).toBe(60);
    expect(getOcrTimelineAutoPanEdgeWidth(1_000)).toBe(120);
    expect(getOcrTimelineAutoPanEdgeWidth(2_000)).toBe(150);
  });

  it('computes auto-pan intent from pointer pressure near track edges', () => {
    const leftIntent = getOcrTimelineAutoPanIntent({
      pointerClientX: 40,
      trackLeft: 0,
      trackWidth: 1_000,
      viewportWindowMs: 30_000,
      durationMs: 120_000,
    });
    expect(leftIntent.direction).toBe(-1);
    expect(leftIntent.pressure).toBeCloseTo(0.666, 3);

    const rightIntent = getOcrTimelineAutoPanIntent({
      pointerClientX: 960,
      trackLeft: 0,
      trackWidth: 1_000,
      viewportWindowMs: 30_000,
      durationMs: 120_000,
    });
    expect(rightIntent.direction).toBe(1);
    expect(rightIntent.pressure).toBeCloseTo(0.666, 3);

    expect(getOcrTimelineAutoPanIntent({
      pointerClientX: 500,
      trackLeft: 0,
      trackWidth: 1_000,
      viewportWindowMs: 30_000,
      durationMs: 120_000,
    })).toEqual({ direction: 0, pressure: 0 });
  });

  it('does not auto-pan when the full duration is already visible', () => {
    expect(getOcrTimelineAutoPanIntent({
      pointerClientX: 20,
      trackLeft: 0,
      trackWidth: 1_000,
      viewportWindowMs: 120_000,
      durationMs: 120_000,
    })).toEqual({ direction: 0, pressure: 0 });
  });

  it('formats precise timeline timestamps with milliseconds', () => {
    expect(formatOcrTimelinePreciseTime(606_240)).toBe('10:06.240');
    expect(formatOcrTimelinePreciseTime(3_661_007)).toBe('1:01:01.007');
  });

  it('validates cut times strictly inside segment boundaries', () => {
    expect(isValidOcrTimelineCutTime(1_000, 1_000, 5_000)).toBe(false);
    expect(isValidOcrTimelineCutTime(4_999, 1_000, 5_000)).toBe(true);
    expect(isValidOcrTimelineCutTime(5_000, 1_000, 5_000)).toBe(false);
  });
});
