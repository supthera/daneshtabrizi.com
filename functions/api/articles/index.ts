import { json, resolveIdentity } from "../../lib/auth";

type Env = {
  DB?: D1Database;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;
  DEV_AUTH_EMAIL?: string;
};

function id(): string {
  return crypto.randomUUID();
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const identity = await resolveIdentity(context.request, context.env);
  if (!identity) return json({ error: "Unauthorized" }, 401);
  if (!context.env.DB) return json({ articles: [], note: "D1 not bound yet" });

  try {
    const rows = await context.env.DB.prepare(
      `SELECT id, title, slug, excerpt, status, updated_at, created_at
       FROM articles ORDER BY updated_at DESC LIMIT 100`
    ).all();
    return json({ articles: rows.results || [] });
  } catch (e) {
    return json({ articles: [], error: String(e) }, 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const identity = await resolveIdentity(context.request, context.env);
  if (!identity) return json({ error: "Unauthorized" }, 401);
  if (!context.env.DB) return json({ error: "D1 not bound" }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await context.request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const articleId = id();
  const title = String(body.title || "Untitled");
  const content = String(body.content_html || body.content || "");
  const excerpt = body.excerpt ? String(body.excerpt) : null;
  const slug = body.slug ? String(body.slug) : null;
  const status = String(body.status || "draft");

  try {
    await context.env.DB.prepare(
      `INSERT INTO articles (id, title, slug, content_html, excerpt, author, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(articleId, title, slug, content, excerpt, identity.email, status)
      .run();

    await context.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
       VALUES (?, ?, 'article.create', 'article', ?)`
    )
      .bind(id(), identity.email, articleId)
      .run();

    return json({ id: articleId, title, status }, 201);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};
