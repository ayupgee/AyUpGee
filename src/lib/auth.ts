/**
 * Authentication primitives.
 *
 * Password hashing: PBKDF2-SHA256 via Web Crypto API.
 *   - No external dependencies — built into the Workers runtime.
 *   - 600,000 iterations (OWASP 2024 recommendation for PBKDF2-SHA256).
 *   - Random 16-byte salt per password.
 *
 * If Argon2 support arrives natively in Workers in the future, swap
 * hashPassword / verifyPassword — the rest of the codebase is unchanged.
 */

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH_BYTES   = 32; // 256-bit output

// ─── Password hashing ─────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BYTES * 8
  );

  const saltHex = toHex(salt);
  const hashHex = toHex(new Uint8Array(hashBuffer));
  return `pbkdf2sha256:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2sha256') return false;

  const iterations = parseInt(parts[1] ?? '0', 10);
  const saltHex    = parts[2] ?? '';
  const storedHash = parts[3] ?? '';

  if (!iterations || !saltHex || !storedHash) return false;

  const salt = fromHex(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BYTES * 8
  );

  const computedHash = toHex(new Uint8Array(hashBuffer));
  return timingSafeEqual(computedHash, storedHash);
}

// ─── Token utilities ──────────────────────────────────────────────────────────

/** Generate a cryptographically random URL-safe token */
export function generateToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  // base64url encode
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/** SHA-256 hash of a token for safe DB storage */
export async function hashToken(token: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token)
  );
  return toHex(new Uint8Array(buffer));
}

/** Generate a UUID v4 */
export function generateId(): string {
  return crypto.randomUUID();
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const pairs = hex.match(/.{2}/g) ?? [];
  return new Uint8Array(pairs.map(byte => parseInt(byte, 16)));
}

/** Constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return diff === 0;
}
