/**
 * Cloudflare Pages Function — GET /api/twitch/schedule
 *
 * Proxies the Twitch Helix schedule API with a 15-minute edge cache.
 * Secrets are read from Cloudflare environment variables — never exposed to the frontend.
 *
 * Required env vars (set in Cloudflare Pages → Settings → Environment variables):
 *   TWITCH_CLIENT_ID        — from https://dev.twitch.tv/console
 *   TWITCH_CLIENT_SECRET    — from https://dev.twitch.tv/console
 *   TWITCH_BROADCASTER_ID   — numeric ID for twitch.tv/ayupgee (see README comments below)
 *
 * Response shape:
 *   { source, timezone, items: [{ id, title, category, startTime, endTime, url, isRecurring }] }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 2 TODO — Admin backend:
 *   - Add a Cloudflare D1 table `schedule_overrides` (id, date, title, time, cancel: bool)
 *   - Merge overrides here: cancelled entries remove Twitch segments, manual entries are injected
 *   - Recommended stack: Cloudflare Pages + Workers + D1 + R2 + Clerk for auth
 *   - Supabase is a solid alternative if you prefer a managed Postgres + auth combo
 *
 * PHASE 3 TODO — Automatic media widgets:
 *   - Add /api/twitch/vods  → GET /helix/videos?user_id=…&type=archive
 *   - Add /api/youtube/videos → YouTube Data API v3 /search or /videos
 *   - TikTok: no official API for latest posts; use manual-override approach or TikTok embed
 *   - Instagram: Basic Display API for own-account posts (requires Facebook app approval)
 *   - All endpoints should follow the same cache + fallback pattern as this file
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TWITCH_TOKEN_URL    = 'https://id.twitch.tv/oauth2/token';
const TWITCH_SCHEDULE_URL = 'https://api.twitch.tv/helix/schedule';
const CACHE_TTL           = 15 * 60;          // seconds
const WINDOW_DAYS         = 7;                // how far ahead to return

export async function onRequest(context) {
  const { env, request } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  // ── Guard: env vars not configured (local dev without wrangler secrets) ──
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET || !env.TWITCH_BROADCASTER_ID) {
    return new Response(
      JSON.stringify({ error: 'not_configured', message: 'Twitch env vars not set — see README' }),
      { status: 503, headers }
    );
  }

  // ── Edge cache ─────────────────────────────────────────────────────────────
  const cache    = caches.default;
  const cacheKey = new Request(new URL('/api/twitch/schedule', request.url).toString());
  const cached   = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.text();
    return new Response(body, { headers: { ...headers, 'X-Cache': 'HIT' } });
  }

  try {
    // ── 1. App access token ──────────────────────────────────────────────────
    const tokenRes = await fetch(TWITCH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     env.TWITCH_CLIENT_ID,
        client_secret: env.TWITCH_CLIENT_SECRET,
        grant_type:    'client_credentials',
      }),
    });
    if (!tokenRes.ok) throw new Error(`Token fetch failed: ${tokenRes.status}`);
    const { access_token } = await tokenRes.json();

    // ── 2. Twitch schedule ───────────────────────────────────────────────────
    const schedUrl = new URL(TWITCH_SCHEDULE_URL);
    schedUrl.searchParams.set('broadcaster_id', env.TWITCH_BROADCASTER_ID);
    schedUrl.searchParams.set('start_time', new Date().toISOString());
    schedUrl.searchParams.set('first', '25');

    const schedRes = await fetch(schedUrl.toString(), {
      headers: {
        'Client-Id':     env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${access_token}`,
      },
    });

    // 404 = broadcaster has no schedule set up; return empty array gracefully
    if (schedRes.status === 404) {
      return new Response(
        JSON.stringify({ source: 'twitch', timezone: 'Europe/London', items: [] }),
        { headers }
      );
    }
    if (!schedRes.ok) throw new Error(`Schedule fetch failed: ${schedRes.status}`);

    const { data } = await schedRes.json();

    // ── 3. Normalise ─────────────────────────────────────────────────────────
    const cutoff = Date.now() + WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const items = (data?.segments ?? [])
      .filter(s => !s.canceled_until && new Date(s.start_time).getTime() <= cutoff)
      .map(s => ({
        id:          s.id,
        title:       s.title || s.category?.name || 'Stream',
        category:    s.category?.name ?? null,
        startTime:   s.start_time,
        endTime:     s.end_time ?? null,
        url:         `https://www.twitch.tv/${data.broadcaster_login ?? 'ayupgee'}`,
        isRecurring: s.is_recurring ?? false,
      }));

    const payload = JSON.stringify({
      source:   'twitch',
      timezone: 'Europe/London',
      items,
    });

    // ── 4. Cache and respond ─────────────────────────────────────────────────
    const response = new Response(payload, {
      headers: {
        ...headers,
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
        'X-Cache': 'MISS',
      },
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;

  } catch (err) {
    console.error('[/api/twitch/schedule]', err.message);
    return new Response(
      JSON.stringify({ error: 'schedule_unavailable', message: err.message }),
      { status: 503, headers }
    );
  }
}
