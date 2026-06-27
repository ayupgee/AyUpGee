/**
 * GET /api/notices
 *
 * Public endpoint — returns active notices ordered by sort_order.
 * Used by the homepage banner. No auth required.
 * Max 3 notices returned (mirrors the DB/admin cap).
 */

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
};

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.DB) {
    return new Response(JSON.stringify({ ok: true, notices: [] }), { headers: HEADERS });
  }

  try {
    const { results } = await env.DB.prepare(`
      SELECT id, emoji, title, body, sort_order
      FROM   notices
      WHERE  is_active = 1
      ORDER  BY sort_order ASC, created_at ASC
      LIMIT  3
    `).all();

    return new Response(JSON.stringify({ ok: true, notices: results ?? [] }), { headers: HEADERS });
  } catch (e) {
    console.error('[/api/notices]', e.message);
    return new Response(JSON.stringify({ ok: true, notices: [] }), { headers: HEADERS });
  }
}
