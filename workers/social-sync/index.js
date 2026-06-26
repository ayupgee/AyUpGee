/**
 * AyUpGee Social Sync Worker
 *
 * Runs on a cron schedule (every hour) and syncs social media posts into D1.
 * The homepage reads from D1 — so once this runs, posts appear automatically.
 *
 * ─── Platforms ─────────────────────────────────────────────────────────────────
 *   Instagram  → Behold.so (free, handles all Meta OAuth complexity)
 *   TikTok     → TikHub.io (unofficial REST API, pay-as-you-go ~$0.001/request)
 *
 * ─── Required secrets ──────────────────────────────────────────────────────────
 *   BEHOLD_FEED_ID    — Feed ID from behold.so dashboard
 *   TIKHUB_API_KEY    — API key from user.tikhub.io (scope: /api/v1/tiktok/web/)
 *
 * ─── Endpoints ─────────────────────────────────────────────────────────────────
 *   GET /          → health status + D1 stats (no auth required)
 *   GET /sync      → trigger a manual full sync
 */

const VERSION = '1.1.0';

// ── D1 log writer ──────────────────────────────────────────────────────────────
async function writeLog(env, platform, event, message, extra = {}) {
  try {
    await env.DB.prepare(`
      INSERT INTO sync_logs
        (id, platform, event, message, items_synced, error_message, response_time_ms, created_at)
      VALUES
        (lower(hex(randomblob(8))), ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      platform,
      event,
      message,
      extra.items_synced     ?? 0,
      extra.error_message    ?? null,
      extra.response_time_ms ?? null,
    ).run();
  } catch (e) {
    // Never let logging failures break the sync
    console.error('[log] Failed to write sync_log:', e.message);
  }
}

// ── Instagram via Behold.so ────────────────────────────────────────────────────
async function syncInstagram(env) {
  if (!env.BEHOLD_FEED_ID) {
    console.log('[instagram] BEHOLD_FEED_ID not set — skipping');
    return { synced: 0, skipped: 0 };
  }

  console.log('[instagram] Fetching from Behold.so...');
  const start = Date.now();

  const res = await fetch(`https://feeds.behold.so/${env.BEHOLD_FEED_ID}`, {
    headers: { 'User-Agent': 'AyUpGee-SocialSync/1.0' },
  });

  if (!res.ok) {
    const msg = `Behold API returned ${res.status}`;
    await writeLog(env, 'instagram', 'sync_error', 'Instagram sync failed', {
      error_message: msg,
      response_time_ms: Date.now() - start,
    });
    throw new Error(msg);
  }

  const data = await res.json();
  const posts = data.posts ?? data;
  if (!Array.isArray(posts) || posts.length === 0) {
    console.log('[instagram] No posts returned');
    return { synced: 0, skipped: 0 };
  }

  const latest = posts.slice(0, 8);
  let synced = 0;
  let skipped = 0;

  for (const post of latest) {
    try {
      const id  = String(post.id);
      const url = post.permalink || 'https://instagram.com/ayupgee';
      const caption = (post.prunedCaption || post.caption || '').trim();
      const title   = caption || 'View on Instagram';
      const thumbnailUrl =
        post.sizes?.medium?.mediaUrl ||
        post.sizes?.large?.mediaUrl  ||
        post.sizes?.small?.mediaUrl  ||
        post.thumbnailUrl || post.mediaUrl || null;
      const publishedAt = post.timestamp
        ? new Date(post.timestamp).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      await env.DB.prepare(`
        INSERT INTO social_posts
          (id, platform, url, title, thumbnail_url, caption_raw, published_at, created_at, updated_at)
        VALUES (?, 'instagram', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          url           = excluded.url,
          title         = excluded.title,
          thumbnail_url = excluded.thumbnail_url,
          caption_raw   = excluded.caption_raw,
          published_at  = excluded.published_at,
          updated_at    = datetime('now')
      `).bind(id, url, title, thumbnailUrl, post.caption || '', publishedAt).run();

      synced++;
    } catch (e) {
      console.error('[instagram] Failed to save post:', e.message);
      skipped++;
    }
  }

  const elapsed = Date.now() - start;
  await writeLog(env, 'instagram', 'sync_success',
    `Synced ${synced} post${synced !== 1 ? 's' : ''} from Instagram`, {
      items_synced: synced,
      response_time_ms: elapsed,
    });

  console.log(`[instagram] Done — ${synced} synced, ${skipped} skipped (${elapsed}ms)`);
  return { synced, skipped };
}

