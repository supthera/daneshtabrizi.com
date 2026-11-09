import { CustomRestConnector } from "./connectors/custom-rest";
import type { PublishPayload, PublishResult } from "./connectors/types";
import { mediaPublicUrl } from "./media";
import { sanitizePublisherHtml } from "./sanitizeHtml";

export type PublishEnv = {
  DB: D1Database;
  MEDIA?: R2Bucket;
  [key: string]: unknown;
};

type WebsiteRow = {
  id: string;
  name: string;
  domain: string;
  connector_type: string;
  api_endpoint: string | null;
  enabled: number;
  secret_ref: string | null;
};

type ArticleRow = {
  id: string;
  title: string;
  slug: string | null;
  content_html: string;
  excerpt: string | null;
  author: string | null;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  status: string;
  featured_image_id: string | null;
};

const DEFAULT_AUTHOR_NAME = "Danesh Tabrizi";
const DEFAULT_AUTHOR_URL = "https://daneshtabrizi.com";

function uid(): string {
  return crypto.randomUUID();
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "article";
}

function resolveSecret(env: PublishEnv, secretRef: string | null): string | null {
  if (!secretRef) return null;
  const value = env[secretRef];
  return typeof value === "string" && value.length ? value : null;
}

function siteOrigin(env: PublishEnv): string {
  const configured = env.PUBLIC_SITE_URL;
  if (typeof configured === "string" && configured.trim()) {
    return configured.replace(/\/$/, "");
  }
  return "https://daneshtabrizi.com";
}

