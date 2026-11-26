// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { api, normalizeImage } from "./api.js";
import { PAGE, TRACK_TTL } from "./constants.js";
import type {
  SCCollection,
  SCComment,
  SCPlaylist,
  SCPlaylistTrackEntry,
  SCTrack,
  SCUser,
} from "./soundcloud-types.js";
import type { Account, Album, Artist, Comment, Playlist, Show, Track } from "./types.js";
import { dedupe, t } from "./utils.js";

export { normalizeImage as image };

export function trackImage(track: SCTrack): string {
  return normalizeImage(
    track.artwork_url || (track.user && track.user.avatar_url),
  );
}

export function toArtist(
  user: SCUser | undefined,
  options: { following?: boolean } = {},
): Artist {
  if (!user) return { id: "", name: "" };
  const result: Artist = {
    id: String(user.id !== undefined ? user.id : user.user_id || ""),
    name: user.username || user.full_name || "",
    imageUrl: normalizeImage(user.avatar_url),
  };
  if (options.following !== undefined) result.following = !!options.following;
  return result;
}

// A track is playable when SoundCloud offers a stream the app can use: plain
// HLS (through bin/hls-helper) or an old progressive file. Encrypted HLS is DRM.
export function playable(track: SCTrack | undefined): boolean {
  if (!track || track.streamable === false) return false;
  if (track.policy === "BLOCK") return false;
  const protocols = (
    track.media && track.media.transcodings ? track.media.transcodings : []
  )
    .map((item) => (item.format ? item.format.protocol || "" : ""))
    .filter(Boolean);
  if (!protocols.length) return true;
  return protocols.some(
    (protocol) => protocol === "hls" || protocol === "progressive",
  );
}

export function toTrack(
  track: SCTrack | undefined,
  context?: SCPlaylist,
): Track | null {
  if (!track || !track.id) return null;
  const artists = [toArtist(track.user)];
  let album: Album;

  if (context) {
    album = {
      id: String(context.id),
      name: context.title || "",
      imageUrl:
        trackImage(track) ||
        normalizeImage(
          context.artwork_url || (context.user && context.user.avatar_url),
        ),
      artists: [toArtist(context.user)],
    };
  } else {
    const metadata = track.publisher_metadata || {};
    album = {
      id: "track:" + track.id,
      name: metadata.album_title || t("Single"),
      imageUrl: trackImage(track),
      artists,
      released: String(track.release_date || track.display_date || "").slice(
        0,
        10,
      ),
    };
  }

  return {
    id: String(track.id),
    name: track.title || "",
    artists,
    album,
    duration: Number(track.duration) || 0,
    url: track.permalink_url || "",
    unavailable: !playable(track),
  };
}

export function toAlbum(
  playlist: SCPlaylist,
  options: { saved?: boolean } = {},
): Album {
  const result: Album = {
    id: String(playlist.id),
    name: playlist.title || "",
    imageUrl: normalizeImage(
      playlist.artwork_url || (playlist.user && playlist.user.avatar_url),
    ),
    artists: [toArtist(playlist.user)],
    released: String(
      playlist.release_date || playlist.display_date || "",
    ).slice(0, 10),
  };
  if (options.saved !== undefined) result.saved = !!options.saved;
  return result;
}

export function toPlaylist(
  playlist: SCPlaylist,
  options: { mine?: boolean; saved?: boolean } = {},
): Playlist {
  return {
    id: String(playlist.id),
    name: playlist.title || "",
    imageUrl: normalizeImage(
      playlist.artwork_url || (playlist.user && playlist.user.avatar_url),
    ),
    description: playlist.description || "",
    owner: playlist.user ? playlist.user.username || "" : "",
    trackCount: Number(playlist.track_count || 0),
    mine: !!options.mine,
    saved: !!options.saved,
  };
}

export function toComment(
  item: SCComment | undefined,
  fallbackUser?: Account | SCUser | null,
): Comment | null {
  if (!item || item.id === undefined || item.id === null) return null;
  const user: (SCUser & Partial<Account>) = (item.user || fallbackUser || {}) as SCUser & Partial<Account>;
  const parsedTime = item.created_at ? Date.parse(item.created_at) : 0;
  return {
    id: String(item.id),
    author: user.username || user.full_name || user.name || t("Unknown"),
    avatarUrl: normalizeImage(user.avatar_url || user.imageUrl),
    text: String(item.body || ""),
    time: Number.isFinite(parsedTime) && parsedTime > 0 ? parsedTime : 0,
  };
}

const PODCAST_HINT_RE =
  /\b(podcasts?|episodes?|audiobooks?|storytelling|talk\s+show|radio\s+show|spoken\s+word)\b|播客|电台节目/i;

export function isPodcastPlaylist(playlist: SCPlaylist | undefined): boolean {
  if (!playlist || playlist.is_album) return false;
  const fields = [
    playlist.title,
    playlist.genre,
    playlist.tag_list,
    playlist.description,
  ]
    .filter(Boolean)
    .join(" ");
  return PODCAST_HINT_RE.test(fields);
}

