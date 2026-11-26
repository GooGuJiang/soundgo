// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { api, meNow } from "./api.js";
import {
  image,
  isPodcastPlaylist,
  toAlbum,
  toArtist,
  toPlaylist,
  toShow,
  toTrack,
  tracksIn,
} from "./models.js";
import { recent } from "./recent.js";
import { hasSession, requireToken } from "./session.js";
import type {
  SCChartItem,
  SCCollection,
  SCLikeItem,
  SCPlaylist,
  SCSelection,
  SCTrack,
  SCUser,
} from "./soundcloud-types.js";
import type { Browse, BrowseParams, Playlist, Section, Track } from "./types.js";
import { fail, t } from "./utils.js";

async function trending(limit: number): Promise<Track[]> {
  const response = await api<SCCollection<SCChartItem | SCTrack>>("/charts", {
    query: { kind: "trending", genre: "soundcloud:genres:all-music", limit },
    auth: false,
  });
  return (response.collection || [])
    .map((item) => ("track" in item && item.track ? item.track : (item as SCTrack)))
    .filter(Boolean)
    .map((track) => toTrack(track))
    .filter((track): track is Track => track !== null);
}

async function selectionPlaylists(limit: number): Promise<Playlist[]> {
  const response = await api<SCCollection<SCSelection>>("/mixed-selections", {
    query: { limit },
    auth: false,
  });
  const out: Playlist[] = [];
  for (const selection of response.collection || []) {
    const items =
      selection.items && selection.items.collection
        ? selection.items.collection
        : [];
    for (const playlist of items) out.push(toPlaylist(playlist));
  }
  return out.slice(0, limit * 3);
}

export async function home(): Promise<Browse> {
  const sections: Section[] = [];

  if (hasSession()) {
    const me = await meNow().catch(() => null);

    if (me) {
      const [streamRes, recentRes, playlistsRes, likesRes] =
        await Promise.allSettled([
          api("/stream", { query: { limit: 12, linked_partitioning: 1 } }),
          api("/me/play-history/tracks", {
            query: { limit: 12, linked_partitioning: 1 },
          }),
          api<SCCollection<SCPlaylist>>(`/users/${me.id}/playlists`, {
            query: { limit: 12, linked_partitioning: 1 },
          }),
          api<SCCollection<SCLikeItem>>(`/users/${me.id}/track_likes`, {
            query: { limit: 12, linked_partitioning: 1 },
          }),
        ]);

      if (streamRes.status === "fulfilled") {
        const tracks = tracksIn(streamRes.value);
        if (tracks.length) sections.push({ title: t("Your Stream"), tracks });
      }

      if (recentRes.status === "fulfilled") {
        const tracks = tracksIn(recentRes.value);
        if (tracks.length) {
          sections.push({
            title: t("Recently Played"),
            tracks,
            morePage: "recent",
          });
        }
      }

      if (playlistsRes.status === "fulfilled") {
        const mine = (playlistsRes.value.collection || [])
          .filter((playlist) => !playlist.is_album)
          .map((playlist) => toPlaylist(playlist, { mine: true }));
        if (mine.length) {
          sections.push({ title: t("Your Playlists"), playlists: mine });
        }
      }

      if (likesRes.status === "fulfilled") {
        const tracks = (likesRes.value.collection || [])
          .map((item) => toTrack(item.track))
          .filter((track): track is Track => track !== null);
        if (tracks.length) sections.push({ title: t("Liked Tracks"), tracks });
      }
    }
  }

  try {
    const tracks = await trending(20);
    if (tracks.length) {
      sections.push({ title: t("Trending Now"), tracks, morePage: "charts" });
    }
  } catch {
    // Home still shows what the account gave.
  }

  if (!sections.length) {
    sections.push({
      title: t("Trending Now"),
      tracks: [],
      empty: t("Nothing to show right now"),
    });
  }

  return { title: t("SoundCloud"), sections };
}

