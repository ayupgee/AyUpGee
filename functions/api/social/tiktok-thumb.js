/**
 * GET /api/social/tiktok-thumb?url=ENCODED_CDN_URL
 *
 * Proxies TikTok CDN thumbnail images server-side.
 * TikTok's CDN blocks direct browser requests (hotlink protection),
 * but allows server-to-server fetches with a TikTok referer header.
 *
 * Only proxies URLs from known TikTok CDN domains for security.
 */

const ALLOWED_DOMAINS = [
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktok.com',
];

function isTikTokCdn(urlString) {
  try {
    const { hostname } = new URL(urlString);
    return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export async function onRequestGet(context) {
  const raw = new URL(context.request.url).searchParams.get('url');

  if (!raw) {
    return new Response('Missing url parameter', { status: 400 });
  }

  if (!isTikTokCdn(raw)) {
    return new Response('URL not from an allowed domain', { status: 403 });
  }

  try {
    const res = await fetch(raw, {
      headers: {
        'Referer': 'https://www.tiktok.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; AyUpGee/1.0)',
      },
    });

    if (!res.ok) {
      return new Response('Thumbnail not found', { status: 404 });
    }

    return new Response(res.body, {
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400', // cache 24 hours at the edge
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response('Failed to fetch thumbnail', { status: 502 });
  }
}
