# Cloudflare setup

## 1. Workers + static assets

`daneshtabrizi.com` is attached to the **Workers** project `daneshtabrizi`
(`*.workers.dev`), not a classic Pages `*.pages.dev` host.

`wrangler.toml` uses `[assets] directory = "."` so `wrangler deploy` uploads the site.

### Build settings (Workers & Pages → daneshtabrizi → Settings → Builds)

| Setting | Value |
|---|---|
| Framework preset | **None** |
| Build command | `exit 0` |
| Deploy command | `npx wrangler deploy` |
| Root directory | blank |

Do **not** set Deploy to `exit 0` — that marks success without uploading new files (WASD never goes live).

### After changing settings

**Save**, then **Retry deployment** (or push a new commit). Confirm Production shows the new commit.

### Note on `functions/`

The `functions/` folder is Pages-style and is excluded from asset upload (see `.assetsignore`).
API/auth routes need a Worker `main` (or a Pages project) before they go live; the public site + WASD gate do not.

## 2. D1 database

Prefer the click-path in **`docs/ADMIN_CHECKLIST.md`**, or CLI:

```bash
npx wrangler d1 create command-center
```

Copy the database id into `wrangler.toml` → `database_id` and uncomment `[[d1_databases]]`.

Apply migrations (production):

```bash
npx wrangler d1 migrations apply command-center --remote
```

Local:

```bash
npx wrangler d1 migrations apply command-center --local
```

Bind `DB` on the Worker: **Workers & Pages** → **daneshtabrizi** → **Bindings** → D1 (`DB`).

## 3. R2 bucket

```bash
npx wrangler r2 bucket create command-center-media
```

Bind as `MEDIA` on the Pages project.

## 4. Cloudflare Access (Zero Trust)

1. Zero Trust → Access → Applications → Add **Self-hosted**.
2. Application domain: `daneshtabrizi.com`.
3. Path protect:
   - `/private*`
   - `/api*`
4. Policy: Allow your Gmail (include).
5. Identity providers:
   - Google (restrict to your account) and/or
   - One-time PIN (email)
   - Passkeys / security keys as supported by the IdP and device
6. Disable public signup / any self-registration IdPs.
7. Copy **Application Audience (AUD)** tag.
8. Team domain looks like `yourteam.cloudflareaccess.com`.

### Pages secrets

```bash
npx wrangler pages secret put CF_ACCESS_TEAM_DOMAIN --project-name=daneshtabrizi
npx wrangler pages secret put CF_ACCESS_AUD --project-name=daneshtabrizi
```

Never set `DEV_AUTH_BYPASS=true` on production.

### Passkeys / biometrics

Face ID, Touch ID, Android biometrics, and QR cross-device flows come from the IdP + device passkey support — Access does not invent a custom QR login UI. Enroll passkeys in the Google / IdP account security settings.

### Logout

`https://<team>.cloudflareaccess.com/cdn-cgi/access/logout`

## 5. Local development

```bash
# optional: allow localhost bypass
export DEV_AUTH_BYPASS=true
export DEV_AUTH_EMAIL=you@gmail.com

npx wrangler pages dev . --d1=DB --r2=MEDIA
```

Public site alone (no Functions):

```bash
python3 -m http.server 3600
```

WASD works on the static server; auth + API require `wrangler pages dev`.

## 6. Always Use HTTPS

In the domain’s Cloudflare zone → SSL/TLS → Edge Certificates → **Always Use HTTPS** On.
(This is a zone setting, not a Pages setting.)
