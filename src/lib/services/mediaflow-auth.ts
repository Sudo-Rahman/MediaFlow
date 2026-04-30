import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { mediaFlowUrl, resolveMediaFlowBaseUrl } from '$lib/config/api';
import { settingsStore, type MediaFlowUser } from '$lib/stores/settings.svelte';
import { logStore } from '$lib/stores/logs.svelte';

const CLIENT_ID = 'mediaflow-desktop';
const APP_REDIRECT_URI = 'mediaflow://oauth/callback';
const WEB_OAUTH_CALLBACK_PATH = '/desktop/oauth/callback';
const AUTH_SCOPE = 'openid profile email offline_access';
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
  baseUrl: string;
  redirectUri?: string;
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

export function getMediaFlowBaseUrl(): string {
  return resolveMediaFlowBaseUrl(settingsStore.settings.mediaflowBaseUrl);
}

function authBaseUrl(): string {
  return mediaFlowUrl('/api/auth', settingsStore.settings.mediaflowBaseUrl);
}

function authBaseUrlFor(baseUrl: string): string {
  return mediaFlowUrl('/api/auth', baseUrl);
}

function webRedirectUriFor(baseUrl: string): string {
  return mediaFlowUrl(WEB_OAUTH_CALLBACK_PATH, baseUrl);
}

function loginUrlFor(baseUrl: string, redirectTo: string): string {
  const params = new URLSearchParams({ redirectTo });
  return `${mediaFlowUrl('/auth/login', baseUrl)}?${params}`;
}

function apiUrl(path: string): string {
  return mediaFlowUrl(path, settingsStore.settings.mediaflowBaseUrl);
}

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
    typeof candidate.baseUrl === 'string' &&
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

async function tokenRequest(body: URLSearchParams, baseUrl = getMediaFlowBaseUrl()): Promise<TokenResponse> {
  const response = await httpFetch(`${authBaseUrlFor(baseUrl)}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MediaFlow OAuth token request failed (${response.status}): ${errorText}`);
  }

  return await response.json() as TokenResponse;
}

async function fetchUserInfo(token: string): Promise<MediaFlowUser> {
  const response = await httpFetch(`${authBaseUrl()}/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch MediaFlow account information.');
  }

  const body = await response.json() as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email : '';
  if (!email) {
    throw new Error('MediaFlow account response did not include an email.');
  }

  const name = typeof body.name === 'string' ? body.name : undefined;
  return { email, name };
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
  baseUrl: string,
  redirectUri: string,
): Promise<string> {
  return applyTokenResponse(await tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
  }), baseUrl), { requireRefreshToken: true });
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
      login.baseUrl,
      login.redirectUri ?? APP_REDIRECT_URI,
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
  const baseUrl = getMediaFlowBaseUrl();
  const redirectUri = webRedirectUriFor(baseUrl);
  storePendingLogin({ state, codeVerifier, baseUrl, redirectUri, createdAt: Date.now() });
  logStore.addLog({
    level: 'info',
    source: 'mediaflow',
    title: 'OAuth sign-in started',
    details: `Waiting for browser callback from ${baseUrl}.`,
  });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: AUTH_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  try {
    await openUrl(loginUrlFor(baseUrl, `/api/auth/oauth2/authorize?${params}`));
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
      return await applyTokenResponse(await tokenRequest(new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      })), { fallbackRefreshToken: refreshToken });
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
      await httpFetch(`${authBaseUrl()}/oauth2/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          token: refreshToken,
          token_type_hint: 'refresh_token',
        }),
      });
    } catch (error) {
      console.warn('MediaFlow token revocation failed:', error);
    }
  }

  accessToken = null;
  accessTokenExpiresAt = 0;
  await invoke('delete_refresh_token');
  await settingsStore.setMediaFlowUser(null);
}

export async function fetchMediaFlowApi(
  path: string,
  init: RequestInit | (() => RequestInit | Promise<RequestInit>),
): Promise<Response> {
  const makeInit = typeof init === 'function' ? init : () => init;
  const buildRequest = async (token: string) => {
    const requestInit = await makeInit();
    const headers = new Headers(requestInit.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return {
      ...requestInit,
      headers,
    };
  };

  let response = await httpFetch(apiUrl(path), await buildRequest(await getMediaFlowAccessToken()));
  if (response.status !== 401) {
    return response;
  }

  response = await httpFetch(apiUrl(path), await buildRequest(await refreshMediaFlowSession()));
  return response;
}