export function toShow(
  playlist: SCPlaylist,
  options: { subscribed?: boolean } = {},
): Show {
  const publisher =
    (playlist.user && (playlist.user.username || playlist.user.full_name)) || "";
  const publisherId =
    playlist.user && playlist.user.id !== undefined
      ? String(playlist.user.id)
      : "";
  const result: Show = {
    id: String(playlist.id),
    name: playlist.title || "",
    imageUrl: normalizeImage(
      playlist.artwork_url || (playlist.user && playlist.user.avatar_url),
    ),
    description: String(playlist.description || ""),
    publisher,
    ...(publisherId ? { publisherPage: `user:${publisherId}` } : {}),
    episodeCount: Number(
      playlist.track_count ||
        (Array.isArray(playlist.tracks) ? playlist.tracks.length : 0) ||
        0,
    ),
  };
  if (options.subscribed !== undefined) result.subscribed = !!options.subscribed;
  return result;
}

export function toEpisode(track: SCTrack, show: SCPlaylist): Track | null {
  const base = toTrack(track, show);
  if (!base) return null;
  return {
    ...base,
    showId: String(show.id),
    description: String(track.description || ""),
    published: String(
      track.release_date || track.display_date || track.created_at || "",
    ).slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Track cache & playlist hydration

interface CachedRawTrack {
  data: SCTrack;
  at: number;
}

export const rawTracks = new Map<string, CachedRawTrack>();

export async function rawTrack(id: string | number): Promise<SCTrack> {
  const key = String(id);
  const cached = rawTracks.get(key);
  if (cached && Date.now() - cached.at < TRACK_TTL) return cached.data;
  const data = await api<SCTrack>(`/tracks/${encodeURIComponent(key)}`);
  rawTracks.set(key, { data, at: Date.now() });
  return data;
}

export async function trackById(id: string | number): Promise<Track | null> {
  return toTrack(await rawTrack(id));
}

// A playlist only carries full tracks for its first few entries; the rest come
// as `{id, kind, policy}` stubs. The batch endpoint fills them in, so the app
// never gets a row without a title.
export async function hydrateTracks(
  entries: Array<SCTrack | SCPlaylistTrackEntry>,
): Promise<Array<SCTrack | null>> {
  const missing: string[] = [];
  for (const track of entries) {
    if (!track || !track.id) continue;
    if (!track.title || !track.user) missing.push(String(track.id));
  }

  const unique = [...new Set(missing)];
  const found = new Map<string, SCTrack>();

  for (let at = 0; at < unique.length; at += 50) {
    const ids = unique.slice(at, at + 50);
    try {
      const data = await api<SCTrack[]>("/tracks", {
        query: { ids: ids.join(",") },
      });
      if (Array.isArray(data)) {
        for (const track of data) {
          if (track && track.id) {
            found.set(String(track.id), track);
            rawTracks.set(String(track.id), { data: track, at: Date.now() });
          }
        }
      }
    } catch {
      // A batch that fails leaves its entries as they came.
    }
  }

  return entries.map((track) => {
    if (!track || !track.id) return null;
    if (track.title && track.user) return track as SCTrack;
    return found.get(String(track.id)) || null;
  });
}

export async function playlistTracks(playlist: SCPlaylist): Promise<Track[]> {
  const entries = (playlist.tracks || [])
    .map((item) => ("track" in item && item.track ? item.track : item))
    .filter((track): track is SCTrack | SCPlaylistTrackEntry => !!(track && track.id));
  const full = await hydrateTracks(entries);
  return full
    .filter((track): track is SCTrack => !!(track && track.title))
    .map((track) => toTrack(track, playlist))
    .filter((track): track is Track => track !== null);
}

export async function playlistPage(
  playlist: SCPlaylist,
  options: { mine?: boolean; saved?: boolean } = {},
): Promise<Playlist> {
  const result = toPlaylist(playlist, options);
  result.tracks = await playlistTracks(playlist);
  result.trackCount = result.tracks.length || result.trackCount;
  return result;
}

export function collectTracks(
  value: unknown,
  out: SCTrack[] = [],
  seen = new Set<string>(),
  depth = 0,
): SCTrack[] {
  if (depth > 8 || !value || typeof value !== "object") return out;

  if (Array.isArray(value)) {
    for (const item of value) collectTracks(item, out, seen, depth + 1);
    return out;
  }

  const record = value as Record<string, unknown>;
  if (
    record.kind === "track" &&
    record.id &&
    record.title &&
    !seen.has(String(record.id))
  ) {
    seen.add(String(record.id));
    out.push(record as SCTrack);
  }

  for (const key of [
    "track",
    "origin",
    "playlist",
    "items",
    "collection",
    "tracks",
    "data",
    "activities",
  ]) {
    if (record[key]) collectTracks(record[key], out, seen, depth + 1);
  }

  return out;
}

export function tracksIn(response: unknown): Track[] {
  return dedupe(
    collectTracks(response)
      .map((track) => toTrack(track))
      .filter((track): track is Track => track !== null),
  );
}

export function hasMore(
  response: SCCollection<unknown> | undefined | null,
  count: number,
): boolean {
  if (!response) return false;
  if (response.next_href !== undefined) return !!response.next_href;
  return count >= PAGE;
}