function absolutizeMediaUrls(html: string, origin: string): string {
  return String(html || "").replace(
    /(src|href)=(["'])(\/media\/[^"']+)\2/gi,
    (_m, attr: string, quote: string, path: string) => `${attr}=${quote}${origin}${path}${quote}`,
  );
}

/**
 * Featured image URLs always point at the public site origin (prod).
 * Publishing from `wrangler dev --local` writes media only to the local
 * Miniflare R2/D1 — those IDs 404 on daneshtabrizi.com. Verify the R2
 * object exists in *this* env before stamping a public URL into MAF.
 */
async function resolveFeaturedImageUrl(
  env: PublishEnv,
  featuredImageId: string | null,
): Promise<string | undefined> {
  if (!featuredImageId) return undefined;

  const media = await env.DB.prepare(
    `SELECT id, r2_key, filename FROM media WHERE id = ?`,
  )
    .bind(featuredImageId)
    .first<{ id: string; r2_key: string; filename: string | null }>();

  if (!media) {
    throw new Error(
      `Featured image ${featuredImageId} is missing from the media library. Re-select or re-upload it, then publish again.`,
    );
  }

  if (!env.MEDIA) {
    throw new Error(
      "R2 MEDIA binding is not configured — cannot publish a featured image.",
    );
  }

  const obj = await env.MEDIA.head(media.r2_key);
  if (!obj) {
    throw new Error(
      `Featured image “${media.filename || media.id}” is in the database but missing from object storage. ` +
        `If you uploaded it via local wrangler (--local), it only exists on this machine — upload again on https://daneshtabrizi.com/private/publisher/ (or use remote bindings), then publish.`,
    );
  }

  return mediaPublicUrl(siteOrigin(env), media.id);
}

async function toPayload(
  env: PublishEnv,
  article: ArticleRow,
  status: "draft" | "published",
): Promise<PublishPayload> {
  const origin = siteOrigin(env);
  const featuredImage = await resolveFeaturedImageUrl(env, article.featured_image_id);

  const authorName =
    article.author && !article.author.includes("@")
      ? article.author
      : DEFAULT_AUTHOR_NAME;

  return {
    article_id: article.id,
    title: article.title,
    slug: article.slug || undefined,
    content: absolutizeMediaUrls(
      sanitizePublisherHtml(article.content_html || ""),
      origin,
    ),
    excerpt: article.excerpt || undefined,
    featured_image: featuredImage,
    author: {
      name: authorName,
      url: DEFAULT_AUTHOR_URL,
      avatar_url: `${origin}/author.jpg`,
    },
    seo: {
      title: article.seo_title || undefined,
      description: article.seo_description || undefined,
      og_image: featuredImage,
    },
    canonical_url: article.canonical_url || undefined,
    status,
  };
}

async function log(
  db: D1Database,
  jobId: string,
  articleId: string,
  websiteId: string | null,
  level: string,
  message: string,
  detail?: unknown
) {
  await db
    .prepare(
      `INSERT INTO publishing_logs (id, job_id, article_id, website_id, level, message, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      uid(),
      jobId,
      articleId,
      websiteId,
      level,
      message,
      detail ? JSON.stringify(detail) : null
    )
    .run();
}

export async function runPublishJob(
  env: PublishEnv,
  opts: {
    articleId: string;
    websiteIds: string[];
    mode?: "draft" | "publish";
    actorEmail?: string;
  }
): Promise<{
  job_id: string;
  results: Array<{
    website_id: string;
    website_name: string;
    ok: boolean;
    stage?: PublishResult["stage"];
    published_url?: string;
    remote_id?: string;
    error?: string;
  }>;
}> {
  const db = env.DB;
  const mode = opts.mode || "publish";
  const article = await db
    .prepare(
      `SELECT id, title, slug, content_html, excerpt, author, seo_title, seo_description, canonical_url, status, featured_image_id
       FROM articles WHERE id = ?`
    )
    .bind(opts.articleId)
    .first<ArticleRow>();

  if (!article) throw new Error("Article not found");

  const placeholders = opts.websiteIds.map(() => "?").join(",");
  const websites = await db
    .prepare(
      `SELECT w.id, w.name, w.domain, w.connector_type, w.api_endpoint, w.enabled, c.secret_ref
       FROM websites w
       LEFT JOIN website_credentials c ON c.website_id = w.id
       WHERE w.id IN (${placeholders})`
    )
    .bind(...opts.websiteIds)
    .all<WebsiteRow>();

  const list = (websites.results || []) as WebsiteRow[];
  if (!list.length) throw new Error("No matching websites");

  // Fail before opening a job if featured media isn't in this env's R2.
  if (!article.slug) {
    const slug = slugify(article.title);
    await db.prepare(`UPDATE articles SET slug = ?, updated_at = datetime('now') WHERE id = ?`).bind(slug, article.id).run();
    article.slug = slug;
  }
  const payload = await toPayload(env, article, mode === "publish" ? "published" : "draft");

  const jobId = uid();
  await db
    .prepare(
      `INSERT INTO publishing_jobs (id, article_id, mode, status) VALUES (?, ?, ?, 'running')`
    )
    .bind(jobId, article.id, mode)
    .run();

  await log(db, jobId, article.id, null, "info", `Job started (${mode}) for ${list.length} destination(s)`);
  const results: Array<{
    website_id: string;
    website_name: string;
    ok: boolean;
    stage?: PublishResult["stage"];
    published_url?: string;
    remote_id?: string;
    error?: string;
  }> = [];

  for (const site of list) {
    const destId = uid();
    const idempotency = `${article.id}:${site.id}:${article.slug || "noslug"}`;

    await db
      .prepare(
        `INSERT INTO article_destinations
          (id, article_id, website_id, status, idempotency_key, last_attempt_at)
         VALUES (?, ?, ?, 'publishing', ?, datetime('now'))
         ON CONFLICT(article_id, website_id) DO UPDATE SET
           status = 'publishing',
           last_attempt_at = datetime('now'),
           error_message = NULL`
      )
      .bind(destId, article.id, site.id, idempotency)
      .run();

    if (!site.enabled) {
      const err = "Website disabled";
      await db
        .prepare(
          `UPDATE article_destinations SET status = 'skipped', error_message = ? WHERE article_id = ? AND website_id = ?`
        )
        .bind(err, article.id, site.id)
        .run();
      await log(db, jobId, article.id, site.id, "warn", err);
      results.push({ website_id: site.id, website_name: site.name, ok: false, error: err });
      continue;
    }

    if (site.connector_type !== "custom_rest") {
      const err = `Connector ${site.connector_type} is not implemented yet`;
      await db
        .prepare(
          `UPDATE article_destinations SET status = 'failed', error_message = ? WHERE article_id = ? AND website_id = ?`
        )
        .bind(err, article.id, site.id)
        .run();
      await log(db, jobId, article.id, site.id, "error", err);
      results.push({ website_id: site.id, website_name: site.name, ok: false, error: err });
      continue;
    }

    if (!site.api_endpoint) {
      const err = "Missing api_endpoint";
      await db
        .prepare(
          `UPDATE article_destinations SET status = 'failed', error_message = ? WHERE article_id = ? AND website_id = ?`
        )
        .bind(err, article.id, site.id)
        .run();
      await log(db, jobId, article.id, site.id, "error", err);
      results.push({ website_id: site.id, website_name: site.name, ok: false, error: err });
      continue;
    }

    const token = resolveSecret(env, site.secret_ref);
    if (!token) {
      const err = site.secret_ref
        ? `Worker secret "${site.secret_ref}" is not set`
        : "Missing secret_ref (set the Worker secret name on this website)";
      await db
        .prepare(
          `UPDATE article_destinations SET status = 'failed', error_message = ? WHERE article_id = ? AND website_id = ?`
        )
        .bind(err, article.id, site.id)
        .run();
      await log(db, jobId, article.id, site.id, "error", err);
      results.push({ website_id: site.id, website_name: site.name, ok: false, error: err });
      continue;
    }

    const connector = new CustomRestConnector(site.api_endpoint, token);
    const existing = await db
      .prepare(`SELECT remote_id FROM article_destinations WHERE article_id = ? AND website_id = ?`)
      .bind(article.id, site.id)
      .first<{ remote_id: string | null }>();

    let result: PublishResult;
    try {
      if (existing?.remote_id) {
        result = await connector.updateArticle(existing.remote_id, payload);
      } else {
        result = await connector.createArticle(payload);
      }
    } catch (e) {
      result = { ok: false, stage: "failed", error: String(e) };
    }

    if (result.ok) {
      await db
        .prepare(
          `UPDATE article_destinations
           SET status = 'published',
               remote_id = COALESCE(?, remote_id),
               published_url = ?,
               published_at = datetime('now'),
               error_message = NULL
           WHERE article_id = ? AND website_id = ?`
        )
        .bind(result.remote_id || null, result.published_url || null, article.id, site.id)
        .run();
      await db
        .prepare(`UPDATE websites SET last_publication_at = datetime('now'), connection_status = 'ok', updated_at = datetime('now') WHERE id = ?`)
        .bind(site.id)
        .run();
      await log(db, jobId, article.id, site.id, "info", `Published (${result.stage})`, result);
      results.push({
        website_id: site.id,
        website_name: site.name,
        ok: true,
        stage: result.stage,
        published_url: result.published_url,
        remote_id: result.remote_id,
      });
    } else {
      await db
        .prepare(
          `UPDATE article_destinations
           SET status = 'failed', error_message = ?
           WHERE article_id = ? AND website_id = ?`
        )
        .bind(result.error || "Publish failed", article.id, site.id)
        .run();
      await log(db, jobId, article.id, site.id, "error", result.error || "Publish failed", result);
      results.push({
        website_id: site.id,
        website_name: site.name,
        ok: false,
        stage: result.stage,
        error: result.error,
      });
    }
  }

  const anyOk = results.some((r) => r.ok);
  if (anyOk && mode === "publish") {
    await db
      .prepare(`UPDATE articles SET status = 'published', updated_at = datetime('now') WHERE id = ?`)
      .bind(article.id)
      .run();
  }

  await db
    .prepare(`UPDATE publishing_jobs SET status = ?, finished_at = datetime('now') WHERE id = ?`)
    .bind(anyOk ? "completed" : "failed", jobId)
    .run();

  if (opts.actorEmail) {
    await db
      .prepare(
        `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id, detail_json)
         VALUES (?, ?, 'article.publish', 'article', ?, ?)`
      )
      .bind(uid(), opts.actorEmail, article.id, JSON.stringify({ job_id: jobId, results }))
      .run();
  }

  await log(db, jobId, article.id, null, "info", `Job finished (${anyOk ? "completed" : "failed"})`);
  return { job_id: jobId, results };
}

export async function testWebsiteConnection(env: PublishEnv, websiteId: string) {
  const site = await env.DB
    .prepare(
      `SELECT w.id, w.name, w.domain, w.connector_type, w.api_endpoint, w.enabled, c.secret_ref
       FROM websites w
       LEFT JOIN website_credentials c ON c.website_id = w.id
       WHERE w.id = ?`
    )
    .bind(websiteId)
    .first<WebsiteRow>();

  if (!site) throw new Error("Website not found");
  if (site.connector_type !== "custom_rest") {
    return { ok: false, message: `Connector ${site.connector_type} not implemented` };
  }
  if (!site.api_endpoint) return { ok: false, message: "Missing api_endpoint" };
  const token = resolveSecret(env, site.secret_ref);
  if (!token) {
    return {
      ok: false,
      message: site.secret_ref
        ? `Worker secret "${site.secret_ref}" is not set`
        : "Missing secret_ref",
    };
  }

  const connector = new CustomRestConnector(site.api_endpoint, token);
  const result = await connector.testConnection();
  await env.DB
    .prepare(
      `UPDATE websites
       SET connection_status = ?, last_successful_connection = CASE WHEN ? = 1 THEN datetime('now') ELSE last_successful_connection END,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(result.ok ? "ok" : "error", result.ok ? 1 : 0, websiteId)
    .run();
  return result;
}
