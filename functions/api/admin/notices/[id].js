/**
 * /api/admin/notices/:id
 *
 * GET    — fetch single notice
 * PUT    — update a notice (full or partial)
 * DELETE — remove a notice
 *
 * Auth: admin session required (enforced by _middleware.ts).
 */

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const MAX_ACTIVE   = 3;

function err(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: JSON_HEADERS });
}

/** GET single notice */
export async function onRequestGet(context) {
  const { env, params } = context;
  const id = params.id;
  if (!env.DB) return err('Database not configured', 503);

  try {
    const row = await env.DB.prepare(`SELECT * FROM notices WHERE id = ?`).bind(id).first();
    if (!row) return err('Notice not found', 404);
    return new Response(JSON.stringify({ ok: true, notice: row }), { headers: JSON_HEADERS });
  } catch (e) {
    return err('Failed to fetch notice', 500);
  }
}

/** PUT — update a notice */
export async function onRequestPut(context) {
  const { env, params, request } = context;
  const id = params.id;
  if (!env.DB) return err('Database not configured', 503);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON'); }

  // Load existing
  const existing = await env.DB.prepare(`SELECT * FROM notices WHERE id = ?`).bind(id).first().catch(() => null);
  if (!existing) return err('Notice not found', 404);

  const emoji      = ('emoji'      in body) ? (body.emoji      ?? '📢').trim().slice(0, 8) : existing.emoji;
  const title      = ('title'      in body) ? (body.title      ?? '').trim()                : existing.title;
  const bodyText   = ('body'       in body) ? (body.body       ?? '').trim()                : existing.body;
  const sort_order = ('sort_order' in body) ? Number(body.sort_order)                        : existing.sort_order;
  const is_active  = ('is_active'  in body) ? (body.is_active ? 1 : 0)                      : existing.is_active;

  if (!title)    return err('Title is required');
  if (!bodyText) return err('Body text is required');
  if (title.length > 120)    return err('Title must be 120 characters or fewer');
  if (bodyText.length > 600) return err('Body must be 600 characters or fewer');

  // Enforce max 3 active (only when activating a currently-inactive notice)
  if (is_active && !existing.is_active) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM notices WHERE is_active = 1`
    ).first().catch(() => null);
    if ((row?.cnt ?? 0) >= MAX_ACTIVE) {
      return err(`You already have ${MAX_ACTIVE} active notices. Disable one before activating another.`, 409);
    }
  }

  try {
    await env.DB.prepare(`
      UPDATE notices
      SET emoji = ?, title = ?, body = ?, is_active = ?, sort_order = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(emoji, title, bodyText, is_active, sort_order, id).run();

    const updated = await env.DB.prepare(`SELECT * FROM notices WHERE id = ?`).bind(id).first();
    return new Response(JSON.stringify({ ok: true, notice: updated }), { headers: JSON_HEADERS });
  } catch (e) {
    console.error('[PUT /api/admin/notices/:id]', e.message);
    return err('Failed to update notice', 500);
  }
}

/** DELETE — remove a notice */
export async function onRequestDelete(context) {
  const { env, params } = context;
  const id = params.id;
  if (!env.DB) return err('Database not configured', 503);

  try {
    const { meta } = await env.DB.prepare(`DELETE FROM notices WHERE id = ?`).bind(id).run();
    if ((meta?.changes ?? 0) === 0) return err('Notice not found', 404);
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  } catch (e) {
    console.error('[DELETE /api/admin/notices/:id]', e.message);
    return err('Failed to delete notice', 500);
  }
}
