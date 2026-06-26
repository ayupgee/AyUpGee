/**
 * Auth service — orchestrates login, session creation, and session resolution.
 * All the pieces (hashing, cookie building, DB writes) live in their own modules.
 * This service wires them together so functions stay thin.
 */

import { generateId, generateToken, hashToken, verifyPassword } from '../lib/auth.ts';
import { SESSION_TTL_LONG, SESSION_TTL_SHORT } from '../lib/cookie.ts';
import { findUserByEmail, updateLastLogin } from '../repositories/userRepository.ts';
import { createSession, deleteSessionByTokenHash, findValidSession } from '../repositories/sessionRepository.ts';
import { writeAuditLog } from '../repositories/auditRepository.ts';
import type { ResolvedSession } from '../types/models.ts';

// ─── Rate limiting via KV ─────────────────────────────────────────────────────

const RATE_WINDOW_SECONDS = 15 * 60; // 15 minutes
const MAX_ATTEMPTS        = 5;

async function checkRateLimit(
  cache: KVNamespace | undefined,
  ip: string
): Promise<{ allowed: boolean; remaining: number }> {
  if (!cache) return { allowed: true, remaining: MAX_ATTEMPTS };

  const key      = `rate:login:${ip}`;
  const current  = parseInt((await cache.get(key)) ?? '0', 10);

  if (current >= MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0 };
  }

  await cache.put(key, String(current + 1), { expirationTtl: RATE_WINDOW_SECONDS });
  return { allowed: true, remaining: MAX_ATTEMPTS - current - 1 };
}

// ─── Login ────────────────────────────────────────────────────────────────────

export type LoginResult =
  | { success: true; token: string; session: ResolvedSession }
  | { success: false; reason: 'rate_limited' | 'invalid_credentials' | 'account_disabled' };

export async function login(params: {
  db: D1Database;
  cache?: KVNamespace;
  email: string;
  password: string;
  rememberMe: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<LoginResult> {
  const { db, cache, email, password, rememberMe, ipAddress, userAgent } = params;

  // 1. Rate limit
  if (ipAddress) {
    const rate = await checkRateLimit(cache, ipAddress);
    if (!rate.allowed) {
      await writeAuditLog(db, {
        action: 'auth.login.rate_limited',
        details: { email },
        ipAddress,
        userAgent,
      });
      return { success: false, reason: 'rate_limited' };
    }
  }

  // 2. Find user — always run verifyPassword even on miss to prevent timing attacks
  const user = await findUserByEmail(db, email);
  const dummyHash = 'pbkdf2sha256:600000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
  const passwordOk = await verifyPassword(password, user?.password_hash ?? dummyHash);

  if (!user || !passwordOk) {
    await writeAuditLog(db, {
      userId: user?.id ?? null,
      action: 'auth.login.failed',
      details: { email, reason: !user ? 'user_not_found' : 'wrong_password' },
      ipAddress,
      userAgent,
    });
    return { success: false, reason: 'invalid_credentials' };
  }

  // 3. Active check
  if (user.is_active !== 1) {
    return { success: false, reason: 'account_disabled' };
  }

  // 4. Create session
  const token    = generateToken(32);
  const tokenHash = await hashToken(token);
  const sessionId = generateId();
  const ttl       = rememberMe ? SESSION_TTL_LONG : SESSION_TTL_SHORT;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  await createSession(db, {
    id: sessionId,
    userId: user.id,
    tokenHash,
    expiresAt,
    ipAddress,
    userAgent,
  });

  // 5. Update last login
  await updateLastLogin(db, user.id);

  // 6. Audit
  await writeAuditLog(db, {
    userId: user.id,
    action: 'auth.login.success',
    details: { role: user.role, rememberMe },
    ipAddress,
    userAgent,
  });

  const resolvedSession: ResolvedSession = {
    session: { id: sessionId, user_id: user.id, token_hash: tokenHash, expires_at: expiresAt, ip_address: ipAddress ?? null, user_agent: userAgent ?? null, created_at: new Date().toISOString() },
    user,
  };

  return { success: true, token, session: resolvedSession };
}

// ─── Session resolution ───────────────────────────────────────────────────────

export async function resolveSession(
  db: D1Database,
  rawToken: string
): Promise<ResolvedSession | null> {
  const tokenHash = await hashToken(rawToken);
  return findValidSession(db, tokenHash);
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(
  db: D1Database,
  rawToken: string,
  userId?: string,
  ipAddress?: string | null
): Promise<void> {
  const tokenHash = await hashToken(rawToken);
  await deleteSessionByTokenHash(db, tokenHash);
  await writeAuditLog(db, {
    userId: userId ?? null,
    action: 'auth.logout',
    ipAddress,
  });
}

// ─── Role redirect ────────────────────────────────────────────────────────────

export function redirectForRole(role: string): string {
  switch (role) {
    case 'admin':     return '/admin';
    case 'moderator': return '/moderator';
    default:          return '/member';
  }
}
