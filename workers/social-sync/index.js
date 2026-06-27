/**
 * AyUpGee Social Sync Worker
 *
 * Runs on a cron schedule (every 12 hours) and syncs social media posts into D1.
 * The homepage reads from D1 — so once this runs, posts appear automatically.
 *
 * ─── Platforms ─────────────────────────────────────────────────────────────────
 *   Instagram  → Behold.so (free, handles all Meta OAuth complexity)
 *   TikTok     → TikHub.io (unofficial REST API, pay-as-you-go ~$0.001/request)
 *   Twitch     → Twitch Helix API (official, client credentials OAuth)
 *   YouTube    → YouTube Data API v3 (official, API key only)
 *
 * ─── Required secrets ──────────────────────────────────────────────────────────
 *   BEHOLD_FEED_ID          — Feed ID from behold.so dashboard
 *   TIKHUB_API_KEY          — API key from user.tikhub.io (scope: /api/v1/tiktok/web/)
 *   TWITCH_CLIENT_ID        — from https://dev.twitch.tv/console
 *   TWITCH_CLIENT_SECRET    — from https://dev.twitch.tv/console
 *   TWITCH_BROADCASTER_ID   — numeric user ID for twitch.tv/ayupgee
 *   YOUTUBE_API_KEY         — from https://console.cloud.google.com (YouTube Data API v3)
 *
 * ─── Optional secrets ──────────────────────────────────────────────────────────
 *   YOUTUBE_UPLOADS_PLAYLIST_ID — skip the channels API call (e.g. "UU...")
 *                                 Find it once: channels?part=contentDetails&forHandle=AyUpGee
 *
 * ─── Endpoints ─────────────────────────────────────────────────────────────────
 *   GET /          → health status + D1 stats (no auth required)
 *   GET /sync      → trigger a manual full sync
 *   GET /cleanup   → trigger a manual cleanup run
 */

const VERSION = '2.0.0';

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
    headers: { 'User-Agent': 'AyUpGee-SocialSync/2.0' },
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
    'User-Agent': 'AyUpGee-SocialSync/2.0',
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

// ── Twitch VODs ────────────────────────────────────────────────────────────────

/**
 * Fetch a short-lived Twitch app access token using client credentials.
 * This token is NOT stored — it is used for one sync run and discarded.
 */
async function getTwitchToken(env) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type:    'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Twitch token request failed: ${res.status}`);
  const { access_token } = await res.json();
  return access_token;
}

/**
 * Format a Twitch duration string into HH:MM:SS or MM:SS.
 * Input examples: "3h42m18s", "58m30s", "45s"
 */
function formatTwitchDuration(dur) {
  if (!dur) return '';
  const h = dur.match(/(\d+)h/)?.[1];
  const m = dur.match(/(\d+)m/)?.[1];
  const s = dur.match(/(\d+)s/)?.[1];
  const hours = parseInt(h ?? 0);
  const mins  = parseInt(m ?? 0);
  const secs  = parseInt(s ?? 0);
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

async function syncTwitch(env) {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET || !env.TWITCH_BROADCASTER_ID) {
    console.log('[twitch-vods] TWITCH credentials not set — skipping');
    return { synced: 0, skipped: 0 };
  }

  console.log('[twitch-vods] Fetching latest VODs from Twitch Helix API...');
  const start = Date.now();

  // App-access token (client credentials — no user scope needed for public VODs)
  let token;
  try {
    token = await getTwitchToken(env);
  } catch (e) {
    const msg = `Token error: ${e.message}`;
    await writeLog(env, 'twitch', 'sync_error', 'Twitch VODs sync failed', {
      error_message: msg,
      response_time_ms: Date.now() - start,
    });
    throw new Error(msg);
  }

  // Fetch latest archive VODs (type=archive excludes highlights/uploads)
  const vodsUrl = new URL('https://api.twitch.tv/helix/videos');
  vodsUrl.searchParams.set('user_id', env.TWITCH_BROADCASTER_ID);
  vodsUrl.searchParams.set('type', 'archive');
  vodsUrl.searchParams.set('first', '6'); // fetch buffer; cleanup will trim to 6

  const res = await fetch(vodsUrl.toString(), {
    headers: {
      'Client-Id':     env.TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'User-Agent':    'AyUpGee-SocialSync/2.0',
    },
  });

  if (!res.ok) {
    const msg = `Twitch Helix /videos returned ${res.status}`;
    await writeLog(env, 'twitch', 'sync_error', 'Twitch VODs sync failed', {
      error_message: msg,
      response_time_ms: Date.now() - start,
    });
    throw new Error(msg);
  }

  const { data: videos } = await res.json();

  if (!Array.isArray(videos) || videos.length === 0) {
    console.log('[twitch-vods] No VODs returned');
    return { synced: 0, skipped: 0 };
  }

  let synced  = 0;
  let skipped = 0;

  for (const v of videos) {
    try {
      const id    = `twitch_${v.id}`;
      const title = v.title || 'Twitch VOD';
      const url   = v.url   || `https://www.twitch.tv/videos/${v.id}`;

      // Twitch thumbnail URLs use %{width}x%{height} placeholders
      const thumbnailUrl = v.thumbnail_url
        ? v.thumbnail_url.replace('%{width}', '640').replace('%{height}', '360')
        : null;

      const publishedAt = v.published_at
        ? new Date(v.published_at).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      const duration = formatTwitchDuration(v.duration);

      await env.DB.prepare(`
        INSERT INTO social_posts
          (id, platform, url, title, thumbnail_url, caption_raw, published_at, duration, created_at, updated_at)
        VALUES (?, 'twitch', ?, ?, ?, '', ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          url           = excluded.url,
          title         = excluded.title,
          thumbnail_url = excluded.thumbnail_url,
          published_at  = excluded.published_at,
          duration      = excluded.duration,
          updated_at    = datetime('now')
      `).bind(id, url, title, thumbnailUrl, publishedAt, duration).run();

      synced++;
    } catch (e) {
      console.error('[twitch-vods] Failed to save VOD:', e.message);
      skipped++;
    }
  }

  const elapsed = Date.now() - start;
  await writeLog(env, 'twitch', 'sync_success',
    `Synced ${synced} VOD${synced !== 1 ? 's' : ''} from Twitch`, {
      items_synced: synced,
      response_time_ms: elapsed,
    });

  console.log(`[twitch-vods] Done — ${synced} synced, ${skipped} skipped (${elapsed}ms)`);
  return { synced, skipped };
}

