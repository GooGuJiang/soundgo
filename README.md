# SoundGo for MyGo Music

> **Compatibility Notice / 兼容性说明:**  
> This fork is adapted for **[GooGuJiang/mygo-music](https://github.com/GooGuJiang/mygo-music)**, a custom MyGo Music build that exposes `host.webFetch` (browser-backed WebView requests with interactive verification for SoundCloud's DataDome-protected write endpoints). **It is NOT compatible with official upstream MyGo Music** for write actions (liking tracks/episodes, saving playlists/albums, following artists, editing playlists, and posting comments); read-only browsing, playback, viewing comments, and podcasts still work without `host.webFetch`.

Plays SoundCloud in [MyGo Music](https://github.com/GooGuJiang/mygo-music), including the library of a personal account. This repository is a modified fork of [Satyawikananda/SoundGo](https://github.com/satyawikananda/soundgo). It uses SoundCloud's private web API, is not affiliated with or endorsed by SoundCloud, and may stop working at any time.

## Install

Install in [GooGuJiang/mygo-music](https://github.com/GooGuJiang/mygo-music), or add this repository in **Settings > Plugins > +**:

```
https://github.com/GooGuJiang/soundgo
```

Use the platform-specific plugin ZIP attached to a release for manual installation (MyGo Music picks it automatically when installing from GitHub), not GitHub's source ZIP. The minimum supported MyGo Music version is listed in `plugin.json` as `minAppVersion`.

Each release ZIP bundles a lightweight HLS helper (`bin/hls-helper`), so **you do not need to install `ffmpeg`**. In Settings > Plugins, allow SoundGo to start `bin/hls-helper*`.

## Signing in

1. Click **Sign In** in MyGo Music.
2. Sign in to your SoundCloud account in the window that opens (supports email, Google, Apple, and Facebook). Once finished, the window closes automatically and captures both `oauth_token` and `oauth_refresh_token`.

When `oauth_refresh_token` is present, SoundGo automatically rotates the session via `https://secure.soundcloud.com/oauth/token` before expiration and on `401` responses, persisting each new single-use refresh token in plugin storage.

The tokens are kept unencrypted in the plugin's data on this machine and are sent only to SoundCloud. Signing out forgets them. To end the session on SoundCloud's side, sign out in the browser.

The public catalog, search and playback work without signing in.

## What works

- Signed out: Home, charts, search (tracks, albums, artists, playlists, podcasts), artist pages, album, playlist and podcast pages, comments, playback, lyrics.
- Signed in: your stream, recently played, your playlists (create, rename, delete, add/remove/reorder tracks), liking tracks and podcast episodes, saving playlists and albums, following artists, posting comments, subscribing to podcasts, your own tracks, and a personal Home and My Page.
- Not available: liking individual comments (SoundCloud has no comment-like API) and remote playback.

## How it plays

SoundCloud serves most audio as plain HLS (fMP4 AAC-LC segments). The plugin resolves the HLS playlist with the account's session, then its bundled pure-Go helper (`bin/hls-helper`) unwraps the fMP4/MP3/MPEG-TS segments into continuous ADTS AAC or MP3 audio on `127.0.0.1` without lossy re-encoding.

Some tracks, mostly major-label releases, are encrypted with Widevine or PlayReady. No plugin can play those; they are shown as unavailable.

## Lyrics

SoundCloud has no lyrics. The plugin asks [LRCLIB](https://lrclib.net) by title, artist and length, and shows a synced lyric when it finds one. A plain lyric is spread over the track's length.

## Privacy

The plugin talks to `soundcloud.com`, `*.soundcloud.com`, `api-v2.soundcloud.com`, `api-auth.soundcloud.com`, `secure.soundcloud.com`, `*.sndcdn.com`, `*.soundcloud.cloud` and `lrclib.net`. It reads SoundCloud's public pages to find the current web client id, keeps that id, the session tokens, cached track metadata and the local listening history in its data folder, and sends nothing anywhere else.

## Credits

- [Satyawikananda/SoundGo](https://github.com/satyawikananda/soundgo) by Satyawikananda: the original SoundGo plugin that this fork is built upon — thank you for creating SoundGo!
- [MyGo Music](https://github.com/egoist/mygo-music) by egoist: the plugin runtime, its demo plugin, and the data model this plugin follows (adapted fork used here: [GooGuJiang/mygo-music](https://github.com/GooGuJiang/mygo-music)).
- [YouTube Music for MyGo Music](https://github.com/egoist/mygo-music-youtube-music) by egoist: the pattern of serving local audio streams on `127.0.0.1`.
- [LRCLIB](https://lrclib.net) for lyrics.

SoundGo is an independent plugin. It is not affiliated with or endorsed by SoundCloud, MyGo Music, or the projects above.

## License & Notice of Modifications (AGPL-3.0-only)

Licensed under the **GNU Affero General Public License v3.0 only (`AGPL-3.0-only`)**. See [LICENSE](LICENSE).

- **Original Work:** Based on [Satyawikananda/SoundGo](https://github.com/satyawikananda/soundgo) (Copyright © 2026 SoundGo contributors).
- **Modifications (2026, GooGuJiang):** Modularized the plugin into TypeScript (`src/`), added built-in popup-free web sign-in and automatic OAuth refresh-token rotation, replaced `ffmpeg` with a bundled pure-Go HLS helper (`helper/`), added likes/saves/follow/playlist editing/comments/podcasts and `liked()` cursor pagination, and integrated `host.webFetch` for [GooGuJiang/mygo-music](https://github.com/GooGuJiang/mygo-music).
- **Corresponding Source:** The complete source code (TypeScript sources under `src/`, Go HLS helper under `helper/`, and build scripts under `scripts/`) for every bundled Release ZIP is publicly available at [https://github.com/GooGuJiang/soundgo](https://github.com/GooGuJiang/soundgo) under the matching release tag.
