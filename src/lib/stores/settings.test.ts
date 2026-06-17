import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
}));
const loadStoreMock = vi.hoisted(() => vi.fn(async () => fakeStore));

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: loadStoreMock,
  },
}));

describe('settingsStore MediaFlow account listeners', () => {
  beforeEach(() => {
    loadStoreMock.mockClear();
    fakeStore.get.mockReset().mockResolvedValue(undefined);
    fakeStore.set.mockReset().mockResolvedValue(undefined);
    fakeStore.delete.mockReset().mockResolvedValue(undefined);
    fakeStore.clear.mockReset().mockResolvedValue(undefined);
  });

  it('notifies listeners when the MediaFlow user changes', async () => {
    const { settingsStore } = await import('./settings.svelte');
    const listener = vi.fn();
    const user = { email: 'starter@example.com', name: 'Starter User' };

    const unsubscribe = settingsStore.onMediaFlowUserChange(listener);
    await settingsStore.setMediaFlowUser(user);
    await settingsStore.setMediaFlowUser(null);
    unsubscribe();
    await settingsStore.setMediaFlowUser({ email: 'ignored@example.com' });

    expect(listener).toHaveBeenNthCalledWith(1, user);
    expect(listener).toHaveBeenNthCalledWith(2, null);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
