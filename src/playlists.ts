// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { api, likedPlaylistIds, likedTrackIds, meNow } from "./api.js";
import { PAGE } from "./constants.js";
import { playlistPage, toPlaylist, toTrack } from "./models.js";
import {
  hasSession,
  likedCursor,
  likedPlaylistIdsCache,
  likedTrackIdsCache,
  requireToken,
  setLikedCursor,
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

  // SoundCloud's /users/:id/track_likes uses opaque timestamp cursors in
  // next_href and rejects numeric offsets > 0 with 400 (ChronoParams.Cursor).
  let response: SCCollection<SCLikeItem>;
  if (offset <= 0) {
    setLikedCursor(null);
    response = await api<SCCollection<SCLikeItem>>(
      `/users/${me.id}/track_likes`,
      { query: { limit: PAGE, linked_partitioning: 1 } },
    );
  } else if (likedCursor && Math.abs(offset - likedCursor.at) <= 5) {
    response = await api<SCCollection<SCLikeItem>>(likedCursor.href);
  } else {
    // Fallback when jumping to a non-sequential offset without a cached cursor:
    // walk next_href from the start and slice the requested window.
    const all: Track[] = [];
    let nextPath = `/users/${me.id}/track_likes`;
    let query: Record<string, string | number> | undefined = {
      limit: 50,
      linked_partitioning: 1,
    };
    for (let page = 0; page < 20 && nextPath && all.length < offset + PAGE; page++) {
      const batch = await api<SCCollection<SCLikeItem>>(nextPath, { query });
      for (const item of batch.collection || []) {
        const mapped = toTrack(item.track);
        if (mapped) all.push(mapped);
      }
      nextPath = batch.next_href || "";
      query = undefined;
    }
    const tracks = all.slice(offset, offset + PAGE);
    if (likedTrackIdsCache) {
      for (const tr of tracks) likedTrackIdsCache.ids.add(tr.id);
    }
    if (nextPath && all.length >= offset + PAGE) {
      setLikedCursor({ at: all.length, href: nextPath });
    } else {
      setLikedCursor(null);
    }
    return { tracks, more: all.length > offset + PAGE || !!nextPath };
  }

  const tracks = (response.collection || [])
    .map((item) => toTrack(item.track))
    .filter((track): track is Track => track !== null);
  if (likedTrackIdsCache) {
    for (const tr of tracks) likedTrackIdsCache.ids.add(tr.id);
  }

  const nextHref = response.next_href || "";
  if (nextHref) {
    setLikedCursor({ at: offset + tracks.length, href: nextHref });
  } else {
    setLikedCursor(null);
  }

  return { tracks, more: !!nextHref };
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
