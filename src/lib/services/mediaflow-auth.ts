import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { settingsStore, type MediaFlowUser } from '$lib/stores/settings.svelte';
import { logStore } from '$lib/stores/logs.svelte';

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;
const PENDING_LOGIN_STORAGE_KEY = 'mediaflow.oauth.pendingLogin';
const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;

export interface OAuthCallbackParams {
  code: string;
  state: string;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  refreshToken?: string;
  scope?: string;
  id_token?: string;
}

interface ApplyTokenOptions {
  requireRefreshToken?: boolean;
  fallbackRefreshToken?: string;
}

interface PendingLogin {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let pendingLogin: PendingLogin | null = null;
let unlistenDeepLink: (() => void) | null = null;
let unlistenNativeDeepLink: (() => void) | null = null;
let restorePromise: Promise<void> | null = null;
let refreshPromise: Promise<string> | null = null;
const callbackStatesInProgress = new Set<string>();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isPendingLogin(value: unknown): value is PendingLogin {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.state === 'string' &&
    typeof candidate.codeVerifier === 'string' &&
    typeof candidate.createdAt === 'number'
  );
}

function storePendingLogin(login: PendingLogin): void {
  pendingLogin = login;

  try {
    getLocalStorage()?.setItem(PENDING_LOGIN_STORAGE_KEY, JSON.stringify(login));
  } catch (error) {
    console.warn('Failed to persist pending MediaFlow OAuth login:', error);
  }
}

function clearPendingLogin(): void {
  pendingLogin = null;

  try {
    getLocalStorage()?.removeItem(PENDING_LOGIN_STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear pending MediaFlow OAuth login:', error);
  }
}

function getPendingLogin(): PendingLogin | null {
  if (pendingLogin) {
    return pendingLogin;
  }

  const stored = getLocalStorage()?.getItem(PENDING_LOGIN_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isPendingLogin(parsed) || Date.now() - parsed.createdAt > PENDING_LOGIN_TTL_MS) {
      clearPendingLogin();
      return null;
    }

    pendingLogin = parsed;
    return parsed;
  } catch {
    clearPendingLogin();
    return null;
  }
}

export async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function createPkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = await createCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}

export function parseOAuthCallbackUrl(url: string, expectedState?: string): OAuthCallbackParams {
  const parsed = new URL(url);
  if (parsed.protocol !== 'mediaflow:' || parsed.hostname !== 'oauth' || parsed.pathname !== '/callback') {
    throw new Error('Invalid MediaFlow OAuth callback URL.');
  }

  const error = parsed.searchParams.get('error');
  if (error) {
    throw new Error(parsed.searchParams.get('error_description') || error);
  }

  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');
  if (!code || !state) {
    throw new Error('OAuth callback is missing code or state.');
  }

  if (expectedState && state !== expectedState) {
    throw new Error('OAuth state mismatch.');
  }

  return { code, state };
}

export function isMediaFlowOAuthCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'mediaflow:' && parsed.hostname === 'oauth' && parsed.pathname === '/callback';
  } catch {
    return false;
  }
}

async function fetchUserInfo(token: string): Promise<MediaFlowUser> {
  return invoke<MediaFlowUser>('fetch_mediaflow_user_info', { accessToken: token });
}

function refreshTokenFromResponse(tokenResponse: TokenResponse): string | null {
  return tokenResponse.refresh_token || tokenResponse.refreshToken || null;
}

async function storeAndVerifyRefreshToken(refreshToken: string): Promise<void> {
  await invoke('store_refresh_token', { refreshToken });
  const storedRefreshToken = await invoke<string | null>('get_refresh_token');
  if (storedRefreshToken !== refreshToken) {
    throw new Error('MediaFlow refresh token could not be verified in the OS keychain.');
  }
}

async function applyTokenResponse(
  tokenResponse: TokenResponse,
  options: ApplyTokenOptions = {},
): Promise<string> {
  const refreshToken = refreshTokenFromResponse(tokenResponse);
  if (options.requireRefreshToken && !refreshToken) {
    throw new Error('MediaFlow login did not return a refresh token. The offline_access scope is required.');
  }

  if (refreshToken) {
    await storeAndVerifyRefreshToken(refreshToken);
  } else if (options.fallbackRefreshToken) {
    await storeAndVerifyRefreshToken(options.fallbackRefreshToken);
  }

  accessToken = tokenResponse.access_token;
  accessTokenExpiresAt = Date.now() + Math.max(1, tokenResponse.expires_in ?? 3600) * 1000;

  const user = await fetchUserInfo(accessToken);
  await settingsStore.setMediaFlowUser(user);
  return accessToken;
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
): Promise<string> {
  return applyTokenResponse(await invoke<TokenResponse>('exchange_mediaflow_authorization_code', {
    code,
    codeVerifier,
  }), { requireRefreshToken: true });
}

