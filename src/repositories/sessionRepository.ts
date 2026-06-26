import type { SessionRow, ResolvedSession } from '../types/models.ts';
import type { UserRow } from '../types/models.ts';

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createSession(
  db: D1Database,
  params: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      params.id,
      params.userId,
      params.tokenHash,
      params.expiresAt,
      params.ipAddress ?? null,
      params.userAgent ?? null
    )
    .run();
}

// ─── Lookup ───────────────────────────────────────────────────────────────────

/**
 * Look up a session by its hashed token and return both the session and user.
 * Returns null if not found, expired, or the user is inactive.
 */
export async function findValidSession(
  db: D1Database,
  tokenHash: string
): Promise<ResolvedSession | null> {
  const result = await db
    .prepare(
      `SELECT
         s.id, s.user_id, s.token_hash, s.expires_at, s.ip_address, s.user_agent, s.created_at,
         u.id as u_id, u.email, u.password_hash, u.display_name, u.role,
         u.created_at as u_created_at, u.updated_at, u.last_login, u.is_active
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.expires_at > datetime('now')
         AND u.is_active = 1
       LIMIT 1`
    )
    .bind(tokenHash)
    .first<{
      id: string; user_id: string; token_hash: string; expires_at: string;
      ip_address: string | null; user_agent: string | null; created_at: string;
      u_id: string; email: string; password_hash: string; display_name: string;
      role: string; u_created_at: string; updated_at: string;
      last_login: string | null; is_active: number;
    }>();

  if (!result) return null;

  const session: SessionRow = {
    id:         result.id,
    user_id:    result.user_id,
    token_hash: result.token_hash,
    expires_at: result.expires_at,
    ip_address: result.ip_address,
    user_agent: result.user_agent,
    created_at: result.created_at,
  };

  const user: UserRow = {
    id:            result.u_id,
    email:         result.email,
    password_hash: result.password_hash,
    display_name:  result.display_name,
    role:          result.role as UserRow['role'],
    created_at:    result.u_created_at,
    updated_at:    result.updated_at,
    last_login:    result.last_login,
    is_active:     result.is_active,
  };

  return { session, user };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteSession(
  db: D1Database,
  sessionId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM sessions WHERE id = ?')
    .bind(sessionId)
    .run();
}

export async function deleteSessionByTokenHash(
  db: D1Database,
  tokenHash: string
): Promise<void> {
  await db
    .prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(tokenHash)
    .run();
}

/** Delete all sessions for a user (force logout everywhere) */
export async function deleteAllUserSessions(
  db: D1Database,
  userId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM sessions WHERE user_id = ?')
    .bind(userId)
    .run();
}

/** Prune expired sessions — run periodically from a scheduled Worker or admin action */
export async function pruneExpiredSessions(db: D1Database): Promise<number> {
  const result = await db
    .prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')")
    .run();
  return result.meta?.changes ?? 0;
}
