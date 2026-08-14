# Reader

A modern, self-hostable RSS/Atom reader. Import your existing subscriptions from OPML,
read a clean reverse-chronological stream of articles across a three-pane desktop layout,
and keep your subscriptions portable — nothing here locks your data in.

Built for a single user today, with a data model (separate `Feed`/`Subscription`/`User`
tables) that doesn't stand in the way of multi-user support later.

## Features

- OPML import with a preview step (new / duplicate / invalid classification, folder
  reconstruction) and OPML export
- Manual feed subscription with feed discovery from a plain webpage URL
- Folders, per-feed and per-folder unread counts, starring
- RSS 2.0, RSS 0.9x, RSS 1.0/RDF, Atom 1.0, tolerant of malformed real-world feeds
- Deduplication by GUID/Atom id → canonical URL → content hash fallback; re-fetching
  never creates duplicate articles, and edits to an already-seen article update it in
  place without touching your read/starred state
- Sanitized HTML rendering (scripts, event handlers, iframes, `javascript:` URLs stripped)
- Background scheduler with adaptive backoff for failing feeds, conditional HTTP
  (ETag / If-Modified-Since) requests, and SSRF-hardened fetching
- Full-text search (SQLite FTS5) across title/author/content/feed name
- Keyboard shortcuts (`j` `k` `o` `m` `s` `v` `r` `/` `?`), light/dark theme, responsive
  three-pane → single-pane layout
- Optional single-user password login for anything reachable over a network

## Screenshots

Three-pane desktop reader (folders/feeds · article list · article content), collapsing to
a single navigable pane (Feeds → List → Article) on mobile. The article list shows an
unread dot, title, source, relative time, and a short excerpt; the reader pane shows
sanitized article content with mark read/unread, star, and "View Original" controls.

## Architecture

Three subsystems, one codebase (`src/`):

```
feeds/       Ingestion: HTTP fetcher, RSS/Atom/RDF parser, normalizer, discovery,
             scheduler — the only place that knows about feed-format details.
articles/    Library/state: canonical Article queries, dedup helpers, per-user
             read/starred state.
opml/        Import/export: parser, importer (preview + write), exporter.
search/      SQLite FTS5 query layer.
security/    Sanitization, SSRF protection, auth.
jobs/        Refresh orchestration (fetch → parse → normalize → dedupe → store)
             and the background scheduler built on top of it.
db/          Drizzle schema, migrations, sqlite client.
app/         Next.js routes, layouts, and server actions (the service/API layer —
             UI components never call feeds/articles/opml modules directly except
             through src/app/actions.ts).
components/  React UI.
```

The UI never sees RSS/Atom/RDF-specific data — everything is normalized into a single
`Article` shape (`src/feeds/types.ts`) before it reaches the database.

