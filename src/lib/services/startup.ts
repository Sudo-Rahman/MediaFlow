export type StartupFrameScheduler = (callback: FrameRequestCallback) => number;
export type StartupTimeoutScheduler = (callback: () => void, delay: number) => unknown;

export const STARTUP_PAINT_TIMEOUT_MS = 120;

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
