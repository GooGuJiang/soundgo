// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { afterEach, describe, expect, test } from "bun:test";

const origFetch = globalThis.fetch;
const origHost = globalThis.host;
const origAtob = globalThis.atob;
const origBtoa = globalThis.btoa;

let caseSeq = 1000;
const loadedPlugins = [];

function makeJwt(payload) {
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
}

function jsonResponse(status, body) {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function setupPlugin({ storage = {}, settings = {}, fetchImpl }) {
  const store = new Map(Object.entries(storage));
  const settingMap = new Map(Object.entries(settings));

  globalThis.host = {
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
    spawn: () => {
      throw new Error("spawn not mocked");
    },
  };
  globalThis.fetch = fetchImpl;
  globalThis.atob = undefined;
  globalThis.btoa = undefined;

  caseSeq += 1;
  const plugin = await import(`../index.js?feat=${caseSeq}`);
  loadedPlugins.push(plugin);
  return { plugin, store };
}

function validAuthStorage(extra = {}) {
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

afterEach(() => {
  while (loadedPlugins.length) {
    try {
      loadedPlugins.pop().signOut();
    } catch {
      // ignore cleanup errors
    }
  }
  globalThis.fetch = origFetch;
  globalThis.host = origHost;
  globalThis.atob = origAtob;
  globalThis.btoa = origBtoa;
});

describe("Likes, saves, and saved albums", () => {
  test("isLiked paginates /me/track_likes/ids, caches results, and updates on like/likeEpisode", async () => {
    let idsCalls = 0;
    const mutations = [];

    const { plugin } = await setupPlugin({
      storage: validAuthStorage(),
      fetchImpl: async (url, init = {}) => {
        const method = (init.method || "GET").toUpperCase();
        if (url.includes("/me/track_likes/ids")) {
          idsCalls += 1;
          if (!url.includes("cursor=2")) {
            return jsonResponse(200, {
              collection: [101, 102],
              next_href: "https://api-v2.soundcloud.com/me/track_likes/ids?cursor=2",
            });
          }
          return jsonResponse(200, { collection: [203], next_href: null });
        }
        if (url.includes("/me?")) {
          return jsonResponse(200, { id: 42, username: "alice", avatar_url: "" });
        }
        if (url.includes("/users/42/track_likes/")) {
          mutations.push({ method, url });
          return jsonResponse(200, { ok: true });
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    });

    const first = await plugin.isLiked({ ids: ["101", "203", "999"] });
    expect(first).toEqual({ 101: true, 203: true, 999: false });
    expect(idsCalls).toBe(2);

    // Second call hits memory cache without re-fetching.
    const cached = await plugin.isLiked({ ids: ["102", "999"] });
    expect(cached).toEqual({ 102: true, 999: false });
    expect(idsCalls).toBe(2);

    await plugin.like({ id: "999", on: true });
    await plugin.likeEpisode({ id: "101", on: false });

    expect(mutations.map((m) => m.method)).toEqual(["PUT", "DELETE"]);
    expect(mutations[0].url).toContain("/users/42/track_likes/999");
    expect(mutations[1].url).toContain("/users/42/track_likes/101");

    const updated = await plugin.isLiked({ ids: ["101", "999"] });
    expect(updated).toEqual({ 101: false, 999: true });
  });

  test("savePlaylist, saveAlbum, savedAlbums, and album/playlist saved flags work cleanly", async () => {
    const mutations = [];
    const likedPlaylists = new Set(["500", "700"]);

    const { plugin } = await setupPlugin({
      storage: validAuthStorage(),
      fetchImpl: async (url, init = {}) => {
        const method = (init.method || "GET").toUpperCase();
        if (url.includes("/me?")) {
          return jsonResponse(200, { id: 42, username: "alice", avatar_url: "" });
        }
        if (url.includes("/me/playlist_likes/ids")) {
          return jsonResponse(200, { collection: [...likedPlaylists].map(Number), next_href: null });
        }
        if (url.includes("/me/track_likes/ids")) {
          return jsonResponse(200, { collection: [888], next_href: null });
        }
        if (url.includes("/users/42/playlist_likes/")) {
          const id = url.split("/playlist_likes/")[1].split("?")[0];
          mutations.push({ kind: "playlist", method, id });
          if (method === "PUT") likedPlaylists.add(id);
          else likedPlaylists.delete(id);
          return jsonResponse(200, { ok: true });
        }
        if (url.includes("/users/42/track_likes/")) {
          const id = url.split("/track_likes/")[1].split("?")[0];
          mutations.push({ kind: "track", method, id });
          return jsonResponse(200, { ok: true });
        }
        if (url.includes("/playlists/500")) {
          return jsonResponse(200, {
            id: 500,
            title: "Someone Else Playlist",
            is_album: false,
            user: { id: 99, username: "other" },
            tracks: [],
          });
        }
        if (url.includes("/playlists/700")) {
          return jsonResponse(200, {
            id: 700,
            title: "Saved Album",
            is_album: true,
            user: { id: 99, username: "artist" },
            tracks: [],
          });
        }
        if (url.includes("/tracks/888")) {
          return jsonResponse(200, {
            id: 888,
            title: "Single Song",
            duration: 180000,
            user: { id: 99, username: "artist" },
          });
        }
        if (url.includes("/users/42/likes")) {
          return jsonResponse(200, {
            collection: [
              { track: { id: 1, title: "Ignored Track", user: { id: 2, username: "u" } } },
              { playlist: { id: 500, title: "Liked Playlist", is_album: false, user: { id: 99, username: "other" } } },
              { playlist: { id: 700, title: "Saved Album", is_album: true, user: { id: 99, username: "artist" } } },
            ],
            next_href: null,
          });
        }
        if (url.includes("/users/42/playlists")) {
          return jsonResponse(200, { collection: [], next_href: null });
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    });

    const pl = await plugin.playlist({ id: "500" });
    expect(pl.saved).toBe(true);
    expect(pl.mine).toBe(false);

    const al = await plugin.album({ id: "700" });
    expect(al.album.saved).toBe(true);

    const singleAl = await plugin.album({ id: "track:888" });
    expect(singleAl.album.saved).toBe(true);

    await plugin.savePlaylist({ id: "500", on: false });
    await plugin.saveAlbum({ id: "701", on: true });
    await plugin.saveAlbum({ id: "track:888", on: false });

    expect(mutations).toEqual([
      { kind: "playlist", method: "DELETE", id: "500" },
      { kind: "playlist", method: "PUT", id: "701" },
      { kind: "track", method: "DELETE", id: "888" },
    ]);

    const saved = await plugin.savedAlbums({ offset: 0 });
    expect(saved.albums.map((a) => ({ id: a.id, saved: a.saved }))).toEqual([
      { id: "700", saved: true },
    ]);
    expect(saved.more).toBe(false);

    // Regular playlists() excludes saved albums so they don't duplicate.
    const pls = await plugin.playlists();
    expect(pls.map((p) => p.id)).toEqual(["500"]);
  });
});

describe("Follow artist", () => {
  test("followArtist signs POST /me/followings/:id using SoundCloud's signature algorithm and updates artist.following", async () => {
    const calls = [];
    const followed = new Set(["777"]);

    const { plugin } = await setupPlugin({
      storage: validAuthStorage(),
      fetchImpl: async (url, init = {}) => {
        const method = (init.method || "GET").toUpperCase();
        if (url.includes("/me?")) {
          return jsonResponse(200, { id: 42, username: "alice", avatar_url: "" });
        }
        if (url.includes("/users/42/followings/ids")) {
          return jsonResponse(200, { collection: [...followed].map(Number), next_href: null });
        }
        if (url.includes("/me/followings/")) {
          const parsed = new URL(url);
          calls.push({
            method,
            path: parsed.pathname,
            signature: parsed.searchParams.get("signature"),
          });
          return jsonResponse(200, { ok: true });
        }
        if (url.includes("/users/888/tracks") || url.includes("/users/888/playlists")) {
          return jsonResponse(200, { collection: [] });
        }
        if (url.includes("/users/888")) {
          return jsonResponse(200, { id: 888, username: "DJ Test", avatar_url: "" });
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    });

    const before = await plugin.artist({ id: "888" });
    expect(before.artist.following).toBe(false);

    await plugin.followArtist({ id: "888", on: true });
    const afterFollow = await plugin.artist({ id: "888" });
    expect(afterFollow.artist.following).toBe(true);

    await plugin.followArtist({ id: "888", on: false });
    const afterUnfollow = await plugin.artist({ id: "888" });
    expect(afterUnfollow.artist.following).toBe(false);

    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/me/followings/888");
    expect(calls[0].signature).toMatch(/^1:[0-9a-f]{1,6}$/);
    expect(calls[1].method).toBe("DELETE");
    expect(calls[1].path).toBe("/me/followings/888");
  });
});

describe("Playlist editing", () => {
  test("create, rename, add, move, remove, and delete send SoundCloud's playlist payloads", async () => {
    let tracks = [10, 20, 30];
    const log = [];

    const { plugin } = await setupPlugin({
      storage: validAuthStorage(),
      fetchImpl: async (url, init = {}) => {
        const method = (init.method || "GET").toUpperCase();
        const body = init.body ? JSON.parse(init.body) : null;
        if (url.includes("/playlists/900")) {
          if (method === "GET") {
            return jsonResponse(200, {
              id: 900,
              title: "My List",
              user: { id: 42, username: "alice" },
              tracks: tracks.map((id) => ({ id, kind: "track" })),
            });
          }
          log.push({ method, body });
          if (method === "PUT" && body && body.playlist && Array.isArray(body.playlist.tracks)) {
            tracks = body.playlist.tracks;
          }
          return jsonResponse(200, { id: 900, title: body?.playlist?.title || "My List" });
        }
        if (url.includes("/playlists") && method === "POST") {
          log.push({ method, body });
          return jsonResponse(201, {
            id: 900,
            title: body.playlist.title,
            user: { id: 42, username: "alice" },
            track_count: 0,
            tracks: [],
          });
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    });

    const created = await plugin.createPlaylist({ name: "  Road Trip  " });
    expect(created).toMatchObject({ id: "900", name: "Road Trip", mine: true, trackCount: 0 });
    expect(log[0]).toEqual({
      method: "POST",
      body: { playlist: { title: "Road Trip", sharing: "public", tracks: [] } },
    });

    await plugin.renamePlaylist({ id: "900", name: "Night Drive" });
    expect(log[1]).toEqual({
      method: "PUT",
      body: { playlist: { title: "Night Drive" } },
    });

    await plugin.addToPlaylist({ id: "900", trackIds: ["20", "40", "50"] });
    expect(tracks).toEqual([10, 20, 30, 40, 50]);

    await plugin.movePlaylistTrack({ id: "900", from: 0, to: 2 });
    expect(tracks).toEqual([20, 30, 10, 40, 50]);

    await plugin.removeFromPlaylist({ id: "900", trackIds: ["30", "50"] });
    expect(tracks).toEqual([20, 10, 40]);

    await plugin.deletePlaylist({ id: "900" });
    expect(log[log.length - 1]).toEqual({ method: "DELETE", body: null });
  });
});

describe("Comments", () => {
  test("comments maps timestamps and total count, postComment submits form-urlencoded, and likeComment is not exported", async () => {
    let postedForm = null;
    let postedContentType = "";

    const { plugin } = await setupPlugin({
      storage: validAuthStorage(),
      fetchImpl: async (url, init = {}) => {
        const method = (init.method || "GET").toUpperCase();
        if (url.includes("/me?")) {
          return jsonResponse(200, { id: 42, username: "alice", avatar_url: "" });
        }
        if (url.includes("/tracks/321/comments") && method === "GET") {
          return jsonResponse(200, {
            collection: [
              {
                id: 555,
                body: "Great beat!",
                created_at: "2026-03-01T12:00:00Z",
                user: { id: 9, username: "listener", avatar_url: "https://i1.sndcdn.com/a-large.jpg" },
              },
            ],
            next_href: "https://api-v2.soundcloud.com/tracks/321/comments?offset=20",
          });
        }
        if (url.includes("/tracks/321/comments") && method === "POST") {
          postedContentType = init.headers["content-type"] || "";
          postedForm = new URLSearchParams(init.body);
          return jsonResponse(200, {
            id: 556,
            body: postedForm.get("body"),
            created_at: "2026-03-02T00:00:00Z",
            user: { id: 42, username: "alice", avatar_url: "" },
          });
        }
        if (url.includes("/tracks/321")) {
          return jsonResponse(200, { id: 321, title: "Beat", comment_count: 88, user: { id: 1, username: "a" } });
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    });

    expect(plugin.likeComment).toBeUndefined();

    const page = await plugin.comments({ trackId: "321", offset: 0 });
    expect(page.total).toBe(88);
    expect(page.more).toBe(true);
    expect(page.comments).toEqual([
      {
        id: "555",
        author: "listener",
        avatarUrl: "https://i1.sndcdn.com/a-t500x500.jpg",
        text: "Great beat!",
        time: Date.parse("2026-03-01T12:00:00Z"),
      },
    ]);

    const created = await plugin.postComment({ trackId: "321", text: "  Love this!  " });
    expect(postedContentType).toContain("application/x-www-form-urlencoded");
    expect(postedForm.get("body")).toBe("Love this!");
    expect(postedForm.get("timestamp")).toBe("0");
    expect(created).toMatchObject({
      id: "556",
      author: "alice",
      text: "Love this!",
    });
  });
});

describe("Podcasts (Shows)", () => {
  test("search(shows), show pagination, subscribeShow, shows, and publisher browse work end to end", async () => {
    const likedPlaylists = new Set(["1001"]);
    const hydratedBatches = [];

    const { plugin } = await setupPlugin({
      storage: validAuthStorage(),
      fetchImpl: async (url, init = {}) => {
        const method = (init.method || "GET").toUpperCase();
        if (url.includes("/me?")) {
          return jsonResponse(200, { id: 42, username: "alice", avatar_url: "" });
        }
        if (url.includes("/me/playlist_likes/ids")) {
          return jsonResponse(200, { collection: [...likedPlaylists].map(Number), next_href: null });
        }
        if (url.includes("/users/42/playlist_likes/")) {
          const id = url.split("/playlist_likes/")[1].split("?")[0];
          if (method === "PUT") likedPlaylists.add(id);
          else likedPlaylists.delete(id);
          return jsonResponse(200, { ok: true });
        }
        if (url.includes("/search/playlists_without_albums")) {
          const parsed = new URL(url);
          const q = parsed.searchParams.get("q");
          if (q === "tech podcast") {
            return jsonResponse(200, {
              collection: [
                {
                  id: 1001,
                  title: "Tech Talk Podcast",
                  description: "Weekly tech",
                  genre: "Technology",
                  is_album: false,
                  track_count: 25,
                  user: { id: 50, username: "TechHost", avatar_url: "" },
                },
                {
                  id: 1002,
                  title: "AI Deep Dive Podcast",
                  description: "AI episodes",
                  is_album: false,
                  track_count: 10,
                  user: { id: 51, username: "AIHost", avatar_url: "" },
                },
              ],
              next_href: null,
            });
          }
          return jsonResponse(200, { collection: [], next_href: null });
        }
        if (url.includes("/playlists/1001")) {
          const stubs = Array.from({ length: 25 }, (_, i) => ({
            id: 5000 + i,
            kind: "track",
          }));
          return jsonResponse(200, {
            id: 1001,
            title: "Tech Talk Podcast",
            description: "Weekly tech",
            is_album: false,
            track_count: 25,
            user: { id: 50, username: "TechHost", avatar_url: "" },
            tracks: stubs,
          });
        }
        if (url.includes("/playlists/1002")) {
          return jsonResponse(200, {
            id: 1002,
            title: "AI Deep Dive Podcast",
            description: "AI episodes",
            is_album: false,
            track_count: 10,
            user: { id: 51, username: "AIHost", avatar_url: "" },
            tracks: [],
          });
        }
        if (url.includes("/tracks?client_id=") || url.includes("/tracks?")) {
          const parsed = new URL(url);
          const ids = (parsed.searchParams.get("ids") || "").split(",").filter(Boolean);
          hydratedBatches.push(ids);
          return jsonResponse(
            200,
            ids.map((id) => ({
              id: Number(id),
              title: `Episode ${id}`,
              description: `Notes for ${id}`,
              display_date: "2026-04-01T00:00:00Z",
              duration: 1200000,
              user: { id: 50, username: "TechHost", avatar_url: "" },
            })),
          );
        }
        if (url.includes("/users/42/likes")) {
          return jsonResponse(200, {
            collection: [
              {
                playlist: {
                  id: 1001,
                  title: "Tech Talk Podcast",
                  description: "Weekly tech",
                  is_album: false,
                  track_count: 25,
                  user: { id: 50, username: "TechHost", avatar_url: "" },
                },
              },
            ],
            next_href: null,
          });
        }
        if (url.includes("/users/50/tracks")) {
          return jsonResponse(200, { collection: [] });
        }
        if (url.includes("/users/50/playlists")) {
          return jsonResponse(200, {
            collection: [
              {
                id: 1001,
                title: "Tech Talk Podcast",
                is_album: false,
                track_count: 25,
                user: { id: 50, username: "TechHost", avatar_url: "" },
              },
            ],
          });
        }
        if (url.includes("/users/50")) {
          return jsonResponse(200, { id: 50, username: "TechHost", description: "Host bio", avatar_url: "" });
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    });

    const found = await plugin.search({ query: "tech", kind: "shows", offset: 0 });
    expect(found.shows).toHaveLength(2);
    expect(found.shows[0]).toMatchObject({
      id: "1001",
      name: "Tech Talk Podcast",
      publisher: "TechHost",
      publisherPage: "user:50",
      episodeCount: 25,
      subscribed: true,
    });
    expect(found.shows[1].subscribed).toBe(false);

    // First page hydrates only 20 episodes out of 25.
    const page1 = await plugin.show({ id: "1001", offset: 0 });
    expect(page1.show.subscribed).toBe(true);
    expect(page1.episodes).toHaveLength(20);
    expect(page1.more).toBe(true);
    expect(page1.episodes[0]).toMatchObject({
      id: "5000",
      showId: "1001",
      description: "Notes for 5000",
      published: "2026-04-01",
    });
    expect(hydratedBatches[0]).toHaveLength(20);

    // Second page hydrates the remaining 5.
    const page2 = await plugin.show({ id: "1001", offset: 20 });
    expect(page2.episodes).toHaveLength(5);
    expect(page2.more).toBe(false);

    // Subscribe to 1002 and unsubscribe from 1001.
    await plugin.subscribeShow({ id: "1002", on: true });
    await plugin.subscribeShow({ id: "1001", on: false });

    const subscribed = await plugin.shows();
    expect(subscribed.map((s) => s.id)).toEqual(["1002"]);

    // Publisher page opens cleanly.
    const pub = await plugin.browse({ page: "user:50" });
    expect(pub.title).toBe("TechHost");
    expect(pub.sections[0].shows[0].id).toBe("1001");
  });
});
