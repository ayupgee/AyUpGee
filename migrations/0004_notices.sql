-- AyUpGee - Migration 0004: Site Notices
-- Stores admin-managed banners shown on the homepage.
-- Max 3 active at once (enforced in API layer).
--
-- Apply with:
--   wrangler d1 migrations apply ayupgee-db --remote

CREATE TABLE IF NOT EXISTS notices (
  id         TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  emoji      TEXT    NOT NULL DEFAULT '📢',
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notices_active_order ON notices (is_active, sort_order);
