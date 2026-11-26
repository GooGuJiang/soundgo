// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { meNow } from "./api.js";
import {
  ANDROID_WEB_AUTH_APP_ID,
  AUTH,
  browserUserAgent,
  MOBI,
  MOBI_CLIENT_ID_FALLBACK,
  SITE,
} from "./constants.js";
import { clientIdValue, request } from "./http.js";
import {
  bumpSessionGen,
  clearRefreshTimer,
  clearSession,
  clearStateCaches,
  hasSession,
  requestTokenRefresh,
  saveSession,
  scheduleRefresh,
  sessionGen,
  setMeCache,
} from "./session.js";
import type { Account, SetSettingParams } from "./types.js";
import {
  encodeBase64,
  extractCookieFromHeader,
  fail,
  isPluginError,
  jwtExpiryMs,
  randomBase64Url,
  randomDeviceId,
  readRefreshToken,
  readToken,
  t,
} from "./utils.js";

let mobiClientIdCache = "";

async function validateConnectSession(accessToken: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const clientId = await clientIdValue(attempt > 0);
    const response = await request(
      `${AUTH}/connect/session?client_id=${encodeURIComponent(clientId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: { access_token: accessToken } }),
      },
    );
    if (response.status === 200) return true;
  }
  return false;
}

async function mobiClientIdValue(): Promise<string> {
  if (mobiClientIdCache) return mobiClientIdCache;
  try {
    const response = await request(`${MOBI}/signin`, {
      headers: { accept: "text/html" },
    });
    if (response.status === 200) {
      const found =
        response.text.match(/"clientId"\s*:\s*"([0-9a-zA-Z]{32})"/) ||
        response.text.match(/client_id["']?\s*:\s*["']([0-9a-zA-Z]{32})["']/);
      if (found) {
        mobiClientIdCache = found[1];
        return mobiClientIdCache;
      }
    }
  } catch {
    // Fall back to the known mobile web client id.
  }
  return MOBI_CLIENT_ID_FALLBACK;
}

// Builds a top-level secure.soundcloud.com/web-auth URL that runs third-party
// providers (Google, Apple, Facebook) via same-window redirect instead of
// window.open popups (which embedded WebViews block), then bounces through
// m.soundcloud.com/signin/callback onto soundcloud.com so SoundCloud's own web
// bootstrap mints oauth_token + HttpOnly oauth_refresh_token cookies.
async function buildWebSignInUrl(): Promise<string> {
  const mobiClientId = await mobiClientIdValue();
  const nonce = randomBase64Url(24);
  const state = encodeBase64(
    JSON.stringify({
      origin: SITE,
      path: "/discover",
      client_id: mobiClientId,
      nonce,
    }),
  );
  const params = new URLSearchParams({
    client_id: mobiClientId,
    device_id: randomDeviceId(),
    origin: MOBI,
    app_id: ANDROID_WEB_AUTH_APP_ID,
    redirect_uri: `${MOBI}/signin/callback`,
    response_type: "code",
    code_challenge: randomBase64Url(43),
    code_challenge_method: "S256",
    state,
    stand_alone: "true",
  });
  return `https://secure.soundcloud.com/web-auth?${params.toString()}`;
}

export async function signIn(): Promise<Account> {
  const rawToken = host.setting("oauthToken");
  const rawRefresh = host.setting("oauthRefreshToken");
  let access = readToken(rawToken);
  let refresh =
    readRefreshToken(rawRefresh) ||
    extractCookieFromHeader(rawToken, "oauth_refresh_token");
  let fromWebSignIn = false;

  const gen = bumpSessionGen();
  clearRefreshTimer();
  setMeCache(null);
  clearStateCaches();

  if (!access && !refresh) {
    if (typeof host.webSignIn !== "function") {
      throw fail(
        "setup",
        t("Paste your oauth_token in the plugin settings, then sign in"),
      );
    }

    const authUrl = await buildWebSignInUrl();

    // Request cookies for /n/api/refresh-token so both Path=/ (oauth_token) and
    // path-scoped HttpOnly refresh cookies (oauth_refresh_token) are captured.
    const result = await host.webSignIn({
      url: authUrl,
      cookiesOf: `${SITE}/n/api/refresh-token`,
      until: ["oauth_token"],
      userAgent: browserUserAgent(),
    });
    const cookieHeader = (result && result.cookie) || "";
    access = extractCookieFromHeader(cookieHeader, "oauth_token");
    refresh = extractCookieFromHeader(cookieHeader, "oauth_refresh_token");
    fromWebSignIn = true;

    if (!access) {
      throw fail(
        "signIn",
        t("SoundCloud sign-in did not return a session: try again"),
      );
    }
  }

  let expiresIn = 0;
  let needsRefresh = !access;

  if (access && !fromWebSignIn) {
    const exp = jwtExpiryMs(access);
    if (exp > 0 && Date.now() >= exp && refresh) {
      needsRefresh = true;
    } else {
      const accepted = await validateConnectSession(access);
      if (!accepted) {
        if (refresh) {
          needsRefresh = true;
        } else {
          throw fail("signIn", t("SoundCloud rejected that oauth_token"));
        }
      }
    }
  }

  if (needsRefresh) {
    const refreshed = await requestTokenRefresh(refresh, access);
    if (!refreshed.ok || !refreshed.data || !refreshed.data.access_token) {
      if (refreshed.permanent) {
        throw fail(
          "signIn",
          t("SoundCloud rejected that oauth_refresh_token"),
        );
      }
      throw new Error(
        refreshed.error || t("Could not refresh SoundCloud session"),
      );
    }
    access = refreshed.data.access_token;
    if (refreshed.data.refresh_token) refresh = refreshed.data.refresh_token;
    expiresIn = Number(refreshed.data.expires_in) || 0;
  }

  if (gen !== sessionGen) {
    throw fail("signIn", t("Sign-in was interrupted"));
  }

  saveSession({ accessToken: access, refreshToken: refresh, expiresIn });

  try {
    const me = await meNow();
    return { id: me.id, name: me.name, imageUrl: me.imageUrl, page: "me" };
  } catch (error) {
    clearSession();
    if (isPluginError(error) && error.code === "signIn") throw error;
    throw fail(
      "signIn",
      fromWebSignIn
        ? t("SoundCloud did not accept that sign-in: try again")
        : t("SoundCloud rejected that oauth_token"),
    );
  }
}

export function signOut(): void {
  clearSession();
}

export async function account(): Promise<Account | null> {
  if (!hasSession()) return null;
  try {
    const me = await meNow();
    return { id: me.id, name: me.name, imageUrl: me.imageUrl, page: "me" };
  } catch {
    return null;
  }
}

export function setSetting({ key, value }: SetSettingParams): void {
  // A new token replaces the old session; signing in validates the new one.
  if (key === "oauthToken") {
    clearSession();
    return;
  }
  if (key === "oauthRefreshToken" && hasSession()) {
    const raw =
      value !== undefined ? value : host.setting("oauthRefreshToken");
    const rt = readRefreshToken(raw);
    if (rt) {
      host.storage.set("refreshToken", rt);
      scheduleRefresh();
    } else {
      host.storage.remove("refreshToken");
      clearRefreshTimer();
    }
  }
}
