# Connector development guide

Connectors live in `functions/lib/connectors/` and implement `PublisherConnector`.

## Contract

```ts
testConnection(): Promise<ConnectionTestResult>
createArticle(payload: PublishPayload): Promise<PublishResult>
updateArticle(remoteId, payload): Promise<PublishResult>
```

### Publish stages

Report the furthest confirmed stage only:

- `content_received`
- `content_saved`
- `build_triggered`
- `deployment_completed`
- `publicly_accessible`
- `failed`

Do not return success as publicly accessible until the destination confirms a live URL (or equivalent).

## Custom REST destination API (recommended for your sites)

Expose under your site’s base path (example: `https://medicareagencyfinder.com/api/publisher/`):

- `GET health` — auth required, 200 when ready
- `POST articles` — body = `PublishPayload`, returns `{ remote_id, published_url?, stage }`
- `PUT articles/:id` — update

Authenticate with `Authorization: Bearer <secret>`.

On daneshtabrizi, store the token as a **Worker secret** (e.g. `MAF_PUBLISHER_TOKEN`) and set `website_credentials.secret_ref` to that secret **name** (never the token value).

Ready-made receiver for MedicareAgencyFinder: `scaffolds/maf-publisher/`.

### Static sites

If the destination is statically generated:

1. Save content to the site’s content store / git / CMS.
2. Trigger rebuild webhook.
3. Wait or poll until deploy completes.
4. Only then set `stage: "publicly_accessible"` with `published_url`.

## WordPress / Webflow

Scaffold later as `wordpress.ts` / `webflow.ts` using the same interface. Keep destination-specific field mapping inside the connector, not in the editor UI.

## Idempotency

Publisher HQ stores `article_destinations.idempotency_key`. Connectors should send it when the destination supports dedupe.
