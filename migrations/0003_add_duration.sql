-- AyUpGee – Migration 0003: Add duration column to social_posts
-- Stores human-readable duration strings for Twitch VODs ("3:42:18") and
-- YouTube videos ("18:42"). NULL for platforms that don't have durations.
--
-- Apply with:
--   wrangler d1 migrations apply ayupgee-db --remote
--
-- Safe to run on an existing table — SQLite ADD COLUMN sets NULL for all rows.

ALTER TABLE social_posts ADD COLUMN duration TEXT;
