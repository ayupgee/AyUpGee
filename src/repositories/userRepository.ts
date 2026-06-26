import type { UserRow, PublicUser, UserRole } from '../types/models.ts';

/** Convert a DB row to a safe public-facing user object */
export function toPublicUser(row: UserRow): PublicUser {
  return {
    id:           row.id,
    email:        row.email,
    display_name: row.display_name,
    role:         row.role,
    created_at:   row.created_at,
    last_login:   row.last_login,
    is_active:    row.is_active === 1,
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function findUserById(
  db: D1Database,
  id: string
): Promise<UserRow | null> {
  const result = await db
    .prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
    .bind(id)
    .first<UserRow>();
  return result ?? null;
}

export async function findUserByEmail(
  db: D1Database,
  email: string
): Promise<UserRow | null> {
  const result = await db
    .prepare('SELECT * FROM users WHERE email = ? LIMIT 1')
    .bind(email.toLowerCase().trim())
    .first<UserRow>();
  return result ?? null;
}

export async function createUser(
  db: D1Database,
  params: {
    id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    role: UserRole;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      params.id,
      params.email.toLowerCase().trim(),
      params.passwordHash,
      params.displayName,
      params.role
    )
    .run();
}

export async function updateLastLogin(
  db: D1Database,
  id: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET last_login = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(id)
    .run();
}

export async function countAdmins(db: D1Database): Promise<number> {
  const result = await db
    .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function countAllUsers(db: D1Database): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1')
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function listUsers(
  db: D1Database,
  limit = 50,
  offset = 0
): Promise<PublicUser[]> {
  const result = await db
    .prepare(
      `SELECT id, email, display_name, role, created_at, last_login, is_active
       FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all<UserRow>();
  return (result.results ?? []).map(toPublicUser);
}
