import { resolveIdentity, unauthorized, type AccessIdentity } from "./lib/auth";

type Env = {
  DB?: D1Database;
  MEDIA?: R2Bucket;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;
  DEV_AUTH_EMAIL?: string;
};

export type AppContext = EventContext<Env, string, { identity?: AccessIdentity }>;

function needsAuth(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  if (pathname === "/private" || pathname.startsWith("/private/")) return true;
  return false;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, next, env, data } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (!needsAuth(path)) {
    return next();
  }

  const identity = await resolveIdentity(request, env);
  if (!identity) {
    if (path.startsWith("/api/")) {
      return unauthorized("Cloudflare Access authentication required");
    }
    // HTML routes: let Access / browser handle login by bouncing to /private/
    // When Access is configured at the edge, unauthenticated users never reach here.
    // When Access is missing (misconfig), show a clear 401 page instead of private UI.
    if (request.headers.get("accept")?.includes("text/html")) {
      return new Response(
        `<!doctype html><html><head><meta charset="utf-8"/><title>Access Required</title>
        <style>body{font-family:ui-monospace,monospace;background:#0c0b0b;color:#ece6da;display:grid;place-items:center;min-height:100vh;margin:0}
        main{max-width:28rem;padding:2rem;border:1px solid rgba(236,230,218,.12)}
        a{color:#ffae3b}</style></head><body><main>
        <p style="letter-spacing:.2em;font-size:.7rem;color:#8d877b">PRIVATE ACCESS</p>
        <h1 style="font-size:1.4rem">Authentication required</h1>
        <p style="color:#8d877b;line-height:1.5">Configure Cloudflare Access for <code>/private/*</code> and <code>/api/*</code>, then sign in with your authorized identity.</p>
        <p><a href="/">Return to public site</a></p>
        </main></body></html>`,
        { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
      );
    }
    return unauthorized();
  }

  data.identity = identity;

  // Soft audit for API mutations later; identity available to handlers via context.data
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("cache-control", headers.get("cache-control") || "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
