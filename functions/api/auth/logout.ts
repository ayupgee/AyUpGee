/**
 * POST /api/auth/logout
 *
 * Deletes the session from D1 and clears the session + CSRF cookies.
 * No auth middleware required — a missing/invalid session is still a valid logout.
 */

import type { Env } from '../../../src/types/env.ts';
import { parseCookies, SESSION_COOKIE, CSRF_COOKIE, clearCookieHeader } from '../../../src/lib/cookie.ts';
import { ok, methodNotAllowed } from '../../../src/lib/response.ts';
import { logout } from '../../../src/services/authService.ts';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const cookies  = parseCookies(request);
  const rawToken = cookies[SESSION_COOKIE];

  if (rawToken) {
    const userId = request.headers.get('X-User-Id') ?? undefined;
    const ip     = request.headers.get('CF-Connecting-IP');
    await logout(env.DB, rawToken, userId, ip);
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', clearCookieHeader(SESSION_COOKIE));
  headers.append('Set-Cookie', clearCookieHeader(CSRF_COOKIE));

  return new Response(
    JSON.stringify({ ok: true, data: { message: 'Logged out' } }),
    { status: 200, headers }
  );
};

export const onRequestGet:    PagesFunction = () => methodNotAllowed();
export const onRequestPut:    PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();
