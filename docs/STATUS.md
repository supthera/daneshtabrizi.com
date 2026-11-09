# Implementation status

## Done in repo

- Public site preserved (`index.html`)
- WASD → Private Access modal → `/private/`
- Private Command Center launcher + app registry API
- Publisher HQ shell (overview, write, websites, media, history, settings)
- Worker entry (`worker.ts`) routes `/api/*` before static assets
- Publish engine: create/update article, select destinations, run Custom REST jobs, history/logs
- Website `secret_ref` + connection **Test**
- MedicareAgencyFinder receiver scaffold (`scaffolds/maf-publisher/`)
- Admin checklist (`docs/ADMIN_CHECKLIST.md`)
- Pages Functions middleware with Access JWT verification
- Localhost-only dev auth adapter
- D1 migration `0001_init.sql`
- Custom REST connector (path-safe URL join)

## Requires your Cloudflare account

See **`docs/ADMIN_CHECKLIST.md`**:

- D1 create + bind `DB` + remote migrate
- Worker secrets (`CF_ACCESS_*`, `MAF_PUBLISHER_TOKEN`)
- Deploy `npx wrangler deploy`
- Access app for `/private*` + `/api*`
- Deploy MAF receiver Worker + KV + routes + `PUBLISHER_TOKEN`

## Incomplete / next

- TipTap upgrade (current editor is contenteditable baseline)
- WordPress / Webflow connectors
- `/api/media` R2 upload pipeline
- Rate limiting middleware
- Automated test suite

Do not treat planned apps or unbound integrations as connected.
