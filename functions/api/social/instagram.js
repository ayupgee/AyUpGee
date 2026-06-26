/**
 * GET /api/social/instagram
 *
 * Proxies the Instagram Graph API, returning the latest 8 posts.
 * Results are cached in KV for 30 minutes so the homepage stays fast
 * and we don't hammer the API on every page load.
 *
 * ─── Required Cloudflare Secrets (Dashboard → Settings → Environment Variables) ───
 *   INSTAGRAM_ACCESS_TOKEN  — Long-lived User Access Token from Meta
 *   INSTAGRAM_USER_ID       — Numeric Instagram user/creator ID
 *
 * ─── How to get these ──────────────────────────────────────────────────────────────
 *   1. Go to developers.facebook.com and create a Meta App (type: Business or Consumer)
 *   2. Add the "Instagram" product to your app
 *   3. Connect your Instagram Creator or Business account
 *   4. Generate a short-lived token, then exchange it for a long-lived token:
 *      GET https://graph.instagram.com/access_token
 *        ?grant_type=ig_exchange_token
 *        &client_id={app-id}
 *        &client_secret={app-secret}
 *        &access_token={short-lived-token}
 *   5. Long-lived tokens last 60 days. To refresh before they expire:
 *      GET https://graph.instagram.com/refresh_access_token
 *        ?grant_type=ig_refresh_token
 *        &access_token={long-lived-token}
 *   6. Store the resulting token + your numeric user ID as Cloudflare Secrets.
 *
 * ─── Response shape ────────────────────────────────────────────────────────────────
 *   { ok: true, items: [{ id, url, imageUrl, caption, mediaType, timestamp }] }
 */

const CACHE_KEY = 'ig_feed_v1';
const CACHE_TTL = 30 * 60; // 30 minutes
const IG_API    = 'https://graph.instagram.com/v21.0';
const FIELDS    = 'id,caption,media_url,thumbnail_url,permalink,media_type,timestamp';
const LIMIT     = 8;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function ok(items, cached = false) {
  return new Response(
    JSON.stringify({ ok: true, items }),
    { headers: { ...JSON_HEADERS, 'X-Cache': cached ? 'HIT' : 'MISS' } }
  );
}

function fail(message, status = 500) {
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    { status, headers: JSON_HEADERS }
  );
}

/**
 * Normalise a raw Instagram API post into a safe, minimal object.
 * Never forwards the access token or any internal API fields.
 */
function normalise(post) {
  return {
    id:        post.id,
    url:       post.permalink,
    // Videos expose thumbnail_url instead of media_url for the cover image
    imageUrl:  post.media_type === 'VIDEO'
      ? (post.thumbnail_url || null)
      : (post.media_url || null),
    caption:   post.caption || '',
    mediaType: post.media_type,   // IMAGE | VIDEO | CAROUSEL_ALBUM
    timestamp: post.timestamp,
  };
}

export async function onRequest(context) {
  const { env } = context;

  if (!env.INSTAGRAM_ACCESS_TOKEN || !env.INSTAGRAM_USER_ID) {
    return fail(
      'Instagram not configured — add INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID as Cloudflare Secrets.',
      503
    );
  }

  // ── KV cache ────────────────────────────────────────────────────────────────
  if (env.CACHE) {
    const cached = await env.CACHE.get(CACHE_KEY);
    if (cached) {
      return new Response(cached, {
        headers: { ...JSON_HEADERS, 'X-Cache': 'HIT' },
      });
    }
  }

  // ── Live Instagram Graph API call ────────────────────────────────────────────
  try {
    const apiUrl = new URL(`${IG_API}/${env.INSTAGRAM_USER_ID}/media`);
    apiUrl.searchParams.set('fields', FIELDS);
    apiUrl.searchParams.set('limit', String(LIMIT));
    apiUrl.searchParams.set('access_token', env.INSTAGRAM_ACCESS_TOKEN);

    const res = await fetch(apiUrl.toString());

    if (!res.ok) {
      const body = await res.text();
      console.error('[/api/social/instagram] API error', res.status, body);
      return fail(`Instagram API returned ${res.status}`, 502);
    }

    const data  = await res.json();
    const items = (data.data ?? []).map(normalise);
    const payload = JSON.stringify({ ok: true, items });

    // Store in KV for next 30 minutes
    if (env.CACHE) {
      await env.CACHE.put(CACHE_KEY, payload, { expirationTtl: CACHE_TTL });
    }

    return new Response(payload, {
      headers: { ...JSON_HEADERS, 'X-Cache': 'MISS' },
    });

  } catch (e) {
    console.error('[/api/social/instagram]', e.message);
    return fail('Failed to fetch Instagram feed');
  }
}
