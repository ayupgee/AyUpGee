/**
 * Global Pages Functions middleware.
 *
 * Responsibilities:
 *  1. Attach security headers to every response.
 *  2. Protect /admin* routes — require valid session + admin role.
 *  3. Protect /moderator* routes — require valid session + moderator or admin role.
 *  4. Protect /member* routes — require any valid session.
 *  5. Protect /api/* routes (except the auth endpoints) — require valid session.
 *
 * Static assets under /assets/ are skipped immediately (no DB hit).
 */

import type { Env } from '../src/types/env.ts';
import { parseCookies, SESSION_COOKIE } from '../src/lib/cookie.ts';
import { withSecurityHeaders, redirect, unauthorized, forbidden } from '../src/lib/response.ts';
import { resolveSession } from '../src/services/authService.ts';

// Paths that are always public — no auth check needed
const PUBLIC_PATH_PREFIXES = [
  '/assets/',
  '/api/twitch/',       // Phase 1 Twitch schedule (no auth)
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/setup',
  '/login',
  '/favicon',
];

// Paths that require admin role
const ADMIN_PATHS = ['/admin', '/api/users', '/api/posts', '/api/media', '/api/settings', '/api/audit'];

// Paths that require moderator or admin role
const MODERATOR_PATHS = ['/moderator'];

// Paths that require any authenticated session
const MEMBER_PATHS = ['/member', '/api/auth/me', '/api/schedule'];

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, next, env } = context;
  const url      = new URL(request.url);
  const pathname = url.pathname;

  // ── 1. Skip static assets immediately ───────────────────────────────────
  if (
    PUBLIC_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix)) ||
    pathname === '/' ||
    !pathname.startsWith('/api/') && !pathname.startsWith('/admin') &&
    !pathname.startsWith('/moderator') && !pathname.startsWith('/member')
  ) {
    const response = await next();
    return withSecurityHeaders(response);
  }

  // ── 2. Determine required access level ──────────────────────────────────
  const requiresAdmin     = ADMIN_PATHS.some(p => pathname.startsWith(p));
  const requiresModerator = MODERATOR_PATHS.some(p => pathname.startsWith(p));
  const requiresAuth      = MEMBER_PATHS.some(p => pathname.startsWith(p));

  if (!requiresAdmin && !requiresModerator && !requiresAuth) {
    // Unknown path — serve it, let the static file handler deal with 404
    const response = await next();
    return withSecurityHeaders(response);
  }

  // ── 3. Resolve session from cookie ───────────────────────────────────────
  const cookies  = parseCookies(request);
  const rawToken = cookies[SESSION_COOKIE];

  if (!rawToken) {
    // Not logged in — redirect HTML requests, JSON for API
    if (pathname.startsWith('/api/')) {
      return withSecurityHeaders(unauthorized());
    }
    return withSecurityHeaders(redirect(`/login?next=${encodeURIComponent(pathname)}`));
  }

  const resolved = await resolveSession(env.DB, rawToken);

  if (!resolved) {
    if (pathname.startsWith('/api/')) {
      return withSecurityHeaders(unauthorized());
    }
    return withSecurityHeaders(redirect(`/login?next=${encodeURIComponent(pathname)}`));
  }

  const { user } = resolved;

  // ── 4. Role checks ────────────────────────────────────────────────────────
  if (requiresAdmin && user.role !== 'admin') {
    return withSecurityHeaders(forbidden());
  }

  if (requiresModerator && user.role !== 'admin' && user.role !== 'moderator') {
    return withSecurityHeaders(forbidden());
  }

  // ── 5. Inject user into request for downstream functions ─────────────────
  // Downstream functions can read X-User-Id, X-User-Role from the request.
  const modifiedRequest = new Request(request, {
    headers: new Headers({
      ...Object.fromEntries(request.headers),
      'X-User-Id':   user.id,
      'X-User-Role': user.role,
      'X-User-Email': user.email,
    }),
  });

  const response = await next(modifiedRequest);
  return withSecurityHeaders(response);
};
