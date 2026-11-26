// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

export const PLUGIN_VERSION = "0.2.0";

export const API = "https://api-v2.soundcloud.com";
export const AUTH = "https://api-auth.soundcloud.com";
export const SECURE = "https://secure.soundcloud.com";
export const SITE = "https://soundcloud.com";
export const MOBI = "https://m.soundcloud.com";
export const LRCLIB = "https://lrclib.net";

export const MOBI_CLIENT_ID_FALLBACK = "KKzJxmw11tYpCs6T24P4uUYhqmjalG6M";
export const ANDROID_WEB_AUTH_APP_ID = "3152";
export const FOLLOW_SIGNATURE_SECRET_FALLBACK = "5Dpr3ubBw8LFtbvQcd4Hx6hU";

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export function browserUserAgent(): string {
  return host.platform === "darwin"
    ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15"
    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
}

export const PAGE = 20;
export const CLIENT_ID_TTL = 24 * 60 * 60 * 1000;
export const TRACK_TTL = 5 * 60 * 1000;
export const STATE_CACHE_TTL = 5 * 60 * 1000;
export const ID_SET_MAX_PAGES = 25;
export const HISTORY_MAX = 50;

export const TOKEN_REFRESH_MARGIN = 5 * 60 * 1000;
export const REFRESH_MIN_DELAY = 5 * 1000;
export const REFRESH_MAX_DELAY = 6 * 60 * 60 * 1000;
export const REFRESH_RETRY_BASE = 60 * 1000;
export const REFRESH_RETRY_MAX = 10 * 60 * 1000;
