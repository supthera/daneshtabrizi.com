# Implementation status

## Done in repo

- Public site preserved (`index.html`)
- WASD → Private Access modal → `/private/`
- Private Command Center launcher + app registry API
- Publisher HQ shell (overview, write, websites, media, history, settings)
- Pages Functions middleware with Access JWT verification
- Localhost-only dev auth adapter
- D1 migration `0001_init.sql`
- Custom REST connector scaffold + docs

## Requires your Cloudflare account (not claimable from code alone)

- Access application + identity policy
- D1 database create + remote migrate
- R2 bucket create + bind
- Pages secret values
- First live publish to an external site (Phase 5)

## Incomplete / next

- Article PATCH/update + TipTap upgrade (current editor is contenteditable baseline)
- Publish job runner + retries + multi-destination orchestration UI
- WordPress / Webflow connectors
- `/api/media` R2 upload pipeline
- Rate limiting middleware per IP / identity
- Automated test suite

Do not treat planned apps or unbound integrations as connected.
