import { handleApi } from "./functions/lib/api-router";
import { serveMediaFile } from "./functions/lib/media";

export interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  MEDIA?: R2Bucket;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;
  DEV_AUTH_EMAIL?: string;
  [key: string]: unknown;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const mediaMatch = url.pathname.match(/^\/media\/([^/]+)\/?$/);
    if (mediaMatch && request.method === "GET") {
      return serveMediaFile(env, decodeURIComponent(mediaMatch[1]));
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env as Env & { DB: D1Database });
    }
    return env.ASSETS.fetch(request);
  },
};
