/**
 * Social Provider Abstraction Layer
 *
 * Shared by all /api/admin/social/* endpoints.
 * Each provider exposes a common interface:
 *   getStatus(env)   → { status, reachable, responseTime, lastSync, itemCount, lastError }
 *   getLogs(env, n)  → [{ event, message, items_synced, response_time_ms, created_at }]
 *
 * Adding a new provider (e.g. YouTube):
 *   1. Create a YoutubeProvider object below
 *   2. Add it to PROVIDERS map
 *   No other files need changing.
 */

const WORKER_URL = 'https://ayupgee-social-sync.ayupgee.workers.dev';

// ── Utility ────────────────────────────────────────────────────────────────────

/**
 * Ping a URL and return { reachable, responseTime, httpStatus }.
 * Never throws — network errors return reachable:false.
 */
export async function pingUrl(url, timeoutMs = 6000) {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
    const res  = await fetch(url, {
      signal: ctrl.signal,
      method: 'GET',
      headers: { 'User-Agent': 'AyUpGee-HealthCheck/1.0' },
    });
    clearTimeout(tid);
    return { reachable: res.ok || res.status < 500, responseTime: Date.now() - start, httpStatus: res.status };
  } catch {
    return { reachable: false, responseTime: null, httpStatus: null };
  }
}

/**
 * Determine an overall status string from reachability + last sync age.
 */
export function computeStatus(reachable, lastSyncIso) {
  if (!reachable) return 'offline';
  if (!lastSyncIso) return 'unknown';
  const ageMs = Date.now() - new Date(lastSyncIso).getTime();
  if (ageMs > 3 * 60 * 60 * 1000) return 'warning'; // > 3 hours
  return 'online';
}

/**
 * Read recent sync logs from D1 for a given platform.
 * Gracefully returns [] if the table doesn't exist yet.
 */