async function handleOAuthCallbackUrl(url: string): Promise<void> {
  const callback = parseOAuthCallbackUrl(url, getPendingLogin()?.state);
  if (callbackStatesInProgress.has(callback.state)) {
    return;
  }

  const login = getPendingLogin();
  if (!login) {
    logStore.addLog({
      level: 'warning',
      source: 'mediaflow',
      title: 'OAuth callback ignored',
      details: 'MediaFlow received a callback, but no OAuth login is currently pending.',
    });
    console.warn('Ignoring MediaFlow OAuth callback because no login is in progress.');
    return;
  }

  callbackStatesInProgress.add(callback.state);
  clearPendingLogin();
  try {
    logStore.addLog({
      level: 'info',
      source: 'mediaflow',
      title: 'OAuth callback received',
      details: 'Exchanging MediaFlow authorization code for access and refresh tokens.',
    });
    await exchangeAuthorizationCode(
      callback.code,
      login.codeVerifier,
    );
    logStore.addLog({
      level: 'success',
      source: 'mediaflow',
      title: 'MediaFlow sign-in complete',
      details: 'MediaFlow account tokens were received and the refresh token was stored in the OS keychain.',
    });
  } finally {
    callbackStatesInProgress.delete(callback.state);
  }
}

async function handleDeepLinkUrls(urls: string[] | null): Promise<void> {
  const callbackUrl = urls?.find(isMediaFlowOAuthCallbackUrl);
  if (!callbackUrl) {
    return;
  }

  await handleOAuthCallbackUrl(callbackUrl);
}

export async function initMediaFlowAuth(): Promise<void> {
  if (!unlistenDeepLink) {
    unlistenDeepLink = await onOpenUrl((urls) => {
      void handleDeepLinkUrls(urls).catch((error) => {
        logStore.addLog({
          level: 'error',
          source: 'mediaflow',
          title: 'OAuth callback failed',
          details: error instanceof Error ? error.message : String(error),
        });
        console.error('MediaFlow OAuth callback failed:', error);
      });
    });
  }

  if (!unlistenNativeDeepLink) {
    unlistenNativeDeepLink = await listen<string[]>('mediaflow://oauth-callback', (event) => {
      void handleDeepLinkUrls(event.payload).catch((error) => {
        logStore.addLog({
          level: 'error',
          source: 'mediaflow',
          title: 'OAuth callback failed',
          details: error instanceof Error ? error.message : String(error),
        });
        console.error('MediaFlow OAuth callback failed:', error);
      });
    });
  }

  await handleDeepLinkUrls(await getCurrent());
}

export async function restoreMediaFlowSession(): Promise<void> {
  if (restorePromise) {
    return restorePromise;
  }

  restorePromise = (async () => {
    await initMediaFlowAuth();
    const refreshToken = await invoke<string | null>('get_refresh_token');
    if (!refreshToken) {
      await settingsStore.setMediaFlowUser(null);
      return;
    }

    try {
      await refreshMediaFlowSession();
    } catch (error) {
      console.warn('MediaFlow session restore failed:', error);
      accessToken = null;
      accessTokenExpiresAt = 0;
      await settingsStore.setMediaFlowUser(null);
    }
  })();

  return restorePromise;
}

export async function signInWithMediaFlow(): Promise<void> {
  await initMediaFlowAuth();
  const { codeVerifier, codeChallenge } = await createPkcePair();
  const state = randomBase64Url(24);
  storePendingLogin({ state, codeVerifier, createdAt: Date.now() });
  logStore.addLog({
    level: 'info',
    source: 'mediaflow',
    title: 'OAuth sign-in started',
    details: 'Waiting for MediaFlow browser callback.',
  });

  try {
    await invoke('open_mediaflow_sign_in', { codeChallenge, state });
  } catch (error) {
    clearPendingLogin();
    logStore.addLog({
      level: 'error',
      source: 'mediaflow',
      title: 'OAuth browser launch failed',
      details: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function cancelPendingMediaFlowSignIn(): void {
  clearPendingLogin();
}

export async function refreshMediaFlowSession(): Promise<string> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const refreshToken = await invoke<string | null>('get_refresh_token');
    if (!refreshToken) {
      throw new Error('No MediaFlow refresh token is available.');
    }

    try {
      return await applyTokenResponse(await invoke<TokenResponse>('refresh_mediaflow_access_token', {
        refreshToken,
      }), { fallbackRefreshToken: refreshToken });
    } catch (error) {
      accessToken = null;
      accessTokenExpiresAt = 0;
      await invoke('delete_refresh_token');
      await settingsStore.setMediaFlowUser(null);
      throw error;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function getMediaFlowAccessToken(): Promise<string> {
  if (accessToken && Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS < accessTokenExpiresAt) {
    return accessToken;
  }

  return refreshMediaFlowSession();
}

export async function signOutMediaFlow(): Promise<void> {
  const refreshToken = await invoke<string | null>('get_refresh_token');

  if (refreshToken) {
    try {
      await invoke('revoke_mediaflow_refresh_token', { refreshToken });
    } catch (error) {
      console.warn('MediaFlow token revocation failed:', error);
    }
  }

  accessToken = null;
  accessTokenExpiresAt = 0;
  await invoke('delete_refresh_token');
  await settingsStore.setMediaFlowUser(null);
}

export interface MediaFlowHttpResponse {
  status: number;
  body: string;
}

export async function fetchMediaFlowAccountUsage(): Promise<MediaFlowHttpResponse> {
  let response = await invoke<MediaFlowHttpResponse>('fetch_mediaflow_account_usage', {
    accessToken: await getMediaFlowAccessToken(),
  });
  if (response.status !== 401) {
    return response;
  }

  response = await invoke<MediaFlowHttpResponse>('fetch_mediaflow_account_usage', {
    accessToken: await refreshMediaFlowSession(),
  });
  return response;
}

export async function openMediaFlowDashboard(): Promise<void> {
  await invoke('open_mediaflow_dashboard');
}
