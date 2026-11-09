import { json, resolveIdentity, unauthorized } from "./auth";
import { runPublishJob, testWebsiteConnection, type PublishEnv } from "./publish";
import { FALLBACK_APPS } from "./apps";
import { deleteMedia, listMedia, uploadMedia } from "./media";

type Env = PublishEnv & {
  ASSETS?: Fetcher;
  MEDIA?: R2Bucket;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;
  DEV_AUTH_EMAIL?: string;
};

function uid(): string {
  return crypto.randomUUID();
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  return (await request.json()) as Record<string, unknown>;
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (path === "/api/health" && method === "GET") {
    const identity = await resolveIdentity(request, env);
    return json({
      ok: true,
      service: "command-center",
      identity: identity || null,
      db: Boolean(env.DB),
      bindings: {
        d1: Boolean(env.DB),
        r2: Boolean(env.MEDIA),
      },
    });
  }

  const identity = await resolveIdentity(request, env);
  if (!identity) return unauthorized("Cloudflare Access authentication required");

  if (path === "/api/apps" && method === "GET") {
    if (!env.DB) return json({ apps: FALLBACK_APPS, source: "fallback" });
    try {
      const rows = await env.DB.prepare(
        `SELECT id, name, description, icon, route, status, version, sort_order
         FROM applications ORDER BY sort_order ASC, name ASC`
      ).all();
      return json({ apps: rows.results?.length ? rows.results : FALLBACK_APPS, source: "d1" });
    } catch {
      return json({ apps: FALLBACK_APPS, source: "fallback" });
    }
  }

  if (path === "/api/websites" && method === "GET") {
    if (!env.DB) return json({ websites: [], note: "D1 not bound yet" });
    try {
      const rows = await env.DB.prepare(
        `SELECT w.id, w.name, w.domain, w.connector_type, w.api_endpoint, w.enabled,
                w.connection_status, w.last_successful_connection, w.last_publication_at,
                c.secret_ref
         FROM websites w
         LEFT JOIN website_credentials c ON c.website_id = w.id
         ORDER BY w.name ASC`
      ).all();
      return json({ websites: rows.results || [] });
    } catch (e) {
      return json({ websites: [], error: String(e) }, 500);
    }
  }

  if (path === "/api/websites" && method === "POST") {
    if (!env.DB) return json({ error: "D1 not bound" }, 503);
    let body: Record<string, unknown>;
    try {
      body = await readJson(request);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const websiteId = uid();
    const name = String(body.name || "").trim();
    const domain = String(body.domain || "").trim();
    const connector = String(body.connector_type || "custom_rest");
    const endpoint = body.api_endpoint ? String(body.api_endpoint).trim() : null;
    const secretRef = body.secret_ref ? String(body.secret_ref).trim() : null;
    if (!name || !domain) return json({ error: "name and domain required" }, 400);

    try {
      await env.DB.prepare(
        `INSERT INTO websites (id, name, domain, connector_type, api_endpoint)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(websiteId, name, domain, connector, endpoint)
        .run();

      if (secretRef) {
        await env.DB.prepare(
          `INSERT INTO website_credentials (id, website_id, secret_ref) VALUES (?, ?, ?)`
        )
          .bind(uid(), websiteId, secretRef)
          .run();
      }

      await env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
         VALUES (?, ?, 'website.create', 'website', ?)`
      )
        .bind(uid(), identity.email, websiteId)
        .run();

      return json({ id: websiteId, name, domain, connector_type: connector, secret_ref: secretRef }, 201);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  const websiteIdMatch = path.match(/^\/api\/websites\/([^/]+)$/);
  if (websiteIdMatch && method === "DELETE") {
    if (!env.DB) return json({ error: "D1 not bound" }, 503);
    const websiteId = decodeURIComponent(websiteIdMatch[1]);
    try {
      const existing = await env.DB.prepare(`SELECT id, name FROM websites WHERE id = ?`)
        .bind(websiteId)
        .first<{ id: string; name: string }>();
      if (!existing) return json({ error: "Website not found" }, 404);

      await env.DB.prepare(`DELETE FROM websites WHERE id = ?`).bind(websiteId).run();
      await env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
         VALUES (?, ?, 'website.delete', 'website', ?)`
      )
        .bind(uid(), identity.email, websiteId)
        .run();

      return json({ ok: true, id: websiteId, name: existing.name });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  const websiteTest = path.match(/^\/api\/websites\/([^/]+)\/test$/);
  if (websiteTest && method === "POST") {
    if (!env.DB) return json({ error: "D1 not bound" }, 503);
    try {
      const result = await testWebsiteConnection(env as PublishEnv, decodeURIComponent(websiteTest[1]));
      return json(result);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  if (path === "/api/articles" && method === "GET") {
    if (!env.DB) return json({ articles: [], note: "D1 not bound yet" });
    try {
      const rows = await env.DB.prepare(
        `SELECT id, title, slug, excerpt, status, updated_at, created_at
         FROM articles ORDER BY updated_at DESC LIMIT 100`
      ).all();
      return json({ articles: rows.results || [] });
    } catch (e) {
      return json({ articles: [], error: String(e) }, 500);
    }
  }

  if (path === "/api/articles" && method === "POST") {
    if (!env.DB) return json({ error: "D1 not bound" }, 503);
    let body: Record<string, unknown>;
    try {
      body = await readJson(request);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const articleId = uid();
    const title = String(body.title || "Untitled");
    const content = String(body.content_html || body.content || "");
    const excerpt = body.excerpt ? String(body.excerpt) : null;
    const slug = body.slug ? String(body.slug) : null;
    const status = String(body.status || "draft");
    const seoTitle = body.seo_title ? String(body.seo_title) : null;
    const seoDescription = body.seo_description ? String(body.seo_description) : null;
    const featuredImageId = body.featured_image_id ? String(body.featured_image_id) : null;
    const author = body.author ? String(body.author) : "Danesh Tabrizi";

    try {
      await env.DB.prepare(
        `INSERT INTO articles (id, title, slug, content_html, excerpt, author, status, seo_title, seo_description, featured_image_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          articleId,
          title,
          slug,
          content,
          excerpt,
          author,
          status,
          seoTitle,
          seoDescription,
          featuredImageId,
        )
        .run();

      await env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
         VALUES (?, ?, 'article.create', 'article', ?)`
      )
        .bind(uid(), identity.email, articleId)
        .run();

      return json({ id: articleId, title, status }, 201);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  const articleOne = path.match(/^\/api\/articles\/([^/]+)$/);
  if (articleOne && method === "GET") {
    if (!env.DB) return json({ error: "D1 not bound" }, 503);
    const row = await env.DB.prepare(`SELECT * FROM articles WHERE id = ?`)
      .bind(decodeURIComponent(articleOne[1]))
      .first();
    if (!row) return json({ error: "Not found" }, 404);
    return json({ article: row });
  }

  if (articleOne && method === "PATCH") {
    if (!env.DB) return json({ error: "D1 not bound" }, 503);
    let body: Record<string, unknown>;
    try {
      body = await readJson(request);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const id = decodeURIComponent(articleOne[1]);
    const existing = await env.DB.prepare(`SELECT id FROM articles WHERE id = ?`).bind(id).first();
    if (!existing) return json({ error: "Not found" }, 404);

    const title = body.title != null ? String(body.title) : null;
    const slug = body.slug != null ? String(body.slug) : null;
    const excerpt = body.excerpt != null ? String(body.excerpt) : null;
    const content = body.content_html != null ? String(body.content_html) : body.content != null ? String(body.content) : null;
    const status = body.status != null ? String(body.status) : null;
    const seoTitle = body.seo_title != null ? String(body.seo_title) : null;
    const seoDescription = body.seo_description != null ? String(body.seo_description) : null;
    const featuredImageId =
      body.featured_image_id !== undefined
        ? body.featured_image_id
          ? String(body.featured_image_id)
          : null
        : undefined;

    await env.DB.prepare(
      `UPDATE articles SET
         title = COALESCE(?, title),
         slug = COALESCE(?, slug),
         excerpt = COALESCE(?, excerpt),
         content_html = COALESCE(?, content_html),
         status = COALESCE(?, status),
         seo_title = COALESCE(?, seo_title),
         seo_description = COALESCE(?, seo_description),
         featured_image_id = CASE WHEN ? THEN ? ELSE featured_image_id END,
         updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        title,
        slug,
        excerpt,
        content,
        status,
        seoTitle,
        seoDescription,
        featuredImageId !== undefined ? 1 : 0,
        featuredImageId ?? null,
        id,
      )
      .run();

    return json({ id, ok: true });
  }

  if (articleOne && method === "DELETE") {
    if (!env.DB) return json({ error: "D1 not bound" }, 503);
    const id = decodeURIComponent(articleOne[1]);
    const existing = await env.DB.prepare(`SELECT id, title FROM articles WHERE id = ?`)
      .bind(id)
      .first<{ id: string; title: string }>();
    if (!existing) return json({ error: "Not found" }, 404);

    await env.DB.prepare(`DELETE FROM articles WHERE id = ?`).bind(id).run();
    await env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
       VALUES (?, ?, 'article.delete', 'article', ?)`,
    )
      .bind(uid(), identity.email, id)
      .run();

    return json({ ok: true, id, title: existing.title });
  }

  const articlePublish = path.match(/^\/api\/articles\/([^/]+)\/publish$/);
  if (articlePublish && method === "POST") {
    if (!env.DB) return json({ error: "D1 not bound" }, 503);
    let body: Record<string, unknown>;
    try {
      body = await readJson(request);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const websiteIds = Array.isArray(body.website_ids)
      ? body.website_ids.map((x) => String(x))
      : [];
    if (!websiteIds.length) return json({ error: "website_ids required" }, 400);
    try {
      const result = await runPublishJob(env as PublishEnv, {
        articleId: decodeURIComponent(articlePublish[1]),
        websiteIds,
        mode: body.mode === "draft" ? "draft" : "publish",
        actorEmail: identity.email,
      });
      return json(result);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  if (path === "/api/jobs" && method === "GET") {
    if (!env.DB) return json({ jobs: [], note: "D1 not bound yet" });
    try {
      const jobs = await env.DB.prepare(
        `SELECT j.id, j.article_id, j.mode, j.status, j.created_at, j.finished_at, a.title
         FROM publishing_jobs j
         LEFT JOIN articles a ON a.id = j.article_id
         ORDER BY j.created_at DESC LIMIT 50`
      ).all();
      const logs = await env.DB.prepare(
        `SELECT id, job_id, article_id, website_id, level, message, created_at
         FROM publishing_logs ORDER BY created_at DESC LIMIT 100`
      ).all();
      return json({ jobs: jobs.results || [], logs: logs.results || [] });
    } catch (e) {
      return json({ jobs: [], logs: [], error: String(e) }, 500);
    }
  }

  if (path === "/api/jobs/failed" && method === "DELETE") {
    if (!env.DB) return json({ error: "D1 not bound" }, 503);
    try {
      const failed = await env.DB.prepare(
        `SELECT id FROM publishing_jobs WHERE status = 'failed'`,
      ).all<{ id: string }>();
      const ids = (failed.results || []).map((row) => row.id);
      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        await env.DB.prepare(
          `DELETE FROM publishing_logs WHERE job_id IN (${placeholders})`,
        )
          .bind(...ids)
          .run();
        await env.DB.prepare(`DELETE FROM publishing_jobs WHERE status = 'failed'`).run();
      }
      await env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
         VALUES (?, ?, 'jobs.clear_failed', 'publishing_jobs', ?)`,
      )
        .bind(uid(), identity.email, String(ids.length))
        .run();
      return json({ ok: true, cleared: ids.length });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  if (path === "/api/media" && method === "GET") {
    return listMedia(env);
  }

  if (path === "/api/media" && method === "POST") {
    return uploadMedia(env, request, identity.email);
  }

  const mediaOne = path.match(/^\/api\/media\/([^/]+)$/);
  if (mediaOne && method === "DELETE") {
    return deleteMedia(env, decodeURIComponent(mediaOne[1]), identity.email);
  }

  return json({ error: "Not found" }, 404);
}
