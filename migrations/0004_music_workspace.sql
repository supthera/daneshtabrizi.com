-- Music Studio workspace: cards + takes (media in R2 under music/).
CREATE TABLE IF NOT EXISTS music_cards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','in_progress','finished')),
  key_text TEXT,
  tempo_text TEXT,
  lyrics TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS music_takes (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('audio','video')),
  label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  cue_notes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES music_cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_music_cards_sort ON music_cards(archived, sort_order, updated_at);
CREATE INDEX IF NOT EXISTS idx_music_takes_card ON music_takes(card_id, sort_order);