// ── YouTube Videos ─────────────────────────────────────────────────────────────

/**
 * Parse an ISO 8601 duration (e.g. "PT1H3M17S") into a display string ("1:03:17").
 * Short videos: "PT18M42S" → "18:42". Very short: "PT45S" → "0:45".
 */
function formatYouTubeDuration(iso) {
  if (!iso) return '';
  const h = iso.match(/(\d+)H/)?.[1];
  const m = iso.match(/(\d+)M/)?.[1];
  const s = iso.match(/(\d+)S/)?.[1];
  const hours = parseInt(h ?? 0);
  const mins  = parseInt(m ?? 0);
  const secs  = parseInt(s ?? 0);
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Returns total seconds from an ISO 8601 duration — used to detect Shorts (≤ 60s). */
function parseDurationSeconds(iso) {
  if (!iso) return 0;
  const h = parseInt(iso.match(/(\d+)H/)?.[1] ?? 0);
  const m = parseInt(iso.match(/(\d+)M/)?.[1] ?? 0);
  const s = parseInt(iso.match(/(\d+)S/)?.[1] ?? 0);
  return h * 3600 + m * 60 + s;
}

async function syncYouTube(env) {
  if (!env.YOUTUBE_API_KEY) {
    console.log('[youtube] YOUTUBE_API_KEY not set — skipping');
    return { synced: 0, skipped: 0 };
  }

  console.log('[youtube] Fetching latest videos from YouTube Data API v3...');
  const start = Date.now();
  const key   = env.YOUTUBE_API_KEY;
  const ua    = 'AyUpGee-SocialSync/2.0';

  // ── Step 1: resolve uploads playlist ID ─────────────────────────────────────
  // YOUTUBE_UPLOADS_PLAYLIST_ID can be cached in secrets to skip this API call.
  let uploadsPlaylistId = env.YOUTUBE_UPLOADS_PLAYLIST_ID ?? null;

  if (!uploadsPlaylistId) {
    const chanRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=AyUpGee&key=${key}`,
      { headers: { 'User-Agent': ua } }
    );
    if (!chanRes.ok) {
      const msg = `YouTube channels API returned ${chanRes.status}`;
      await writeLog(env, 'youtube', 'sync_error', 'YouTube sync failed', {
        error_message: msg,
        response_time_ms: Date.now() - start,
      });
      throw new Error(msg);
    }
    const chanData = await chanRes.json();
    uploadsPlaylistId =
      chanData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;

    if (!uploadsPlaylistId) {
      const msg = 'Could not resolve YouTube uploads playlist ID';
      await writeLog(env, 'youtube', 'sync_error', 'YouTube sync failed', {
        error_message: msg,
        response_time_ms: Date.now() - start,
      });
      throw new Error(msg);
    }
  }

  // ── Step 2: fetch latest video IDs + snippets from uploads playlist ──────────
  const listRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=6&key=${key}`,
    { headers: { 'User-Agent': ua } }
  );
  if (!listRes.ok) {
    const msg = `YouTube playlistItems API returned ${listRes.status}`;
    await writeLog(env, 'youtube', 'sync_error', 'YouTube sync failed', {
      error_message: msg,
      response_time_ms: Date.now() - start,
    });
    throw new Error(msg);
  }

  const listData = await listRes.json();
  const items    = listData?.items ?? [];

  if (items.length === 0) {
    console.log('[youtube] No videos returned');
    return { synced: 0, skipped: 0 };
  }

  // ── Step 3: fetch video durations (requires a separate API call) ─────────────
  const videoIds = items
    .map(i => i.snippet?.resourceId?.videoId)
    .filter(Boolean);

  const durationMap    = {}; // videoId → display string e.g. "18:42"
  const durationSecMap = {}; // videoId → total seconds (used to detect Shorts)

  if (videoIds.length > 0) {
    const detailRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds.join(',')}&key=${key}`,
      { headers: { 'User-Agent': ua } }
    );
    if (detailRes.ok) {
      const detailData = await detailRes.json();
      for (const v of (detailData?.items ?? [])) {
        const iso = v.contentDetails?.duration;
        durationMap[v.id]    = formatYouTubeDuration(iso);
        durationSecMap[v.id] = parseDurationSeconds(iso);
      }
    }
    // Non-fatal if duration fetch fails — cards render without timestamps and no Shorts filter
  }

  // ── Remove any Shorts (≤ 60 s) already saved in D1 ──────────────────────────
  // Shorts live in the uploads playlist but should never appear on the site.
  const shortDbIds = videoIds
    .filter(id => (durationSecMap[id] ?? 999) <= 60)
    .map(id => `yt_${id}`);

  if (shortDbIds.length > 0) {
    const placeholders = shortDbIds.map(() => '?').join(',');
    await env.DB.prepare(
      `DELETE FROM social_posts WHERE platform = 'youtube' AND id IN (${placeholders})`
    ).bind(...shortDbIds).run();
    console.log(`[youtube] Removed ${shortDbIds.length} Short(s) from D1`);
  }

  // ── Step 4: upsert regular videos (> 60 s) into D1 ──────────────────────────
  let synced  = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      const videoId = item.snippet?.resourceId?.videoId;
      if (!videoId) { skipped++; continue; }

      // Skip Shorts — already deleted from D1 above
      if ((durationSecMap[videoId] ?? 999) <= 60) { skipped++; continue; }

      const id    = `yt_${videoId}`;
      const title = item.snippet?.title || 'YouTube Video';
      const url   = `https://www.youtube.com/watch?v=${videoId}`;

      // Prefer high-quality thumbnail; fall through to lower res
      const thumbnailUrl =
        item.snippet?.thumbnails?.maxres?.url  ||
        item.snippet?.thumbnails?.high?.url    ||
        item.snippet?.thumbnails?.medium?.url  ||
        item.snippet?.thumbnails?.default?.url || null;

      const publishedAt = item.snippet?.publishedAt
        ? new Date(item.snippet.publishedAt).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      const duration = durationMap[videoId] ?? '';

      await env.DB.prepare(`
        INSERT INTO social_posts
          (id, platform, url, title, thumbnail_url, caption_raw, published_at, duration, created_at, updated_at)
        VALUES (?, 'youtube', ?, ?, ?, '', ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          url           = excluded.url,
          title         = excluded.title,
          thumbnail_url = excluded.thumbnail_url,
          published_at  = excluded.published_at,
          duration      = excluded.duration,
          updated_at    = datetime('now')
      `).bind(id, url, title, thumbnailUrl, publishedAt, duration).run();

      synced++;
    } catch (e) {
      console.error('[youtube] Failed to save video:', e.message);
      skipped++;
    }
  }

  const elapsed = Date.now() - start;
  await writeLog(env, 'youtube', 'sync_success',
    `Synced ${synced} video${synced !== 1 ? 's' : ''} from YouTube`, {
      items_synced: synced,
      response_time_ms: elapsed,
    });

  console.log(`[youtube] Done — ${synced} synced, ${skipped} skipped (${elapsed}ms)`);
  return { synced, skipped };
}

