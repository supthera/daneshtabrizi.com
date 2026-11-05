import { json, resolveIdentity } from "../lib/auth";

type Env = {
  DB?: D1Database;
  MEDIA?: R2Bucket;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;
  DEV_AUTH_EMAIL?: string;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const identity = await resolveIdentity(context.request, context.env);
  if (!identity) {
    return json({ error: "Unauthorized" }, 401);
  }

  let dbOk = false;
  if (context.env.DB) {
    try {
      await context.env.DB.prepare("SELECT 1 AS ok").first();
      dbOk = true;
    } catch {
      dbOk = false;
    }
  }

  return json({
    ok: true,
    identity: { email: identity.email, source: identity.source },
    bindings: {
      d1: Boolean(context.env.DB),
      d1_query_ok: dbOk,
      r2: Boolean(context.env.MEDIA),
      access_configured: Boolean(context.env.CF_ACCESS_TEAM_DOMAIN && context.env.CF_ACCESS_AUD),
    },
  });
};
