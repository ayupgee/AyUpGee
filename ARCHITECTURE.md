# AyUpGee – Phase 2 Architecture

> Cloudflare Pages + Workers + D1 + KV + Turnstile · TypeScript · No build step required for the site, Wrangler handles function bundling

---

## Project structure

```
/
├── index.html                          # Main public site (Phase 1)
├── login.html                          # Login page
├── admin/
│   └── index.html                      # Admin dashboard
├── assets/                             # Static assets (images, etc.)
│
├── functions/                          # Cloudflare Pages Functions
│   ├── _middleware.ts                  # Auth + security headers (runs on every request)
│   └── api/
│       ├── auth/
│       │   ├── login.ts                # POST /api/auth/login
│       │   ├── logout.ts               # POST /api/auth/logout
│       │   ├── me.ts                   # GET  /api/auth/me
│       │   └── setup.ts                # POST /api/auth/setup (first-run admin bootstrap)
│       └── twitch/
│           └── schedule.js             # GET  /api/twitch/schedule (Phase 1, unchanged)
│
├── src/                                # Shared TypeScript (imported by functions)
│   ├── types/
│   │   ├── env.ts                      # Cloudflare Env interface
│   │   └── models.ts                   # User, Session, API response types
│   ├── lib/
│   │   ├── auth.ts                     # PBKDF2 hashing, token generation
│   │   ├── cookie.ts                   # Cookie parsing/building
│   │   ├── response.ts                 # Typed JSON response helpers + security headers
│   │   └── turnstile.ts                # Cloudflare Turnstile validation
│   ├── repositories/
│   │   ├── userRepository.ts           # D1 queries for users table
│   │   ├── sessionRepository.ts        # D1 queries for sessions table
│   │   └── auditRepository.ts          # Append-only audit log writes
│   └── services/
│       └── authService.ts              # Login, logout, session resolution, rate limiting
│
├── migrations/
│   └── 0001_initial_schema.sql         # D1 schema: users, sessions, posts, schedule, etc.
│
├── wrangler.toml                       # Cloudflare configuration
├── package.json                        # Dev dependencies + scripts
├── tsconfig.json                       # TypeScript config
├── .dev.vars.example                   # Copy to .dev.vars for local development
└── ARCHITECTURE.md                     # This file
```

---

## Authentication flow

```
Browser                          Edge (Pages Function)              D1
──────                           ─────────────────────              ──
POST /api/auth/login
  { email, password,         →
    rememberMe,
    turnstileToken }

                               1. Validate Turnstile token
                                  (POST challenges.cloudflare.com)
                               2. Rate-limit check (KV: rate:login:{ip})
                               3. findUserByEmail(email)
                               4. PBKDF2-verify(password, user.password_hash)
                                  (runs even on user-not-found to prevent timing attacks)
                               5. createSession(userId, tokenHash, expiresAt)  →  INSERT sessions
                               6. updateLastLogin(userId)                       →  UPDATE users
                               7. writeAuditLog(auth.login.success)             →  INSERT audit_log

  ←  Set-Cookie: ayg_session=<raw_token>; HttpOnly; Secure; SameSite=Strict
     Set-Cookie: ayg_csrf=<csrf_token>   (readable by JS)
     { ok: true, data: { user, redirectTo: "/admin" } }

Browser stores nothing —
the session lives in
an HTTP-only cookie                                                 sessions table:
                                                                    token_hash (SHA-256 of token)
                                                                    NOT the raw token

GET /admin                       _middleware.ts intercepts:
                               1. parseCookies → read ayg_session
                               2. SHA-256(raw_token) → tokenHash
                               3. findValidSession(tokenHash)      →  SELECT sessions JOIN users
                               4. Check user.role === 'admin'
                               5. Inject X-User-Id, X-User-Role headers
                               6. next() → serve admin/index.html

                               Admin JS then calls GET /api/auth/me
                               to populate user display name and get CSRF token
```

---

## Role system

