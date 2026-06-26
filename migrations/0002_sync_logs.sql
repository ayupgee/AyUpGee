-- AyUpGee – Migration 0002: Social Sync Logs
-- Tracks every sync attempt across all social platforms.
-- Apply with: wrangler d1 execute ayupgee-db --file=migrations/0002_sync_logs.sql --remote

CREATE TABLE IF NOT EXISTS sync_logs (
  id               TEXT    NOT NULL DEFAULT (lower(hex(randomblob(8)))),
  platform         TEXT    NOT NULL,          -- 'instagram' | 'tiktok' | 'twitch' | 'system'
  event            TEXT    NOT NULL,          -- 'sync_success' | 'sync_error' | 'auth_refresh' | 'ping'
  message          TEXT    NOT NULL,
  items_synced     INTEGER NOT NULL DEFAULT 0,
  error_message    TEXT,
  response_time_ms INTEGER,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_platform_created
  ON sync_logs (platform, created_at DESC);
