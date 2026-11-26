// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

export type PluginErrorCode = "signIn" | "setup" | "unavailable" | "unsupported";

export interface PluginError extends Error {
  code?: PluginErrorCode;
}

export interface Account {
  id: string;
  name: string;
  imageUrl?: string;
  page?: string;
}

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  following?: boolean;
}

export interface Album {
  id: string;
  name: string;
  imageUrl?: string;
  artists?: Artist[];
  released?: string;
  saved?: boolean;
}

export interface Track {
  id: string;
  name: string;
  artists: Artist[];
  album: Album;
  duration: number;
  url: string;
  unavailable?: boolean;
  showId?: string;
  description?: string;
  published?: string;
}

export interface Playlist {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
  owner: string;
  trackCount: number;
  mine: boolean;
  saved: boolean;
  fixed?: boolean;
  tracks?: Track[];
}

export interface Show {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
  publisher: string;
  publisherPage?: string;
  episodeCount: number;
  subscribed?: boolean;
}

export interface ShowPage {
  show: Show;
  episodes: Track[];
  more: boolean;
}

export interface AlbumPage {
  album: Album;
  tracks: Track[];
}

export interface AlbumList {
  albums: Album[];
  more: boolean;
}

export interface ArtistPage {
  artist: Artist;
  tracks: Track[];
  albums: Album[];
}

export interface TrackPage {
  tracks: Track[];
  more: boolean;
}

export interface Comment {
  id: string;
  author: string;
  avatarUrl: string;
  text: string;
  time: number;
  likes?: number;
  liked?: boolean;
}

export interface CommentPage {
  comments: Comment[];
  total?: number;
  more: boolean;
}

export interface Link {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  page: string;
}

export interface Section {
  title?: string;
  pageTitle?: string;
  subtitle?: string;
  tracks?: Track[];
  playlists?: Playlist[];
  albums?: Album[];
  artists?: Artist[];
  shows?: Show[];
  links?: Link[];
  morePage?: string;
  empty?: string;
}

export interface Browse {
  title?: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
  sections: Section[];
}

export type SearchKind = "tracks" | "albums" | "artists" | "playlists" | "shows";

export interface SearchResult {
  tracks?: Track[];
  albums?: Album[];
  artists?: Artist[];
  playlists?: Playlist[];
  shows?: Show[];
  more: boolean;
}

export interface Lyrics {
  lrc?: string;
  translation?: string;
}

export interface Stream {
  url: string;
  type: string;
  quality?: string;
  bitRate?: number;
  headers?: Record<string, string>;
}

export interface SpawnedProcess {
  readLine(): Promise<string | null>;
  wait(): Promise<unknown>;
  kill(): void;
  closeStdin?(): void;
  errorOutput?(): string;
}

export interface WebSignInOptions {
  url: string;
  cookiesOf: string;
  until: string[];
  userAgent: string;
}

export interface WebFetchOptions {
  origin: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  userAgent?: string;
}

export interface WebFetchResponse {
  status: number;
  text: string;
}

export interface Host {
  platform?: string;
  arch?: string;
  storage: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    remove(key: string): void;
  };
  setting(key: string): string;
  language(): string;
  t(text: string): string;
  spawn(cmd: string, args: string[]): SpawnedProcess;
  webSignIn?: (options: WebSignInOptions) => Promise<{ cookie?: string } | null>;
  webFetch?: (options: WebFetchOptions) => Promise<WebFetchResponse>;
}

declare global {
  const host: Host;
}

export interface ByID {
  id: string;
}

export interface Toggle extends ByID {
  on: boolean;
}

export interface PageOptions {
  offset?: number;
}

export interface Named {
  name: string;
}

export interface TrackIDs extends ByID {
  trackIds: string[];
}

export interface MoveTrackParams extends ByID {
  from: number;
  to: number;
}

export interface SearchParams extends PageOptions {
  query: string;
  kind: SearchKind;
}

export interface QueryParams {
  query: string;
}

export interface BrowseParams {
  page: string;
}

export interface CommentListParams extends PageOptions {
  trackId: string;
}

export interface PostCommentParams {
  trackId: string;
  text: string;
}

export interface ShowParams extends ByID, PageOptions {}

export interface StreamParams extends ByID {
  quality?: string;
}

export interface SetSettingParams {
  key: string;
  value?: string;
}
