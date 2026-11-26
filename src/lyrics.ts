// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

// Lyrics: SoundCloud has none, so LRCLIB is asked by title, artist and length.

import { LRCLIB, PLUGIN_VERSION } from "./constants.js";
import { request } from "./http.js";
import { rawTrack } from "./models.js";
import type { LrcLibMatch, SCTrack } from "./soundcloud-types.js";
import type { ByID, Lyrics } from "./types.js";

const lyricCache = new Map<string, Lyrics>();

async function lrclib<T>(path: string): Promise<T | null> {
  const response = await request<T>(LRCLIB + path, {
    headers: {
      "user-agent": `mygo-soundcloud/${PLUGIN_VERSION} (MyGo Music plugin)`,
    },
  });
  if (response.status !== 200) return null;
  return response.data;
}

function spreadLrc(plain: string, seconds: number): string {
  const lines = String(plain)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const step = (seconds * 1000) / (lines.length + 1);
  return lines
    .map((line, index) => {
      const at = Math.round(step * (index + 1));
      const minutes = String(Math.floor(at / 60000)).padStart(2, "0");
      const rest = String(Math.floor((at % 60000) / 1000)).padStart(2, "0");
      const hundredths = String(Math.floor((at % 1000) / 10)).padStart(2, "0");
      return `[${minutes}:${rest}.${hundredths}]${line}`;
    })
    .join("\n");
}

function lyricsFrom(found: LrcLibMatch | null, seconds: number): Lyrics | null {
  if (!found) return null;
  if (found.syncedLyrics) return { lrc: found.syncedLyrics };
  if (found.plainLyrics) return { lrc: spreadLrc(found.plainLyrics, seconds) };
  return null;
}

function normalizeName(text: string | undefined): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Uploaders often put their own name, with "official" or "VEVO" on it, where
// the artist belongs. The publisher metadata is better when it is there.
function cleanUploader(name: string): string {
  return String(name || "")
    .replace(/\b(official|vevo|music|records|recordings|tv|hq|audio)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lyricNames(track: SCTrack): {
  title: string;
  artists: string[];
  seconds: number;
} {
  const metadata = track.publisher_metadata || {};
  const uploader = (track.user && track.user.username) || "";
  let title = String(track.title || "").trim();
  let artist = String(metadata.artist || "").trim();

  const split = title.match(/^(.{2,60}?)\s+-\s+(.{2,140})$/);
  if (!artist && split) {
    artist = split[1].trim();
    title = split[2].trim();
  }

  title = title
    .replace(/\s*[\(\[](?:feat\.|ft\.|featuring|with)[^\)\]]*[\)\]]/gi, "")
    .replace(/\s+(?:official\s+)?(?:video|audio|lyrics?|visuali[sz]er)\b/gi, "")
    .trim();

  const artists = [artist, metadata.artist, uploader, cleanUploader(uploader)]
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .filter((name, index, all) => all.indexOf(name) === index);

  return {
    title,
    artists,
    seconds: Math.round((Number(track.duration) || 0) / 1000),
  };
}

// The closest result whose name holds the title, with the length as a tiebreak.
// A SoundCloud preview is shorter than the song, so the length only counts when
// the track is a real one.
function bestLyrics(
  list: LrcLibMatch[],
  title: string,
  seconds: number,
): LrcLibMatch | null {
  const wanted = normalizeName(title);
  const scored: Array<{ item: LrcLibMatch; score: number }> = [];

  for (const item of list || []) {
    if (!item.syncedLyrics && !item.plainLyrics) continue;
    const name = normalizeName(item.trackName);
    const gap = seconds >= 60 ? Math.abs((item.duration || 0) - seconds) : 0;
    scored.push({
      item,
      score: (wanted && name.includes(wanted) ? 1000 : 0) - gap,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].item : null;
}

export async function lyrics({ id }: ByID): Promise<Lyrics> {
  const key = String(id);
  const existing = lyricCache.get(key);
  if (existing) return existing;

  let result: Lyrics = {};
  try {
    const track = await rawTrack(key);
    const { title, artists, seconds } = lyricNames(track);
    let found: Lyrics | null = null;

    for (const artist of artists) {
      const exact = await lrclib<LrcLibMatch>(
        `/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(
          title,
        )}&duration=${seconds}`,
      );
      found = lyricsFrom(exact, seconds);
      if (found) break;
    }

    if (!found) {
      const candidates: LrcLibMatch[] = [];

      for (const artist of artists) {
        const list = await lrclib<LrcLibMatch[]>(
          `/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(
            title,
          )}`,
        );
        if (Array.isArray(list)) candidates.push(...list);
      }

      const query = [artists[0] || "", title].filter(Boolean).join(" ").trim();
      if (query) {
        const list = await lrclib<LrcLibMatch[]>(
          `/api/search?q=${encodeURIComponent(query)}`,
        );
        if (Array.isArray(list)) candidates.push(...list);
      }

      const best = bestLyrics(candidates, title, seconds);
      if (best) found = lyricsFrom(best, seconds);
    }

    if (found) result = found;
  } catch {
    result = {};
  }

  lyricCache.set(key, result);
  return result;
}
