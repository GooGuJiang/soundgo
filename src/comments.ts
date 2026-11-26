// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { api, meNow } from "./api.js";
import { PAGE } from "./constants.js";
import { hasMore, rawTrack, rawTracks, toComment } from "./models.js";
import { requireToken } from "./session.js";
import type { SCCollection, SCComment } from "./soundcloud-types.js";
import type {
  Comment,
  CommentListParams,
  CommentPage,
  PostCommentParams,
} from "./types.js";
import { t } from "./utils.js";

export async function comments({
  trackId,
  offset = 0,
}: CommentListParams): Promise<CommentPage> {
  const key = String(trackId);
  const [response, trackMeta] = await Promise.all([
    api<SCCollection<SCComment>>(
      `/tracks/${encodeURIComponent(key)}/comments`,
      {
        query: {
          sort: "newest",
          limit: PAGE,
          offset,
          linked_partitioning: 1,
          threaded: 0,
        },
      },
    ),
    offset === 0 ? rawTrack(key).catch(() => null) : Promise.resolve(null),
  ]);

  const list = (response.collection || [])
    .map((item) => toComment(item))
    .filter((item): item is Comment => item !== null);
  const total =
    trackMeta && Number.isFinite(Number(trackMeta.comment_count))
      ? Number(trackMeta.comment_count)
      : undefined;

  return {
    comments: list,
    ...(total !== undefined ? { total } : {}),
    more: hasMore(response, list.length),
  };
}

export async function postComment({
  trackId,
  text,
}: PostCommentParams): Promise<Comment | null> {
  requireToken();
  const body = String(text || "").trim();
  if (!body) throw new Error(t("Comment cannot be empty"));
  const key = String(trackId);
  const [created, me] = await Promise.all([
    api<SCComment>(`/tracks/${encodeURIComponent(key)}/comments`, {
      method: "POST",
      form: { body, timestamp: 0 },
    }),
    meNow().catch(() => null),
  ]);

  const cached = rawTracks.get(key);
  if (
    cached &&
    cached.data &&
    Number.isFinite(Number(cached.data.comment_count))
  ) {
    cached.data.comment_count = Number(cached.data.comment_count) + 1;
  }

  return toComment(created, me);
}
