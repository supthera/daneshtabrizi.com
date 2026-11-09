# MedicareAgencyFinder publisher receiver

Drop-in Cloudflare Worker that accepts articles from daneshtabrizi **Publisher HQ** and serves them at `/blog/:slug`.

## What you deploy (on the MAF account / zone)

1. Create a KV namespace named something like `maf-articles`.
2. Paste its id into `wrangler.toml` → `id`.
3. Deploy:
   ```bash
   cd scaffolds/maf-publisher
   npx wrangler deploy
   ```
4. Set the shared Bearer token:
   ```bash
   npx wrangler secret put PUBLISHER_TOKEN
   ```
5. Attach a route on `medicareagencyfinder.com`:
   - `/api/publisher/*`
   - `/blog/*`

## Matching setup on daneshtabrizi

In Cloudflare → **Workers & Pages** → **daneshtabrizi** → **Settings** → **Variables and Secrets**:

| Secret name | Value |
|---|---|
| `MAF_PUBLISHER_TOKEN` | same string as `PUBLISHER_TOKEN` |

In Publisher HQ → Manage Websites:

| Field | Value |
|---|---|
| Name | MedicareAgencyFinder.com |
| Domain | medicareagencyfinder.com |
| Connector | Custom REST API |
| API endpoint | `https://medicareagencyfinder.com/api/publisher/` |
| Worker secret name | `MAF_PUBLISHER_TOKEN` |

Then **Test**, then Write → select MAF → **Publish Selected**.
