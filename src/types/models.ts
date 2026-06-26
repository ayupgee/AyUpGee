// ─── Core domain types ────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'moderator' | 'member';

/** Raw row from the `users` D1 table */
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
  last_login: string | null;
  is_active: number; // SQLite: 0 or 1
}

/** Safe user object for API responses — never includes password_hash */
export interface PublicUser {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  created_at: string;
  last_login: string | null;
  is_active: boolean;
}

/** Raw row from the `sessions` D1 table */
export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

/** Resolved session with its associated user */
export interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
}

/** Audit log entry */
export interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  resource: string | null;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: string;
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface ApiSuccess<T = unknown> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  message: string;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ─── Auth types ───────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
  turnstileToken: string;
}

export interface LoginResponse {
  user: PublicUser;
  redirectTo: string;
}

export interface MeResponse {
  user: PublicUser;
  csrfToken: string;
}
