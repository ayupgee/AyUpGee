/**
 * GET /api/social/youtube
 *
 * Returns the latest 3 YouTube videos from the D1 social_posts table.
 * Rows are written by the ayupgee-social-sync Cloudflare Worker (every 12 h).
 * No YouTube API key is needed here — this is a pure D1 read.
 *
 * ─── Required env vars ─────────────────────────────────────────────────────────
 *   DB   — Cloudflare D1 binding (configured in wrangler.toml)
 *
 * ─── Response shape ─────────────────────────────────────────────────────────────
 *   { ok: true, items: [{ id, url, title, thumbnailUrl, publishedAt, duration }] }
 *
 * ─── Caching ────────────────────────────────────────────────────────────────────
 *   2-hour edge cache — sync worker refreshes D1 every 12 h.
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function ok(items) {
  return new Response(JSON.stringify({ ok: true, items }), {
    headers: {
      ...JSON_HEADERS,
      'Cache-Control': 'public, max-age=7200', // 2-hour edge cache
    },
  });
}

function fail(message, status = 500) {
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.DB) {
    return fail('Database not configured', 503);
  }

  try {
    const { results } = await env.DB.prepare(`
      SELECT id, url, title, thumbnail_url, published_at, duration
      FROM   social_posts
      WHERE  platform = 'youtube'
      ORDER  BY published_at DESC, updated_at DESC
      LIMIT  3
    `).all();

    const items = (results ?? []).map(row => ({
      id:           row.id,
      url:          row.url,
      title:        row.title,
      thumbnailUrl: row.thumbnail_url,
      publishedAt:  row.published_at,
      duration:     row.duration ?? '',
    }));

    return ok(items);
  } catch (e) {
    console.error('[/api/social/youtube]', e.message);
    return fail('Failed to fetch YouTube videos');
  }
}
