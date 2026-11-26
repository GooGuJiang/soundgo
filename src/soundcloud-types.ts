// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

export interface SCUser {
  id?: number | string;
  user_id?: number | string;
  username?: string;
  full_name?: string;
  avatar_url?: string;
  description?: string;
}

export interface SCTranscodingFormat {
  protocol?: string;
  mime_type?: string;
}

export interface SCTranscoding {
  url: string;
  preset?: string;
  format?: SCTranscodingFormat;
}

export interface SCPublisherMetadata {
  artist?: string;
  album_title?: string;
}

export interface SCTrack {
  id?: number | string;
  kind?: string;
  title?: string;
  duration?: number;
  permalink_url?: string;
  artwork_url?: string;
  description?: string;
  release_date?: string;
  display_date?: string;
  created_at?: string;
  streamable?: boolean;
  policy?: string;
  track_authorization?: string;
  comment_count?: number;
  user?: SCUser;
  publisher_metadata?: SCPublisherMetadata;
  media?: {
    transcodings?: SCTranscoding[];
  };
}

export interface SCPlaylistTrackEntry {
  id?: number | string;
  kind?: string;
  title?: string;
  user?: SCUser;
  track?: SCTrack;
}

export interface SCPlaylist {
  id?: number | string;
  title?: string;
  artwork_url?: string;
  description?: string;
  genre?: string;
  tag_list?: string;
  release_date?: string;
  display_date?: string;
  track_count?: number;
  is_album?: boolean;
  user?: SCUser;
  tracks?: Array<SCTrack | SCPlaylistTrackEntry>;
}

export interface SCComment {
  id?: number | string;
  body?: string;
  created_at?: string;
  timestamp?: number;
  user?: SCUser;
}

export interface SCCollection<T> {
  collection?: T[];
  next_href?: string | null;
}

export interface SCLikeItem {
  track?: SCTrack;
  playlist?: SCPlaylist;
}

export interface SCChartItem {
  track?: SCTrack;
}

export interface SCSelection {
  items?: SCCollection<SCPlaylist>;
}

export interface SCSearchQueryItem {
  output?: string;
  query?: string;
}

export interface SCTokenRefreshResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface SCMediaResponse {
  url?: string;
}

export interface SCErrorBody {
  errors?: unknown[];
  message?: string;
}

export interface LrcLibMatch {
  trackName?: string;
  duration?: number;
  syncedLyrics?: string;
  plainLyrics?: string;
}

export interface HelperRegisterResponse {
  id?: string;
  url?: string;
  type?: string;
  error?: string;
}
