-- Personal Command Center + Publisher HQ schema

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'app',
  route TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','planned','disabled','hidden')),
  version TEXT NOT NULL DEFAULT '0.1.0',
  visibility TEXT NOT NULL DEFAULT 'private',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS application_permissions (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  UNIQUE(application_id, user_id)
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  slug TEXT,
  content_html TEXT NOT NULL DEFAULT '',
  excerpt TEXT,
  featured_image_id TEXT,
  author TEXT,
  seo_title TEXT,
  seo_description TEXT,
  canonical_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','archived')),
  scheduled_for TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at);

CREATE TABLE IF NOT EXISTS article_versions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  website_id TEXT,
  title TEXT,
  slug TEXT,
  content_html TEXT,
  excerpt TEXT,
  featured_image_id TEXT,
  seo_title TEXT,
  seo_description TEXT,
  canonical_url TEXT,
  categories_json TEXT,
  tags_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS websites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  connector_type TEXT NOT NULL CHECK (connector_type IN ('custom_rest','wordpress','webflow','other')),
  api_endpoint TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  connection_status TEXT NOT NULL DEFAULT 'unknown',
  last_successful_connection TEXT,
  last_publication_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Encrypted credential blob / secret reference — never store plaintext API keys here
CREATE TABLE IF NOT EXISTS website_credentials (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL UNIQUE REFERENCES websites(id) ON DELETE CASCADE,
  secret_ref TEXT NOT NULL,
  meta_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS article_destinations (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  website_id TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  version_id TEXT REFERENCES article_versions(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','publishing','published','failed','skipped')),
  published_url TEXT,
  remote_id TEXT,
  error_message TEXT,
  last_attempt_at TEXT,
  published_at TEXT,
  idempotency_key TEXT UNIQUE,
  UNIQUE(article_id, website_id)
);

CREATE TABLE IF NOT EXISTS publishing_jobs (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('draft','publish','schedule')),
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS publishing_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES publishing_jobs(id) ON DELETE SET NULL,
  article_id TEXT,
  website_id TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_publishing_logs_created ON publishing_logs(created_at);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  title TEXT,
  alt_text TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_email TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- Seed application registry
INSERT OR IGNORE INTO applications (id, name, description, icon, route, status, version, sort_order) VALUES
  ('publisher-hq', 'Publisher HQ', 'Centralized multi-website publishing management.', 'publish', '/private/publisher/', 'active', '0.1.0', 10),
  ('trading-center', 'Trading Center', 'Future financial research and trading tools.', 'trade', '/private/apps/#trading-center', 'planned', '0.0.0', 20),
  ('project-center', 'Project Center', 'Future project and operations management.', 'project', '/private/apps/#project-center', 'planned', '0.0.0', 30),
  ('administration', 'Administration', 'Private settings, accounts, integrations, and application management.', 'admin', '/private/settings/', 'active', '0.1.0', 90);
