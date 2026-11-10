import { json } from "./auth";

export type MusicEnv = {
  DB?: D1Database;
  MEDIA?: R2Bucket;
};

const MAX_TAKE_BYTES = 80 * 1024 * 1024;
const AUDIO_EXT = new Set(["m4a", "mp3", "wav", "aac", "ogg", "webm"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v"]);

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

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function kindFromFile(file: File): "audio" | "video" | null {
  const type = (file.type || "").toLowerCase();
  const ext = extOf(file.name);
  if (type.startsWith("audio/") || AUDIO_EXT.has(ext)) return "audio";
  if (type.startsWith("video/") || VIDEO_EXT.has(ext)) return "video";
  return null;
}

function normalizeStatus(raw: unknown): "idea" | "in_progress" | "finished" {
  const s = String(raw || "idea");
  if (s === "in_progress" || s === "finished" || s === "idea") return s;
  return "idea";
}

function parseCues(raw: string | null | undefined): Array<{ id: string; timeSec: number; text: string }> {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c, i) => {
        const row = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
        return {
          id: String(row.id || `cue-${i}`).slice(0, 80),
          timeSec: Math.max(0, Number(row.timeSec) || 0),
          text: String(row.text || "").slice(0, 500),
        };
      })
      .filter((c) => c.text.trim());
  } catch {
    return [];
  }
}

async function nextCardSort(env: MusicEnv): Promise<number> {
  const row = await env.DB!.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM music_cards`).first<{ m: number }>();
  return Number(row?.m ?? -1) + 1;
}

async function nextTakeSort(env: MusicEnv, cardId: string): Promise<number> {
  const row = await env.DB!.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM music_takes WHERE card_id = ?`)
    .bind(cardId)
    .first<{ m: number }>();
  return Number(row?.m ?? -1) + 1;
}

