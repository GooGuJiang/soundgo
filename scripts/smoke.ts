#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors
//
// Live smoke test for the public catalog of the built plugin bundle.
// Run with `bun run smoke`.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPlugin } from "./build.ts";

const dir = await buildPlugin();
const store = new Map<string, unknown>();

(globalThis as Record<string, unknown>).host = {
  platform: process.platform === "win32" ? "windows" : process.platform,
  arch: process.arch === "x64" ? "amd64" : process.arch,
  t: (s: string) => s,
  language: () => "en",
  setting: () => "",
  storage: {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => store.set(k, v),
    remove: (k: string) => store.delete(k),
  },
  spawn: () => {
    throw new Error("helper spawn not exercised in public smoke");
  },
};

const plugin = (await import(
  pathToFileURL(resolve(dir, "index.js")).href
)) as typeof import("../src/index.ts");

let failures = 0;

async function check(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}: ${detail}`);
  } catch (error) {
    failures += 1;
    console.log(
      `FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

let firstTrackId = "";
let firstShowId = "";

await check("browse(charts)", async () => {
  const charts = await plugin.browse({ page: "charts" });
  const tracks = charts.sections[0]?.tracks || [];
  if (!tracks.length) throw new Error("no chart tracks returned");
  firstTrackId = tracks[0].id;
  return `${tracks.length} tracks, first "${tracks[0].name}"`;
});

await check("search(tracks)", async () => {
  const res = await plugin.search({ query: "lofi", kind: "tracks", offset: 0 });
  if (!res.tracks?.length) throw new Error("no tracks found");
  return `${res.tracks.length} results, first "${res.tracks[0].name}"`;
});

await check("comments", async () => {
  if (!firstTrackId) throw new Error("missing track id");
  const res = await plugin.comments({ trackId: firstTrackId, offset: 0 });
  return `${res.comments.length} loaded (total ${res.total ?? "?"})`;
});

await check("search(shows)", async () => {
  const res = await plugin.search({ query: "tech", kind: "shows", offset: 0 });
  if (!res.shows?.length) throw new Error("no shows found");
  firstShowId = res.shows[0].id;
  return `${res.shows.length} shows, first "${res.shows[0].name}"`;
});

await check("show", async () => {
  if (!firstShowId) throw new Error("missing show id");
  const page = await plugin.show({ id: firstShowId, offset: 0 });
  return `"${page.show.name}" (${page.episodes.length} episodes on page 1)`;
});

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
