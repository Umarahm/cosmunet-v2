## API guide

High-level reference for calling the Consumet API shipped in this repo.

### Base URL and transport
- Default base: `http://localhost:<PORT>` (PORT from `.env`, defaults to `3000`).
- All routes are `GET`. CORS is open (`origin: *`), so browser requests are allowed.
- Responses are JSON; errors use standard HTTP codes (400 validation, 404 not found, 500 upstream/internal).

### Environment required/optional
- `PORT` – server port (optional).
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TTL` – enable caching; without Redis everything still works but responses won’t be cached.
- `TMDB_KEY` – required for `/meta/tmdb` routes.
- `PROXY` – optional; used for Anilist metadata requests. See `docs/PROXY.md`.
- `NODE_ENV=DEMO` – enables demo gate (sessions via `/apidemo`).

### Common behaviors and constraints
- **Caching:** When Redis is configured, many search/info/watch endpoints are cached (default TTL 1h).
- **Auth:** Most endpoints are public. The Anilist favorites endpoint expects an `Authorization` header.
- **Upstream limits:** Actual streaming/search data comes from upstream providers; respect their rate limits and terms.
- **Validation:** Required params are checked; missing `id`, `episodeId`, `type`, etc. return 400.

### Route map (top-level)
- `/anime/*` – Anime providers: `hianime`, `animepahe`, `animeunity`, `animekai`, `animesaturn`, `kickassanime`.
- `/manga/*` – Manga providers: `mangadex`, `mangahere`, `mangapill`, `managreader`.
- `/movies/*` – Movies/TV providers: `flixhq`, `dramacool`, `goku`, `sflix`, `himovies`.
- `/meta/*` – Metadata/aggregators: `anilist`, `anilist-manga`, `mal`, `tmdb`.
- `/news/ann` – Anime News Network feed and article info.
- `/comics/getcomics` – Comic search/info.
- `/light-novels` and `/books` – Present but currently only welcome stubs.
- `/utils/providers` – Lists providers from `@consumet/extensions` by type.

### Calling patterns (per area)
- **Anime (`/anime/<provider>`):**
  - Typical endpoints: `/:query` (search with optional `page`), `/info?id=...`, `/watch/:episodeId` (stream sources, often with `server` and sometimes `category`), `/servers/:episodeId` (available streaming servers).
  - Hianime adds `genres`, `genre/:genre`, `schedule`, `spotlight`, `search-suggestions/:query`, and several ranking lists (`/top-airing`, `/most-popular`, `/most-favorite`, `/recently-added`, `/top-upcoming`, `/studio/:studio`, etc.).
  - KickAssAnime exports the minimal set: search, info, watch, servers.

- **Manga (`/manga/<provider>`):**
  - Common endpoints: `/:query` (search), `/info` or `/info/:id` (metadata), `/read` or `/chapters/:id` (chapter list/pages).

- **Movies & TV (`/movies/<provider>`):**
  - Common endpoints across providers: `/:query` (search), `/info` (title/episode details), `/watch` (stream sources, with `episodeId`, optional `server`), `/servers` (available servers), plus feeds like `recent-shows`, `recent-movies`, `trending`, `genre/:genre`.

- **Meta (`/meta`):**
  - `/anilist` (uses `PROXY` if set): search, advanced-search, trending/popular, genre, recent episodes, random, servers, episodes, data/info/character/staff, favorites (requires `Authorization` header), watch/streaming via `/watch/:episodeId`.
  - `/anilist-manga`: search, info, read, chapters.
  - `/mal`: search, info.
  - `/tmdb`: search (`/:query`), `info/:id` (requires `type`, optional `provider` to choose a movie provider), `trending` (`type` and `timePeriod`), `watch` (`/watch` or `/watch/:episodeId` with `episodeId`, `id`, optional `provider`, optional `server`).

- **News (`/news/ann`):**
  - `/recent-feeds` (recent articles), `/info` (details for a link).

- **Comics (`/comics/getcomics`):**
  - `/:query` (search), `/info` (metadata). Shortcut `/comics/s` redirects to `getcomics/s`.

- **Utils (`/utils/providers`):**
  - Query `type` must be one of the keys in `PROVIDERS_LIST` (`ANIME`, `MANGA`, `MOVIES`, `META`, etc.). Returns sorted provider descriptors.

### Base URL examples (using curl)
- Search anime on Hianime:  
  `curl "http://localhost:3000/anime/hianime/one%20piece?page=1"`
- Episode sources on Hianime (sub/dub via `category`, optional `server`):  
  `curl "http://localhost:3000/anime/hianime/watch/episode-123?category=sub&server=gogo"`
- Anilist metadata search with optional proxy set in `.env`:  
  `curl "http://localhost:3000/meta/anilist/jujutsu?page=1&perPage=10"`
- TMDB movie info with flixhq as provider:  
  `curl "http://localhost:3000/meta/tmdb/info/603?type=movie&provider=flixhq"`
- List available movie providers:  
  `curl "http://localhost:3000/utils/providers?type=MOVIES"`

### Running locally
1. Create `.env` (see `.env.example`). Set `TMDB_KEY` if you need TMDB endpoints; set `PROXY` if you want Anilist requests proxied.
2. `npm install`
3. `npm run dev` (or `npm start` for production build)
4. Hit `http://localhost:3000/` to verify the welcome message.

### Notes
- Favor small `page` sizes and caching (Redis) if you expect repeated queries.
- For PROXY details, see `docs/PROXY.md`.

