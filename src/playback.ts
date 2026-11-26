// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { api } from "./api.js";
import { request } from "./http.js";
import { rawTrack } from "./models.js";
import type {
  HelperRegisterResponse,
  SCMediaResponse,
  SCTrack,
  SCTranscoding,
} from "./soundcloud-types.js";
import type { SpawnedProcess, Stream, StreamParams } from "./types.js";
import { fail, isPluginError, t } from "./utils.js";

let helperProc: SpawnedProcess | null = null;
let helperPort = 0;
let helperStarting: Promise<number> | null = null;
let helperMissing = false;

function helperCandidates(): string[] {
  const ext = host.platform === "windows" ? ".exe" : "";
  const list = [`bin/hls-helper${ext}`];
  if (host.platform && host.arch) {
    list.unshift(`bin/hls-helper-${host.platform}-${host.arch}${ext}`);
  }
  return list;
}

async function readLineWithTimeout(
  proc: SpawnedProcess,
  ms: number,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      proc.readLine(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("helper startup timeout")), ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function startHelper(): Promise<number> {
  if (helperPort) return helperPort;
  if (helperMissing) return 0;
  if (helperStarting) return helperStarting;

  helperStarting = (async () => {
    for (const path of helperCandidates()) {
      let proc: SpawnedProcess | null = null;
      try {
        proc = host.spawn(path, []);
        const line = await readLineWithTimeout(proc, 5000);
        if (!line) {
          try {
            proc.kill();
          } catch {
            // already exited
          }
          continue;
        }
        const info = JSON.parse(line) as { port?: number };
        const port = Number(info && info.port);
        if (!Number.isInteger(port) || port <= 0) {
          try {
            proc.kill();
          } catch {
            // ignore
          }
          continue;
        }
        helperProc = proc;
        helperPort = port;
        proc.wait().then((code) => {
          if (helperProc === proc) {
            helperProc = null;
            // On Windows, bin/hls-helper.exe hands off to a staged temp worker
            // and exits 0 so the plugin directory is never locked during updates.
            // Keep helperPort alive; serveWithHelper retries if the worker idles out.
            if (host.platform !== "windows" || code !== 0) {
              helperPort = 0;
            }
          }
        });
        return port;
      } catch (error) {
        if (proc) {
          try {
            proc.kill();
          } catch {
            // ignore
          }
        }
        if (error instanceof Error && /allowed/.test(error.message)) {
          throw fail(
            "setup",
            t("Allow SoundCloud to start programs in its settings"),
          );
        }
      }
    }
    helperMissing = true;
    return 0;
  })().finally(() => {
    helperStarting = null;
  });

  return helperStarting;
}

async function serveWithHelper(
  playlist: string,
): Promise<{ url: string; type: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const port = await startHelper();
    if (!port) {
      throw fail(
        "setup",
        t(
          "SoundGo's built-in HLS helper is missing: reinstall the platform release ZIP",
        ),
      );
    }

    try {
      const response = await request<HelperRegisterResponse>(
        `http://127.0.0.1:${port}/register`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: playlist }),
        },
      );
      if (response.status === 200 && response.data && response.data.url) {
        return {
          url: response.data.url,
          type: response.data.type || "aac",
        };
      }
      const reason =
        (response.data && response.data.error) ||
        t("SoundCloud did not give out a stream for this track");
      throw fail("unavailable", String(reason));
    } catch (error) {
      if (isPluginError(error)) throw error;
      // Helper may have exited; reset and retry spawning once.
      if (helperProc) {
        try {
          helperProc.kill();
        } catch {
          // ignore
        }
      }
      helperProc = null;
      helperPort = 0;
    }
  }
  throw new Error(t("The audio did not start"));
}

function pickTranscoding(track: SCTrack): SCTranscoding | null {
  const transcodings = (track.media && track.media.transcodings) || [];
  const usable = transcodings.filter((item) => {
    const protocol = item.format && item.format.protocol;
    return protocol === "hls" || protocol === "progressive";
  });

  const rank = (item: SCTranscoding): number => {
    if (item.preset === "aac_160k") return 0;
    if (item.preset === "aac_96k") return 1;
    if (item.preset === "mp3_128") return 2;
    return 3;
  };

  usable.sort((a, b) => rank(a) - rank(b));
  return usable[0] || null;
}

async function resolveMedia(
  track: SCTrack,
  transcoding: SCTranscoding,
): Promise<string> {
  const response = await api<SCMediaResponse>(transcoding.url, {
    query: { track_authorization: track.track_authorization || "" },
  });
  if (!response || !response.url) {
    throw fail(
      "unavailable",
      t("SoundCloud did not give out a stream for this track"),
    );
  }
  return response.url;
}

export async function stream({ id, quality }: StreamParams): Promise<Stream> {
  const track = await rawTrack(id);
  const transcoding = pickTranscoding(track);

  if (!transcoding) {
    throw fail(
      "unavailable",
      t(
        "This track is encrypted with DRM, so SoundCloud will not let a plugin play it",
      ),
    );
  }

  const media = await resolveMedia(track, transcoding);
  const protocol = transcoding.format && transcoding.format.protocol;

  if (protocol === "progressive") {
    const mime = (transcoding.format && transcoding.format.mime_type) || "";
    const type = mime.includes("mpeg")
      ? "mp3"
      : mime.includes("mp4")
        ? "m4a"
        : "mp3";
    return { url: media, type, quality: quality || "high" };
  }

  const relayed = await serveWithHelper(media);
  const presetBitRate =
    transcoding.preset === "aac_160k"
      ? 160000
      : transcoding.preset === "aac_96k"
        ? 96000
        : transcoding.preset === "mp3_128"
          ? 128000
          : undefined;
  return {
    url: relayed.url,
    type: relayed.type,
    quality: quality === "standard" ? "standard" : "high",
    ...(presetBitRate ? { bitRate: presetBitRate } : {}),
  };
}
