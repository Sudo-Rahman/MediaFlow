import { beforeEach, describe, expect, it, vi } from 'vitest';

const isTauriMock = vi.hoisted(() => vi.fn(() => true));
const updaterCheckMock = vi.hoisted(() => vi.fn(async () => null));
const updaterInfoMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: isTauriMock,
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: updaterCheckMock,
}));

vi.mock('$lib/utils/log-toast', () => ({
  logAndToast: {
    error: vi.fn(),
    info: updaterInfoMock,
  },
}));

describe('updater store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
    updaterCheckMock.mockResolvedValue(null);
  });

  it('treats Microsoft Store builds as store-managed without calling the updater plugin', async () => {
    vi.stubEnv('VITE_MEDIAFLOW_DISTRIBUTION', 'microsoft-store');
    const { updaterStore } = await import('./updater.svelte');

    await updaterStore.checkForUpdates({ manual: true });

    expect(updaterStore.status).toBe('managed-by-store');
    expect(updaterStore.isManagedByStore).toBe(true);
    expect(updaterStore.lastCheckAt).toBeInstanceOf(Date);
    expect(updaterStore.lastError).toBeNull();
    expect(updaterStore.progress).toBeNull();
    expect(updaterStore.hasUpdate).toBe(false);
    expect(updaterCheckMock).not.toHaveBeenCalled();
    expect(updaterInfoMock).toHaveBeenCalledWith({
      source: 'updater',
      title: 'Updates are managed by Microsoft Store',
      details: 'Install updates from Microsoft Store.',
      showToast: true,
    });
  });
});
