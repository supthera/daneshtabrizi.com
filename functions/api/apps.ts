import { json, resolveIdentity } from "../lib/auth";
import { FALLBACK_APPS, type AppRecord } from "../lib/apps";

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

  let apps: AppRecord[] = FALLBACK_APPS;

  if (context.env.DB) {
    try {
      const rows = await context.env.DB.prepare(
        `SELECT id, name, description, icon, route, status, version, sort_order
         FROM applications
         WHERE status != 'hidden'
         ORDER BY sort_order ASC, name ASC`
      ).all<AppRecord>();
      if (rows.results?.length) apps = rows.results;
    } catch {
      // Fall back to static registry until migrations are applied
      apps = FALLBACK_APPS;
    }
  }

  return json({ apps, identity: { email: identity.email } });
};
