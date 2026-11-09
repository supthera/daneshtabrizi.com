/**
 * MedicareAgencyFinder.com — Publisher HQ receiver
 * Deploy on the MAF Cloudflare zone / Worker.
 *
 * Endpoints (base path configurable via BASE_PATH, default /api/publisher):
 *   GET  {BASE}/health
 *   POST {BASE}/articles
 *   PUT  {BASE}/articles/:id
 *   GET  {BASE}/articles/:id
 *   GET  /blog/:slug   (public HTML render from KV)
 *
 * Secrets / bindings:
 *   PUBLISHER_TOKEN  (Secret) — Bearer token shared with daneshtabrizi MAF_PUBLISHER_TOKEN
 *   ARTICLES         (KV namespace binding)
 */

const BASE = "/api/publisher";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function unauthorized() {
  return json({ error: "Unauthorized" }, 401);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function authed(request, env) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !env.PUBLISHER_TOKEN) return false;
  return timingSafeEqual(match[1].trim(), String(env.PUBLISHER_TOKEN));
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "article";
}

function publicUrl(slug, request) {
  const origin = new URL(request.url).origin;
  return `${origin}/blog/${encodeURIComponent(slug)}`;
}

function renderHtml(article) {
  const title = article.seo?.title || article.title || "Article";
  const description = article.seo?.description || article.excerpt || "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <style>
    body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#0b0b0b;color:#f2f2f2;line-height:1.6}
    main{max-width:720px;margin:0 auto;padding:48px 20px 80px}
    a{color:#ffae3b}
    .meta{color:#8a8a8a;font-size:.9rem;margin-bottom:24px}
  </style>
</head>
<body>
  <main>
    <p class="meta"><a href="/">Medicare Agency Finder</a> · Blog</p>
    <h1>${escapeHtml(article.title || "Untitled")}</h1>
    ${article.excerpt ? `<p class="meta">${escapeHtml(article.excerpt)}</p>` : ""}
    <article>${article.content || ""}</article>
  </main>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function saveArticle(env, remoteId, payload, request) {
  const slug = payload.slug || slugify(payload.title);
  const record = {
    id: remoteId,
    article_id: payload.article_id || null,
    title: payload.title || "Untitled",
    slug,
    content: payload.content || "",
    excerpt: payload.excerpt || "",
    seo: payload.seo || {},
    status: payload.status || "published",
    updated_at: new Date().toISOString(),
  };
  await env.ARTICLES.put(`id:${remoteId}`, JSON.stringify(record));
  await env.ARTICLES.put(`slug:${slug}`, remoteId);
  return {
    remote_id: remoteId,
    published_url: publicUrl(slug, request),
    stage: "publicly_accessible",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
          "access-control-allow-headers": "authorization,content-type",
        },
      });
    }

    if (path.startsWith("/blog/")) {
      const slug = decodeURIComponent(path.slice("/blog/".length));
      const id = await env.ARTICLES.get(`slug:${slug}`);
      if (!id) return new Response("Not found", { status: 404 });
      const raw = await env.ARTICLES.get(`id:${id}`);
      if (!raw) return new Response("Not found", { status: 404 });
      const article = JSON.parse(raw);
      return new Response(renderHtml(article), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (path === `${BASE}/health`) {
      if (!authed(request, env)) return unauthorized();
      return json({ ok: true, service: "maf-publisher" });
    }

    if (path === `${BASE}/articles` && request.method === "POST") {
      if (!authed(request, env)) return unauthorized();
      const payload = await request.json();
      const remoteId = crypto.randomUUID();
      const result = await saveArticle(env, remoteId, payload, request);
      return json(result, 201);
    }

    const articleMatch = path.match(new RegExp(`^${BASE}/articles/([^/]+)$`));
    if (articleMatch && request.method === "PUT") {
      if (!authed(request, env)) return unauthorized();
      const remoteId = decodeURIComponent(articleMatch[1]);
      const payload = await request.json();
      const result = await saveArticle(env, remoteId, payload, request);
      return json(result);
    }

    if (articleMatch && request.method === "GET") {
      if (!authed(request, env)) return unauthorized();
      const remoteId = decodeURIComponent(articleMatch[1]);
      const raw = await env.ARTICLES.get(`id:${remoteId}`);
      if (!raw) return json({ error: "Not found" }, 404);
      return json(JSON.parse(raw));
    }

    return json({ error: "Not found" }, 404);
  },
};
