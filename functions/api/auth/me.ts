/**
 * GET /api/auth/me
 *
 * Returns the currently authenticated user and a fresh CSRF token.
 * Protected by _middleware.ts — if we reach this handler, the session is valid.
 * The user info is forwarded as X-User-* headers by the middleware.
 */

import type { Env } from '../../../src/types/env.ts';
import { parseCookies, SESSION_COOKIE } from '../../../src/lib/cookie.ts';
import { ok, unauthorized, methodNotAllowed } from '../../../src/lib/response.ts';
import { resolveSession } from '../../../src/services/authService.ts';
import { toPublicUser } from '../../../src/repositories/userRepository.ts';
import { generateToken } from '../../../src/lib/auth.ts';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const cookies  = parseCookies(request);
  const rawToken = cookies[SESSION_COOKIE];
  if (!rawToken) return unauthorized();

  const resolved = await resolveSession(env.DB, rawToken);
  if (!resolved) return unauthorized();

  const csrfToken = generateToken(24);

  return ok({
    user:      toPublicUser(resolved.user),
    csrfToken,
  });
};

export const onRequestPost:   PagesFunction = () => methodNotAllowed();
export const onRequestPut:    PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();
