import { describe, expect, it, vi } from 'vitest';

import {
  waitForStartupPaint,
  type StartupFrameScheduler,
  type StartupTimeoutScheduler,
} from './startup';

describe('startup helpers', () => {
  it('waits for two animation frames before resolving', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const scheduleFrame: StartupFrameScheduler = (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    };
    const scheduleTimeout: StartupTimeoutScheduler = () => 0;

    let resolved = false;
    const ready = waitForStartupPaint(scheduleFrame, scheduleTimeout).then(() => {
      resolved = true;
    });

    expect(callbacks).toHaveLength(1);
    expect(resolved).toBe(false);

    callbacks.shift()?.(16);
    await Promise.resolve();

    expect(callbacks).toHaveLength(1);
    expect(resolved).toBe(false);

    callbacks.shift()?.(32);
    await ready;

    expect(resolved).toBe(true);
  });

  it('resolves when animation frames never run but the timeout fires', async () => {
    let timeoutCallback: (() => void) | undefined;
    const scheduleFrame: StartupFrameScheduler = vi.fn(() => 1);
    const scheduleTimeout: StartupTimeoutScheduler = (callback) => {
      timeoutCallback = callback;
      return 1;
    };

    let resolved = false;
    const ready = waitForStartupPaint(scheduleFrame, scheduleTimeout).then(() => {
      resolved = true;
    });

    expect(scheduleFrame).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);

    timeoutCallback?.();
    await ready;

    expect(resolved).toBe(true);
  });
});
