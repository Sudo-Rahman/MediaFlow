import { invoke } from '@tauri-apps/api/core';

export interface WindowControlRectPayload {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export function getElementWindowControlRect(element: HTMLElement): WindowControlRectPayload {
  const rect = element.getBoundingClientRect();

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    scaleFactor: window.devicePixelRatio || 1,
  };
}

export async function updateWindowsMaximizeButtonRect(element: HTMLElement): Promise<void> {
  await invoke<void>('update_windows_maximize_button_rect', {
    rect: getElementWindowControlRect(element),
  });
}

export async function showWindowsSnapOverlay(): Promise<void> {
  await invoke<void>('show_windows_snap_overlay');
}
