# Cloudflare admin checklist (you do these)

Code for publish + MAF receiver is in the repo. You only need account actions.

## A. daneshtabrizi Worker

### 1. Create D1
1. Dashboard → **Storage & databases** → **D1 SQL database** → **Create database**
2. Name: `command-center` → Create
3. Copy **Database ID**

### 2. Bind D1 + enable in wrangler
1. Open `wrangler.toml`
2. Uncomment the `[[d1_databases]]` block
3. Paste the Database ID into `database_id`
4. Dashboard → **Workers & Pages** → **daneshtabrizi** → **Bindings** → **Add** → **D1 database**
   - Variable name: `DB`
   - Database: `command-center`

### 3. Apply migrations
```bash
npx wrangler d1 migrations apply command-center --remote
```

### 4. Secrets
**Workers & Pages** → **daneshtabrizi** → **Settings** → **Variables and Secrets** → **Add** → type **Secret**:

| Name | Purpose |
|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | e.g. `yourteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Access application AUD tag |
| `MAF_PUBLISHER_TOKEN` | Shared Bearer token with MAF receiver |

Then **Deploy**.

### 5. Redeploy site
```bash
npx wrangler deploy
```
or push to git if Builds → Deploy command is `npx wrangler deploy`.

### 6. Access (if not already)
**Zero Trust** → **Access controls** → **Applications** → protect `daneshtabrizi.com` paths `/private*` and `/api*`.

---

## B. MedicareAgencyFinder receiver (in the MAF Next.js repo)

Receiver lives in **MedicareAgencyFinder.com** (not the standalone Worker scaffold):

- Routes: `app/api/publisher/**`
- Docs: `docs/PUBLISHER_HQ.md`

On **Vercel** (or wherever MAF deploys), set:

| Env | Value |
|---|---|
| `PUBLISHER_TOKEN` | same as daneshtabrizi `MAF_PUBLISHER_TOKEN` |
| `SANITY_API_WRITE_TOKEN` | Sanity Editor/write token |
| `NEXT_PUBLIC_SITE_URL` | `https://medicareagencyfinder.com` |

Redeploy MAF after adding env vars.

---

## C. Wire in Publisher HQ UI

1. Publisher HQ → **Manage Websites**
2. Add MAF with:
   - Connector: **Custom REST API**
   - Endpoint: `https://medicareagencyfinder.com/api/publisher/`
   - Secret name: `MAF_PUBLISHER_TOKEN`
3. Click **Test**
4. **Write Article** → check MAF → **Publish Selected →**
5. Confirm History shows the job and `https://medicareagencyfinder.com/blog/<slug>` loads
