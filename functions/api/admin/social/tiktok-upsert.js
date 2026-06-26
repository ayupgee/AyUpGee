/**
 * POST /api/admin/social/tiktok-upsert
 *
 * Adds or updates a TikTok post in the D1 social_posts table.
 * Protected — requires admin session (enforced by _middleware.ts via /api/admin/ prefix).
 *
 * ─── Typical workflow ──────────────────────────────────────────────────────────────
 *   1. You post a new TikTok video
 *   2. In the AyUpGee admin panel, paste the TikTok URL into the social manager
 *   3. This endpoint fetches the title + thumbnail via TikTok's public oEmbed API
 *   4. The post is saved to D1 and immediately appears on the homepage
 *
 * ─── Request body (JSON) ───────────────────────────────────────────────────────────
 *   Required:
 *     url          — Full TikTok video URL, e.g. https://www.tiktok.com/@ayupgee/video/123456789
 *   Optional overrides (use when oEmbed gives a bad title or wrong thumbnail):
 *     title        — Custom clean title (hashtags already stripped)
 *     thumbnailUrl — Direct image URL to use as the card background
 *     publishedAt  — ISO date string, e.g. "2025-03-14"
 *
 * ─── Response (JSON) ───────────────────────────────────────────────────────────────
 *   Success: { ok: true, data: { id, url, title, thumbnailUrl, publishedAt } }
 *   Error:   { ok: false, error: "..." }
 *
 * ─── DELETE a post ─────────────────────────────────────────────────────────────────
 *   Send DELETE /api/admin/social/tiktok-upsert with body: { "id": "123456789" }
 */

const OEMBED_API  = 'https://www.tiktok.com/oembed';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const ok  = (data)      => new Response(JSON.stringify({ ok: true,  data }),  { status: 200, headers: JSON_HEADERS });
const err = (msg, s=400) => new Response(JSON.stringify({ ok: false, error: msg }), { status: s,   headers: JSON_HEADERS });

/** Extract the numeric video ID from any TikTok URL format */
function extractVideoId(url) {
  const match = url.match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Remove trailing hashtags from a TikTok caption.
 * Keeps emojis and normal sentence text.
 * Example: "Cosy night in ✨ #DDLV #DisneyDreamlightValley" → "Cosy night in ✨"
 */
function cleanCaption(caption) {
  if (!caption) return '';
  return caption
    .replace(/(^|\s)#\S+/g, '') // remove hashtag tokens
    .replace(/\s{2,}/g, ' ')    // collapse extra whitespace
    .trim();
}

// ── POST: add or update a TikTok post ────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return err('Database not configured', 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return err('Request body must be valid JSON');
  }

  const {
    url,
    title:        manualTitle,
    thumbnailUrl: manualThumb,
    publishedAt:  manualDate,
  } = body;

  if (!url || typeof url !== 'string') return err('"url" is required');

  const videoId = extractVideoId(url);
  if (!videoId) {
    return err(
      'Could not extract TikTok video ID from URL. ' +
      'Expected: https://www.tiktok.com/@ayupgee/video/{id}'
    );
  }

  const canonicalUrl = `https://www.tiktok.com/@ayupgee/video/${videoId}`;

  let title        = manualTitle  || '';
  let thumbnailUrl = manualThumb  || null;
  let publishedAt  = manualDate   || new Date().toISOString().split('T')[0];

  // ── Fetch oEmbed metadata (title + thumbnail) ──────────────────────────────
  // oEmbed is a public, no-auth API. We only call it when the admin hasn't
  // provided manual overrides.
  if (!title || !thumbnailUrl) {
    try {
      const oRes = await fetch(
        `${OEMBED_API}?url=${encodeURIComponent(canonicalUrl)}`,
        { headers: { 'User-Agent': 'AyUpGee/1.0' } }
      );
      if (oRes.ok) {
        const oembed = await oRes.json();
        if (!title)        title        = cleanCaption(oembed.title || '') || 'Watch on TikTok';
        if (!thumbnailUrl) thumbnailUrl = oembed.thumbnail_url || null;
      } else {
        console.warn('[tiktok-upsert] oEmbed returned', oRes.status);
      }
    } catch (e) {
      console.warn('[tiktok-upsert] oEmbed failed:', e.message);
    }
  }

  if (!title) title = 'Watch on TikTok';

  try {
    await env.DB.prepare(`
      INSERT INTO social_posts
        (id, platform, url, title, thumbnail_url, published_at, created_at, updated_at)
      VALUES
        (?, 'tiktok', ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        url           = excluded.url,
        title         = excluded.title,
        thumbnail_url = excluded.thumbnail_url,
        published_at  = excluded.published_at,
        updated_at    = datetime('now')
    `).bind(videoId, canonicalUrl, title, thumbnailUrl, publishedAt).run();

    return ok({ id: videoId, url: canonicalUrl, title, thumbnailUrl, publishedAt });

  } catch (e) {
    console.error('[tiktok-upsert] DB error:', e.message);
    return err('Failed to save post to database', 500);
  }
}

// ── DELETE: remove a TikTok post ─────────────────────────────────────────────
export async function onRequestDelete(context) {
  const { request, env } = context;

  if (!env.DB) return err('Database not configured', 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return err('Request body must be valid JSON');
  }

  const { id } = body;
  if (!id) return err('"id" is required');

  try {
    await env.DB.prepare(
      `DELETE FROM social_posts WHERE id = ? AND platform = 'tiktok'`
    ).bind(id).run();
    return ok({ deleted: id });
  } catch (e) {
    console.error('[tiktok-upsert] DELETE error:', e.message);
    return err('Failed to delete post', 500);
  }
}
