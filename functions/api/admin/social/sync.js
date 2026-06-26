/**
 * POST /api/admin/social/sync
 *
 * Triggers a manual sync of all social platforms via the Worker.
 * Auth: admin session required (enforced by _middleware.ts).
 *
 * The actual sync runs inside the Worker (which holds the API secrets).
 * This function is purely a secure proxy: admin auth → forward to Worker.
 *
 * Response:
 *   { ok: true, results: { instagram: { synced, skipped }, tiktok: { … } } }
 */

const WORKER_SYNC_URL = 'https://ayupgee-social-sync.ayupgee.workers.dev/sync';
const JSON_HEADERS    = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export async function onRequestPost(context) {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 30_000); // 30s timeout for full sync

    const res = await fetch(WORKER_SYNC_URL, {
      method: 'GET', // Worker's /sync is a GET endpoint
      signal: ctrl.signal,
      headers: { 'User-Agent': 'AyUpGee-Admin/1.0' },
    });
    clearTimeout(tid);

    if (!res.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: `Worker returned ${res.status}` }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    const data = await res.json();
    return new Response(JSON.stringify({ ok: true, results: data.results ?? data }), {
      headers: JSON_HEADERS,
    });
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Sync timed out' : 'Unable to contact sync worker';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }
}

// Only POST is supported
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: false, error: 'Use POST to trigger a sync' }), {
    status: 405,
    headers: JSON_HEADERS,
  });
}
