// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { scheduleRefresh } from "./session.js";

// Resume proactive background refresh when the plugin loads with a saved session.
scheduleRefresh();

export { account, setSetting, signIn, signOut } from "./auth.js";
export { browse, home } from "./browse.js";
export {
  album,
  artist,
  followArtist,
  saveAlbum,
  savedAlbums,
} from "./catalog.js";
export { comments, postComment } from "./comments.js";
export { lyrics } from "./lyrics.js";
export { stream } from "./playback.js";
export {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  isLiked,
  like,
  likeEpisode,
  liked,
  movePlaylistTrack,
  playlist,
  playlists,
  removeFromPlaylist,
  renamePlaylist,
  savePlaylist,
} from "./playlists.js";
export { show, shows, subscribeShow } from "./podcasts.js";
export { played, recent } from "./recent.js";
export { search, suggest } from "./search.js";
