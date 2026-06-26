/**
 * POST /api/admin/social/cleanup  — run cache cleanup now
 * GET  /api/admin/social/cleanup  — return last cleanup stats
 *
 * Auth: admin session required (enforced by _middleware.ts).
 *
 * Cleanup rules (mirrors the Worker's weekly job):
 *   Instagram  → keep latest 6 posts
 *   TikTok     → keep latest 4 posts
 *   sync_logs  → keep 30 days
 *   Twitch     → no persistent cache; documented as no-op
 *
 * All DB writes happen server-side. No secrets reach the browser.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

// ── Cleanup helpers ────────────────────────────────────────────────────────────

async function writeLog(db, platform, event, message) {
  try {
    await db.prepare(`
      INSERT INTO sync_logs (id, platform, event, message, items_synced, created_at)
      VALUES (lower(hex(randomblob(8))), ?, ?, ?, 0, datetime('now'))
    `).bind(platform, event, message).run();
  } catch { /* never let logging break cleanup */ }
}

async function cleanupInstagram(db, keep = 6) {
  const { meta } = await db.prepare(`
    DELETE FROM social_posts
    WHERE  platform = 'instagram'
    AND    id NOT IN (
      SELECT id FROM social_posts
      WHERE  platform = 'instagram'
      ORDER  BY published_at DESC, updated_at DESC
      LIMIT  ?
    )
  `).bind(keep).run();

  const removed = meta?.changes ?? 0;
  const msg = `Instagram cleanup completed. Kept latest ${keep} items, removed ${removed} old item${removed !== 1 ? 's' : ''}.`;
  await writeLog(db, 'instagram', 'cleanup', msg);
  return { kept: keep, removed };
}

async function cleanupTikTok(db, keep = 4) {
  const { meta } = await db.prepare(`
    DELETE FROM social_posts
    WHERE  platform = 'tiktok'
    AND    id NOT IN (
      SELECT id FROM social_posts
      WHERE  platform = 'tiktok'
      ORDER  BY published_at DESC, updated_at DESC
      LIMIT  ?
    )
  `).bind(keep).run();

  const removed = meta?.changes ?? 0;
  const msg = `TikTok cleanup completed. Kept latest ${keep} items, removed ${removed} old item${removed !== 1 ? 's' : ''}.`;
  await writeLog(db, 'tiktok', 'cleanup', msg);
  return { kept: keep, removed };
}

async function cleanupSyncLogs(db, keepDays = 30) {
  const { meta } = await db.prepare(`
    DELETE FROM sync_logs WHERE created_at < datetime('now', ?)
  `).bind(`-${keepDays} days`).run();

  const removed = meta?.changes ?? 0;
  await writeLog(db, 'system', 'cleanup',
    `Sync log cleanup: removed ${removed} entr${removed !== 1 ? 'ies' : 'y'} older than ${keepDays} days.`);
  return { removed };
}

// ── Last cleanup stats ─────────────────────────────────────────────────────────

async function getLastCleanupStats(db) {
  try {
    const platforms = ['instagram', 'tiktok', 'system'];
    const stats = {};

    for (const p of platforms) {
      const row = await db.prepare(`
        SELECT message, created_at
        FROM   sync_logs
        WHERE  platform = ? AND event = 'cleanup'
        ORDER  BY created_at DESC
        LIMIT  1
      `).bind(p).first();
      if (row) stats[p] = { message: row.message, at: row.created_at };
    }

    // Most recent cleanup across all platforms
    const latest = await db.prepare(`
      SELECT MAX(created_at) AS last_run
      FROM   sync_logs
      WHERE  event = 'cleanup'
    `).first();

    return { lastRun: latest?.last_run ?? null, byPlatform: stats };
  } catch {
    return { lastRun: null, byPlatform: {} };
  }
}

// ── Handlers ───────────────────────────────────────────────────────────────────

/** GET — return last cleanup stats */
export async function onRequestGet(context) {
  const { env } = context;

  if (!env.DB) {
    return new Response(JSON.stringify({ ok: false, error: 'Database not configured' }), {
      status: 503, headers: JSON_HEADERS,
    });
  }

  try {
    const stats = await getLastCleanupStats(env.DB);
    return new Response(JSON.stringify({ ok: true, ...stats }), { headers: JSON_HEADERS });
  } catch (e) {
    console.error('[/api/admin/social/cleanup GET]', e.message);
    return new Response(JSON.stringify({ ok: false, error: 'Failed to load cleanup stats' }), {
      status: 500, headers: JSON_HEADERS,
    });
  }
}

/** POST — run cleanup now */
export async function onRequestPost(context) {
  const { env } = context;

  if (!env.DB) {
    return new Response(JSON.stringify({ ok: false, error: 'Database not configured' }), {
      status: 503, headers: JSON_HEADERS,
    });
  }

  const results = {};

  try { results.instagram = await cleanupInstagram(env.DB); }
  catch (e) {
    console.error('[cleanup] Instagram failed:', e.message);
    results.instagram = { error: 'Cleanup failed for Instagram. Please check server logs.' };
  }

  try { results.tiktok = await cleanupTikTok(env.DB); }
  catch (e) {
    console.error('[cleanup] TikTok failed:', e.message);
    results.tiktok = { error: 'Cleanup failed for TikTok. Please check server logs.' };
  }

  try { results.logs = await cleanupSyncLogs(env.DB); }
  catch (e) {
    console.error('[cleanup] Log cleanup failed:', e.message);
    results.logs = { error: 'Log cleanup failed. Please check server logs.' };
  }

  results.twitch = {
    removed: 0,
    note: 'No Twitch cleanup required. Worker does not store persistent Twitch cache records.',
  };

  return new Response(JSON.stringify({ ok: true, results }), { headers: JSON_HEADERS });
}
