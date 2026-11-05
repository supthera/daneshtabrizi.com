import { json, resolveIdentity } from "../../lib/auth";

type Env = {
  DB?: D1Database;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;
  DEV_AUTH_EMAIL?: string;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const identity = await resolveIdentity(context.request, context.env);
  if (!identity) return json({ error: "Unauthorized" }, 401);
  if (!context.env.DB) return json({ websites: [], note: "D1 not bound yet" });

  try {
    const rows = await context.env.DB.prepare(
      `SELECT id, name, domain, connector_type, enabled, connection_status,
              last_successful_connection, last_publication_at
       FROM websites ORDER BY name ASC`
    ).all();
    return json({ websites: rows.results || [] });
  } catch (e) {
    return json({ websites: [], error: String(e) }, 500);
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

  const websiteId = crypto.randomUUID();
  const name = String(body.name || "").trim();
  const domain = String(body.domain || "").trim();
  const connector = String(body.connector_type || "custom_rest");
  const endpoint = body.api_endpoint ? String(body.api_endpoint) : null;

  if (!name || !domain) return json({ error: "name and domain required" }, 400);

  try {
    await context.env.DB.prepare(
      `INSERT INTO websites (id, name, domain, connector_type, api_endpoint)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(websiteId, name, domain, connector, endpoint)
      .run();

    await context.env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_email, action, resource_type, resource_id)
       VALUES (?, ?, 'website.create', 'website', ?)`
    )
      .bind(crypto.randomUUID(), identity.email, websiteId)
      .run();

    return json({ id: websiteId, name, domain, connector_type: connector }, 201);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};
