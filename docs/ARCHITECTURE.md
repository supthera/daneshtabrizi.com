# Architecture — Danesh Tabrizi Personal Command Center

## Layers

1. **Public website** (`/`, existing `index.html`) — unchanged dossier aesthetic.
2. **Discovery** — WASD sequence opens a Private Access modal (not authentication).
3. **Identity** — Cloudflare Access protects `/private/*` and `/api/*`.
4. **Command Center** — `/private/` application launcher + registry.
5. **Apps** — e.g. Publisher HQ at `/private/publisher/`, independently modular.

## Stack

| Piece | Choice |
|---|---|
| Public UI | Existing static HTML/CSS/JS |
| Private UI | Static HTML + ES modules under `/private/` |
| Backend | Cloudflare Pages Functions (`functions/`) |
| DB | Cloudflare D1 (`DB` binding) |
| Media | Cloudflare R2 (`MEDIA` binding) |
| Auth | Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) |

No VPS. No public registration. No framework rewrite of the public site.

## Auth model

- WASD = discovery only.
- Edge: Access application policies on `/private*` and `/api*`.
- App: `functions/_middleware.ts` + `functions/lib/auth.ts` validate JWT (AUD + signature + expiry).
- Dev: `DEV_AUTH_BYPASS=true` only on localhost; impossible to enable for `daneshtabrizi.com`.

## Application registry

- Source of truth: D1 `applications` table (seeded in `migrations/0001_init.sql`).
- Fallback: `functions/lib/apps.ts` when D1 is unbound.
- Launcher reads `/api/apps` — adding an app does not require rewriting the shell.

## Publisher HQ

- Owns articles, websites, jobs, logs, media metadata.
- Connectors implement `PublisherConnector` (`functions/lib/connectors/`).
- First connector: `CustomRestConnector`.
- Publish success stages distinguish *received / saved / build / deploy / public*.

## Extensibility

New apps:

1. Add private UI under `/private/<app>/`.
2. Insert `applications` row (or update fallback registry).
3. Add Functions under `functions/api/<app>/` as needed.
4. Optionally add D1 tables in a new migration — do not overload Publisher tables.
