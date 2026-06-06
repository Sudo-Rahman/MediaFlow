import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const getCurrentMock = vi.hoisted(() => vi.fn<() => Promise<string[] | null>>(async () => null));
const onOpenUrlMock = vi.hoisted(() => vi.fn<() => Promise<() => void>>(async () => () => {}));
const listenMock = vi.hoisted(() => vi.fn<() => Promise<() => void>>(async () => () => {}));
const settingsStoreMock = vi.hoisted(() => ({
  settings: {
    mediaflowUser: null,
  },
  setMediaFlowUser: vi.fn(async (user) => {
    settingsStoreMock.settings.mediaflowUser = user;
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: getCurrentMock,
  onOpenUrl: onOpenUrlMock,
}));

vi.mock('$lib/stores/settings.svelte', () => ({
  settingsStore: settingsStoreMock,
}));

vi.mock('$lib/stores/logs.svelte', () => ({
  logStore: {
    addLog: vi.fn(),
  },
}));

function getOpenSignInArgs(): { codeChallenge: string; state: string } {
  const call = invokeMock.mock.calls.find(([command]) => command === 'open_mediaflow_sign_in');
  expect(call).toBeTruthy();
  return call?.[1] as { codeChallenge: string; state: string };
}

describe('MediaFlow OAuth helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    settingsStoreMock.settings.mediaflowUser = null;
    invokeMock.mockReset();
    getCurrentMock.mockReset();
    getCurrentMock.mockResolvedValue(null);
    onOpenUrlMock.mockReset();
    onOpenUrlMock.mockResolvedValue(() => {});
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'open_mediaflow_sign_in') return undefined;
      throw new Error(`Unexpected command: ${command}`);
    });

    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });
  });

  it('creates the RFC 7636 S256 code challenge', async () => {
    const { createCodeChallenge } = await import('../src/lib/services/mediaflow-auth');

    await expect(
      createCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
    ).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('parses and validates the custom scheme callback', async () => {
    const { parseOAuthCallbackUrl } = await import('../src/lib/services/mediaflow-auth');

    expect(parseOAuthCallbackUrl('mediaflow://oauth/callback?code=abc&state=xyz', 'xyz')).toEqual({
      code: 'abc',
      state: 'xyz',
    });
    expect(() => parseOAuthCallbackUrl('mediaflow://oauth/callback?code=abc&state=bad', 'xyz'))
      .toThrow(/state mismatch/i);
    expect(() => parseOAuthCallbackUrl('https://localhost/callback?code=abc&state=xyz', 'xyz'))
      .toThrow(/invalid/i);
  });

  it('persists pending PKCE state so a deep-link app restart can finish login', async () => {
    const { signInWithMediaFlow } = await import('../src/lib/services/mediaflow-auth');

    await signInWithMediaFlow();

    const { state } = getOpenSignInArgs();
    const callbackUrl = `mediaflow://oauth/callback?code=auth-code&state=${state}`;

    vi.resetModules();
    getCurrentMock.mockResolvedValue([callbackUrl]);
    invokeMock.mockImplementation(async (command: string, args?: { refreshToken?: string }) => {
      if (command === 'exchange_mediaflow_authorization_code') {
        return {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
        };
      }
      if (command === 'store_refresh_token') return undefined;
      if (command === 'get_refresh_token') return 'refresh-token';
      if (command === 'fetch_mediaflow_user_info') {
        return {
          email: 'local@example.com',
          name: 'Local User',
          avatarUrl: 'https://example.com/local-avatar.png',
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { initMediaFlowAuth } = await import('../src/lib/services/mediaflow-auth');
    await initMediaFlowAuth();

    expect(invokeMock).toHaveBeenCalledWith('exchange_mediaflow_authorization_code', expect.objectContaining({
      code: 'auth-code',
      codeVerifier: expect.any(String),
    }));
    expect(invokeMock).toHaveBeenCalledWith('store_refresh_token', { refreshToken: 'refresh-token' });
    expect(invokeMock).toHaveBeenCalledWith('get_refresh_token');
    expect(invokeMock).toHaveBeenCalledWith('fetch_mediaflow_user_info', { accessToken: 'access-token' });
    expect(settingsStoreMock.settings.mediaflowUser).toEqual({
      email: 'local@example.com',
      name: 'Local User',
      avatarUrl: 'https://example.com/local-avatar.png',
    });
  });

  it('rejects sign-in if the token response does not include a refresh token', async () => {
    const { signInWithMediaFlow } = await import('../src/lib/services/mediaflow-auth');

    await signInWithMediaFlow();

    const { state } = getOpenSignInArgs();
    const callbackUrl = `mediaflow://oauth/callback?code=auth-code&state=${state}`;

    vi.resetModules();
    getCurrentMock.mockResolvedValue([callbackUrl]);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'exchange_mediaflow_authorization_code') {
        return {
          access_token: 'access-token',
          expires_in: 3600,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { initMediaFlowAuth } = await import('../src/lib/services/mediaflow-auth');
    await expect(initMediaFlowAuth()).rejects.toThrow(/refresh token/i);

    expect(invokeMock).toHaveBeenCalledWith('exchange_mediaflow_authorization_code', expect.any(Object));
    expect(invokeMock).not.toHaveBeenCalledWith('store_refresh_token', expect.any(Object));
    expect(settingsStoreMock.settings.mediaflowUser).toBeNull();
  });

  it('ignores a stale current callback when no login is pending', async () => {
    getCurrentMock.mockResolvedValue(['mediaflow://oauth/callback?code=old&state=old']);

    const { initMediaFlowAuth } = await import('../src/lib/services/mediaflow-auth');

    await expect(initMediaFlowAuth()).resolves.toBeUndefined();
  });

  it('refreshes a token and retries usage once after an invalid bearer response', async () => {
    let storedRefreshToken = 'refresh-token';
    invokeMock.mockImplementation(async (command: string, args?: { refreshToken?: string }) => {
      if (command === 'get_refresh_token') return storedRefreshToken;
      if (command === 'store_refresh_token') {
        storedRefreshToken = args?.refreshToken ?? storedRefreshToken;
        return undefined;
      }
      if (command === 'refresh_mediaflow_access_token') {
        const token = storedRefreshToken === 'refresh-token' ? 'access-1' : 'access-2';
        const refreshToken = storedRefreshToken === 'refresh-token' ? 'refresh-1' : 'refresh-2';
        return {
          access_token: token,
          refresh_token: refreshToken,
          expires_in: 3600,
        };
      }
      if (command === 'fetch_mediaflow_user_info') {
        return {
          email: 'local@example.com',
          name: 'Local User',
        };
      }
      if (command === 'fetch_mediaflow_account_usage') {
        const accessToken = (args as { accessToken?: string } | undefined)?.accessToken;
        if (accessToken === 'access-1') {
          return {
            status: 401,
            body: JSON.stringify({
              error: { code: 'invalid_token', message: 'Invalid or expired token.' },
            }),
          };
        }
        return {
          status: 200,
          body: JSON.stringify({ ok: true }),
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { fetchMediaFlowAccountUsage } = await import('../src/lib/services/mediaflow-auth');
    const response = await fetchMediaFlowAccountUsage();

    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(invokeMock).toHaveBeenCalledWith('fetch_mediaflow_account_usage', { accessToken: 'access-1' });
    expect(invokeMock).toHaveBeenCalledWith('fetch_mediaflow_account_usage', { accessToken: 'access-2' });
  });
});
