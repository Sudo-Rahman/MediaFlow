import { invoke } from '@tauri-apps/api/core';

export type StartupInvoke = (command: string) => Promise<unknown>;
export type StartupFrameScheduler = (callback: FrameRequestCallback) => number;

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
): Promise<void> {
  return new Promise((resolve) => {
    scheduleFrame(() => {
      scheduleFrame(() => {
        resolve();
      });
    });
  });
}