export async function handleMusicApi(
  request: Request,
  env: MusicEnv,
  path: string,
  method: string,
  actorEmail: string,
): Promise<Response | null> {
  if (!path.startsWith("/api/music")) return null;
  if (!env.DB) return json({ error: "D1 not bound" }, 503);

  // GET /api/music/cards
  if (path === "/api/music/cards" && method === "GET") {
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("archived") === "1";
    try {
      const rows = await env.DB.prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM music_takes t WHERE t.card_id = c.id AND t.kind = 'audio') AS audio_count,
                (SELECT COUNT(*) FROM music_takes t WHERE t.card_id = c.id AND t.kind = 'video') AS video_count
         FROM music_cards c
         WHERE (? = 1 OR c.archived = 0)
         ORDER BY c.archived ASC, c.sort_order ASC, c.updated_at DESC`,
      )
        .bind(includeArchived ? 1 : 0)
        .all();
      return json({ cards: rows.results || [], source: "d1" });
    } catch (e) {
      return json({ cards: [], error: String(e) }, 500);
    }
  }

  // POST /api/music/cards
  if (path === "/api/music/cards" && method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const id = uid();
    const title = String(body.title || "Untitled").trim().slice(0, 160) || "Untitled";
    const status = normalizeStatus(body.status);
    const sortOrder = await nextCardSort(env);
    try {
      await env.DB.prepare(
        `INSERT INTO music_cards (id, title, status, key_text, tempo_text, lyrics, notes, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          title,
          status,
          body.key_text != null ? String(body.key_text).slice(0, 40) : null,
          body.tempo_text != null ? String(body.tempo_text).slice(0, 40) : null,
          String(body.lyrics || ""),
          String(body.notes || ""),
          sortOrder,
        )
        .run();
      await env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
         VALUES (?, ?, 'music.card.create', 'music_card', ?)`,
      )
        .bind(uid(), actorEmail, id)
        .run();
      return json({ id, title, status, sort_order: sortOrder }, 201);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  // PUT /api/music/cards/reorder
  if (path === "/api/music/cards/reorder" && method === "PUT") {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)) : [];
    if (!ids.length) return json({ error: "ids required" }, 400);
    try {
      const stmts = ids.map((id, i) =>
        env.DB!.prepare(`UPDATE music_cards SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`).bind(i, id),
      );
      await env.DB.batch(stmts);
      return json({ ok: true, count: ids.length });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  const cardMatch = path.match(/^\/api\/music\/cards\/([^/]+)$/);
  if (cardMatch) {
    const cardId = decodeURIComponent(cardMatch[1]);

    if (method === "GET") {
      try {
        const card = await env.DB.prepare(`SELECT * FROM music_cards WHERE id = ?`).bind(cardId).first();
        if (!card) return json({ error: "Card not found" }, 404);
        const takes = await env.DB.prepare(
          `SELECT id, card_id, kind, label, note, filename, content_type, byte_size, r2_key, sort_order, cue_notes_json, created_at
           FROM music_takes WHERE card_id = ? ORDER BY sort_order ASC, created_at ASC`,
        )
          .bind(cardId)
          .all();
        const takeRows = (takes.results || []).map((t) => {
          const row = t as Record<string, unknown>;
          const r2 = String(row.r2_key || "");
          const { r2_key: _r2, cue_notes_json: _cues, ...rest } = row;
          return {
            ...rest,
            cue_notes: parseCues(String(row.cue_notes_json || "[]")),
            missing: r2.startsWith("music/missing/"),
            url: `/api/music/takes/${encodeURIComponent(String(row.id))}/file`,
          };
        });
        return json({ card, takes: takeRows });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    if (method === "PATCH") {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const existing = await env.DB.prepare(`SELECT id FROM music_cards WHERE id = ?`).bind(cardId).first();
      if (!existing) return json({ error: "Card not found" }, 404);

      const fields: string[] = [];
      const values: unknown[] = [];
      if (body.title != null) {
        fields.push("title = ?");
        values.push(String(body.title).trim().slice(0, 160) || "Untitled");
      }
      if (body.status != null) {
        fields.push("status = ?");
        values.push(normalizeStatus(body.status));
      }
      if ("key_text" in body) {
        fields.push("key_text = ?");
        values.push(body.key_text == null || body.key_text === "" ? null : String(body.key_text).slice(0, 40));
      }
      if ("tempo_text" in body) {
        fields.push("tempo_text = ?");
        values.push(body.tempo_text == null || body.tempo_text === "" ? null : String(body.tempo_text).slice(0, 40));
      }
      if (body.lyrics != null) {
        fields.push("lyrics = ?");
        values.push(String(body.lyrics).slice(0, 200000));
      }
      if (body.notes != null) {
        fields.push("notes = ?");
        values.push(String(body.notes).slice(0, 200000));
      }
      if (body.archived != null) {
        fields.push("archived = ?");
        values.push(body.archived ? 1 : 0);
      }
      if (!fields.length) return json({ error: "No fields to update" }, 400);
      fields.push("updated_at = datetime('now')");
      values.push(cardId);
      try {
        await env.DB.prepare(`UPDATE music_cards SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
        const card = await env.DB.prepare(`SELECT * FROM music_cards WHERE id = ?`).bind(cardId).first();
        return json({ ok: true, card });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    if (method === "DELETE") {
      try {
        const takes = await env.DB.prepare(`SELECT id, r2_key FROM music_takes WHERE card_id = ?`)
          .bind(cardId)
          .all<{ id: string; r2_key: string }>();
        if (env.MEDIA) {
          for (const t of takes.results || []) {
            await env.MEDIA.delete(t.r2_key);
          }
        }
        await env.DB.prepare(`DELETE FROM music_takes WHERE card_id = ?`).bind(cardId).run();
        const del = await env.DB.prepare(`DELETE FROM music_cards WHERE id = ?`).bind(cardId).run();
        if (!del.meta.changes) return json({ error: "Card not found" }, 404);
        await env.DB.prepare(
          `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
           VALUES (?, ?, 'music.card.delete', 'music_card', ?)`,
        )
          .bind(uid(), actorEmail, cardId)
          .run();
        return json({ ok: true, id: cardId });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }
  }

  // POST /api/music/cards/:id/takes
  const takesPost = path.match(/^\/api\/music\/cards\/([^/]+)\/takes$/);
  if (takesPost && method === "POST") {
    if (!env.MEDIA) return json({ error: "R2 MEDIA binding not configured" }, 503);
    const cardId = decodeURIComponent(takesPost[1]);
    const card = await env.DB.prepare(`SELECT id FROM music_cards WHERE id = ?`).bind(cardId).first();
    if (!card) return json({ error: "Card not found" }, 404);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Expected multipart form upload" }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return json({ error: "file required" }, 400);
    if (file.size > MAX_TAKE_BYTES) {
      return json({ error: `Max take size is ${MAX_TAKE_BYTES / (1024 * 1024)}MB` }, 413);
    }
    const kind = kindFromFile(file);
    if (!kind) return json({ error: "Only audio (m4a/mp3/wav) and video (mp4/mov) are supported" }, 415);

    const id = uid();
    const filename = safeFilename(file.name);
    const contentType = file.type || (kind === "audio" ? "audio/mpeg" : "video/mp4");
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const r2Key = `music/${yyyy}/${mm}/${id}-${filename}`;
    const label = form.get("label") ? String(form.get("label")).trim().slice(0, 120) : filename;
    const note = form.get("note") ? String(form.get("note")).trim().slice(0, 2000) : "";
    const sortOrder = await nextTakeSort(env, cardId);

    try {
      const bytes = await file.arrayBuffer();
      await env.MEDIA.put(r2Key, bytes, {
        httpMetadata: { contentType },
        customMetadata: { take_id: id, card_id: cardId, filename },
      });
      await env.DB.prepare(
        `INSERT INTO music_takes (id, card_id, kind, label, note, filename, content_type, byte_size, r2_key, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, cardId, kind, label, note, filename, contentType, file.size, r2Key, sortOrder)
        .run();
      await env.DB.prepare(`UPDATE music_cards SET updated_at = datetime('now') WHERE id = ?`).bind(cardId).run();
      await env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
         VALUES (?, ?, 'music.take.upload', 'music_take', ?)`,
      )
        .bind(uid(), actorEmail, id)
        .run();
      return json(
        {
          id,
          card_id: cardId,
          kind,
          label,
          note,
          filename,
          content_type: contentType,
          byte_size: file.size,
          sort_order: sortOrder,
          cue_notes: [],
          url: `/api/music/takes/${encodeURIComponent(id)}/file`,
        },
        201,
      );
    } catch (e) {
      try {
        await env.MEDIA.delete(r2Key);
      } catch {
        /* ignore cleanup */
      }
      return json({ error: String(e) }, 500);
    }
  }

  // PUT /api/music/cards/:id/takes/reorder
  const takesReorder = path.match(/^\/api\/music\/cards\/([^/]+)\/takes\/reorder$/);
  if (takesReorder && method === "PUT") {
    const cardId = decodeURIComponent(takesReorder[1]);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)) : [];
    try {
      const stmts = ids.map((id, i) =>
        env.DB!.prepare(`UPDATE music_takes SET sort_order = ? WHERE id = ? AND card_id = ?`).bind(i, id, cardId),
      );
      if (stmts.length) await env.DB.batch(stmts);
      await env.DB.prepare(`UPDATE music_cards SET updated_at = datetime('now') WHERE id = ?`).bind(cardId).run();
      return json({ ok: true, count: ids.length });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  const takeFile = path.match(/^\/api\/music\/takes\/([^/]+)\/file$/);
  if (takeFile && method === "GET") {
    if (!env.MEDIA) return new Response("Media unavailable", { status: 503 });
    const takeId = decodeURIComponent(takeFile[1]);
    const row = await env.DB.prepare(
      `SELECT id, r2_key, content_type, filename FROM music_takes WHERE id = ?`,
    )
      .bind(takeId)
      .first<{ id: string; r2_key: string; content_type: string; filename: string }>();
    if (!row) return new Response("Not found", { status: 404 });
    const obj = await env.MEDIA.get(row.r2_key);
    if (!obj) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    headers.set("content-type", row.content_type || "application/octet-stream");
    headers.set("cache-control", "private, max-age=3600");
    headers.set("x-content-type-options", "nosniff");
    headers.set("content-disposition", `inline; filename="${row.filename.replace(/"/g, "")}"`);
    return new Response(obj.body, { status: 200, headers });
  }

  const takeOne = path.match(/^\/api\/music\/takes\/([^/]+)$/);
  if (takeOne) {
    const takeId = decodeURIComponent(takeOne[1]);

    if (method === "PATCH") {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const existing = await env.DB.prepare(`SELECT id, card_id FROM music_takes WHERE id = ?`)
        .bind(takeId)
        .first<{ id: string; card_id: string }>();
      if (!existing) return json({ error: "Take not found" }, 404);

      const fields: string[] = [];
      const values: unknown[] = [];
      if (body.label != null) {
        fields.push("label = ?");
        values.push(String(body.label).slice(0, 120));
      }
      if (body.note != null) {
        fields.push("note = ?");
        values.push(String(body.note).slice(0, 2000));
      }
      if (body.cue_notes != null) {
        const cues = Array.isArray(body.cue_notes) ? body.cue_notes : [];
        fields.push("cue_notes_json = ?");
        values.push(JSON.stringify(parseCues(JSON.stringify(cues))));
      }
      if (!fields.length) return json({ error: "No fields to update" }, 400);
      values.push(takeId);
      try {
        await env.DB.prepare(`UPDATE music_takes SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
        await env.DB.prepare(`UPDATE music_cards SET updated_at = datetime('now') WHERE id = ?`)
          .bind(existing.card_id)
          .run();
        const take = await env.DB.prepare(`SELECT * FROM music_takes WHERE id = ?`).bind(takeId).first();
        const row = take as Record<string, unknown>;
        return json({
          ok: true,
          take: {
            ...row,
            cue_notes: parseCues(String(row.cue_notes_json || "[]")),
            url: `/api/music/takes/${encodeURIComponent(takeId)}/file`,
          },
        });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    if (method === "DELETE") {
      if (!env.MEDIA) return json({ error: "R2 MEDIA binding not configured" }, 503);
      const row = await env.DB.prepare(`SELECT id, card_id, r2_key FROM music_takes WHERE id = ?`)
        .bind(takeId)
        .first<{ id: string; card_id: string; r2_key: string }>();
      if (!row) return json({ error: "Take not found" }, 404);
      try {
        if (row.r2_key && !row.r2_key.startsWith("music/missing/")) {
          await env.MEDIA.delete(row.r2_key);
        }
        await env.DB.prepare(`DELETE FROM music_takes WHERE id = ?`).bind(takeId).run();
        await env.DB.prepare(`UPDATE music_cards SET updated_at = datetime('now') WHERE id = ?`)
          .bind(row.card_id)
          .run();
        return json({ ok: true, id: takeId });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }
  }

  // POST /api/music/takes/:id/relink — replace missing/broken media bytes
  const takeRelink = path.match(/^\/api\/music\/takes\/([^/]+)\/relink$/);
  if (takeRelink && method === "POST") {
    if (!env.MEDIA) return json({ error: "R2 MEDIA binding not configured" }, 503);
    const takeId = decodeURIComponent(takeRelink[1]);
    const existing = await env.DB.prepare(
      `SELECT id, card_id, kind, r2_key, filename FROM music_takes WHERE id = ?`,
    )
      .bind(takeId)
      .first<{ id: string; card_id: string; kind: string; r2_key: string; filename: string }>();
    if (!existing) return json({ error: "Take not found" }, 404);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Expected multipart form upload" }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return json({ error: "file required" }, 400);
    if (file.size > MAX_TAKE_BYTES) {
      return json({ error: `Max take size is ${MAX_TAKE_BYTES / (1024 * 1024)}MB` }, 413);
    }
    const kind = kindFromFile(file);
    if (!kind) return json({ error: "Only audio (m4a/mp3/wav) and video (mp4/mov) are supported" }, 415);
    if (kind !== existing.kind) {
      return json({ error: `Expected a ${existing.kind} file for this take` }, 415);
    }

    const filename = safeFilename(file.name);
    const contentType = file.type || (kind === "audio" ? "audio/mpeg" : "video/mp4");
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const r2Key = `music/${yyyy}/${mm}/${takeId}-${filename}`;

    try {
      const bytes = await file.arrayBuffer();
      await env.MEDIA.put(r2Key, bytes, {
        httpMetadata: { contentType },
        customMetadata: { take_id: takeId, card_id: existing.card_id, filename },
      });
      if (existing.r2_key && existing.r2_key !== r2Key && !existing.r2_key.startsWith("music/missing/")) {
        try {
          await env.MEDIA.delete(existing.r2_key);
        } catch {
          /* keep new object even if old cleanup fails */
        }
      }
      await env.DB.prepare(
        `UPDATE music_takes SET filename = ?, content_type = ?, byte_size = ?, r2_key = ? WHERE id = ?`,
      )
        .bind(filename, contentType, file.size, r2Key, takeId)
        .run();
      await env.DB.prepare(`UPDATE music_cards SET updated_at = datetime('now') WHERE id = ?`)
        .bind(existing.card_id)
        .run();
      return json({
        ok: true,
        take: {
          id: takeId,
          filename,
          content_type: contentType,
          byte_size: file.size,
          url: `/api/music/takes/${encodeURIComponent(takeId)}/file`,
          missing: false,
        },
      });
    } catch (e) {
      try {
        await env.MEDIA.delete(r2Key);
      } catch {
        /* ignore */
      }
      return json({ error: String(e) }, 500);
    }
  }

  // POST /api/music/import/take-stub — create a take row without media (for missing backup files)
  if (path === "/api/music/import/take-stub" && method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const cardId = String(body.card_id || "");
    const card = await env.DB.prepare(`SELECT id FROM music_cards WHERE id = ?`).bind(cardId).first();
    if (!card) return json({ error: "Card not found" }, 404);
    const kind = body.kind === "video" ? "video" : body.kind === "audio" ? "audio" : null;
    if (!kind) return json({ error: "kind must be audio or video" }, 400);
    const id = uid();
    const filename = safeFilename(String(body.filename || "missing-file"));
    const label = String(body.label || filename).slice(0, 120);
    const note = String(body.note || "").slice(0, 2000);
    const contentType = String(body.content_type || (kind === "audio" ? "audio/mpeg" : "video/mp4"));
    const cues = Array.isArray(body.cue_notes) ? body.cue_notes : [];
    const sortOrder = await nextTakeSort(env, cardId);
    const r2Key = `music/missing/${id}`;
    try {
      await env.DB.prepare(
        `INSERT INTO music_takes (id, card_id, kind, label, note, filename, content_type, byte_size, r2_key, sort_order, cue_notes_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
        .bind(id, cardId, kind, label, note, filename, contentType, r2Key, sortOrder, JSON.stringify(parseCues(JSON.stringify(cues))))
        .run();
      return json({
        id,
        card_id: cardId,
        kind,
        label,
        note,
        filename,
        content_type: contentType,
        byte_size: 0,
        sort_order: sortOrder,
        cue_notes: parseCues(JSON.stringify(cues)),
        missing: true,
        url: `/api/music/takes/${encodeURIComponent(id)}/file`,
      }, 201);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  // GET /api/music/export — manifest only (client packs zip with take files)
  if (path === "/api/music/export" && method === "GET") {
    const url = new URL(request.url);
    const cardId = url.searchParams.get("card_id");
    try {
      let cardsQuery = `SELECT * FROM music_cards`;
      const binds: string[] = [];
      if (cardId) {
        cardsQuery += ` WHERE id = ?`;
        binds.push(cardId);
      }
      cardsQuery += ` ORDER BY sort_order ASC`;
      const cards = binds.length
        ? await env.DB.prepare(cardsQuery).bind(...binds).all()
        : await env.DB.prepare(cardsQuery).all();
      const cardRows = cards.results || [];
      const ids = cardRows.map((c) => String((c as { id: string }).id));
      let takes: unknown[] = [];
      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        const takeRes = await env.DB.prepare(
          `SELECT * FROM music_takes WHERE card_id IN (${placeholders}) ORDER BY sort_order ASC`,
        )
          .bind(...ids)
          .all();
        takes = (takeRes.results || []).map((t) => {
          const row = t as Record<string, unknown>;
          return {
            ...row,
            cue_notes: parseCues(String(row.cue_notes_json || "[]")),
            file_path: `media/${row.id}-${row.filename}`,
          };
        });
      }
      return json({
        format: "daneshtabrizi.music.backup",
        version: 1,
        exported_at: new Date().toISOString(),
        cards: cardRows,
        takes,
      });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  return json({ error: "Not found" }, 404);
}
