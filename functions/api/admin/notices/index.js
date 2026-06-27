/**
 * /api/admin/notices
 *
 * GET  — list all notices (active + inactive) for the admin UI
 * POST — create a new notice
 *
 * Auth: admin session required (enforced by _middleware.ts via /api/admin/ prefix).
 */

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const MAX_ACTIVE   = 3;

function err(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: JSON_HEADERS });
}

/** GET — return all notices ordered by sort_order */
export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err('Database not configured', 503);

  try {
    const { results } = await env.DB.prepare(`
      SELECT id, emoji, title, body, is_active, sort_order, created_at, updated_at
      FROM   notices
      ORDER  BY sort_order ASC, created_at ASC
    `).all();

    return new Response(JSON.stringify({ ok: true, notices: results ?? [] }), { headers: JSON_HEADERS });
  } catch (e) {
    console.error('[GET /api/admin/notices]', e.message);
    return err('Failed to load notices', 500);
  }
}

/** POST — create a notice */
export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err('Database not configured', 503);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  const emoji      = (body.emoji  ?? '📢').trim().slice(0, 8);
  const title      = (body.title  ?? '').trim();
  const bodyText   = (body.body   ?? '').trim();
  const is_active  = body.is_active ? 1 : 0;
  const sort_order = Number(body.sort_order ?? 0);

  if (!title)    return err('Title is required');
  if (!bodyText) return err('Body text is required');
  if (title.length  > 120) return err('Title must be 120 characters or fewer');
  if (bodyText.length > 600) return err('Body must be 600 characters or fewer');

  // Enforce max 3 active
  if (is_active) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM notices WHERE is_active = 1`
    ).first().catch(() => null);
    if ((row?.cnt ?? 0) >= MAX_ACTIVE) {
      return err(`You already have ${MAX_ACTIVE} active notices. Disable one before adding another.`, 409);
    }
  }

  try {
    const result = await env.DB.prepare(`
      INSERT INTO notices (emoji, title, body, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).bind(emoji, title, bodyText, is_active, sort_order).run();

    // Fetch the created row
    const created = await env.DB.prepare(
      `SELECT * FROM notices WHERE rowid = ?`
    ).bind(result.meta.last_row_id).first();

    return new Response(JSON.stringify({ ok: true, notice: created }), {
      status: 201, headers: JSON_HEADERS,
    });
  } catch (e) {
    console.error('[POST /api/admin/notices]', e.message);
    return err('Failed to create notice', 500);
  }
}
