/**
 * Cloudflare Turnstile server-side validation.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * The secret key is NEVER in code — it comes from Env.TURNSTILE_SECRET_KEY.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileOutcome {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

/**
 * Validate a Turnstile response token.
 *
 * @param token  - The `cf-turnstile-response` value from the submitted form
 * @param secret - Env.TURNSTILE_SECRET_KEY
 * @param ip     - Optional: the visitor's IP for extra verification
 */
export async function validateTurnstile(
  token: string,
  secret: string,
  ip?: string | null
): Promise<boolean> {
  if (!token || !secret) return false;

  // Turnstile test secret always succeeds — safe for dev
  if (secret.startsWith('1x000000')) return true;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);

    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!res.ok) return false;
    const data = await res.json() as TurnstileOutcome;
    return data.success === true;
  } catch {
    return false;
  }
}
