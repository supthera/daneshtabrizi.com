/**
 * Cloudflare Access JWT validation + localhost-only development adapter.
 * Production always requires a valid CF Access JWT. Dev bypass cannot enable in production.
 */

export type AccessIdentity = {
  email: string;
  name?: string;
  sub?: string;
  source: "cloudflare-access" | "dev-bypass";
};

type Env = {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;
  DEV_AUTH_EMAIL?: string;
};

function b64urlToBytes(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = new TextDecoder().decode(b64urlToBytes(parts[1]));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchAccessCerts(teamDomain: string): Promise<JsonWebKey[]> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const data = (await res.json()) as { keys?: JsonWebKey[] };
  return data.keys || [];
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  aud: string
): Promise<AccessIdentity | null> {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const email = String(payload.email || "");
  if (!email) return null;

  // Expiry
  const exp = Number(payload.exp || 0);
  if (!exp || exp * 1000 < Date.now()) return null;

  // Audience
  const tokenAud = payload.aud;
  const audOk = Array.isArray(tokenAud)
    ? tokenAud.includes(aud)
    : String(tokenAud || "") === aud;
  if (!audOk) return null;

  // Signature via Access public certs (RS256)
  const parts = token.split(".");
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64))) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== "RS256") return null;

  const keys = await fetchAccessCerts(teamDomain);
  const jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid) || keys[0];
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = b64urlToBytes(sigB64);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  if (!ok) return null;

  return {
    email,
    name: payload.name ? String(payload.name) : undefined,
    sub: payload.sub ? String(payload.sub) : undefined,
    source: "cloudflare-access",
  };
}

function isLocalHost(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
}

function isProduction(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === "daneshtabrizi.com" || host.endsWith(".pages.dev") === false && host.includes("daneshtabrizi");
}

/**
 * Resolve identity for a request.
 * - Prefer CF-Access-Jwt-Assertion
 * - Dev bypass only on localhost AND DEV_AUTH_BYPASS=true AND never on production hosts
 */
function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=") || null;
  }
  return null;
}

export async function resolveIdentity(
  request: Request,
  env: Env
): Promise<AccessIdentity | null> {
  const jwt =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    request.headers.get("CF-Access-JWT-Assertion") ||
    // Access session cookie — needed when /api* was not itself behind Access
    cookieValue(request, "CF_Authorization");

  if (jwt && env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD) {
    try {
      return await verifyAccessJwt(jwt, env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD);
    } catch {
      return null;
    }
  }

  // If Access JWT present but secrets missing, reject rather than pass
  if (jwt && (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD)) {
    return null;
  }

  const bypass = env.DEV_AUTH_BYPASS === "true";
  const local = isLocalHost(request);
  const prodHost = (() => {
    const h = new URL(request.url).hostname;
    return h === "daneshtabrizi.com" || h === "www.daneshtabrizi.com";
  })();

  if (bypass && local && !prodHost) {
    const email = env.DEV_AUTH_EMAIL || "dev@localhost";
    return { email, name: "Dev Operator", source: "dev-bypass" };
  }

  return null;
}

export function unauthorized(message = "Unauthorized"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export { timingSafeEqual, isLocalHost, isProduction };
