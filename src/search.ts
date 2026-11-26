// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { api, likedPlaylistIds, meNow } from "./api.js";
import { PAGE } from "./constants.js";
import {
  hasMore,
  toAlbum,
  toArtist,
  toPlaylist,
  toShow,
  toTrack,
} from "./models.js";
import { isShowSubscribed } from "./podcasts.js";
import { hasSession } from "./session.js";
import type {
  SCCollection,
  SCPlaylist,
  SCSearchQueryItem,
  SCTrack,
  SCUser,
} from "./soundcloud-types.js";
import type {
  QueryParams,
  SearchParams,
  SearchResult,
  Track,
} from "./types.js";

export async function search({
  query,
  kind,
  offset = 0,
}: SearchParams): Promise<SearchResult> {
  if (kind === "shows") {
    const trimmed = String(query || "").trim();
    const hasPodcastWord = /\bpodcasts?\b|播客/i.test(trimmed);
    const primaryQuery =
      !trimmed || hasPodcastWord ? trimmed : `${trimmed} podcast`;

    let response = await api<SCCollection<SCPlaylist>>(
      "/search/playlists_without_albums",
      {
        query: { q: primaryQuery, limit: PAGE, offset },
        auth: false,
      },
    );
    let collection = response.collection || [];

    if (!collection.length && offset === 0 && primaryQuery !== trimmed) {
      response = await api<SCCollection<SCPlaylist>>(
        "/search/playlists_without_albums",
        {
          query: { q: trimmed, limit: PAGE, offset },
          auth: false,
        },
      );
      collection = response.collection || [];
    }

    const [me, likedSet] = hasSession()
      ? await Promise.all([
          meNow().catch(() => null),
          likedPlaylistIds().catch(() => new Set<string>()),
        ])
      : [null, new Set<string>()];
    const showsList = collection
      .filter((item) => item && !item.is_album)
      .map((playlist) =>
        toShow(playlist, {
          subscribed: isShowSubscribed(playlist, me, likedSet),
        }),
      );
    return { shows: showsList, more: hasMore(response, showsList.length) };
  }

  const paths: Record<Exclude<SearchParams["kind"], "shows">, string> = {
    tracks: "/search/tracks",
    albums: "/search/albums",
    artists: "/search/users",
    playlists: "/search/playlists",
  };

  const path = paths[kind];
  if (!path) return { more: false };

  const response = await api<SCCollection<unknown>>(path, {
    query: { q: query, limit: PAGE, offset },
    auth: false,
  });
  const collection = response.collection || [];

  if (kind === "tracks") {
    const tracks = (collection as SCTrack[])
      .map((track) => toTrack(track))
      .filter((track): track is Track => track !== null);
    return { tracks, more: hasMore(response, tracks.length) };
  }
  if (kind === "albums") {
    const albums = (collection as SCPlaylist[]).map((album) => toAlbum(album));
    return { albums, more: hasMore(response, albums.length) };
  }
  if (kind === "artists") {
    const artists = (collection as SCUser[]).map((user) => toArtist(user));
    return { artists, more: hasMore(response, artists.length) };
  }

  const playlists = (collection as SCPlaylist[]).map((playlist) =>
    toPlaylist(playlist),
  );
  return { playlists, more: hasMore(response, playlists.length) };
}

export async function suggest({ query }: QueryParams): Promise<string[]> {
  try {
    const response = await api<SCCollection<SCSearchQueryItem>>(
      "/search/queries",
      {
        query: { q: query, limit: 8 },
        auth: false,
      },
    );
    return (response.collection || [])
      .map((item) => item.output || item.query || "")
      .filter(Boolean);
  } catch {
    return [];
  }
}
