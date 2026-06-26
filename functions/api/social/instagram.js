/**
 * GET /api/social/instagram
 *
 * Returns the latest 8 Instagram posts, read from the D1 social_posts table.
 * Posts are populated automatically by the ayupgee-social-sync Cloudflare Worker,
 * which runs every hour and syncs from Behold.so.
 *
 * This endpoint is intentionally simple — it just reads from D1.
 * All the Instagram API complexity lives in workers/social-sync/index.js.
 *
 * ─── Response shape ────────────────────────────────────────────────────────────
 *   { ok: true, items: [{ id, url, imageUrl, caption, timestamp }] }
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300', // 5 minute browser cache
  'Access-Control-Allow-Origin': '*',
};

function ok(items) {
  return new Response(JSON.stringify({ ok: true, items }), { headers: JSON_HEADERS });
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
      SELECT id, url, title, thumbnail_url, caption_raw, published_at
      FROM   social_posts
      WHERE  platform = 'instagram'
      ORDER BY published_at DESC
      LIMIT  8
    `).all();

    const items = (results ?? []).map(row => ({
      id:        row.id,
      url:       row.url,
      imageUrl:  row.thumbnail_url,
      caption:   row.title,          // title already has hashtags stripped
      timestamp: row.published_at,
    }));

    return ok(items);
  } catch (e) {
    console.error('[/api/social/instagram]', e.message);
    return fail('Failed to load Instagram feed');
  }
}
