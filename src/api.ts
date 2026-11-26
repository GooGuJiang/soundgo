// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import {
  browserUserAgent,
  ID_SET_MAX_PAGES,
  SITE,
  STATE_CACHE_TTL,
} from "./constants.js";
import {
  apiUrl,
  clientIdValue,
  request,
  type HttpResponse,
  type QueryRecord,
} from "./http.js";
import {
  clearSession,
  ensureFreshToken,
  followingIdsCache,
  followingIdsPromise,
  hasSession,
  likedPlaylistIdsCache,
  likedPlaylistIdsPromise,
  likedTrackIdsCache,
  likedTrackIdsPromise,
  meCache,
  refreshAccessToken,
  refreshToken,
  requireToken,
  sessionGen,
  setFollowingIdsCache,
  setFollowingIdsPromise,
  setLikedPlaylistIdsCache,
  setLikedPlaylistIdsPromise,
  setLikedTrackIdsCache,
  setLikedTrackIdsPromise,
  setMeCache,
  token,
} from "./session.js";
import type { SCCollection, SCErrorBody, SCUser } from "./soundcloud-types.js";
import type { Account } from "./types.js";
import { fail, t } from "./utils.js";

export interface ApiOptions {
  method?: string;
  query?: QueryRecord | ((clientId: string) => QueryRecord);
  body?: unknown;
  form?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const queryOption = options.query;
  const useAuth = options.auth !== false;
  const method = String(options.method || "GET").toUpperCase();
  let forceClientId = false;
  let triedClientIdRefresh = false;
  let triedTokenRefresh = false;

  if (useAuth && hasSession()) {
    await ensureFreshToken();
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const clientId = await clientIdValue(forceClientId);
    forceClientId = false;

    const query: QueryRecord =
      typeof queryOption === "function"
        ? queryOption(clientId) || {}
        : { ...(queryOption || {}) };

    const usedToken = useAuth ? token() : "";
    const headers: Record<string, string> = {};
    if (usedToken) headers.Authorization = "OAuth " + usedToken;

    let body: string | undefined;
    if (options.form !== undefined) {
      headers["content-type"] =
        "application/x-www-form-urlencoded; charset=UTF-8";
      const params = new URLSearchParams();
      for (const key of Object.keys(options.form || {})) {
        const value = options.form[key];
        if (value === undefined || value === null) continue;
        params.set(key, String(value));
      }
      body = params.toString();
    } else if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const fullUrl = apiUrl(path, clientId, query);
    let response: HttpResponse<T & SCErrorBody>;

    // SoundCloud gates api-v2 mutations with DataDome. On the adapted MyGo
    // Music build, host.webFetch runs mutations inside a real WebView page on
    // soundcloud.com and shows a visible verification popup if requested.
    if (method !== "GET" && typeof host.webFetch === "function") {
      const webRes = await host.webFetch({
        origin: `${SITE}/robots.txt`,
        url: fullUrl,
        method,
        headers: { accept: "application/json", ...headers },
        ...(body !== undefined ? { body } : {}),
        userAgent: browserUserAgent(),
      });
      let parsed: (T & SCErrorBody) | null = null;
      try {
        parsed = webRes.text
          ? (JSON.parse(webRes.text) as T & SCErrorBody)
          : null;
      } catch {
        parsed = null;
      }
      response = { status: webRes.status, data: parsed, text: webRes.text };
    } else {
      response = await request<T & SCErrorBody>(fullUrl, {
        method,
        headers,
        body,
      });
    }

    if (response.status === 401) {
      // Another concurrent call may already have rotated the access token while
      // this request was in flight. Retry immediately with the new token.
      if (useAuth && usedToken && token() && token() !== usedToken) {
        continue;
      }

      // Rule out a stale client id before consuming the single-use refresh token.
      if (!triedClientIdRefresh) {
        triedClientIdRefresh = true;
        forceClientId = true;
        continue;
      }

      // With a fresh client id, a 401 means the access token expired or was
      // revoked. Try refreshing it once when a refresh token is stored.
      if (useAuth && usedToken && !triedTokenRefresh && refreshToken()) {
        triedTokenRefresh = true;
        const refreshed = await refreshAccessToken(usedToken);
        if (refreshed) continue;
      }

      if (useAuth && usedToken) {
        if (token() === usedToken) clearSession();
        throw fail(
          "signIn",
          t(
            "Your oauth_token stopped working: paste a new one in the settings",
          ),
        );
      }
      throw new Error(t("SoundCloud rejected the request"));
    }

    if (response.status === 404) {
      throw fail("unavailable", t("SoundCloud has nothing at that address"));
    }
    if (response.status === 403) {
      const bodyText = response.text || "";
      const isCaptcha =
        bodyText.includes("captcha-delivery.com") ||
        bodyText.toLowerCase().includes("datadome");

      if (isCaptcha) {
        if (method !== "GET" && typeof host.webFetch !== "function") {
          throw new Error(
            t(
              "This action requires the adapted MyGo Music build with host.webFetch (not supported on official MyGo Music)",
            ),
          );
        }
        throw new Error(
          t("SoundCloud blocked this action with a CAPTCHA check"),
        );
      }
      if (method !== "GET") {
        throw new Error(t("SoundCloud did not allow this action"));
      }
      throw fail("unavailable", t("SoundCloud will not play this"));
    }
    if (response.status === 429) {
      throw new Error(t("SoundCloud is rate limiting: try again later"));
    }

    if (response.status < 200 || response.status >= 300) {
      const said =
        (response.data && response.data.errors && response.data.errors[0]) ||
        (response.data && response.data.message) ||
        `${t("SoundCloud answered")} ${response.status}`;
      throw new Error(String(said));
    }

    return (response.data === null ? response.text : response.data) as T;
  }

