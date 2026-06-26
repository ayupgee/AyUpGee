/**
 * GET /api/admin/social/logs?platform=instagram&limit=20
 *
 * Returns recent sync log entries for a specific platform.
 * Auth: admin session required (enforced by _middleware.ts).
 *
 * Query params:
 *   platform  — 'instagram' | 'tiktok' | 'twitch' (required)
 *   limit     — max entries to return, 1–100 (default: 20)
 */

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const VALID_PLATFORMS = new Set(['instagram', 'tiktok', 'twitch', 'system']);

export async function onRequestGet(context) {
  const { env, request } = context;
  const params   = new URL(request.url).searchParams;
  const platform = params.get('platform') ?? '';
  const limit    = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '20', 10)));

  if (!VALID_PLATFORMS.has(platform)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid platform. Use: instagram, tiktok, twitch, system' }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ ok: false, error: 'Database not configured' }), {
      status: 503, headers: JSON_HEADERS,
    });
  }

  try {
    const { results } = await env.DB.prepare(`
      SELECT event, message, items_synced, error_message, response_time_ms, created_at
      FROM   sync_logs
      WHERE  platform = ?
      ORDER  BY created_at DESC
      LIMIT  ?
    `).bind(platform, limit).all();

    return new Response(JSON.stringify({ ok: true, platform, logs: results ?? [] }), {
      headers: JSON_HEADERS,
    });
  } catch (e) {
    console.error('[/api/admin/social/logs]', e.message);
    return new Response(JSON.stringify({ ok: false, error: 'Failed to load logs' }), {
      status: 500, headers: JSON_HEADERS,
    });
  }
}