export async function browse({ page }: BrowseParams): Promise<Browse> {
  if (page === "charts") {
    const sections: Section[] = [];
    const tracks = await trending(50);
    if (tracks.length) sections.push({ title: t("Trending Now"), tracks });

    try {
      const playlists = await selectionPlaylists(6);
      if (playlists.length) {
        sections.push({ title: t("Selections"), playlists });
      }
    } catch {
      // Charts alone are enough.
    }

    return {
      title: t("Charts"),
      subtitle: t("What SoundCloud is playing"),
      sections,
    };
  }

  if (page === "following") {
    requireToken();
    const me = await meNow();
    const response = await api<SCCollection<SCUser>>(
      `/users/${me.id}/followings`,
      { query: { limit: 100, linked_partitioning: 1 } },
    );
    const artists = (response.collection || []).map((user) =>
      toArtist(user, { following: true }),
    );
    return {
      title: t("Following"),
      sections: [
        {
          title: t("Artists"),
          artists,
          empty: t("You do not follow anyone yet"),
        },
      ],
    };
  }

  if (String(page || "").startsWith("user:")) {
    const userId = String(page).slice(5);
    if (!userId) throw fail("unavailable", t("No such page"));
    const [user, tracksRes, playlistsRes] = await Promise.all([
      api<SCUser>(`/users/${encodeURIComponent(userId)}`),
      api<SCCollection<SCTrack>>(`/users/${encodeURIComponent(userId)}/tracks`, {
        query: { limit: 30, linked_partitioning: 1 },
      }).catch(() => ({ collection: [] as SCTrack[] })),
      api<SCCollection<SCPlaylist>>(
        `/users/${encodeURIComponent(userId)}/playlists`,
        { query: { limit: 24, linked_partitioning: 1 } },
      ).catch(() => ({ collection: [] as SCPlaylist[] })),
    ]);

    const sections: Section[] = [];
    const collection = playlistsRes.collection || [];
    const showsList = collection
      .filter((item) => isPodcastPlaylist(item))
      .map((item) => toShow(item));
    const playlistsList = collection
      .filter((item) => !item.is_album && !isPodcastPlaylist(item))
      .map((item) => toPlaylist(item));
    const albumsList = collection
      .filter((item) => item.is_album)
      .map((item) => toAlbum(item));
    const tracksList = (tracksRes.collection || [])
      .map((track) => toTrack(track))
      .filter((track): track is Track => track !== null);

    if (showsList.length) sections.push({ title: t("Podcasts"), shows: showsList });
    if (playlistsList.length) {
      sections.push({ title: t("Playlists"), playlists: playlistsList });
    }
    if (albumsList.length) sections.push({ title: t("Albums"), albums: albumsList });
    if (tracksList.length) sections.push({ title: t("Tracks"), tracks: tracksList });

    return {
      title: user.username || user.full_name || "",
      imageUrl: image(user.avatar_url),
      description: String(user.description || ""),
      sections,
    };
  }

  if (page === "me") {
    requireToken();
    const me = await meNow();
    const [profile, playlistsRes, likesRes] = await Promise.allSettled([
      api<SCUser>(`/users/${me.id}`),
      api<SCCollection<SCPlaylist>>(`/users/${me.id}/playlists`, {
        query: { limit: 24, linked_partitioning: 1 },
      }),
      api<SCCollection<SCLikeItem>>(`/users/${me.id}/track_likes`, {
        query: { limit: 12, linked_partitioning: 1 },
      }),
    ]);

    const sections: Section[] = [];

    if (playlistsRes.status === "fulfilled") {
      const mine = (playlistsRes.value.collection || [])
        .filter((playlist) => !playlist.is_album)
        .map((playlist) => toPlaylist(playlist, { mine: true }));
      if (mine.length) {
        sections.push({ title: t("Your Playlists"), playlists: mine });
      }
    }

    if (likesRes.status === "fulfilled") {
      const tracks = (likesRes.value.collection || [])
        .map((item) => toTrack(item.track))
        .filter((track): track is Track => track !== null);
      if (tracks.length) {
        sections.push({ title: t("Liked Tracks"), tracks, morePage: "liked" });
      }
    }

    if (profile.status === "fulfilled") {
      const tracks = await api<SCCollection<SCTrack>>(
        `/users/${me.id}/tracks`,
        { query: { limit: 20, linked_partitioning: 1 } },
      )
        .then((response) =>
          (response.collection || [])
            .map((track) => toTrack(track))
            .filter((track): track is Track => track !== null),
        )
        .catch(() => [] as Track[]);
      if (tracks.length) sections.push({ title: t("Your Tracks"), tracks });
    }

    return { title: me.name, imageUrl: me.imageUrl, sections };
  }

  if (page === "recent") {
    const tracks = await recent();
    return {
      title: t("Recently Played"),
      sections: [
        { title: t("Recently Played"), tracks, empty: t("Nothing played yet") },
      ],
    };
  }

  throw fail("unavailable", t("No such page"));
}
