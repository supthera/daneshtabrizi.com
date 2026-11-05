# Cloudflare setup

## 1. Pages project

Repo already deploys as Cloudflare Pages with **no build**, output `/`.

After this push, Pages will also pick up `functions/`.

## 2. D1 database

```bash
npx wrangler d1 create command-center
```

Copy the database id into `wrangler.toml` → `database_id`.

Apply migrations (production):

```bash
npx wrangler d1 migrations apply command-center --remote
```

Local:

```bash
npx wrangler d1 migrations apply command-center --local
```

Bind `DB` in the Pages project settings (or via wrangler.toml for `pages deploy`).

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
