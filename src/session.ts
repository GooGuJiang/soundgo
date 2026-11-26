// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import {
  REFRESH_MAX_DELAY,
  REFRESH_MIN_DELAY,
  REFRESH_RETRY_BASE,
  REFRESH_RETRY_MAX,
  SECURE,
  TOKEN_REFRESH_MARGIN,
} from "./constants.js";
import { clientIdValue, request } from "./http.js";
import type { SCTokenRefreshResponse } from "./soundcloud-types.js";
import type { Account } from "./types.js";
import { fail, isPluginError, jwtClientId, jwtExpiryMs, t } from "./utils.js";

export interface TimedIdSetCache {
  ids: Set<string>;
  at: number;
}

export interface TokenRefreshResult {
  ok: boolean;
  permanent: boolean;
  status?: number;
  data?: SCTokenRefreshResponse;
  error?: string;
}

export interface LikedCursor {
  at: number;
  href: string;
}

export let meCache: Account | null = null;
export let sessionGen = 0;
export let likedTrackIdsCache: TimedIdSetCache | null = null;
export let likedTrackIdsPromise: Promise<Set<string>> | null = null;
export let likedPlaylistIdsCache: TimedIdSetCache | null = null;
export let likedPlaylistIdsPromise: Promise<Set<string>> | null = null;
export let followingIdsCache: TimedIdSetCache | null = null;
export let followingIdsPromise: Promise<Set<string>> | null = null;
export let likedCursor: LikedCursor | null = null;

let refreshPromise: Promise<string> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshRetryCount = 0;

export function setMeCache(account: Account | null): void {
  meCache = account;
}

export function setLikedTrackIdsCache(cache: TimedIdSetCache | null): void {
  likedTrackIdsCache = cache;
}

export function setLikedTrackIdsPromise(
  promise: Promise<Set<string>> | null,
): void {
  likedTrackIdsPromise = promise;
}

export function setLikedPlaylistIdsCache(cache: TimedIdSetCache | null): void {
  likedPlaylistIdsCache = cache;
}

export function setLikedPlaylistIdsPromise(
  promise: Promise<Set<string>> | null,
): void {
  likedPlaylistIdsPromise = promise;
}

export function setFollowingIdsCache(cache: TimedIdSetCache | null): void {
  followingIdsCache = cache;
}

export function setFollowingIdsPromise(
  promise: Promise<Set<string>> | null,
): void {
  followingIdsPromise = promise;
}

export function setLikedCursor(cursor: LikedCursor | null): void {
  likedCursor = cursor;
}

export function bumpSessionGen(): number {
  sessionGen += 1;
  return sessionGen;
}

export function clearStateCaches(): void {
  likedTrackIdsCache = null;
  likedTrackIdsPromise = null;
  likedPlaylistIdsCache = null;
  likedPlaylistIdsPromise = null;
  followingIdsCache = null;
  followingIdsPromise = null;
  likedCursor = null;
}

export function token(): string {
  const value = host.storage.get("token");
  return typeof value === "string" ? value : "";
}

export function refreshToken(): string {
  const value = host.storage.get("refreshToken");
  return typeof value === "string" ? value : "";
}

export function hasSession(): boolean {
  return !!(token() || refreshToken());
}

export function requireToken(): void {
  if (!hasSession()) {
    throw fail("signIn", t("Sign in with your oauth_token first"));
  }
}

export function tokenExpiresAt(): number {
  const stored = Number(host.storage.get("tokenExpiresAt") || 0);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const fromJwt = jwtExpiryMs(token());
  if (fromJwt > 0) {
    host.storage.set("tokenExpiresAt", fromJwt);
    return fromJwt;
  }
  return 0;
}

export function computeExpiresAt(accessToken: string, expiresIn?: number): number {
  const fromJwt = jwtExpiryMs(accessToken);
  if (fromJwt > 0) return fromJwt;
  const seconds = Number(expiresIn);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Date.now() + seconds * 1000;
  }
  return 0;
}

export function isTokenExpiringSoon(margin: number = TOKEN_REFRESH_MARGIN): boolean {
  const exp = tokenExpiresAt();
  return exp > 0 && Date.now() >= exp - margin;
}

export function isTokenExpired(): boolean {
  const exp = tokenExpiresAt();
  return exp > 0 && Date.now() >= exp;
}

