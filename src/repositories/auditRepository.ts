import { generateId } from '../lib/auth.ts';

export async function writeAuditLog(
  db: D1Database,
  params: {
    userId?: string | null;
    action: string;
    resource?: string | null;
    details?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<void> {
  // Audit writes are best-effort — never let them throw and break the main flow
  try {
    await db
      .prepare(
        `INSERT INTO audit_log (id, user_id, action, resource, details, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateId(),
        params.userId ?? null,
        params.action,
        params.resource ?? null,
        params.details ? JSON.stringify(params.details) : null,
        params.ipAddress ?? null,
        params.userAgent ?? null
      )
      .run();
  } catch {
    // Silently swallow — audit failure must not affect the user's request
    // In production, emit a console.error for Cloudflare log tail visibility
    console.error('[audit] Failed to write audit log entry', params.action);
  }
}

/** Retrieve recent audit entries (admin dashboard) */
export async function listAuditLog(
  db: D1Database,
  limit = 50,
  offset = 0
): Promise<Array<{
  id: string; user_id: string | null; action: string;
  resource: string | null; details: string | null;
  ip_address: string | null; timestamp: string;
}>> {
  const result = await db
    .prepare(
      `SELECT id, user_id, action, resource, details, ip_address, timestamp
       FROM audit_log ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all();
  return (result.results ?? []) as ReturnType<typeof listAuditLog> extends Promise<infer R> ? R : never;
}