  throw new Error(t("SoundCloud rejected the request"));
}

export function normalizeImage(url: string | undefined, size = "t500x500"): string {
  if (!url) return "";
  return String(url).replace(
    /-[a-z0-9]+\.(jpg|jpeg|png|webp)$/i,
    `-${size}.$1`,
  );
}

export async function meNow(): Promise<Account> {
  if (meCache) return meCache;
  requireToken();
  const me = await api<SCUser>("/me");
  const account: Account = {
    id: String(me.id),
    name: me.username || me.full_name || "",
    imageUrl: normalizeImage(me.avatar_url),
  };
  setMeCache(account);
  return account;
}

async function fetchIdSet(initialPath: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let nextPath = initialPath;
  let query: QueryRecord = { limit: 200, linked_partitioning: 1 };

  for (let page = 0; page < ID_SET_MAX_PAGES && nextPath; page++) {
    const response = await api<SCCollection<number | string | { id?: number | string }>>(
      nextPath,
      { query },
    );
    for (const item of response.collection || []) {
      const value =
        item && typeof item === "object" ? item.id : item;
      if (value !== undefined && value !== null && value !== "") {
        ids.add(String(value));
      }
    }
    nextPath = response.next_href || "";
    query = {};
  }

  return ids;
}

export async function likedTrackIds(force = false): Promise<Set<string>> {
  if (!hasSession()) return new Set();
  if (
    !force &&
    likedTrackIdsCache &&
    Date.now() - likedTrackIdsCache.at < STATE_CACHE_TTL
  ) {
    return likedTrackIdsCache.ids;
  }
  if (likedTrackIdsPromise) return likedTrackIdsPromise;

  const gen = sessionGen;
  const promise = fetchIdSet("/me/track_likes/ids")
    .then((ids) => {
      if (gen === sessionGen) {
        setLikedTrackIdsCache({ ids, at: Date.now() });
      }
      return ids;
    })
    .finally(() => {
      setLikedTrackIdsPromise(null);
    });

  setLikedTrackIdsPromise(promise);
  return promise;
}

export async function likedPlaylistIds(force = false): Promise<Set<string>> {
  if (!hasSession()) return new Set();
  if (
    !force &&
    likedPlaylistIdsCache &&
    Date.now() - likedPlaylistIdsCache.at < STATE_CACHE_TTL
  ) {
    return likedPlaylistIdsCache.ids;
  }
  if (likedPlaylistIdsPromise) return likedPlaylistIdsPromise;

  const gen = sessionGen;
  const promise = fetchIdSet("/me/playlist_likes/ids")
    .then((ids) => {
      if (gen === sessionGen) {
        setLikedPlaylistIdsCache({ ids, at: Date.now() });
      }
      return ids;
    })
    .finally(() => {
      setLikedPlaylistIdsPromise(null);
    });

  setLikedPlaylistIdsPromise(promise);
  return promise;
}

export async function followingIds(force = false): Promise<Set<string>> {
  if (!hasSession()) return new Set();
  if (
    !force &&
    followingIdsCache &&
    Date.now() - followingIdsCache.at < STATE_CACHE_TTL
  ) {
    return followingIdsCache.ids;
  }
  if (followingIdsPromise) return followingIdsPromise;

  const gen = sessionGen;
  const promise = (async () => {
    const me = await meNow();
    const ids = await fetchIdSet(`/users/${me.id}/followings/ids`);
    if (gen === sessionGen) {
      setFollowingIdsCache({ ids, at: Date.now() });
    }
    return ids;
  })().finally(() => {
    setFollowingIdsPromise(null);
  });

  setFollowingIdsPromise(promise);
  return promise;
}
