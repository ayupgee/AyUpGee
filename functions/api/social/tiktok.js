/**
 * GET /api/social/tiktok
 *
 * Returns the latest 4 TikTok posts from the D1 social_posts table.
 * Posts are managed via the admin endpoint:
 *   POST /api/admin/social/tiktok-upsert
 *
 * No API keys are required — this is a pure D1 read.
 * TikTok's official API requires app approval before it can auto-fetch posts,
 * so this uses a manual/cache approach: you add posts in the admin panel,
 * this endpoint serves them to the homepage.
 *
 * ─── Response shape ────────────────────────────────────────────────────────────────
 *   { ok: true, items: [{ id, url, title, thumbnailUrl, publishedAt }] }
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export async function onRequest(context) {
  const { env } = context;

  if (!env.DB) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Database not configured' }),
      { status: 503, headers: JSON_HEADERS }
    );
  }

  try {
    const { results } = await env.DB.prepare(`
      SELECT id, url, title, thumbnail_url, published_at
      FROM   social_posts
      WHERE  platform = 'tiktok'
      ORDER  BY published_at DESC
      LIMIT  4
    `).all();

    const items = (results ?? []).map(r => ({
      id:           r.id,
      url:          r.url,
      title:        r.title,
      thumbnailUrl: r.thumbnail_url,
      publishedAt:  r.published_at,
    }));

    return new Response(JSON.stringify({ ok: true, items }), {
      headers: {
        ...JSON_HEADERS,
        'Cache-Control': 'public, max-age=600', // 10-minute edge cache
      },
    });

  } catch (e) {
    console.error('[/api/social/tiktok]', e.message);
    return new Response(
      JSON.stringify({ ok: false, error: 'Failed to fetch TikTok posts' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
}