export async function getLogs(env, platform, limit = 20) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT event, message, items_synced, error_message, response_time_ms, created_at
      FROM   sync_logs
      WHERE  platform = ?
      ORDER  BY created_at DESC
      LIMIT  ?
    `).bind(platform, limit).all();
    return results ?? [];
  } catch {
    return [];
  }
}

/**
 * Read D1 social_posts aggregate for a platform.
 */
export async function getPostStats(env, platform) {
  try {
    const row = await env.DB.prepare(`
      SELECT MAX(updated_at) AS last_sync, COUNT(*) AS item_count
      FROM   social_posts
      WHERE  platform = ?
    `).bind(platform).first();
    return { lastSync: row?.last_sync ?? null, itemCount: row?.item_count ?? 0 };
  } catch {
    return { lastSync: null, itemCount: 0 };
  }
}

/**
 * Get the most recent error from sync_logs for a platform.
 */
export async function getLastError(env, platform) {
  try {
    const row = await env.DB.prepare(`
      SELECT error_message, created_at
      FROM   sync_logs
      WHERE  platform = ? AND event = 'sync_error'
      ORDER  BY created_at DESC
      LIMIT  1
    `).bind(platform).first();
    return row ? { message: row.error_message, at: row.created_at } : null;
  } catch {
    return null;
  }
}

// ── Sync Worker Provider (health of the social-sync Cloudflare Worker) ────────
export const TwitchProvider = {
  id:           'twitch',
  name:         'Social Sync Worker',
  dashboardUrl: WORKER_URL,
  providerUrl:  WORKER_URL,

  async getStatus(env) {
    // Ping the worker health endpoint — it returns version + D1 stats for all platforms
    const start  = Date.now();
    const ctrl   = new AbortController();
    const tid    = setTimeout(() => ctrl.abort(), 6000);
    let reachable    = false;
    let responseTime = null;
    let workerData   = null;

    try {
      const res = await fetch(WORKER_URL, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'AyUpGee-HealthCheck/1.0' },
      });
      clearTimeout(tid);
      responseTime = Date.now() - start;
      reachable    = res.ok;
      if (res.ok) workerData = await res.json();
    } catch {
      clearTimeout(tid);
      responseTime = null;
    }

    // Use the most recent sync across all platforms to determine worker health
    const row = await env.DB.prepare(`
      SELECT MAX(created_at) AS last_sync, COUNT(*) AS total_items
      FROM   social_posts
      WHERE  platform IN ('instagram','tiktok','twitch','youtube')
    `).first().catch(() => null);

    const lastSync = workerData?.lastSync ?? row?.last_sync ?? null;
    const status   = computeStatus(reachable, lastSync);

    // Surface the most recent error across all platforms
    const errRow = await env.DB.prepare(`
      SELECT error_message, created_at
      FROM   sync_logs
      WHERE  event = 'sync_error'
      ORDER  BY created_at DESC
      LIMIT  1
    `).first().catch(() => null);

    return {
      reachable,
      responseTime,
      status,
      lastSync,
      itemCount:   row?.total_items ?? 0,
      lastError:   errRow?.error_message ?? null,
      lastErrorAt: errRow?.created_at    ?? null,
      version:     workerData?.version   ?? null,
    };
  },

  async getLogs(env) {
    // Show a combined overview of all 4 platforms — newest activity across all syncs
    try {
      const { results } = await env.DB.prepare(`
        SELECT event, message, items_synced, error_message, response_time_ms, created_at
        FROM   sync_logs
        WHERE  platform IN ('instagram','tiktok','twitch','youtube')
        ORDER  BY created_at DESC
        LIMIT  20
      `).all();
      return results ?? [];
    } catch {
      return [];
    }
  },

  async sync() {
    const res = await fetch(`${WORKER_URL}/sync`, { method: 'GET' });
    return res.ok ? res.json() : { ok: false, error: `Worker returned ${res.status}` };
  },
};

// ── Instagram Provider ─────────────────────────────────────────────────────────
export const InstagramProvider = {
  id:           'instagram',
  name:         'Instagram',
  dashboardUrl: 'https://behold.so',
  providerUrl:  'https://behold.so',

  async getStatus(env) {
    const ping      = await pingUrl('https://feeds.behold.so/');
    const stats     = await getPostStats(env, 'instagram');
    const lastError = await getLastError(env, 'instagram');
    const status    = computeStatus(ping.reachable, stats.lastSync);

    return {
      reachable:   ping.reachable,
      responseTime: ping.responseTime,
      status,
      lastSync:    stats.lastSync,
      itemCount:   stats.itemCount,
      lastError:   lastError?.message ?? null,
      lastErrorAt: lastError?.at      ?? null,
      version:     null,
    };
  },

  async getLogs(env) { return getLogs(env, 'instagram'); },
  async sync()       { return { ok: false, error: 'Use the Twitch Sync Worker to trigger a full sync.' }; },
};

// ── TikTok Provider ────────────────────────────────────────────────────────────
export const TikTokProvider = {
  id:           'tiktok',
  name:         'TikTok',
  dashboardUrl: 'https://tikhub.io',
  providerUrl:  'https://tikhub.io',

  async getStatus(env) {
    const ping      = await pingUrl('https://api.tikhub.io/');
    const stats     = await getPostStats(env, 'tiktok');
    const lastError = await getLastError(env, 'tiktok');
    const status    = computeStatus(ping.reachable, stats.lastSync);

    return {
      reachable:   ping.reachable,
      responseTime: ping.responseTime,
      status,
      lastSync:    stats.lastSync,
      itemCount:   stats.itemCount,
      lastError:   lastError?.message ?? null,
      lastErrorAt: lastError?.at      ?? null,
      version:     null,
    };
  },

  async getLogs(env) { return getLogs(env, 'tiktok'); },
  async sync()       { return { ok: false, error: 'Use the Twitch Sync Worker to trigger a full sync.' }; },
};

// ── Twitch VODs Provider ───────────────────────────────────────────────────────
export const TwitchVODsProvider = {
  id:           'twitchvods',
  name:         'Twitch VODs',
  dashboardUrl: 'https://dev.twitch.tv/console',
  providerUrl:  'https://www.twitch.tv/ayupgee/videos',

  async getStatus(env) {
    const ping      = await pingUrl('https://api.twitch.tv/');
    const stats     = await getPostStats(env, 'twitch');
    const lastError = await getLastError(env, 'twitch');
    const status    = computeStatus(ping.reachable, stats.lastSync);
    return {
      reachable:    ping.reachable,
      responseTime: ping.responseTime,
      status,
      lastSync:     stats.lastSync,
      itemCount:    stats.itemCount,
      lastError:    lastError?.message ?? null,
      lastErrorAt:  lastError?.at      ?? null,
      version:      null,
    };
  },

  async getLogs(env) { return getLogs(env, 'twitch'); },
  async sync()       { return { ok: false, error: 'Trigger via the social-sync worker /sync endpoint.' }; },
};

// ── YouTube Provider ───────────────────────────────────────────────────────────
export const YouTubeProvider = {
  id:           'youtube',
  name:         'YouTube',
  dashboardUrl: 'https://console.cloud.google.com',
  providerUrl:  'https://www.youtube.com/@AyUpGee',

  async getStatus(env) {
    const ping      = await pingUrl('https://www.googleapis.com/');
    const stats     = await getPostStats(env, 'youtube');
    const lastError = await getLastError(env, 'youtube');
    const status    = computeStatus(ping.reachable, stats.lastSync);
    return {
      reachable:    ping.reachable,
      responseTime: ping.responseTime,
      status,
      lastSync:     stats.lastSync,
      itemCount:    stats.itemCount,
      lastError:    lastError?.message ?? null,
      lastErrorAt:  lastError?.at      ?? null,
      version:      null,
    };
  },

  async getLogs(env) { return getLogs(env, 'youtube'); },
  async sync()       { return { ok: false, error: 'Trigger via the social-sync worker /sync endpoint.' }; },
};

// ── Twitch Schedule Provider ───────────────────────────────────────────────────
export const TwitchScheduleProvider = {
  id:           'twitchschedule',
  name:         'Twitch Schedule',
  dashboardUrl: 'https://dashboard.twitch.tv/u/ayupgee/content/schedule',
  providerUrl:  'https://api.twitch.tv/helix/schedule',

  async getStatus(env) {
    // Ping our own Pages Function which proxies the Twitch schedule API
    const start = Date.now();
    let reachable    = false;
    let responseTime = null;
    let lastSync     = null;
    let itemCount    = 0;
    let lastError    = null;

    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 8000);
      // Use the Pages Function URL — relative won't work in a Pages Function context,
      // so we derive it from the environment or fall back to the production URL.
      const scheduleUrl = (env.PAGES_BASE_URL ?? 'https://ayupgee.pages.dev') + '/api/twitch/schedule';
      const res = await fetch(scheduleUrl, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'AyUpGee-HealthCheck/1.0' },
      });
      clearTimeout(tid);
      responseTime = Date.now() - start;
      reachable    = res.ok;

      if (res.ok) {
        const data = await res.json();
        itemCount = data?.items?.length ?? 0;
        lastSync  = new Date().toISOString(); // schedule endpoint is live, not cached in D1
      } else {
        lastError = `Schedule API returned ${res.status}`;
      }
    } catch (e) {
      responseTime = Date.now() - start;
      lastError    = e.message ?? 'Request failed';
    }

    const status = reachable ? 'online' : 'offline';
    return { reachable, responseTime, status, lastSync, itemCount, lastError, lastErrorAt: null, version: null };
  },

  async getLogs(_env) {
    // Schedule is fetched live from Twitch on every page load — no sync history in D1
    return [];
  },
  async sync() { return { ok: false, error: 'Schedule is read from Twitch in real time — no sync needed.' }; },
};

// ── Registry ───────────────────────────────────────────────────────────────────
export const PROVIDERS = {
  twitch:          TwitchProvider,          // social-sync worker overview (all 4 platforms)
  instagram:       InstagramProvider,
  tiktok:          TikTokProvider,
  twitchvods:      TwitchVODsProvider,      // Twitch VODs sync status
  youtube:         YouTubeProvider,         // YouTube videos sync status
  twitchschedule:  TwitchScheduleProvider,  // Twitch schedule API health
};
