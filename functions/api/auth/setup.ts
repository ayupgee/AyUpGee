/**
 * POST /api/auth/setup
 *
 * One-time bootstrap endpoint to create the first admin account.
 * Disabled automatically once any admin user exists.
 *
 * Body (JSON):
 *   { setupToken, email, password, displayName }
 *
 * Security:
 *   - Requires ADMIN_SETUP_TOKEN secret to match
 *   - Fails if any admin already exists (can only run once)
 *   - setupToken should be deleted from env after use
 *
 * Usage:
 *   curl -X POST https://yourdomain.com/api/auth/setup \
 *     -H 'Content-Type: application/json' \
 *     -d '{"setupToken":"...","email":"gee@example.com","password":"...","displayName":"Gee"}'
 */

import type { Env } from '../../../src/types/env.ts';
import { hashPassword, generateId } from '../../../src/lib/auth.ts';
import { ok, err, methodNotAllowed } from '../../../src/lib/response.ts';
import { countAdmins, createUser } from '../../../src/repositories/userRepository.ts';
import { writeAuditLog } from '../../../src/repositories/auditRepository.ts';

const MIN_PASSWORD_LENGTH = 12;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    return await handleSetup(request, env);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err('internal_error', `Setup failed: ${message}`, 500);
  }
};

async function handleSetup(request: Request, env: Env): Promise<Response> {
  // ── Guard: setup token must be configured ─────────────────────────────────
  if (!env.ADMIN_SETUP_TOKEN) {
    return err('setup_disabled', 'Setup endpoint is not configured', 404);
  }

  // ── Guard: DB binding must exist ──────────────────────────────────────────
  if (!env.DB) {
    return err('configuration_error', 'Database binding (DB) is not configured in Pages dashboard', 503);
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { setupToken?: string; email?: string; password?: string; displayName?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return err('invalid_body', 'Request body must be valid JSON', 400);
  }

  const { setupToken, email, password, displayName } = body;

  // ── Validate setup token (constant-time) ───────────────────────────────────
  if (!setupToken || !timingSafeStringEqual(setupToken, env.ADMIN_SETUP_TOKEN)) {
    return err('forbidden', 'Invalid setup token', 403);
  }

  // ── Validate input ─────────────────────────────────────────────────────────
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return err('validation_error', 'Valid email is required', 422);
  }
  if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return err(
      'validation_error',
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      422
    );
  }
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 2) {
    return err('validation_error', 'Display name must be at least 2 characters', 422);
  }

  // ── Guard: only one admin can be created via this endpoint ─────────────────
  const adminCount = await countAdmins(env.DB);
  if (adminCount > 0) {
    return err('setup_complete', 'Admin account already exists. Setup endpoint is disabled.', 409);
  }

  // ── Create admin user ──────────────────────────────────────────────────────
  const id           = generateId();
  const passwordHash = await hashPassword(password);

  await createUser(env.DB, {
    id,
    email,
    passwordHash,
    displayName: displayName.trim(),
    role: 'admin',
  });

  const ip = request.headers.get('CF-Connecting-IP');
  await writeAuditLog(env.DB, {
    userId: id,
    action: 'auth.setup.admin_created',
    details: { email, displayName: displayName.trim() },
    ipAddress: ip,
    userAgent: request.headers.get('User-Agent'),
  });

  return ok(
    { message: 'Admin account created. Remove ADMIN_SETUP_TOKEN from your environment variables now.' },
    201
  );
}

export const onRequestGet:    PagesFunction = () => methodNotAllowed();
export const onRequestPut:    PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

// ─── Internal ─────────────────────────────────────────────────────────────────

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return diff === 0;
}