## Technology choices

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript, strict mode | Server Components for data-heavy reads, Server Actions as the mutation/API layer without a separate REST scaffold |
| Database | SQLite via `better-sqlite3` + Drizzle ORM | Simplest architecture that satisfies a single-user self-hosted app; one file, trivial backup, no separate DB process to operate. **Deviation from the spec's Postgres-for-production preference** — documented below |
| Feed parsing | `rss-parser` | Mature, handles RSS 2.0/0.9x/1.0(RDF)/Atom 1.0 and common namespace extensions without hand-rolled XML handling |
| OPML/XML parsing | `fast-xml-parser` | No DTD/external-entity support at all, so XXE is structurally not possible, not just disabled by a flag |
| HTML sanitization | `sanitize-html` | Allowlist-based; strips scripts, event handlers, `javascript:` URLs, iframes |
| HTTP fetching | `undici` (Node's fetch, explicit for custom `Agent`/DNS pinning) | SSRF protection needs a custom `lookup` function at the socket-connect layer, which requires an explicit `Agent` |
| Auth | `iron-session` (encrypted cookie) + a single `ADMIN_PASSWORD` env var | Mature session primitive without building session storage; avoids disproportionate effort on an identity system for one user |
| Search | SQLite FTS5 | Native, zero extra infrastructure, sufficient for a personal-scale library |
| Scheduling | In-process `setInterval` + `p-limit` | No queue system needed for tens to low hundreds of feeds on a single process |
| Testing | Vitest | Fast, native TS/ESM support, good for both unit and lightweight integration tests (real local HTTP servers, real SQLite) |

### Deliberate deviation: SQLite-only, not Postgres

The spec's default preference is Postgres for production with SQLite for local dev. This
build ships SQLite for both, because for the actual target ("I should be able to import
an OPML file and have a dependable reader I'd use every day," self-hosted, single user)
SQLite is fully sufficient and meaningfully simpler to operate: one file to back up, no
separate database process, no connection pooling to reason about. The schema uses
Drizzle, whose core query builder is largely portable; migrating to Postgres later would
mean swapping the driver (`drizzle-orm/better-sqlite3` → `drizzle-orm/node-postgres`),
adjusting the handful of `sql`-templated pragmas/FTS calls in `src/db/client.ts` (Postgres
would use `tsvector`/`GIN` instead of FTS5), and regenerating migrations — not a schema
redesign.

## Local development

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # edit as needed — defaults work for local dev with no auth
npm run dev
```

Open <http://localhost:3000>. On first run you'll land on the setup screen (Import OPML /
Add Feed). Migrations run automatically on startup in dev.

### Environment variables

See [`.env.example`](.env.example) for the full list with defaults and comments. Nothing
is required for local development — the app runs with a fully open (no-login) reader and
a `./data/dev.db` SQLite file by default. For anything reachable over a network, set
`ADMIN_PASSWORD` and `SESSION_SECRET` (see **Authentication** below).

### Database setup & migrations

- Schema lives in [`src/db/schema.ts`](src/db/schema.ts); migrations are generated SQL
  files in `src/db/migrations/`.
- In dev / `next start`, migrations run automatically on process start.
- In production (Docker or otherwise), run them explicitly before starting the server:
  ```bash
  npm run db:migrate
  ```
  (The Docker image's default `CMD` already does this — see **Deployment**.)
- After changing `src/db/schema.ts`, generate a new migration:
  ```bash
  npm run db:generate
  ```

### Authentication

If `ADMIN_PASSWORD` is unset, the app has **no login screen** — convenient for local dev,
unsafe for anything reachable over a network. To enable a single-admin-password gate:

```bash
ADMIN_PASSWORD=a-strong-password
SESSION_SECRET=$(openssl rand -base64 32)
```

Both must be set together; the app can't start the auth flow with only one. Sessions are
encrypted cookies (`iron-session`) — nothing is stored server-side. There's no per-user
account system in v1 (see `src/lib/current-user.ts` — the schema is multi-user-ready but
a single seeded user is used throughout).

## How feed refresh works

`src/jobs/refresh.ts` is the single code path used by the background scheduler, "Refresh
now", and "Refresh all" — there's no separate manual-refresh implementation to drift out
of sync. Per feed, it:

1. Sends a conditional GET (`If-None-Match` / `If-Modified-Since` from the last
   successful fetch) through an SSRF-hardened fetcher (`src/feeds/fetcher.ts`,
   `src/security/ssrf.ts`) — protocol allowlist, blocked private/loopback/link-local/
   cloud-metadata ranges, redirect re-validated at every hop, response size capped.
2. On `304 Not Modified`, updates `last_checked_at`/backoff state and stops — no parsing.
3. Otherwise parses (`rss-parser`), normalizes into the canonical `Article` shape, and
   deduplicates: match by GUID/Atom id → canonical URL → a hash fallback of
   feed+title+date+url. An existing match gets its content updated in place (title,
   body, etc.) while `id`, `first_seen_at`, and the user's read/starred state are left
   untouched; an unmatched item is inserted as new.
4. On failure, applies exponential backoff (`consecutive_failure_count`), respects
   `Retry-After` on 429/5xx, and marks the feed `permanently_failed` only after repeated
   failures (or an immediate HTTP 410) — never after a single transient error.

The background scheduler (`src/jobs/scheduler.ts`, started once via
`src/instrumentation.ts`) ticks every `SCHEDULER_TICK_MS` and refreshes whatever's due,
with `FETCH_CONCURRENCY` controlling how many feeds fetch in parallel. Overlapping
refresh calls for the same feed (a tick racing a manual click) collapse into a single
in-flight fetch rather than double-fetching.

## How OPML import/export works

**Import** (`src/opml/parser.ts` + `src/opml/importer.ts`): the file is parsed into a
tree (folders = outlines with children; everything else is a candidate feed), previewed
read-only (`previewOpmlImport` — classifies every entry as new / duplicate / invalid,
never writes to the database), and only written on confirmation
(`importOpmlEntries` — find-or-create for folders and feeds, so re-importing the same
file, or the same file twice, never creates duplicates).

**Export** (`src/opml/exporter.ts`): walks your subscriptions and folder hierarchy back
into valid OPML 2.0, XML-escaped, portable to any other OPML-reading tool.

## Search

SQLite FTS5 (`src/search/index.ts`), indexing title/author/content/feed title, kept in
sync with the `articles` table via triggers (`src/db/client.ts`) rather than a separate
reindex step. Results are scoped to your own subscriptions and returned in the same
reverse-chronological shape as the regular article list.

## Testing

```bash
npm test          # run once
npm run test:watch
npm run typecheck
```

103 tests across unit tests (URL/date normalization, dedup, sanitization, OPML parsing)
and integration tests that spin up real local HTTP servers and a real (in-memory) SQLite
database — no network access or live feeds required; deterministic fixtures live in
`test/fixtures/`.

**A note on the dev sandbox this was built in:** under `npm test`'s full-suite run (many
forked test processes at once), an intermittent `SQLite: database is locked` occasionally
surfaces from host CPU contention spawning ~12 Node processes at once — never on a single
file run alone, and always a different, unrelated test each time (the signature of
scheduling flakiness, not a deterministic bug). `vitest.config.ts` caps worker count and
retries twice as a pragmatic mitigation; this may not be necessary on your machine or in
CI.

## Deployment

### Docker Compose (recommended)

```bash
cp .env.example .env
# edit .env: set ADMIN_PASSWORD and SESSION_SECRET at minimum for any non-local deployment
docker compose up -d --build
```

This builds the image (multi-stage: install → build → run), runs migrations, starts the
server on port 3000, and persists SQLite to a named volume (`reader-data`). A `/health`
endpoint backs the container healthcheck.

### Plain Docker

```bash
docker build -t reader .
docker run -d -p 3000:3000 \
  -e ADMIN_PASSWORD=... -e SESSION_SECRET=... \
  -v reader-data:/app/data \
  reader
```

### Without Docker

```bash
npm ci
npm run build
npm run db:migrate
npm start
```

Put a reverse proxy (nginx, Caddy) in front for TLS; set `NODE_ENV=production`.

## Backup & portability

- **Subscriptions**: Manage Feeds → Export OPML at any time — this is the source of
  truth for "what am I subscribed to" and is readable by any other OPML-supporting
  reader. There is deliberately no scenario where your subscription list is trapped in
  this app.
- **Full database**: the SQLite file (`DATABASE_URL`, or the `reader-data` Docker volume)
  contains subscriptions, articles, and read/starred state. Back it up with a normal file
  copy; SQLite's WAL mode means a copy while the app is running is safe as long as you
  copy the `.db`, `.db-wal`, and `.db-shm` files together (or run `VACUUM INTO` for a
  guaranteed-consistent single-file snapshot).

## Troubleshooting

- **"SESSION_SECRET must be set to a random string of at least 32 characters"**: you set
  `ADMIN_PASSWORD` without `SESSION_SECRET` (or vice versa is silently ignored — auth is
  all-or-nothing). Generate one with `openssl rand -base64 32`.
- **A feed shows a ⚠ / "Failed N times" in the sidebar or Manage Feeds**: click through to
  Manage Feeds for the specific HTTP status / error message. A single transient error
  never marks a feed permanently dead; repeated failures or an HTTP 410 do.
- **"No feed found at that address"** when adding a feed by URL: the app only subscribes
  to feeds explicitly advertised via `<link rel="alternate">` on that page (or the URL
  itself being a feed) — it never guesses at conventional paths like `/feed` or `/rss`.
  Paste the feed URL directly if you have it.
- **A feed URL is rejected outright**: SSRF protection blocks localhost/private-network/
  cloud-metadata addresses by default. If you're intentionally running a feed on your own
  network for testing, set `ALLOW_LOCAL_FEEDS=true` — never do this on a
  publicly-reachable deployment.
- **`npm audit` reports a moderate esbuild advisory**: it's transitive through
  `drizzle-kit`'s dev-only bundler, used solely by `npm run db:generate`; it never runs in
  production and isn't network-reachable in this app's threat model.
