/** Cookie name constants */
export const SESSION_COOKIE = 'ayg_session';
export const CSRF_COOKIE    = 'ayg_csrf';

export const SESSION_TTL_SHORT  = 60 * 60 * 24;        // 24 hours
export const SESSION_TTL_LONG   = 60 * 60 * 24 * 30;   // 30 days (remember me)

// ─── Parsing ──────────────────────────────────────────────────────────────────

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('Cookie') ?? '';
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) result[key] = val;
  }
  return result;
}

// ─── Building ─────────────────────────────────────────────────────────────────

interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  path?: string;
  domain?: string;
}

export function buildCookieHeader(
  name: string,
  value: string,
  opts: CookieOptions = {}
): string {
  const parts: string[] = [`${name}=${value}`];
  if (opts.path     !== undefined) parts.push(`Path=${opts.path}`);
  if (opts.maxAge   !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.sameSite !== undefined) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure)   parts.push('Secure');
  if (opts.domain)   parts.push(`Domain=${opts.domain}`);
  return parts.join('; ');
}

/** Build the Set-Cookie header for a new session */
export function buildSessionCookie(
  token: string,
  rememberMe: boolean,
  secure: boolean
): string {
  return buildCookieHeader(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    path: '/',
    maxAge: rememberMe ? SESSION_TTL_LONG : SESSION_TTL_SHORT,
  });
}

/** Build the Set-Cookie header for a CSRF token (readable by JS) */
export function buildCsrfCookie(token: string, secure: boolean): string {
  return buildCookieHeader(CSRF_COOKIE, token, {
    httpOnly: false, // must be readable by JS to include in headers
    secure,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_LONG,
  });
}

/** Clear a cookie by setting Max-Age=0 */
export function clearCookieHeader(name: string): string {
  return buildCookieHeader(name, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: 0,
  });
}

/** Is this request over HTTPS? */
export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}
