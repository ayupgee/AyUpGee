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
 * ─── How to test manually ──────────────────────────────────────────────────────
 *   Visit: https://ayupgee-social-sync.YOUR_SUBDOMAIN.workers.dev/sync
 */

// ── Instagram via Behold.so ────────────────────────────────────────────────────
// Behold response shape: { username, posts: [...], ... }
// Each post has: id, permalink, timestamp, mediaType, caption, prunedCaption,
//                sizes: { small, medium, large, full: { mediaUrl, width, height } }
// prunedCaption is already stripped of hashtags by Behold — no need to clean it ourselves.
async function syncInstagram(env) {
  if (!env.BEHOLD_FEED_ID) {
    console.log('[instagram] BEHOLD_FEED_ID not set — skipping');
    return { synced: 0, skipped: 0 };
  }

  console.log('[instagram] Fetching from Behold.so...');

  const res = await fetch(`https://feeds.behold.so/${env.BEHOLD_FEED_ID}`, {
    headers: { 'User-Agent': 'AyUpGee-SocialSync/1.0' },
  });

  if (!res.ok) {
    throw new Error(`Behold API returned ${res.status}`);
  }

  const data = await res.json();
  // Response is { username, posts: [...] } not a bare array
  const posts = data.posts ?? data;
  if (!Array.isArray(posts) || posts.length === 0) {
    console.log('[instagram] No posts returned');
    return { synced: 0, skipped: 0 };
  }

  // Free plan caps at 6 posts; slice defensively in case plan changes
  const latest = posts.slice(0, 8);
  let synced = 0;
  let skipped = 0;

  for (const post of latest) {
    try {
      const id = String(post.id);
      const url = post.permalink || 'https://instagram.com/ayupgee';

      // prunedCaption has hashtags already removed by Behold
      const caption = (post.prunedCaption || post.caption || '').trim();
      const title   = caption || 'View on Instagram';

      // Use Behold's CDN-hosted medium size (WebP, optimised, stable URLs)
      const thumbnailUrl = post.sizes?.medium?.mediaUrl
        || post.sizes?.large?.mediaUrl
        || post.sizes?.small?.mediaUrl
        || post.thumbnailUrl   // VIDEO posts: original thumbnail
        || post.mediaUrl       // fallback to raw Instagram URL
        || null;

      const publishedAt = post.timestamp
        ? new Date(post.timestamp).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      await env.DB.prepare(`
        INSERT INTO social_posts
          (id, platform, url, title, thumbnail_url, caption_raw, published_at, created_at, updated_at)
        VALUES
          (?, 'instagram', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
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

  console.log(`[instagram] Done — ${synced} synced, ${skipped} skipped`);
  return { synced, skipped };
}

// ── Caption cleaner ────────────────────────────────────────────────────────────
// TikHub returns raw captions — strip hashtags and tidy whitespace.
// "Cosy night in ✨ #DDLV #DisneyDreamlightValley" → "Cosy night in ✨"
function cleanCaption(caption) {
  if (!caption) return '';
  return caption
    .replace(/(^|\s)#\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── TikTok via TikHub.io ───────────────────────────────────────────────────────
// Step 1: fetch_user_profile to get secUid (TikTok's internal user ID)
// Step 2: fetch_user_post with both unique_id + secUid to get videos
async function syncTikTok(env) {
  if (!env.TIKHUB_API_KEY) {
    console.log('[tiktok] TIKHUB_API_KEY not set — skipping');
    return { synced: 0, skipped: 0 };
  }

  console.log('[tiktok] Fetching from TikHub...');

  const headers = {
    'Authorization': `Bearer ${env.TIKHUB_API_KEY}`,
    'User-Agent': 'AyUpGee-SocialSync/1.0',
  };

  // Step 1 — get secUid (try two endpoint names TikHub uses)
  let secUid = null;
  const profileEndpoints = [
    'https://api.tikhub.io/api/v1/tiktok/web/fetch_user_info?unique_id=ayupgee',
    'https://api.tikhub.io/api/v1/tiktok/web/fetch_user_profile?unique_id=ayupgee',
  ];
  for (const endpoint of profileEndpoints) {
    const r = await fetch(endpoint, { headers });
    if (!r.ok) {
      console.log(`[tiktok] ${endpoint} returned ${r.status} - trying next`);
      continue;
    }
    const j = await r.json();
    secUid = j?.data?.userInfo?.user?.secUid
      || j?.data?.user?.secUid
      || j?.data?.secUid
      || j?.data?.userInfo?.secUid;
    if (secUid) { console.log('[tiktok] Got secUid from', endpoint); break; }
    console.log('[tiktok] No secUid in response:', JSON.stringify(j).slice(0, 300));
  }
  if (!secUid) throw new Error('Could not resolve secUid - check Worker logs for response shape');

  // Step 2 — fetch latest 4 videos
  const res = await fetch(
    `https://api.tikhub.io/api/v1/tiktok/web/fetch_user_post?unique_id=ayupgee&secUid=${encodeURIComponent(secUid)}&count=4`,
    { headers }
  );

  if (!res.ok) {
    throw new Error(`TikHub returned ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();

  // TikHub wraps responses: { code, data: { aweme_list: [...] } }
  const videos = json?.data?.aweme_list ?? [];
  if (videos.length === 0) {
    console.log('[tiktok] No videos returned');
    return { synced: 0, skipped: 0 };
  }

  let synced = 0;
  let skipped = 0;

  for (const v of videos) {
    try {
      const id          = String(v.aweme_id);
      const caption     = cleanCaption(v.desc || '');
      const title       = caption || 'Watch on TikTok';
      // Construct a reliable permalink from the video ID
      const url         = v.share_url
        || `https://www.tiktok.com/@ayupgee/video/${id}`;
      // cover.url_list can contain multiple resolutions — first is usually fine
      const thumbnailUrl = v.video?.cover?.url_list?.[0]
        || v.video?.origin_cover?.url_list?.[0]
        || null;
      const publishedAt = v.create_time
        ? new Date(v.create_time * 1000).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      await env.DB.prepare(`
        INSERT INTO social_posts
          (id, platform, url, title, thumbnail_url, caption_raw, published_at, created_at, updated_at)
        VALUES
          (?, 'tiktok', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
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

  console.log(`[tiktok] Done — ${synced} synced, ${skipped} skipped`);
  return { synced, skipped };
}

// ── Main scheduled handler ─────────────────────────────────────────────────────
export default {
  async scheduled(event, env, ctx) {
    console.log(`[social-sync] Running at ${new Date().toISOString()}`);

    const results = {};

    try {
      results.instagram = await syncInstagram(env);
    } catch (e) {
      console.error('[instagram] Sync failed:', e.message);
      results.instagram = { error: e.message };
    }

    try {
      results.tiktok = await syncTikTok(env);
    } catch (e) {
      console.error('[tiktok] Sync failed:', e.message);
      results.tiktok = { error: e.message };
    }

    console.log('[social-sync] Complete:', JSON.stringify(results));
  },

  // Also handle HTTP requests so you can trigger a manual sync from the browser
  // or test with: curl https://ayupgee-social-sync.YOUR_SUBDOMAIN.workers.dev/sync
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/sync') {
      const results = {};
      try { results.instagram = await syncInstagram(env); } catch (e) { results.instagram = { error: e.message }; }
      try { results.tiktok    = await syncTikTok(env);    } catch (e) { results.tiktok    = { error: e.message }; }
      return new Response(JSON.stringify({ ok: true, results }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, worker: 'ayupgee-social-sync' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
