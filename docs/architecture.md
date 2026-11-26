# Architecture

## Purpose

SoundGo brings SoundCloud into MyGo Music with two core responsibilities:

- **Catalog, library, and account actions** — home, charts, search (tracks, albums, artists, playlists, podcasts), artist/album/playlist/podcast pages, personal stream, liked tracks/episodes, saved playlists/albums, following artists, playlist CRUD & track reordering, comments, and listening history.
- **Playback** — resolving SoundCloud's HLS streams and relaying them through a bundled pure-Go HLS helper (`bin/hls-helper`) onto `127.0.0.1` without lossy re-encoding or external `ffmpeg`.

Comment likes (not supported by SoundCloud's API) and remote playback are not implemented.

## Project layout

The plugin source is written in strict TypeScript under `src/` and bundled with `Bun.build()` into a single self-contained ES module (`dist/plugin/index.js`) for MyGo Music's `moejs` runtime:

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Public MyGo Music plugin entry point and startup refresh trigger |
| `src/types.ts` | MyGo Music host global & domain TypeScript interfaces |
| `src/soundcloud-types.ts` | Raw SoundCloud `api-v2` JSON response shapes |
| `src/constants.ts` | Endpoints, user agents, TTLs, and fallback constants |
| `src/utils.ts` | Error helpers, storage wrappers, pure-JS UTF-8/base64/JWT/cookie parsers, and follow signature generator |
| `src/http.ts` | `fetch` wrapper, URL builder, `client_id` & follow-secret scraping |
| `src/session.ts` | Token persistence, single-flight proactive/reactive OAuth refresh, and session-scoped ID caches |
| `src/api.ts` | Authenticated `api()` client with retry/refresh, `/me` cache, and paginated ID-set loaders |
| `src/auth.ts` | `signIn` (built-in `host.webSignIn` + manual cookie fallback), `signOut`, `account`, `setSetting` |
| `src/models.ts` | Mappers from SoundCloud objects to MyGo Music models, track cache, and batch playlist hydration |
| `src/browse.ts` | `home` and `browse` (`charts`, `following`, `me`, `recent`, `user:<id>`) |
| `src/search.ts` | `search` (`tracks`, `albums`, `artists`, `playlists`, `shows`) and `suggest` |
| `src/catalog.ts` | `album`, `artist`, `followArtist`, `saveAlbum`, `savedAlbums` |
| `src/playlists.ts` | `playlists`, `playlist`, `liked`, `isLiked`, `like`, `likeEpisode`, `savePlaylist`, and playlist CRUD/reordering |
| `src/comments.ts` | `comments` and `postComment` |
| `src/podcasts.ts` | `shows`, `show`, `subscribeShow`, and per-account subscription persistence |
| `src/recent.ts` | `recent` (remote play history + local fallback) and `played` |
| `src/lyrics.ts` | LRCLIB lookup and plain-lyric timestamp spreading |
| `src/playback.ts` | Bundled `bin/hls-helper` lifecycle, transcoding ranking, and `stream` |
| `helper/` | Zero-dependency Go HLS-to-HTTP relay (fMP4 AAC-LC -> ADTS, MP3, MPEG-TS) |
| `scripts/` | Build (`build.ts`), metadata validation (`metadata.ts`), version bump (`version.ts`), live smoke test (`smoke.ts`) |
| `tests/` | Contract tests against the built `dist/plugin/index.js` bundle and build tooling tests |

## Runtime constraints & verification

MyGo Music executes plugins in `moejs` (single ES module, 30s call timeout, 256 MB memory limit, no Node/Bun globals, no `atob`/`btoa`/`unescape`/`Buffer`).

- `tsconfig.json` compiles `src/**/*.ts` with `"strict": true` and `"types": []`, preventing Node/Bun globals from leaking into plugin source.
- `bun run build` bundles `src/index.ts` into `dist/plugin/index.js` and asserts:
  1. Single self-contained ESM output with zero `import` statements.
  2. Exact export match against `tests/fixtures/exports.json`.
  3. Zero references to banned runtime globals (`atob`, `btoa`, `unescape`, `Buffer`, `process`, `require`).
  4. All `t("...")` and `plugin.json` navigation keys exist in both `locales/en.json` and `locales/zh-CN.json`.
- `bun run check` runs `tsc` on both `tsconfig.json` and `tsconfig.tools.json`, builds `dist/plugin/index.js`, and runs the full test suite against the built bundle.

## Permissions

Declared in `plugin.json`:

- **Network:** `soundcloud.com`, `*.soundcloud.com`, `api-v2.soundcloud.com`, `api-auth.soundcloud.com`, `secure.soundcloud.com`, `*.sndcdn.com`, `*.soundcloud.cloud`, `lrclib.net`
- **Process:** `bin/hls-helper*`

## Host compatibility (`host.webFetch`)

SoundCloud protects `api-v2.soundcloud.com` write mutations (`PUT`/`POST`/`DELETE`) with DataDome. This plugin routes non-GET API calls through the custom `host.webFetch` bridge in [GooGuJiang/mygo-music](https://github.com/GooGuJiang/mygo-music) (not supported by official upstream MyGo Music), which executes requests inside a real WebView page on `https://soundcloud.com` and displays the verification window inside a same-origin iframe when SoundCloud requests a human check, hiding the window automatically once completed.

## Authentication and token refresh

1. `signIn()` opens `https://secure.soundcloud.com/web-auth` with `app_id=3152`, `stand_alone=true`, and `redirect_uri=https://m.soundcloud.com/signin/callback` via `host.webSignIn` (`cookiesOf: "https://soundcloud.com/n/api/refresh-token"`), capturing both `oauth_token` and `HttpOnly` `oauth_refresh_token` without popup windows.
2. When `oauth_refresh_token` is present, `session.ts` refreshes tokens proactively (5 minutes before JWT expiry) and reactively on `401` (after ruling out a stale `client_id`), using a single-flight promise lock so single-use refresh tokens are never submitted concurrently.

## Playback pipeline

```
stream({ id })
  -> GET /tracks/{id}
  -> choose transcoding (aac_160k -> aac_96k -> mp3_128 -> progressive)
  -> GET transcoding.url?client_id=…&track_authorization=…
  -> signed HLS playlist.m3u8
  -> POST http://127.0.0.1:<helper-port>/register { url }
  -> { url: "http://127.0.0.1:<helper-port>/stream/<id>", type: "aac" | "mp3" }
```

## Development commands

```sh
bun install          # install TypeScript + @types/bun
bun run build        # bundle src/index.ts -> dist/plugin/index.js & validate
bun run typecheck    # strict tsc check on src/, scripts/, tests/
bun run test         # build + run plugin & tooling tests
bun run check        # typecheck + build + all tests
bun run smoke        # live smoke test against public SoundCloud API
```
