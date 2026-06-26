/**
 * AyUpGee Social Sync Worker
 *
 * Runs on a cron schedule (every hour) and syncs social media posts into D1.
 * The homepage reads from D1 — so once this runs, posts appear automatically.
 *
 * ─── Platforms ─────────────────────────────────────────────────────────────────
 *   Instagram  → Behold.so (free, handles all Meta OAuth complexity)
 *   TikTok     → Manual admin panel for now; cron support added once TikTok
 *                Display API access is approved at developers.tiktok.com
 *
 * ─── Required secrets (set via: wrangler secret put SECRET_NAME) ───────────────
 *   BEHOLD_FEED_ID   — Your feed ID from behold.so dashboard
 *
 * ─── How to deploy ─────────────────────────────────────────────────────────────
 *   cd workers/social-sync
 *   npx wrangler secret put BEHOLD_FEED_ID
 *   npx wrangler deploy
 *
 * ─── How to test manually (without waiting for cron) ───────────────────────────
 *   npx wrangler dev   (runs locally, hit http://localhost:8787/__scheduled)
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

// ── TikTok (placeholder — ready for when API access is approved) ────────────────
async function syncTikTok(env) {
  if (!env.TIKTOK_ACCESS_TOKEN) {
    console.log('[tiktok] TIKTOK_ACCESS_TOKEN not set — skipping (use admin panel to add posts manually)');
    return { synced: 0, skipped: 0 };
  }

  // TODO: implement once TikTok Display API access is approved.
  // Required scope: video.list
  // Endpoint: GET https://open.tiktokapis.com/v2/video/list/
  // Docs: https://developers.tiktok.com/doc/tiktok-api-v2-video-list
  console.log('[tiktok] API access not yet implemented — awaiting approval');
  return { synced: 0, skipped: 0 };
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