export function clearRefreshTimer(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

export function clearSession(): void {
  sessionGen += 1;
  refreshRetryCount = 0;
  clearRefreshTimer();
  host.storage.remove("token");
  host.storage.remove("refreshToken");
  host.storage.remove("tokenExpiresAt");
  meCache = null;
  clearStateCaches();
}

export function saveSession(params: {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}): void {
  host.storage.set("token", params.accessToken);
  if (params.refreshToken) {
    host.storage.set("refreshToken", params.refreshToken);
  }
  const expiresAt = computeExpiresAt(params.accessToken, params.expiresIn);
  if (expiresAt > 0) {
    host.storage.set("tokenExpiresAt", expiresAt);
  } else {
    host.storage.remove("tokenExpiresAt");
  }
  refreshRetryCount = 0;
  scheduleRefresh();
}

export function scheduleRefresh(overrideDelayMs?: number): void {
  clearRefreshTimer();
  if (!refreshToken() || !token()) return;

  let delay = overrideDelayMs;
  if (delay === undefined) {
    const exp = tokenExpiresAt();
    if (!exp) return;
    delay = Math.max(
      REFRESH_MIN_DELAY,
      Math.min(REFRESH_MAX_DELAY, exp - TOKEN_REFRESH_MARGIN - Date.now()),
    );
  }

  const gen = sessionGen;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (gen !== sessionGen || !refreshToken()) return;
    refreshAccessToken().catch((error: unknown) => {
      if (gen !== sessionGen) return;
      if (isPluginError(error) && error.code === "signIn") return;
      // Keep the session on transient network/server errors and retry with backoff.
      refreshRetryCount += 1;
      const backoff = Math.min(
        REFRESH_RETRY_MAX,
        REFRESH_RETRY_BASE * Math.pow(2, Math.min(refreshRetryCount - 1, 4)),
      );
      scheduleRefresh(backoff);
    });
  }, delay);
}

// Exchanges a single-use refresh token at secure.soundcloud.com/oauth/token.
// SoundCloud binds web refresh tokens to the issuing client_id, which is
// carried in the JWT oauth_token when present.
export async function requestTokenRefresh(
  rt: string,
  currentAccessToken: string,
): Promise<TokenRefreshResult> {
  if (!rt) {
    return {
      ok: false,
      permanent: false,
      error: t("Missing refresh token"),
    };
  }

  const tryExchange = async (clientId: string) => {
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: rt,
    }).toString();

    return request<SCTokenRefreshResponse>(`${SECURE}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body,
    });
  };

  let clientId = jwtClientId(currentAccessToken) || (await clientIdValue(false));
  let response = await tryExchange(clientId);

  // If the client_id itself was rejected, scrape a fresh web client_id and
  // retry once. invalid_client fails before the refresh token is consumed.
  if (
    response.status === 401 &&
    response.data &&
    response.data.error === "invalid_client"
  ) {
    const freshClientId = await clientIdValue(true);
    if (freshClientId && freshClientId !== clientId) {
      clientId = freshClientId;
      response = await tryExchange(clientId);
    }
  }

  if (response.status === 200 && response.data && response.data.access_token) {
    return { ok: true, permanent: false, status: 200, data: response.data };
  }

  const errCode =
    response.data && typeof response.data.error === "string"
      ? response.data.error
      : "";
  const permanent =
    (response.status === 400 &&
      (errCode === "invalid_grant" || errCode === "invalid_token")) ||
    response.status === 401;

  const message =
    (response.data &&
      (response.data.error_description || response.data.error)) ||
    `${t("SoundCloud answered")} ${response.status}`;

  return {
    ok: false,
    permanent,
    status: response.status,
    error: String(message),
  };
}

// Single-flight refresh lock: SoundCloud refresh tokens are single-use, so
// concurrent requests must share one refresh call instead of racing.
export async function refreshAccessToken(failedToken = ""): Promise<string> {
  if (failedToken && token() && token() !== failedToken) {
    return token();
  }
  if (refreshPromise) return refreshPromise;

  const gen = sessionGen;
  refreshPromise = (async () => {
    if (failedToken && token() && token() !== failedToken) {
      return token();
    }

    const rt = refreshToken();
    if (!rt) return "";

    const result = await requestTokenRefresh(rt, token());

    // Ignore the response if the user signed out or changed settings meanwhile.
    if (gen !== sessionGen) return "";

    if (result.ok && result.data && result.data.access_token) {
      saveSession({
        accessToken: result.data.access_token,
        refreshToken: result.data.refresh_token || rt,
        expiresIn: result.data.expires_in,
      });
      return result.data.access_token;
    }

    if (result.permanent) {
      clearSession();
      throw fail(
        "signIn",
        t(
          "Your SoundCloud session expired: paste a new oauth_token and oauth_refresh_token in the settings",
        ),
      );
    }

    throw new Error(result.error || t("Could not refresh SoundCloud session"));
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export async function ensureFreshToken(): Promise<void> {
  if (!refreshToken()) return;
  if (token() && !isTokenExpiringSoon()) return;

  try {
    await refreshAccessToken();
  } catch (error) {
    if (isPluginError(error) && error.code === "signIn") throw error;
    // If the current token has not actually expired yet, allow the request to
    // proceed despite a transient refresh failure.
    if (token() && !isTokenExpired()) return;
    throw error;
  }
}
