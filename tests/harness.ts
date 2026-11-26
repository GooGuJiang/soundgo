// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { afterEach } from "bun:test";
import { resolve } from "node:path";
import { root } from "../scripts/metadata.ts";
import type {
  Host,
  SpawnedProcess,
  WebFetchOptions,
  WebFetchResponse,
  WebSignInOptions,
} from "../src/types.ts";

export type PluginModule = typeof import("../src/index.ts") &
  Record<string, unknown>;

type FetchImpl = (
  url: string,
  init?: RequestInit,
) => Promise<Response> | Response;

const origFetch = globalThis.fetch;
const origHost = (globalThis as Record<string, unknown>).host;
const origAtob = globalThis.atob;
const origBtoa = globalThis.btoa;

let caseSeq = 0;
const loadedPlugins: PluginModule[] = [];

export function pluginEntryPath(): string {
  const baseDir = process.env.PLUGIN_DIR || resolve(root, "dist/plugin");
  return resolve(baseDir, "index.js");
}

export function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function validAuthStorage(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    clientId: "TestClientId12345678901234567890",
    clientIdAt: Date.now(),
    token: makeJwt({
      sub: "user-42",
      exp: Math.floor((Date.now() + 3600 * 1000) / 1000),
      client_id: "TestClientId12345678901234567890",
    }),
    ...extra,
  };
}

export interface SetupOptions {
  storage?: Record<string, unknown>;
  settings?: Record<string, string>;
  fetchImpl: FetchImpl;
  webSignInImpl?: (
    options: WebSignInOptions,
  ) => Promise<{ cookie?: string } | null>;
  webFetchImpl?: (options: WebFetchOptions) => Promise<WebFetchResponse>;
  spawnImpl?: (cmd: string, args: string[]) => SpawnedProcess;
  hideAtob?: boolean;
}

export async function setupPlugin({
  storage = {},
  settings = {},
  fetchImpl,
  webSignInImpl,
  webFetchImpl,
  spawnImpl,
  hideAtob = false,
}: SetupOptions) {
  const store = new Map<string, unknown>(Object.entries(storage));
  const settingMap = new Map<string, string>(Object.entries(settings));

  const mockHost: Host = {
    platform: "windows",
    arch: "amd64",
    t: (s) => s,
    language: () => "en",
    setting: (key) => settingMap.get(key) || "",
    storage: {
      get: (key) => store.get(key),
      set: (key, value) => store.set(key, value),
      remove: (key) => store.delete(key),
    },
    ...(webSignInImpl ? { webSignIn: webSignInImpl } : {}),
    ...(webFetchImpl ? { webFetch: webFetchImpl } : {}),
    spawn:
      spawnImpl ||
      (() => {
        throw new Error("spawn not mocked");
      }),
  };

  (globalThis as Record<string, unknown>).host = mockHost;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    fetchImpl(String(input), init)) as typeof fetch;

  if (hideAtob) {
    (globalThis as Record<string, unknown>).atob = undefined;
    (globalThis as Record<string, unknown>).btoa = undefined;
  }

  caseSeq += 1;
  // Bun caches file:// URLs ignoring query strings on Windows, whereas a
  // filesystem path with a query parameter loads a fresh module instance.
  const plugin = (await import(
    `${pluginEntryPath()}?case=${caseSeq}`
  )) as PluginModule;
  loadedPlugins.push(plugin);
  return { plugin, store, settingMap };
}

export function registerCleanup(): void {
  afterEach(() => {
    while (loadedPlugins.length) {
      try {
        loadedPlugins.pop()?.signOut();
      } catch {
        // ignore cleanup errors
      }
    }
    globalThis.fetch = origFetch;
    (globalThis as Record<string, unknown>).host = origHost;
    globalThis.atob = origAtob;
    globalThis.btoa = origBtoa;
  });
}
