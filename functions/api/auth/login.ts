/**
 * POST /api/auth/login
 *
 * Body (JSON):
 *   { email, password, rememberMe?, turnstileToken }
 *
 * On success:
 *   - Sets ayg_session HTTP-only cookie
 *   - Sets ayg_csrf readable cookie (for JS-driven API calls)
 *   - Returns { ok: true, data: { user, redirectTo } }
 */

import type { Env } from '../../../src/types/env.ts';
import { validateTurnstile } from '../../../src/lib/turnstile.ts';
import { buildSessionCookie, buildCsrfCookie, isSecureRequest } from '../../../src/lib/cookie.ts';
import { generateToken } from '../../../src/lib/auth.ts';
import { ok, err, methodNotAllowed, tooManyRequests } from '../../../src/lib/response.ts';
import { login, redirectForRole } from '../../../src/services/authService.ts';
import { toPublicUser } from '../../../src/repositories/userRepository.ts';
import type { LoginRequest } from '../../../src/types/models.ts';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: LoginRequest;
  try {
    body = await request.json() as LoginRequest;
  } catch {
    return err('invalid_body', 'Request body must be valid JSON', 400);
  }

  const { email, password, rememberMe = false, turnstileToken } = body;

  // ── Validate required fields ──────────────────────────────────────────────
  if (!email || typeof email !== 'string' ||
      !password || typeof password !== 'string' ||
      !turnstileToken || typeof turnstileToken !== 'string') {
    return err('validation_error', 'email, password, and turnstileToken are required', 422);
  }

  if (email.length > 254 || password.length > 1024) {
    return err('validation_error', 'Input too long', 422);
  }

  // ── Validate Turnstile ────────────────────────────────────────────────────
  const ip = request.headers.get('CF-Connecting-IP');
  const turnstileOk = await validateTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!turnstileOk) {
    return err('turnstile_failed', 'Bot check failed, please try again', 400);
  }

  // ── Attempt login ─────────────────────────────────────────────────────────
  const result = await login({
    db:         env.DB,
    cache:      env.CACHE,
    email,
    password,
    rememberMe,
    ipAddress:  ip,
    userAgent:  request.headers.get('User-Agent'),
  });

  if (!result.success) {
    if (result.reason === 'rate_limited') {
      return tooManyRequests();
    }
    if (result.reason === 'account_disabled') {
      return err('account_disabled', 'This account has been deactivated', 403);
    }
    // Don't leak whether email exists
    return err('invalid_credentials', 'Incorrect email or password', 401);
  }

  // ── Build cookies ─────────────────────────────────────────────────────────
  const secure     = isSecureRequest(request);
  const csrfToken  = generateToken(24);
  const redirectTo = redirectForRole(result.session.user.role);

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', buildSessionCookie(result.token, rememberMe, secure));
  headers.append('Set-Cookie', buildCsrfCookie(csrfToken, secure));

  const publicUser = toPublicUser(result.session.user);

  return new Response(
    JSON.stringify({ ok: true, data: { user: publicUser, redirectTo } }),
    { status: 200, headers }
  );
};

// Reject non-POST methods
export const onRequestGet:    PagesFunction = () => methodNotAllowed();
export const onRequestPut:    PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();
