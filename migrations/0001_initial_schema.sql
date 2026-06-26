-- ═══════════════════════════════════════════════════════════════════════════
-- AyUpGee — Initial Database Schema
-- Migration: 0001_initial_schema
-- Apply: wrangler d1 migrations apply ayupgee-db --remote
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member'
               CHECK (role IN ('admin', 'moderator', 'member')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_login   TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- ─── Sessions ─────────────────────────────────────────────────────────────────
-- Stores a SHA-256 hash of the session token, not the token itself.
-- The raw token lives only in the user's HTTP-only cookie.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  expires_at  TEXT NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Schedule overrides ───────────────────────────────────────────────────────
-- Manual entries that supplement or override the Twitch API schedule.
-- Phase 2: admin can pin, cancel, or add entries that Twitch doesn't know about.
CREATE TABLE IF NOT EXISTS schedule (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  game            TEXT,
  description     TEXT,
  start_time      TEXT NOT NULL,
  end_time        TEXT,
  twitch_event_id TEXT,          -- links to Twitch segment if sourced from API
  is_cancelled    INTEGER NOT NULL DEFAULT 0,
  is_published    INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Posts (blog / news) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  excerpt     TEXT,
  content     TEXT NOT NULL DEFAULT '',
  published   INTEGER NOT NULL DEFAULT 0,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Media library ────────────────────────────────────────────────────────────
-- R2 object references. storage_key is the R2 object key.
CREATE TABLE IF NOT EXISTS media (
  id           TEXT PRIMARY KEY,
  filename     TEXT NOT NULL,
  alt_text     TEXT,
  storage_key  TEXT NOT NULL UNIQUE,  -- R2 key
  mime_type    TEXT,
  size_bytes   INTEGER,
  width        INTEGER,
  height       INTEGER,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Site settings (key/value store) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('site_title',       'AyUpGee'),
  ('site_description', 'Cosy gaming from Manchester'),
  ('twitch_channel',   'ayupgee'),
  ('discord_invite',   'https://discord.gg/uAhZtzkKDU'),
  ('maintenance_mode', '0');

-- ─── Audit log ────────────────────────────────────────────────────────────────
-- Immutable append-only log. Nothing is ever deleted from here.
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,                   -- nullable: pre-auth actions (failed logins, etc.)
  action     TEXT NOT NULL,          -- e.g. 'auth.login', 'user.update', 'post.publish'
  resource   TEXT,                   -- e.g. 'post:abc123'
  details    TEXT,                   -- JSON string of relevant metadata
  ip_address TEXT,
  user_agent TEXT,
  timestamp  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Future tables (Phase 3+) — commented stubs for reference
-- ═══════════════════════════════════════════════════════════════════════════

-- member_profiles: extended profile for community members
-- connected_accounts: Twitch/Discord/YouTube OAuth links per user
-- loyalty_points: balance + transaction log
-- achievements: badge definitions + user awards
-- giveaways: giveaway campaigns + entries
-- redemptions: redeemable items + transactions
-- notifications: per-user notification queue
-- comments: threaded comments on posts/streams
-- valley_submissions: DreamSnaps + valley design submissions
-- events: stream events + registrations

-- ═══════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash  ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id     ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at  ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_users_email          ON users(email);
CREATE INDEX IF NOT EXISTS idx_posts_slug           ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_published      ON posts(published, published_at);
CREATE INDEX IF NOT EXISTS idx_schedule_start_time  ON schedule(start_time);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp  ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_action     ON audit_log(action);