| Role        | Can access               | Notes                              |
|-------------|-------------------------|------------------------------------|
| `admin`     | /admin, /api/*, /member | Full access                        |
| `moderator` | /moderator, /api/*, /member | Content moderation only         |
| `member`    | /member, /api/auth/*    | Community member portal (Phase 3+) |

Role is enforced **server-side** in `_middleware.ts`. The static HTML files for `/admin`, `/moderator`, `/member` are never served to unauthenticated or insufficient-role requests.

---

## Security model

### Passwords
- Algorithm: **PBKDF2-SHA256**, 600,000 iterations (OWASP 2024 minimum)
- Random 16-byte salt per password, stored with the hash
- Format: `pbkdf2sha256:{iterations}:{saltHex}:{hashHex}`
- No external dependencies — uses Web Crypto API built into Workers runtime
- Future upgrade path: swap `hashPassword`/`verifyPassword` in `src/lib/auth.ts` for Argon2 when natively available in Workers

### Sessions
- Raw token: 32 cryptographically random bytes, base64url encoded
- Stored in cookie: `HttpOnly; Secure; SameSite=Strict` — not accessible to JavaScript
- Stored in D1: **SHA-256 hash** of the raw token only — compromise of D1 cannot replay sessions
- TTL: 24 hours (standard) or 30 days (remember me)
- Prune expired: `DELETE FROM sessions WHERE expires_at <= datetime('now')`

### CSRF
- Login sets a secondary `ayg_csrf` cookie (readable by JS, SameSite=Strict)
- `SameSite=Strict` on the session cookie provides strong CSRF protection for same-origin requests
- For cross-origin API calls (Phase 3), include `X-CSRF-Token` header and validate server-side
- All state-changing endpoints are POST/PUT/DELETE — GET is always safe

### Rate limiting
- Login: 5 attempts per IP per 15 minutes, tracked in KV
- KV key: `rate:login:{ip}` with TTL matching the window
- Degrades gracefully if KV is not configured (logs warning, allows through)

### Response security headers
Applied by `src/lib/response.ts` to every response:
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### SQL injection
All D1 queries use **prepared statements** with `.bind()`. No string interpolation.

### Secrets
**Zero secrets in the repository.** Everything sensitive uses Cloudflare environment variables or `wrangler secret`.

---

## Database schema

### users
| Column        | Type    | Notes                                        |
|---------------|---------|----------------------------------------------|
| id            | TEXT PK | UUID v4                                      |
| email         | TEXT    | UNIQUE, COLLATE NOCASE                       |
| password_hash | TEXT    | pbkdf2sha256:{iter}:{saltHex}:{hashHex}      |
| display_name  | TEXT    |                                              |
| role          | TEXT    | CHECK IN ('admin','moderator','member')      |
| created_at    | TEXT    | ISO 8601                                     |
| updated_at    | TEXT    |                                              |
| last_login    | TEXT    | nullable                                     |
| is_active     | INTEGER | 0 or 1                                       |

### sessions
| Column     | Type    | Notes                               |
|------------|---------|-------------------------------------|
| id         | TEXT PK | UUID v4                             |
| user_id    | TEXT FK | → users(id) ON DELETE CASCADE       |
| token_hash | TEXT    | UNIQUE, SHA-256 of raw cookie token |
| expires_at | TEXT    | ISO 8601                            |
| ip_address | TEXT    | nullable                            |
| user_agent | TEXT    | nullable                            |
| created_at | TEXT    |                                     |

### audit_log (append-only)
| Column     | Type | Notes                                     |
|------------|------|-------------------------------------------|
| id         | TEXT | UUID v4                                   |
| user_id    | TEXT | nullable (pre-auth events)                |
| action     | TEXT | e.g. `auth.login.success`, `post.publish` |
| resource   | TEXT | e.g. `post:abc123`                        |
| details    | TEXT | JSON string                               |
| ip_address | TEXT |                                           |
| timestamp  | TEXT | DEFAULT datetime('now')                   |

Other tables: `schedule`, `posts`, `media`, `settings` — see `migrations/0001_initial_schema.sql`.

---

## Environment variables

### Required secrets (set via Cloudflare dashboard or `wrangler secret put`)
| Variable              | Description                                             |
|-----------------------|---------------------------------------------------------|
| `SESSION_SECRET`      | 32+ random bytes (base64). Signs/validates session context |
| `CSRF_SECRET`         | 32+ random bytes. CSRF token generation                 |
| `TURNSTILE_SECRET_KEY`| From Cloudflare Turnstile dashboard                     |
| `ADMIN_SETUP_TOKEN`   | One-time token for first-admin bootstrap. Delete after use |

### Public config (safe to include as plain variables)
| Variable              | Description                                             |
|-----------------------|---------------------------------------------------------|
| `TURNSTILE_SITE_KEY`  | Public key from Cloudflare Turnstile. Goes in HTML      |

### Phase 1 variables (already set)
| Variable               | Description          |
|------------------------|----------------------|
| `TWITCH_CLIENT_ID`     | Twitch app client ID |
| `TWITCH_CLIENT_SECRET` | Twitch app secret    |
| `TWITCH_BROADCASTER_ID`| Twitch user ID       |

---

## Deployment steps

### 1. Create D1 database
```bash
wrangler d1 create ayupgee-db
# Copy the database_id into wrangler.toml
```

### 2. Create KV namespace
```bash
wrangler kv:namespace create CACHE
# Copy the id into wrangler.toml
```

### 3. Run migrations
```bash
# Production
npm run db:migrate

# Local development
npm run db:migrate:local
```

### 4. Set secrets
```bash
wrangler secret put SESSION_SECRET
wrangler secret put CSRF_SECRET
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put ADMIN_SETUP_TOKEN
```

### 5. Set Turnstile site key (public, can be a plain variable)
In Cloudflare Pages dashboard → Settings → Environment Variables:
```
TURNSTILE_SITE_KEY = <your site key>
```

Also replace `TURNSTILE_SITE_KEY_HERE` in `login.html` with the actual site key.

### 6. Create first admin account
```bash
curl -X POST https://ayupgee.pages.dev/api/auth/setup \
  -H 'Content-Type: application/json' \
  -d '{
    "setupToken": "<your ADMIN_SETUP_TOKEN>",
    "email": "your@email.com",
    "password": "your-strong-password-12chars+",
    "displayName": "Gee"
  }'
```

**After success: remove `ADMIN_SETUP_TOKEN` from Cloudflare environment variables immediately.**
The setup endpoint rejects all requests once any admin exists, but removing the env var is belt-and-suspenders.

### 7. Local development
```bash
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your dev values
npm run db:migrate:local
npm run dev
# Visit http://localhost:8788/login
```

---

## Adding new API routes

1. Create `functions/api/<resource>/index.ts`
2. Export named handlers: `onRequestGet`, `onRequestPost`, etc.
3. Add the path to `ADMIN_PATHS` or `MEMBER_PATHS` in `functions/_middleware.ts`
4. Import from `src/` for shared utilities

Example stub:
```typescript
import type { Env } from '../../../src/types/env.ts';
import { ok, methodNotAllowed } from '../../../src/lib/response.ts';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const userId = context.request.headers.get('X-User-Id'); // injected by middleware
  return ok({ items: [] });
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
```

---

## Planned phases

| Phase | Description                                                   | Status     |
|-------|---------------------------------------------------------------|------------|
| 1     | Static site → WebP hero, Twitch Schedule API                  | ✅ Done    |
| 2     | Auth, roles, admin dashboard, D1 schema                       | ✅ Done    |
| 3     | Blog CRUD, media library (R2), schedule admin UI              | Planned    |
| 4     | Member portal, loyalty points, achievements                   | Planned    |
| 5     | Connected accounts (Twitch OAuth), community features         | Planned    |
| 6     | Analytics, partnerships CRM, Discord bot integration          | Planned    |
