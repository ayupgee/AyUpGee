import type { ApiError, ApiSuccess } from '../types/models.ts';

// ─── Security headers added to every response ─────────────────────────────────
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options':  'nosniff',
  'X-Frame-Options':         'DENY',
  'Referrer-Policy':         'strict-origin-when-cross-origin',
  'Permissions-Policy':      'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  ...SECURITY_HEADERS,
};

// ─── Typed response helpers ───────────────────────────────────────────────────

export function ok<T>(data: T, status = 200, extra?: Record<string, string>): Response {
  const body: ApiSuccess<T> = { ok: true, data };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

export function err(
  error: string,
  message: string,
  status = 400,
  extra?: Record<string, string>
): Response {
  const body: ApiError = { ok: false, error, message };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

export function redirect(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { Location: location, ...SECURITY_HEADERS },
  });
}

/** Add security headers to an existing response */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ─── Common error shortcuts ───────────────────────────────────────────────────
export const unauthorized = () =>
  err('unauthorized', 'Authentication required', 401);

export const forbidden = () =>
  err('forbidden', 'You do not have permission to access this resource', 403);

export const notFound = (resource = 'Resource') =>
  err('not_found', `${resource} not found`, 404);

export const methodNotAllowed = () =>
  err('method_not_allowed', 'Method not allowed', 405);

export const tooManyRequests = () =>
  err('rate_limited', 'Too many requests — please wait and try again', 429);

export const internalError = (message = 'An unexpected error occurred') =>
  err('internal_error', message, 500);
