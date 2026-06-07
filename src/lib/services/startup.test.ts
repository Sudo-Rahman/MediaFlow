import { describe, expect, it, vi } from 'vitest';

import {
  markStartupSplashReady,
  waitForStartupPaint,
  type StartupInvoke,
  type StartupFrameScheduler,
} from './startup';

describe('startup helpers', () => {
  it('marks the startup splash ready through Tauri invoke', async () => {
    const invoke = vi.fn<StartupInvoke>().mockResolvedValue(undefined);

    await expect(markStartupSplashReady(invoke)).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('mark_startup_splash_ready');
  });

  it('returns false when the Tauri ready signal fails', async () => {
    const invoke = vi.fn<StartupInvoke>().mockRejectedValue(new Error('not in Tauri'));

    await expect(markStartupSplashReady(invoke)).resolves.toBe(false);
  });

  it('waits for two animation frames before resolving', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const scheduleFrame: StartupFrameScheduler = (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    };

    let resolved = false;
    const ready = waitForStartupPaint(scheduleFrame).then(() => {
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
});
