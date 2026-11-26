// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { api, likedPlaylistIds, likedTrackIds, meNow } from "./api.js";
import { PAGE } from "./constants.js";
import { hasMore, playlistPage, toPlaylist, toTrack } from "./models.js";
import {
  hasSession,
  likedPlaylistIdsCache,
  likedTrackIdsCache,
  requireToken,
} from "./session.js";
import type { SCCollection, SCLikeItem, SCPlaylist } from "./soundcloud-types.js";
import type {
  ByID,
  MoveTrackParams,
  Named,
  PageOptions,
  Playlist,
  Toggle,
  Track,
  TrackIDs,
  TrackPage,
} from "./types.js";
import { numericOrStringId, t } from "./utils.js";

export async function playlists(): Promise<Playlist[]> {
  if (!hasSession()) return [];
  const me = await meNow();

  const [mine, likes] = await Promise.allSettled([
    api<SCCollection<SCPlaylist>>(`/users/${me.id}/playlists`, {
      query: { limit: 200, linked_partitioning: 1 },
    }),
    api<SCCollection<SCLikeItem>>(`/users/${me.id}/likes`, {
      query: { limit: 200, linked_partitioning: 1 },
    }),
  ]);

  const out: Playlist[] = [];
  const seen = new Set<string>();

  if (mine.status === "fulfilled") {
    for (const pl of mine.value.collection || []) {
      if (pl.is_album) continue;
      const mapped = toPlaylist(pl, { mine: true });
      if (seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      out.push(mapped);
    }
  }

  if (likes.status === "fulfilled") {
    for (const item of likes.value.collection || []) {
      if (!item.playlist || item.playlist.is_album) continue;
      const mapped = toPlaylist(item.playlist, { saved: true });
      if (seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      out.push(mapped);
    }
  }

  return out;
}

export async function playlist({ id }: ByID): Promise<Playlist> {
  const [me, data, likedSet] = await Promise.all([
    meNow().catch(() => null),
    api<SCPlaylist>(`/playlists/${encodeURIComponent(id)}`),
    hasSession()
      ? likedPlaylistIds().catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
  ]);
  const mine = !!(me && data.user && String(data.user.id) === me.id);
  const saved = !mine && likedSet.has(String(data.id));
  return playlistPage(data, { mine, saved });
}

export async function liked({ offset = 0 }: PageOptions = {}): Promise<TrackPage> {
  requireToken();
  const me = await meNow();
  const response = await api<SCCollection<SCLikeItem>>(
    `/users/${me.id}/track_likes`,
    {
      query: { limit: PAGE, offset, linked_partitioning: 1 },
    },
  );
  const tracks = (response.collection || [])
    .map((item) => toTrack(item.track))
    .filter((track): track is Track => track !== null);
  if (likedTrackIdsCache) {
    for (const tr of tracks) likedTrackIdsCache.ids.add(tr.id);
  }
  return { tracks, more: hasMore(response, tracks.length) };
}

export async function isLiked({
  ids,
}: { ids?: string[] } = {}): Promise<Record<string, boolean>> {
  const list = Array.isArray(ids) ? ids : [];
  if (!hasSession() || !list.length) return {};
  const set = await likedTrackIds();
  const out: Record<string, boolean> = {};
  for (const id of list) {
    const key = String(id);
    out[key] = set.has(key);
  }
  return out;
}

export async function like({ id, on }: Toggle): Promise<void> {
  requireToken();
  const me = await meNow();
  const key = String(id);
  await api(`/users/${me.id}/track_likes/${encodeURIComponent(key)}`, {
    method: on ? "PUT" : "DELETE",
  });
  if (likedTrackIdsCache) {
    if (on) likedTrackIdsCache.ids.add(key);
    else likedTrackIdsCache.ids.delete(key);
  }
}

export async function likeEpisode({ id, on }: Toggle): Promise<void> {
  return like({ id, on });
}

export async function savePlaylist({ id, on }: Toggle): Promise<void> {
  requireToken();
  const me = await meNow();
  const key = String(id);
  await api(`/users/${me.id}/playlist_likes/${encodeURIComponent(key)}`, {
    method: on ? "PUT" : "DELETE",
  });
  if (likedPlaylistIdsCache) {
    if (on) likedPlaylistIdsCache.ids.add(key);
    else likedPlaylistIdsCache.ids.delete(key);
  }
}

async function playlistTrackIds(id: string): Promise<Array<number | string>> {
  const data = await api<SCPlaylist>(`/playlists/${encodeURIComponent(id)}`);
  return (data.tracks || [])
    .map((item) => ("track" in item && item.track ? item.track : item))
    .filter((item) => item && item.id !== undefined && item.id !== null)
    .map((item) => numericOrStringId(item.id!));
}

export async function createPlaylist({ name }: Named): Promise<Playlist> {
  requireToken();
  const title = String(name || "").trim();
  if (!title) throw new Error(t("Playlist name cannot be empty"));
  const created = await api<SCPlaylist>("/playlists", {
    method: "POST",
    body: { playlist: { title, sharing: "public", tracks: [] } },
  });
  return toPlaylist(created, { mine: true });
}

export async function renamePlaylist({ id, name }: ByID & Named): Promise<void> {
  requireToken();
  const title = String(name || "").trim();
  if (!title) throw new Error(t("Playlist name cannot be empty"));
  await api(`/playlists/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { playlist: { title } },
  });
}

export async function deletePlaylist({ id }: ByID): Promise<void> {
  requireToken();
  await api(`/playlists/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function addToPlaylist({ id, trackIds }: TrackIDs): Promise<void> {
  requireToken();
  const additions = Array.isArray(trackIds) ? trackIds : [];
  if (!additions.length) return;
  const current = await playlistTrackIds(id);
  const existing = new Set(current.map((item) => String(item)));
  const next = current.slice();
  for (const tid of additions) {
    const key = String(tid || "").trim();
    if (!key || existing.has(key)) continue;
    existing.add(key);
    next.push(numericOrStringId(key));
  }
  await api(`/playlists/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { playlist: { tracks: next } },
  });
}

export async function removeFromPlaylist({
  id,
  trackIds,
}: TrackIDs): Promise<void> {
  requireToken();
  const removals = new Set(
    (Array.isArray(trackIds) ? trackIds : []).map((tid) => String(tid)),
  );
  if (!removals.size) return;
  const current = await playlistTrackIds(id);
  const next = current.filter((tid) => !removals.has(String(tid)));
  await api(`/playlists/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { playlist: { tracks: next } },
  });
}

export async function movePlaylistTrack({
  id,
  from,
  to,
}: MoveTrackParams): Promise<void> {
  requireToken();
  const fromIdx = Number(from);
  const toIdx = Number(to);
  if (
    !Number.isInteger(fromIdx) ||
    !Number.isInteger(toIdx) ||
    fromIdx === toIdx
  ) {
    return;
  }
  const current = await playlistTrackIds(id);
  if (
    fromIdx < 0 ||
    toIdx < 0 ||
    fromIdx >= current.length ||
    toIdx >= current.length
  ) {
    return;
  }
  const next = current.slice();
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  await api(`/playlists/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { playlist: { tracks: next } },
  });
}
