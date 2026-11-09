import { json } from "./auth";

export type MediaEnv = {
  DB?: D1Database;
  MEDIA?: R2Bucket;
};

export type MediaRow = {
  id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  title: string | null;
  alt_text: string | null;
  description: string | null;
  created_at: string;
};

function uid(): string {
  return crypto.randomUUID();
}

function safeFilename(name: string): string {
  return (
    String(name || "file")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "file"
  );
}

export function mediaPublicUrl(origin: string, id: string): string {
  return `${origin.replace(/\/$/, "")}/media/${encodeURIComponent(id)}`;
}

export async function listMedia(env: MediaEnv): Promise<Response> {
  if (!env.DB) return json({ media: [], note: "D1 not bound" });
  try {
    const rows = await env.DB.prepare(
      `SELECT id, r2_key, filename, content_type, byte_size, title, alt_text, description, created_at
       FROM media ORDER BY created_at DESC LIMIT 200`,
    ).all<MediaRow>();
    return json({ media: rows.results || [], r2: Boolean(env.MEDIA) });
  } catch (e) {
    return json({ media: [], error: String(e) }, 500);
  }
}

export async function uploadMedia(
  env: MediaEnv,
  request: Request,
  actorEmail?: string,
): Promise<Response> {
  if (!env.DB) return json({ error: "D1 not bound" }, 503);
  if (!env.MEDIA) return json({ error: "R2 MEDIA binding not configured" }, 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Expected multipart form upload" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File) || !file.size) {
    return json({ error: "file required" }, 400);
  }
  if (file.size > 8 * 1024 * 1024) {
    return json({ error: "Max upload size is 8MB" }, 413);
  }

  const contentType = file.type || "application/octet-stream";
  if (!contentType.startsWith("image/")) {
    return json({ error: "Only image uploads are supported right now" }, 415);
  }

  const id = uid();
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const filename = safeFilename(file.name);
  const r2Key = `media/${yyyy}/${mm}/${id}-${filename}`;
  const title = form.get("title") ? String(form.get("title")).trim() : null;
  const altText = form.get("alt_text") ? String(form.get("alt_text")).trim() : null;

  const bytes = await file.arrayBuffer();
  await env.MEDIA.put(r2Key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { media_id: id, filename },
  });

  await env.DB.prepare(
    `INSERT INTO media (id, r2_key, filename, content_type, byte_size, title, alt_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, r2Key, filename, contentType, file.size, title, altText)
    .run();

  if (actorEmail) {
    await env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
       VALUES (?, ?, 'media.upload', 'media', ?)`,
    )
      .bind(uid(), actorEmail, id)
      .run();
  }

  const origin = new URL(request.url).origin;
  return json(
    {
      id,
      filename,
      content_type: contentType,
      byte_size: file.size,
      title,
      alt_text: altText,
      url: mediaPublicUrl(origin, id),
    },
    201,
  );
}

export async function deleteMedia(
  env: MediaEnv,
  mediaId: string,
  actorEmail?: string,
): Promise<Response> {
  if (!env.DB) return json({ error: "D1 not bound" }, 503);
  if (!env.MEDIA) return json({ error: "R2 MEDIA binding not configured" }, 503);

  const row = await env.DB.prepare(
    `SELECT id, r2_key, filename FROM media WHERE id = ?`,
  )
    .bind(mediaId)
    .first<{ id: string; r2_key: string; filename: string }>();
  if (!row) return json({ error: "Media not found" }, 404);

  await env.MEDIA.delete(row.r2_key);
  await env.DB.prepare(`UPDATE articles SET featured_image_id = NULL WHERE featured_image_id = ?`)
    .bind(mediaId)
    .run();
  await env.DB.prepare(`DELETE FROM media WHERE id = ?`).bind(mediaId).run();

  if (actorEmail) {
    await env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
       VALUES (?, ?, 'media.delete', 'media', ?)`,
    )
      .bind(uid(), actorEmail, mediaId)
      .run();
  }

  return json({ ok: true, id: mediaId, filename: row.filename });
}

export async function serveMediaFile(env: MediaEnv, mediaId: string): Promise<Response> {
  if (!env.DB || !env.MEDIA) {
    return new Response("Media unavailable", { status: 503 });
  }
  const row = await env.DB.prepare(
    `SELECT id, r2_key, content_type, filename FROM media WHERE id = ?`,
  )
    .bind(mediaId)
    .first<{ id: string; r2_key: string; content_type: string; filename: string }>();
  if (!row) return new Response("Not found", { status: 404 });

  const obj = await env.MEDIA.get(row.r2_key);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  headers.set("content-type", row.content_type || "application/octet-stream");
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  if (row.filename) {
    headers.set("content-disposition", `inline; filename="${row.filename.replace(/"/g, "")}"`);
  }
  return new Response(obj.body, { status: 200, headers });
}

export async function resolveMediaUrl(
  env: MediaEnv,
  origin: string,
  mediaId: string | null | undefined,
): Promise<{ url?: string; alt?: string }> {
  if (!mediaId || !env.DB) return {};
  const row = await env.DB.prepare(`SELECT id, alt_text FROM media WHERE id = ?`)
    .bind(mediaId)
    .first<{ id: string; alt_text: string | null }>();
  if (!row) return {};
  return { url: mediaPublicUrl(origin, row.id), alt: row.alt_text || undefined };
}
