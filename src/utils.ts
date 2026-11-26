// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { UA } from "./constants.js";
import type { PluginError, PluginErrorCode } from "./types.js";

export function t(text: string): string {
  return host.t(text);
}

export function fail(code: PluginErrorCode, message: string): PluginError {
  const error: PluginError = new Error(message);
  error.code = code;
  return error;
}

export function isPluginError(error: unknown): error is PluginError {
  return error instanceof Error && typeof (error as PluginError).code === "string";
}

export function load<T>(key: string, fallback: T): T {
  const value = host.storage.get(key);
  return value === undefined || value === null ? fallback : (value as T);
}

export function save(key: string, value: unknown): void {
  host.storage.set(key, value);
}

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Pure-JS UTF-8 byte encoder so base64 and follow signing work without unescape/btoa.
export function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  const encoded = encodeURIComponent(String(input || ""));
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%") {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return bytes;
}

// Pure-JS base64 encoder so state encoding works in runtimes without btoa.
export function encodeBase64(input: string): string {
  const bytes = utf8Bytes(input);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const hasB = i + 1 < bytes.length;
    const hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1] : 0;
    const c = hasC ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += BASE64_CHARS[(n >> 18) & 63];
    out += BASE64_CHARS[(n >> 12) & 63];
    out += hasB ? BASE64_CHARS[(n >> 6) & 63] : "=";
    out += hasC ? BASE64_CHARS[n & 63] : "=";
  }
  return out;
}

export function randomBase64Url(length: number): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function randomDeviceId(): string {
  const part = () => String(100000 + Math.floor(Math.random() * 900000));
  return `${part()}-${part()}-${part()}-${part()}`;
}

// Pure-JS base64url decoder so JWT inspection works in runtimes without atob.
export function decodeBase64Url(input: string): string {
  let str = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/\s+/g, "");
  const mod = str.length % 4;
  if (mod === 1) return "";
  if (mod > 0) str += "=".repeat(4 - mod);

  const bytes: number[] = [];
  for (let i = 0; i < str.length; i += 4) {
    const a = BASE64_CHARS.indexOf(str[i]);
    const b = BASE64_CHARS.indexOf(str[i + 1]);
    const c = str[i + 2] === "=" ? 0 : BASE64_CHARS.indexOf(str[i + 2]);
    const d = str[i + 3] === "=" ? 0 : BASE64_CHARS.indexOf(str[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) return "";
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    bytes.push((n >> 16) & 255);
    if (str[i + 2] !== "=") bytes.push((n >> 8) & 255);
    if (str[i + 3] !== "=") bytes.push(n & 255);
  }

  let pct = "";
  for (let i = 0; i < bytes.length; i++) {
    pct += "%" + bytes[i].toString(16).padStart(2, "0");
  }
  try {
    return decodeURIComponent(pct);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

export function decodeJwtPayload(raw: string): Record<string, unknown> | null {
  const parts = String(raw || "").split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  const decoded = decodeBase64Url(parts[1]);
  if (!decoded) return null;
  try {
    const parsed: unknown = JSON.parse(decoded);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function jwtExpiryMs(raw: string): number {
  const payload = decodeJwtPayload(raw);
  const exp = payload ? Number(payload.exp) : NaN;
  return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
}

export function jwtClientId(raw: string): string {
  const payload = decodeJwtPayload(raw);
  return payload && typeof payload.client_id === "string"
    ? payload.client_id.trim()
    : "";
}

export function stripQuotes(value: string | undefined | null): string {
  const trimmed = String(value || "").trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function extractCookieFromHeader(
  raw: string | undefined | null,
  name: string,
): string {
  const value = String(raw || "").trim();
  if (!value || !value.includes("=")) return "";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|[;\\s'"\`^:])${escaped}=([^;\\r\\n'"\`^]+)`,
  );
  const match = value.match(pattern);
  return match ? stripQuotes(match[1]) : "";
}

// A pasted value can be the token itself, `oauth_token=...`, or a full Cookie
// header copied from the developer tools.
export function readToken(raw: string | undefined | null): string {
  let value = stripQuotes(raw);
  if (!value) return "";
  if (/^OAuth\s+/i.test(value)) value = value.replace(/^OAuth\s+/i, "").trim();
  const fromCookie = extractCookieFromHeader(value, "oauth_token");
  if (fromCookie) return fromCookie;
  return value;
}

export function readRefreshToken(raw: string | undefined | null): string {
  const value = stripQuotes(raw);
  if (!value) return "";
  const fromCookie = extractCookieFromHeader(value, "oauth_refresh_token");
  if (fromCookie) return fromCookie;
  return value;
}

// SoundCloud's POST /me/followings/:id endpoint requires a request signature
// derived from the current user id, target user id, client_id, secret, and UA.
export function signFollow(
  userId: string,
  targetId: string,
  clientId: string,
  secret: string,
  userAgent: string = UA,
): string {
  const version = "1";
  const parts = String(userAgent || "").split(/[ /]/);
  const picked = parts.length ? parts[parts[0].length % parts.length] : "";
  const raw = `${version}${secret}${clientId}${secret}${targetId}${userId}${picked}`;
  const bytes = utf8Bytes(raw);
  let hash = 7996111;
  for (let i = 0; i < bytes.length; i += 1) {
    hash = (hash >> 1) + ((1 & hash) << 23);
    hash += bytes[i];
    hash &= 16777215;
  }
  return `${version}:${hash.toString(16)}`;
}

export function numericOrStringId(id: string | number): number | string {
  const raw = String(id || "").trim();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isSafeInteger(n)) return n;
  }
  return raw;
}

export function dedupe<T extends { id?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!item || !item.id) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