// ── Cache cleanup ──────────────────────────────────────────────────────────────

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

async function cleanupTwitch(env, keep = 6) {
  const { meta } = await env.DB.prepare(`
    DELETE FROM social_posts
    WHERE  platform = 'twitch'
    AND    id NOT IN (
      SELECT id FROM social_posts
      WHERE  platform = 'twitch'
      ORDER  BY published_at DESC, updated_at DESC
      LIMIT  ?
    )
  `).bind(keep).run();

  const removed = meta?.changes ?? 0;
  const msg = `Twitch cleanup completed. Kept latest ${keep} items, removed ${removed} old item${removed !== 1 ? 's' : ''}.`;
  console.log(`[cleanup] ${msg}`);
  await writeLog(env, 'twitch', 'cleanup', msg, { items_synced: 0 });
  return { kept: keep, removed };
}

async function cleanupYouTube(env, keep = 6) {
  const { meta } = await env.DB.prepare(`
    DELETE FROM social_posts
    WHERE  platform = 'youtube'
    AND    id NOT IN (
      SELECT id FROM social_posts
      WHERE  platform = 'youtube'
      ORDER  BY published_at DESC, updated_at DESC
      LIMIT  ?
    )
  `).bind(keep).run();

  const removed = meta?.changes ?? 0;
  const msg = `YouTube cleanup completed. Kept latest ${keep} items, removed ${removed} old item${removed !== 1 ? 's' : ''}.`;
  console.log(`[cleanup] ${msg}`);
  await writeLog(env, 'youtube', 'cleanup', msg, { items_synced: 0 });
  return { kept: keep, removed };
}

