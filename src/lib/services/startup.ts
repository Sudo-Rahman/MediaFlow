import { invoke } from '@tauri-apps/api/core';

export type StartupInvoke = (command: string) => Promise<unknown>;
export type StartupFrameScheduler = (callback: FrameRequestCallback) => number;
export type StartupTimeoutScheduler = (callback: () => void, delay: number) => unknown;

export const STARTUP_PAINT_TIMEOUT_MS = 120;

export async function markStartupSplashReady(
  invokeCommand: StartupInvoke = invoke,
): Promise<boolean> {
  try {
    await invokeCommand('mark_startup_splash_ready');
    return true;
  } catch {
    return false;
  }
}

export function waitForStartupPaint(
  scheduleFrame: StartupFrameScheduler = requestAnimationFrame,
  scheduleTimeout: StartupTimeoutScheduler = setTimeout,
  timeoutMs = STARTUP_PAINT_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;
      resolve();
    };

    scheduleTimeout(finish, timeoutMs);

    scheduleFrame(() => {
      if (finished) {
        return;
      }

      scheduleFrame(() => {
        finish();
      });
    });
  });
}
