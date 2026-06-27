/**
 * POST /api/admin/social/cleanup  — run cache cleanup now
 * GET  /api/admin/social/cleanup  — return last cleanup stats
 *
 * Auth: admin session required (enforced by _middleware.ts).
 *
 * Cleanup rules (mirrors the Worker's weekly job):
 *   Instagram   → keep latest 6 posts
 *   TikTok      → keep latest 4 posts
 *   Twitch VODs → keep latest 3 VODs
 *   YouTube     → keep latest 3 videos
 *   sync_logs   → keep 30 days
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

async function cleanupPlatform(db, platform, keep) {
  const { meta } = await db.prepare(`
    DELETE FROM social_posts
    WHERE  platform = ?
    AND    id NOT IN (
      SELECT id FROM social_posts
      WHERE  platform = ?
      ORDER  BY published_at DESC, updated_at DESC
      LIMIT  ?
    )
  `).bind(platform, platform, keep).run();

  const removed = meta?.changes ?? 0;
  const label   = platform.charAt(0).toUpperCase() + platform.slice(1);
  const msg     = `${label} cleanup completed. Kept latest ${keep} items, removed ${removed} old item${removed !== 1 ? 's' : ''}.`;
  await writeLog(db, platform, 'cleanup', msg);
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
    const platforms = ['instagram', 'tiktok', 'twitch', 'youtube', 'system'];
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

  try { results.instagram = await cleanupPlatform(env.DB, 'instagram', 6); }
  catch (e) {
    console.error('[cleanup] Instagram failed:', e.message);
    results.instagram = { error: 'Cleanup failed. Check server logs.' };
  }

  try { results.tiktok = await cleanupPlatform(env.DB, 'tiktok', 4); }
  catch (e) {
    console.error('[cleanup] TikTok failed:', e.message);
    results.tiktok = { error: 'Cleanup failed. Check server logs.' };
  }

  try { results.twitch = await cleanupPlatform(env.DB, 'twitch', 3); }
  catch (e) {
    console.error('[cleanup] Twitch failed:', e.message);
    results.twitch = { error: 'Cleanup failed. Check server logs.' };
  }

  try { results.youtube = await cleanupPlatform(env.DB, 'youtube', 3); }
  catch (e) {
    console.error('[cleanup] YouTube failed:', e.message);
    results.youtube = { error: 'Cleanup failed. Check server logs.' };
  }

  try { results.logs = await cleanupSyncLogs(env.DB); }
  catch (e) {
    console.error('[cleanup] Log cleanup failed:', e.message);
    results.logs = { error: 'Log cleanup failed. Check server logs.' };
  }

  return new Response(JSON.stringify({ ok: true, results }), { headers: JSON_HEADERS });
}
