// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import {
  API,
  browserUserAgent,
  CLIENT_ID_TTL,
  FOLLOW_SIGNATURE_SECRET_FALLBACK,
  SITE,
} from "./constants.js";
import { t } from "./utils.js";

export type QueryRecord = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T | null;
  text: string;
}

export async function request<T = unknown>(
  url: string,
  options: RequestOptions = {},
): Promise<HttpResponse<T>> {
  const headers: Record<string, string> = {
    "user-agent": browserUserAgent(),
    accept: "application/json",
    referer: SITE + "/",
    ...(options.headers || {}),
  };
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body,
    redirect: "follow",
  });
  const text = await response.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data, text };
}

export function apiUrl(
  path: string,
  clientId: string,
  query?: QueryRecord,
): string {
  const url = path.startsWith("http") ? new URL(path) : new URL(API + path);
  url.searchParams.set("client_id", clientId);
  for (const key of Object.keys(query || {})) {
    const value = query?.[key];
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

let clientIdCache = "";
let clientIdPromise: Promise<string> | null = null;
let followSecretCache = "";

export function followSecretValue(): string {
  if (followSecretCache) return followSecretCache;
  const stored = host.storage.get("followSecret");
  if (stored) {
    followSecretCache = String(stored);
    return followSecretCache;
  }
  return FOLLOW_SIGNATURE_SECRET_FALLBACK;
}

export async function clientIdValue(force = false): Promise<string> {
  if (!force && clientIdCache) return clientIdCache;

  if (!force) {
    const stored = host.storage.get("clientId");
    const at = Number(host.storage.get("clientIdAt") || 0);
    if (typeof stored === "string" && stored && Date.now() - at < CLIENT_ID_TTL) {
      clientIdCache = stored;
      return stored;
    }
  }

  if (clientIdPromise) return clientIdPromise;

  clientIdPromise = (async () => {
    const found = await scrapeClientId();
    clientIdCache = found;
    host.storage.set("clientId", found);
    host.storage.set("clientIdAt", Date.now());
    return found;
  })().finally(() => {
    clientIdPromise = null;
  });

  return clientIdPromise;
}

async function scrapeClientId(): Promise<string> {
  const pages = [SITE + "/", SITE + "/discover"];
  let reachedPage = false;
  let lastError: unknown = null;
  let foundClientId = "";

  for (const page of pages) {
    let html = "";
    try {
      const response = await request(page, {
        headers: { accept: "text/html" },
      });
      reachedPage = true;
      if (response.status !== 200) continue;
      html = response.text;
    } catch (error) {
      lastError = error;
      continue;
    }

    const scripts: string[] = [];
    const pattern = /<script[^>]+src="(https:\/\/[^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      if (match[1].includes("sndcdn")) scripts.push(match[1]);
    }

    for (const src of scripts.reverse()) {
      try {
        const asset = await request(src, {
          headers: { accept: "text/javascript" },
        });
        if (asset.status !== 200) continue;
        const secretMatch = asset.text.match(
          /__FOLLOWS_SIGNATURE_SECRET__\s*=\s*["']([^"']+)["']/,
        );
        if (secretMatch && secretMatch[1]) {
          followSecretCache = secretMatch[1];
          host.storage.set("followSecret", secretMatch[1]);
        }
        if (!foundClientId) {
          const found =
            asset.text.match(/client_id\s*:\s*["']([0-9a-zA-Z]{32})["']/) ||
            asset.text.match(/[?&]client_id=([0-9a-zA-Z]{32})\b/);
          if (found) foundClientId = found[1];
        }
        if (foundClientId) return foundClientId;
      } catch (error) {
        lastError = error;
        // Another asset may have it.
      }
    }
  }

  if (!reachedPage && lastError) {
    throw new Error(t("Could not reach SoundCloud: check your network or proxy"));
  }

  throw new Error(t("Could not find SoundCloud's client id: try again later"));
}