async function cleanupSyncLogs(env, keepDays = 30) {
  const { meta } = await env.DB.prepare(`
    DELETE FROM sync_logs
    WHERE created_at < datetime('now', ? )
  `).bind(`-${keepDays} days`).run();

  const removed = meta?.changes ?? 0;
  const msg = `Sync log cleanup: removed ${removed} entr${removed !== 1 ? 'ies' : 'y'} older than ${keepDays} days.`;
  console.log(`[cleanup] ${msg}`);
  await writeLog(env, 'system', 'cleanup', msg, { items_synced: 0 });
  return { removed };
}

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

  try { results.twitch = await cleanupTwitch(env); }
  catch (e) {
    console.error('[cleanup] Twitch cleanup failed:', e.message);
    results.twitch = { error: e.message };
  }

  try { results.youtube = await cleanupYouTube(env); }
  catch (e) {
    console.error('[cleanup] YouTube cleanup failed:', e.message);
    results.youtube = { error: e.message };
  }

  try { results.logs = await cleanupSyncLogs(env); }
  catch (e) {
    console.error('[cleanup] Log cleanup failed:', e.message);
    results.logs = { error: e.message };
  }

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
  // Cron trigger — 12-hourly sync (06:00 + 18:00 UTC) OR weekly cleanup (Sun 03:00 UTC)
  async scheduled(event, env, ctx) {
    console.log(`[social-sync] Cron "${event.cron}" firing at ${new Date().toISOString()}`);

    if (event.cron === '0 3 * * 0') {
      // Weekly Sunday 03:00 UTC — run cache cleanup
      await runCleanup(env);
    } else {
      // Every other cron (12-hourly) — run social sync for all platforms
      const results = {};
      try { results.instagram = await syncInstagram(env); }
      catch (e) { console.error('[instagram] Sync failed:', e.message); results.instagram = { error: e.message }; }
      try { results.tiktok = await syncTikTok(env); }
      catch (e) { console.error('[tiktok] Sync failed:', e.message); results.tiktok = { error: e.message }; }
      try { results.twitch = await syncTwitch(env); }
      catch (e) { console.error('[twitch-vods] Sync failed:', e.message); results.twitch = { error: e.message }; }
      try { results.youtube = await syncYouTube(env); }
      catch (e) { console.error('[youtube] Sync failed:', e.message); results.youtube = { error: e.message }; }
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
            twitch:    stats.twitch    ?? { lastSync: null, itemCount: 0 },
            youtube:   stats.youtube   ?? { lastSync: null, itemCount: 0 },
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
      try { results.tiktok = await syncTikTok(env); }
      catch (e) { results.tiktok    = { error: e.message }; }
      try { results.twitch = await syncTwitch(env); }
      catch (e) { results.twitch    = { error: e.message }; }
      try { results.youtube = await syncYouTube(env); }
      catch (e) { results.youtube   = { error: e.message }; }
      return jsonResponse({ ok: true, results });
    }

    return jsonResponse({ ok: true, worker: 'ayupgee-social-sync', version: VERSION });
  },
};
