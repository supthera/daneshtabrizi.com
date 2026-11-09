import { joinEndpoint } from "../urls";
import type {
  ConnectionTestResult,
  PublishPayload,
  PublishResult,
  PublisherConnector,
} from "./types";

/**
 * Custom REST connector for independently hosted sites.
 * Destination must expose authenticated endpoints and return clear stage signals.
 * For static sites: receiving content ≠ publicly accessible until rebuild/deploy completes.
 */
export class CustomRestConnector implements PublisherConnector {
  readonly type = "custom_rest" as const;

  constructor(
    private readonly endpoint: string,
    private readonly token: string
  ) {}

  private headers(): HeadersInit {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.token}`,
      accept: "application/json",
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const tested_at = new Date().toISOString();
    try {
      const res = await fetch(joinEndpoint(this.endpoint, "health"), {
        headers: this.headers(),
      });
      if (!res.ok) {
        return { ok: false, message: `Health check failed (${res.status})`, tested_at };
      }
      return { ok: true, message: "Connection ok", tested_at };
    } catch (e) {
      return { ok: false, message: String(e), tested_at };
    }
  }

  async createArticle(payload: PublishPayload): Promise<PublishResult> {
    try {
      const res = await fetch(joinEndpoint(this.endpoint, "articles"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          stage: "failed",
          error: (raw && (raw as { error?: string }).error) || `HTTP ${res.status}`,
          raw,
        };
      }
      const data = raw as {
        remote_id?: string;
        published_url?: string;
        stage?: PublishResult["stage"];
      };
      const stage = data.stage || (data.published_url ? "content_saved" : "content_received");
      return {
        ok: true,
        stage,
        remote_id: data.remote_id,
        published_url: data.published_url,
        raw,
      };
    } catch (e) {
      return { ok: false, stage: "failed", error: String(e) };
    }
  }

  async updateArticle(remoteId: string, payload: PublishPayload): Promise<PublishResult> {
    try {
      const res = await fetch(joinEndpoint(this.endpoint, `articles/${encodeURIComponent(remoteId)}`), {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify(payload),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          stage: "failed",
          error: (raw && (raw as { error?: string }).error) || `HTTP ${res.status}`,
          raw,
        };
      }
      const data = raw as {
        published_url?: string;
        stage?: PublishResult["stage"];
      };
      return {
        ok: true,
        stage: data.stage || "content_saved",
        remote_id: remoteId,
        published_url: data.published_url,
        raw,
      };
    } catch (e) {
      return { ok: false, stage: "failed", error: String(e) };
    }
  }
}
