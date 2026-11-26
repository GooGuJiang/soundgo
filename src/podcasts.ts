// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { api, likedPlaylistIds, meNow } from "./api.js";
import { PAGE } from "./constants.js";
import {
  hydrateTracks,
  isPodcastPlaylist,
  toEpisode,
  toShow,
} from "./models.js";
import { savePlaylist } from "./playlists.js";
import { hasSession, requireToken } from "./session.js";
import type {
  SCCollection,
  SCLikeItem,
  SCPlaylist,
  SCPlaylistTrackEntry,
  SCTrack,
} from "./soundcloud-types.js";
import type { Account, Show, ShowPage, ShowParams, Toggle, Track } from "./types.js";
import { load, save } from "./utils.js";

function showStorageKeys(userId: string) {
  return {
    sub: `shows:sub:${userId}`,
    unsub: `shows:unsub:${userId}`,
  };
}

export function storedShowIds(userId: string, which: "sub" | "unsub"): string[] {
  const keys = showStorageKeys(userId);
  const list = load<unknown>(keys[which], []);
  return Array.isArray(list) ? list.map((id) => String(id)).filter(Boolean) : [];
}

function saveShowIds(
  userId: string,
  which: "sub" | "unsub",
  ids: string[],
): void {
  const keys = showStorageKeys(userId);
  save(keys[which], [...new Set(ids.map((id) => String(id)).filter(Boolean))]);
}

export function isShowSubscribed(
  playlist: SCPlaylist | undefined,
  me: Account | null,
  likedSet: Set<string>,
): boolean {
  if (!me || !playlist || playlist.id === undefined || playlist.id === null) {
    return false;
  }
  const key = String(playlist.id);
  const subSet = new Set(storedShowIds(me.id, "sub"));
  if (subSet.has(key)) return true;
  const unsubSet = new Set(storedShowIds(me.id, "unsub"));
  return !unsubSet.has(key) && isPodcastPlaylist(playlist) && likedSet.has(key);
}

export async function shows(): Promise<Show[]> {
  if (!hasSession()) return [];
  const me = await meNow();
  const explicitIds = storedShowIds(me.id, "sub");
  const unsubSet = new Set(storedShowIds(me.id, "unsub"));

  const likesResponse = await api<SCCollection<SCLikeItem>>(
    `/users/${me.id}/likes`,
    { query: { limit: 200, linked_partitioning: 1 } },
  ).catch(() => ({ collection: [] as SCLikeItem[] }));

  const byId = new Map<string, SCPlaylist>();
  for (const item of likesResponse.collection || []) {
    if (!item || !item.playlist || item.playlist.is_album) continue;
    byId.set(String(item.playlist.id), item.playlist);
  }

  const orderedIds: string[] = [];
  const seen = new Set<string>();

  for (const id of explicitIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
  }

  for (const [pid, pl] of byId.entries()) {
    if (seen.has(pid) || unsubSet.has(pid)) continue;
    if (!isPodcastPlaylist(pl)) continue;
    seen.add(pid);
    orderedIds.push(pid);
  }

  const missingIds = orderedIds.filter((id) => !byId.has(id));
  if (missingIds.length) {
    const fetched = await Promise.allSettled(
      missingIds.map((id) =>
        api<SCPlaylist>(`/playlists/${encodeURIComponent(id)}`),
      ),
    );
    for (let i = 0; i < missingIds.length; i++) {
      const result = fetched[i];
      if (result.status === "fulfilled" && result.value) {
        byId.set(missingIds[i], result.value);
      }
    }
  }

  return orderedIds
    .map((id) => byId.get(id))
    .filter((pl): pl is SCPlaylist => pl !== undefined)
    .map((pl) => toShow(pl, { subscribed: true }));
}

export async function show({ id, offset = 0 }: ShowParams): Promise<ShowPage> {
  const key = String(id);
  const [data, me, likedSet] = await Promise.all([
    api<SCPlaylist>(`/playlists/${encodeURIComponent(key)}`),
    hasSession() ? meNow().catch(() => null) : Promise.resolve(null),
    hasSession()
      ? likedPlaylistIds().catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
  ]);

  const subscribed = isShowSubscribed(data, me, likedSet);

  const entries = (data.tracks || [])
    .map((item) => ("track" in item && item.track ? item.track : item))
    .filter((track): track is SCTrack | SCPlaylistTrackEntry => !!(track && track.id));
  const slice = entries.slice(offset, offset + PAGE);
  const full = await hydrateTracks(slice);
  const episodes = full
    .filter((track): track is SCTrack => !!(track && track.title))
    .map((track) => toEpisode(track, data))
    .filter((track): track is Track => track !== null);

  return {
    show: toShow(data, { subscribed }),
    episodes,
    more: offset + PAGE < entries.length,
  };
}

export async function subscribeShow({ id, on }: Toggle): Promise<void> {
  requireToken();
  const me = await meNow();
  const key = String(id);

  if (typeof host.webFetch === "function") {
    await savePlaylist({ id: key, on });
  } else {
    await savePlaylist({ id: key, on }).catch(() => {
      // Keep local podcast subscriptions working even without host.webFetch.
    });
  }

  const sub = storedShowIds(me.id, "sub").filter((item) => item !== key);
  const unsub = storedShowIds(me.id, "unsub").filter((item) => item !== key);

  if (on) {
    sub.unshift(key);
  } else {
    unsub.unshift(key);
  }

  saveShowIds(me.id, "sub", sub);
  saveShowIds(me.id, "unsub", unsub);
}
