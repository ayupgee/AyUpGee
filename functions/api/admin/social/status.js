/**
 * GET /api/admin/social/status
 *
 * Returns live health data for all social providers.
 * Auth: admin session required (enforced by _middleware.ts).
 *
 * All external requests (pinging Behold, TikHub, the Worker) happen here
 * on the server side — no secrets or API keys ever reach the browser.
 *
 * Response shape:
 * {
 *   ok: true,
 *   timestamp: "2026-06-27T…",
 *   providers: {
 *     twitch:    { status, reachable, responseTime, lastSync, itemCount, lastError, logs },
 *     instagram: { … },
 *     tiktok:    { … },
 *   }
 * }
 */

import { PROVIDERS } from './_providers.js';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.DB) {
    return new Response(JSON.stringify({ ok: false, error: 'Database not configured' }), {
      status: 503,
      headers: CORS_HEADERS,
    });
  }

  try {
    // Fetch all providers in parallel for speed
    const [twitchStatus, instagramStatus, tiktokStatus] = await Promise.all([
      PROVIDERS.twitch.getStatus(env),
      PROVIDERS.instagram.getStatus(env),
      PROVIDERS.tiktok.getStatus(env),
    ]);

    const [twitchLogs, instagramLogs, tiktokLogs] = await Promise.all([
      PROVIDERS.twitch.getLogs(env),
      PROVIDERS.instagram.getLogs(env),
      PROVIDERS.tiktok.getLogs(env),
    ]);

    const payload = {
      ok: true,
      timestamp: new Date().toISOString(),
      providers: {
        twitch: {
          ...PROVIDERS.twitch,
          sync: undefined,   // don't serialise functions
          getStatus: undefined,
          getLogs: undefined,
          ...twitchStatus,
          logs: twitchLogs,
        },
        instagram: {
          ...PROVIDERS.instagram,
          sync: undefined,
          getStatus: undefined,
          getLogs: undefined,
          ...instagramStatus,
          logs: instagramLogs,
        },
        tiktok: {
          ...PROVIDERS.tiktok,
          sync: undefined,
          getStatus: undefined,
          getLogs: undefined,
          ...tiktokStatus,
          logs: tiktokLogs,
        },
      },
    };

    return new Response(JSON.stringify(payload), { headers: CORS_HEADERS });
  } catch (e) {
    console.error('[/api/admin/social/status]', e.message);
    return new Response(JSON.stringify({ ok: false, error: 'Failed to fetch provider status' }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
