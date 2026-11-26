// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import {
  api,
  followingIds,
  likedPlaylistIds,
  likedTrackIds,
  meNow,
} from "./api.js";
import { browserUserAgent, PAGE } from "./constants.js";
import { followSecretValue, type QueryRecord } from "./http.js";
import {
  playlistTracks,
  rawTrack,
  toAlbum,
  toArtist,
  toTrack,
} from "./models.js";
import { like, savePlaylist } from "./playlists.js";
import { followingIdsCache, hasSession, requireToken } from "./session.js";
import type {
  SCCollection,
  SCLikeItem,
  SCPlaylist,
  SCTrack,
  SCUser,
} from "./soundcloud-types.js";
import type {
  Album,
  AlbumList,
  AlbumPage,
  ArtistPage,
  ByID,
  PageOptions,
  Toggle,
  Track,
} from "./types.js";
import { fail, signFollow, t } from "./utils.js";

export async function album({ id }: ByID): Promise<AlbumPage> {
  const key = String(id);
  if (key.startsWith("track:")) {
    const trackId = key.slice(6);
    const [raw, likedSet] = await Promise.all([
      rawTrack(trackId),
      hasSession()
        ? likedTrackIds().catch(() => new Set<string>())
        : Promise.resolve(new Set<string>()),
    ]);
    const track = toTrack(raw);
    if (!track) {
      throw fail("unavailable", t("SoundCloud has nothing at that address"));
    }
    track.album.saved = likedSet.has(trackId);
    return { album: track.album, tracks: [track] };
  }

  const [data, likedSet] = await Promise.all([
    api<SCPlaylist>(`/playlists/${encodeURIComponent(key)}`),
    hasSession()
      ? likedPlaylistIds().catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
  ]);
  const saved = likedSet.has(String(data.id));
  return {
    album: toAlbum(data, { saved }),
    tracks: await playlistTracks(data),
  };
}

export async function artist({ id }: ByID): Promise<ArtistPage> {
  const key = String(id);
  const [user, tracks, playlists, followed] = await Promise.all([
    api<SCUser>(`/users/${encodeURIComponent(key)}`),
    api<SCCollection<SCTrack>>(`/users/${encodeURIComponent(key)}/tracks`, {
      query: { limit: 50, linked_partitioning: 1 },
    }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    ),
    api<SCCollection<SCPlaylist>>(
      `/users/${encodeURIComponent(key)}/playlists`,
      { query: { limit: 24, linked_partitioning: 1 } },
    ).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    ),
    hasSession()
      ? followingIds().catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
  ]);

  const top =
    tracks.status === "fulfilled"
      ? (tracks.value.collection || [])
          .map((track) => toTrack(track))
          .filter((track): track is Track => track !== null)
      : [];

  const albums =
    playlists.status === "fulfilled"
      ? (playlists.value.collection || [])
          .filter((item) => item.is_album)
          .map((item) => toAlbum(item))
      : [];

  return {
    artist: toArtist(user, { following: followed.has(key) }),
    tracks: top,
    albums,
  };
}

export async function saveAlbum({ id, on }: Toggle): Promise<void> {
  requireToken();
  const key = String(id);
  if (key.startsWith("track:")) {
    return like({ id: key.slice(6), on });
  }
  return savePlaylist({ id: key, on });
}

export async function savedAlbums({
  offset = 0,
}: PageOptions = {}): Promise<AlbumList> {
  requireToken();
  const me = await meNow();
  const albums: Album[] = [];
  const seen = new Set<string>();
  const targetCount = offset + PAGE + 1;
  let nextPath = `/users/${me.id}/likes`;
  let query: QueryRecord = { limit: 200, linked_partitioning: 1 };

  for (
    let page = 0;
    page < 10 && nextPath && albums.length < targetCount;
    page++
  ) {
    const response = await api<SCCollection<SCLikeItem>>(nextPath, { query });
    for (const item of response.collection || []) {
      if (!item || !item.playlist || !item.playlist.is_album) continue;
      const mapped = toAlbum(item.playlist, { saved: true });
      if (seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      albums.push(mapped);
    }
    nextPath = response.next_href || "";
    query = {};
  }

  const pageAlbums = albums.slice(offset, offset + PAGE);
  const more = albums.length > offset + PAGE || !!nextPath;
  return { albums: pageAlbums, more };
}

export async function followArtist({ id, on }: Toggle): Promise<void> {
  requireToken();
  const me = await meNow();
  const key = String(id);

  if (on) {
    await api(`/me/followings/${encodeURIComponent(key)}`, {
      method: "POST",
      query: (clientId) => ({
        signature: signFollow(
          me.id,
          key,
          clientId,
          followSecretValue(),
          browserUserAgent(),
        ),
      }),
    });
  } else {
    await api(`/me/followings/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
  }

  if (followingIdsCache) {
    if (on) followingIdsCache.ids.add(key);
    else followingIdsCache.ids.delete(key);
  }
}
