// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { api } from "./api.js";
import { HISTORY_MAX } from "./constants.js";
import { collectTracks, trackById } from "./models.js";
import { hasSession } from "./session.js";
import type { ByID, Track } from "./types.js";
import { load, save } from "./utils.js";

export async function recent(): Promise<Track[]> {
  const local = load<Array<string | number>>("history", []);
  let remote: string[] = [];

  if (hasSession()) {
    try {
      const response = await api("/me/play-history/tracks", {
        query: { limit: 50, linked_partitioning: 1 },
      });
      remote = collectTracks(response).map((track) => String(track.id));
    } catch {
      // The machine's own history still answers.
    }
  }

  const ids: string[] = [];
  for (const item of remote.concat(local.map((id) => String(id)))) {
    if (!item || ids.includes(item)) continue;
    ids.push(item);
  }

  const tracks = await Promise.all(
    ids.slice(0, 30).map((id) => trackById(id).catch(() => null)),
  );
  return tracks.filter((track): track is Track => track !== null);
}

export function played({ id }: ByID): void {
  if (!id) return;
  const key = String(id);
  const history = load<Array<string | number>>("history", []).filter(
    (item) => String(item) !== key,
  );
  history.unshift(key);
  save("history", history.slice(0, HISTORY_MAX));
}
