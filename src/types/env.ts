/**
 * Cloudflare environment bindings.
 * All secrets are injected at runtime — never hardcoded.
 */
export interface Env {
  // ── Cloudflare bindings ──────────────────────────────────────────────────
  /** D1 database instance */
  DB: D1Database;
  /** KV namespace for rate limiting and short-lived cache */
  CACHE: KVNamespace;
  // Future: R2 for media storage
  // MEDIA: R2Bucket;

  // ── Secrets (set via Cloudflare dashboard or wrangler secret) ───────────
  /** 32+ byte random string — signs session tokens */
  SESSION_SECRET: string;
  /** 32+ byte random string — CSRF token validation */
  CSRF_SECRET: string;
  /** Cloudflare Turnstile secret key */
  TURNSTILE_SECRET_KEY: string;
  /** Cloudflare Turnstile site key (public, safe in HTML) */
  TURNSTILE_SITE_KEY: string;
  /** One-time token for bootstrapping the first admin account */
  ADMIN_SETUP_TOKEN?: string;

  // ── Third-party API secrets (Phase 3) ────────────────────────────────────
  /** Twitch app client ID (already used in Phase 1) */
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  TWITCH_BROADCASTER_ID?: string;
  // YOUTUBE_API_KEY?: string;
  // DISCORD_BOT_TOKEN?: string;
}
