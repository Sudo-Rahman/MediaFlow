import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSubtitleOcrPreviewRestoreState } from './subtitle-ocr-preview-restore-state';

describe('Subtitle OCR preview restore state', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects stale T1 callbacks without changing an in-flight T2 attempt', () => {
    const state = createSubtitleOcrPreviewRestoreState();

    expect(state.begin('item-1', 'T1', true)).toBe(true);
    expect(state.queue('item-1', 'T2', true, 2)).toBe(true);
    expect(state.begin('item-1', 'T2', true)).toBe(true);

    expect(state.retry('item-1', 'T1', 3)).toBe(false);
    expect(state.discard('item-1', 'T1')).toBe(false);
    expect(state.finish('item-1', 'T1')).toBe(false);

    expect(state.getCurrent('item-1')).toEqual({
      itemId: 'item-1',
      hydrationToken: 'T2',
      attempts: 2,
      phase: 'in_flight',
    });
  });

  it('keeps independent retry timers when a later item is removed', () => {
    vi.useFakeTimers();
    const state = createSubtitleOcrPreviewRestoreState();
    const callbacks = { a: 0, b: 0 };

    expect(state.queue('item-a', 'A', true, 1)).toBe(true);
    expect(state.queue('item-b', 'B', true, 1)).toBe(true);
    expect(state.schedule('item-a', 'A', () => { callbacks.a += 1; })).toBe(true);
    expect(state.schedule('item-b', 'B', () => { callbacks.b += 1; })).toBe(true);
    expect(vi.getTimerCount()).toBe(2);

    expect(state.discard('item-b', 'B')).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    vi.runAllTimers();
    expect(callbacks).toEqual({ a: 1, b: 0 });
    expect(state.getCurrent('item-a')).toEqual({
      itemId: 'item-a',
      hydrationToken: 'A',
      attempts: 1,
      phase: 'queued',
    });
  });
});
