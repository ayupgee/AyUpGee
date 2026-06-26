/**
 * GET /api/social/tiktok-thumb?id=VIDEO_ID
 *
 * Proxies TikTok video thumbnails server-side.
 *
 * Why: TikTok CDN URLs are signed with an expiry (~hours), so storing them
 * in D1 and serving them directly doesn't work reliably. Instead, we call
 * TikTok's public oembed API to get a fresh signed URL on each request,
 * then proxy the image with the required Referer header.
 *
 * The oembed endpoint is public and requires no API key.
 */

const TIKTOK_OEMBED = 'https://www.tiktok.com/oembed';
const TIKTOK_ALLOWED = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktok.com', 'tiktokv.com'];

function isTikTokCdn(urlString) {
  try {
    const { hostname } = new URL(urlString);
    return TIKTOK_ALLOWED.some(d => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export async function onRequestGet(context) {
  const id = new URL(context.request.url).searchParams.get('id');

  if (!id || !/^\d+$/.test(id)) {
    return new Response('Missing or invalid id parameter', { status: 400 });
  }

  try {
    // 1. Fetch fresh signed thumbnail URL from TikTok's public oembed API
    const videoUrl = `https://www.tiktok.com/@ayupgee/video/${id}`;
    const oembedRes = await fetch(`${TIKTOK_OEMBED}?url=${encodeURIComponent(videoUrl)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AyUpGee/1.0)',
      },
    });

    if (!oembedRes.ok) {
      return new Response('Could not fetch oembed data', { status: 502 });
    }

    const oembed = await oembedRes.json();
    const thumbnailUrl = oembed?.thumbnail_url;

    if (!thumbnailUrl || !isTikTokCdn(thumbnailUrl)) {
      return new Response('No valid thumbnail URL in oembed response', { status: 404 });
    }

    // 2. Proxy the image server-side with TikTok Referer to bypass hotlink protection
    const imgRes = await fetch(thumbnailUrl, {
      headers: {
        'Referer': 'https://www.tiktok.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; AyUpGee/1.0)',
      },
    });

    if (!imgRes.ok) {
      return new Response('Thumbnail not found', { status: 404 });
    }

    return new Response(imgRes.body, {
      headers: {
        'Content-Type': imgRes.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=3600', // 1 hour — oembed URLs expire
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response('Failed to fetch thumbnail', { status: 502 });
  }
}
