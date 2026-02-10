import { invoke } from '@tauri-apps/api/core';

export async function withSleepInhibit<T>(
  reason: string,
  fn: () => Promise<T>
): Promise<T> {
  let token: number | null = null;

  try {
    token = await invoke<number>('acquire_sleep_inhibit', { reason });
  } catch (error) {
    console.error('Failed to acquire sleep inhibition:', error);
  }

  try {
    return await fn();
  } finally {
    if (token !== null) {
      try {
        await invoke('release_sleep_inhibit', { token });
      } catch (error) {
        console.error('Failed to release sleep inhibition:', error);
      }
    }
  }
}