// ── Caption cleaner ────────────────────────────────────────────────────────────
function cleanCaption(caption) {
  if (!caption) return '';
  return caption.replace(/(^|\s)#\S+/g, '').replace(/\s{2,}/g, ' ').trim();
}

// ── TikTok via TikHub.io ───────────────────────────────────────────────────────
async function syncTikTok(env) {
  if (!env.TIKHUB_API_KEY) {
    console.log('[tiktok] TIKHUB_API_KEY not set — skipping');
    return { synced: 0, skipped: 0 };
  }

  console.log('[tiktok] Fetching from TikHub...');
  const start = Date.now();

  const headers = {
    'Authorization': `Bearer ${env.TIKHUB_API_KEY}`,
    'User-Agent': 'AyUpGee-SocialSync/1.0',
  };

  // Step 1 — resolve secUid
  const secUidRes = await fetch(
    'https://api.tikhub.io/api/v1/tiktok/web/get_sec_user_id?url=https://www.tiktok.com/@ayupgee',
    { headers }
  );

  let secUid = null;
  if (secUidRes.ok) {
    const secUidJson = await secUidRes.json();
    secUid = secUidJson?.data ?? null;
  }

  if (!secUid) {
    const msg = 'Could not resolve TikTok secUid';
    await writeLog(env, 'tiktok', 'sync_error', 'TikTok sync failed', {
      error_message: msg,
      response_time_ms: Date.now() - start,
    });
    throw new Error(msg);
  }

  // Step 2 — fetch latest videos
  const res = await fetch(
    `https://api.tikhub.io/api/v1/tiktok/web/fetch_user_post?unique_id=ayupgee&secUid=${encodeURIComponent(secUid)}&count=4`,
    { headers }
  );

  if (!res.ok) {
    const msg = `TikHub returned ${res.status}`;
    await writeLog(env, 'tiktok', 'sync_error', 'TikTok sync failed', {
      error_message: msg,
      response_time_ms: Date.now() - start,
    });
    throw new Error(`${msg}: ${await res.text()}`);
  }

  const json   = await res.json();
  const videos = json?.data?.aweme_list ?? [];

  if (videos.length === 0) {
    console.log('[tiktok] No videos returned');
    return { synced: 0, skipped: 0 };
  }

  let synced  = 0;
  let skipped = 0;

  for (const v of videos) {
    try {
      const id           = String(v.aweme_id);
      const caption      = cleanCaption(v.desc || '');
      const title        = caption || 'Watch on TikTok';
      const url          = v.share_url || `https://www.tiktok.com/@ayupgee/video/${id}`;
      const thumbnailUrl = v.video?.cover?.url_list?.[0]
        || v.video?.origin_cover?.url_list?.[0] || null;
      const publishedAt  = v.create_time
        ? new Date(v.create_time * 1000).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      await env.DB.prepare(`
        INSERT INTO social_posts
          (id, platform, url, title, thumbnail_url, caption_raw, published_at, created_at, updated_at)
        VALUES (?, 'tiktok', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          url           = excluded.url,
          title         = excluded.title,
          thumbnail_url = excluded.thumbnail_url,
          caption_raw   = excluded.caption_raw,
          published_at  = excluded.published_at,
          updated_at    = datetime('now')
      `).bind(id, url, title, thumbnailUrl, v.desc || '', publishedAt).run();

      synced++;
    } catch (e) {
      console.error('[tiktok] Failed to save video:', e.message);
      skipped++;
    }
  }

  const elapsed = Date.now() - start;
  await writeLog(env, 'tiktok', 'sync_success',
    `Synced ${synced} video${synced !== 1 ? 's' : ''} from TikTok`, {
      items_synced: synced,
      response_time_ms: elapsed,
    });

  console.log(`[tiktok] Done — ${synced} synced, ${skipped} skipped (${elapsed}ms)`);
  return { synced, skipped };
}

// ── Cache cleanup ──────────────────────────────────────────────────────────────

/**
 * Keep only the latest N Instagram posts; delete the rest.
 * Uses a subquery so a single DELETE statement does the work safely.
 */
async function cleanupInstagram(env, keep = 6) {
  const { meta } = await env.DB.prepare(`
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
  console.log(`[cleanup] ${msg}`);
  await writeLog(env, 'instagram', 'cleanup', msg, { items_synced: 0 });
  return { kept: keep, removed };
}

/**
 * Keep only the latest N TikTok posts; delete the rest.
 */
async function cleanupTikTok(env, keep = 4) {
  const { meta } = await env.DB.prepare(`
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
  console.log(`[cleanup] ${msg}`);
  await writeLog(env, 'tiktok', 'cleanup', msg, { items_synced: 0 });
  return { kept: keep, removed };
}

/**
 * Twitch: this worker does not maintain a persistent Twitch content cache.
 * Sync logs older than 30 days are pruned across all platforms.
 */
async function cleanupSyncLogs(env, keepDays = 30) {
  const { meta } = await env.DB.prepare(`
    DELETE FROM sync_logs
    WHERE created_at < datetime('now', ? )
  `).bind(`-${keepDays} days`).run();

  const removed = meta?.changes ?? 0;
  const msg = `Sync log cleanup: removed ${removed} entr${removed !== 1 ? 'ies' : 'y'} older than ${keepDays} days.`;
  console.log(`[cleanup] ${msg}`);
  // Write the log after pruning (so this entry itself is fresh)
  await writeLog(env, 'system', 'cleanup', msg, { items_synced: 0 });
  return { removed };
}

/**
 * Run all cleanup jobs and return a summary.
 * Each step is wrapped so a failure in one does not abort the rest.
 */
async function runCleanup(env) {
  console.log('[cleanup] Starting weekly cleanup…');
  const results = {};

  try { results.instagram = await cleanupInstagram(env); }
  catch (e) {
    console.error('[cleanup] Instagram cleanup failed:', e.message);
    results.instagram = { error: e.message };
  }

  try { results.tiktok = await cleanupTikTok(env); }
  catch (e) {
    console.error('[cleanup] TikTok cleanup failed:', e.message);
    results.tiktok = { error: e.message };
  }

  try { results.logs = await cleanupSyncLogs(env); }
  catch (e) {
    console.error('[cleanup] Log cleanup failed:', e.message);
    results.logs = { error: e.message };
  }

  results.twitch = {
    removed: 0,
    note: 'No Twitch cleanup required. Worker does not store persistent Twitch cache records.',
  };

  console.log('[cleanup] Complete:', JSON.stringify(results));
  return results;
}

// ── Response helper ────────────────────────────────────────────────────────────
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default {
  // Cron trigger — hourly sync OR weekly cleanup depending on schedule
  async scheduled(event, env, ctx) {
    console.log(`[social-sync] Cron "${event.cron}" firing at ${new Date().toISOString()}`);

    if (event.cron === '0 3 * * 0') {
      // Weekly Sunday 03:00 UTC — run cache cleanup
      await runCleanup(env);
    } else {
      // Every other cron (hourly) — run social sync
      const results = {};
      try { results.instagram = await syncInstagram(env); }
      catch (e) { console.error('[instagram] Sync failed:', e.message); results.instagram = { error: e.message }; }
      try { results.tiktok    = await syncTikTok(env); }
      catch (e) { console.error('[tiktok] Sync failed:', e.message); results.tiktok = { error: e.message }; }
      console.log('[social-sync] Sync complete:', JSON.stringify(results));
    }
  },

  // HTTP handler
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── GET /  — health + D1 stats (public, no secrets exposed) ──────────
    if (url.pathname === '/' || url.pathname === '') {
      try {
        const rows = await env.DB.prepare(`
          SELECT platform, MAX(updated_at) AS last_sync, COUNT(*) AS item_count
          FROM social_posts
          GROUP BY platform
        `).all();

        const stats = {};
        for (const row of rows.results ?? []) {
          stats[row.platform] = { lastSync: row.last_sync, itemCount: row.item_count };
        }

        return jsonResponse({
          ok: true,
          worker: 'ayupgee-social-sync',
          version: VERSION,
          timestamp: new Date().toISOString(),
          providers: {
            instagram: stats.instagram ?? { lastSync: null, itemCount: 0 },
            tiktok:    stats.tiktok    ?? { lastSync: null, itemCount: 0 },
          },
        });
      } catch (e) {
        return jsonResponse({
          ok: true,
          worker: 'ayupgee-social-sync',
          version: VERSION,
          timestamp: new Date().toISOString(),
          error: 'db_unavailable',
        });
      }
    }

    // ── GET /cleanup  — manual cleanup trigger ───────────────────────────
    if (url.pathname === '/cleanup') {
      const results = await runCleanup(env);
      return jsonResponse({ ok: true, results });
    }

    // ── GET /sync  — manual sync trigger ─────────────────────────────────
    if (url.pathname === '/sync') {
      const results = {};
      try { results.instagram = await syncInstagram(env); }
      catch (e) { results.instagram = { error: e.message }; }
      try { results.tiktok    = await syncTikTok(env); }
      catch (e) { results.tiktok    = { error: e.message }; }
      return jsonResponse({ ok: true, results });
    }

    return jsonResponse({ ok: true, worker: 'ayupgee-social-sync', version: VERSION });
  },
};
