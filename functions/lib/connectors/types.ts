/** Standardized connector interface for multi-site publishing. */

export type PublishStatus = "draft" | "published" | "scheduled";

export type PublishAuthor = {
  name: string;
  url?: string;
  avatar_url?: string;
};

export type PublishPayload = {
  article_id: string;
  title: string;
  slug?: string;
  content: string;
  excerpt?: string;
  featured_image?: string;
  author?: PublishAuthor;
  seo?: {
    title?: string;
    description?: string;
    og_title?: string;
    og_description?: string;
    og_image?: string;
  };
  categories?: string[];
  tags?: string[];
  canonical_url?: string;
  status: PublishStatus;
  scheduled_for?: string;
};

export type PublishResult = {
  ok: boolean;
  stage:
    | "authenticated"
    | "content_received"
    | "content_saved"
    | "build_triggered"
    | "deployment_completed"
    | "publicly_accessible"
    | "failed";
  remote_id?: string;
  published_url?: string;
  error?: string;
  raw?: unknown;
};

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  tested_at: string;
};

export interface PublisherConnector {
  readonly type: "custom_rest" | "wordpress" | "webflow" | "other";
  testConnection(): Promise<ConnectionTestResult>;
  createArticle(payload: PublishPayload): Promise<PublishResult>;
  updateArticle(remoteId: string, payload: PublishPayload): Promise<PublishResult>;
}
