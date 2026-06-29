# AyUpGee — Project Notes for Claude

## Site overview
- **URL:** ayupgee.com
- **Host:** Cloudflare Pages
- **Owner:** Gee (gilleshubb@gmail.com)
- **Purpose:** Twitch streamer website (cosy gaming — Disney Dreamlight Valley, Animal Crossing, Stardew, Palia, Fortnite)

---

## Design & UX constraints
- **Never change layout, design, or user experience** without explicit approval
- Twitch embed loads based on whether Gee is live — currently uses IntersectionObserver lazy-load (scroll-triggered); do NOT change to a click/facade pattern
- Twitch schedule already has skeleton placeholders and dynamic rendering — leave it alone unless explicitly asked
- Notice banner (`/api/notices`) injects above the hero card ~725ms after load — this causes CLS 0.216 but is a known, accepted trade-off

---

## Performance work completed

### giveaway.html ✅ (fully optimised)
- Added `<link rel="preconnect">` for `js.gleam.io` and `widget.gleamjs.io`
- Added `fetchpriority="high"` to LCP hero background image
- Prize card screenshot: resized + srcset (420w / 840w / 1920w WebP)
- Hero panel image: srcset (728w / 1229w WebP)
- `honey-drips.png` → `honey-drips.webp` (both header and footer)

**New image files (giveaway):**
- `assets/images/giveaway/honeyglow-woods-screenshot-1-420w.webp` (420×236, 31KB)
- `assets/images/giveaway/honeyglow-woods-screenshot-1-840w.webp` (840×473, 88KB)
- `assets/images/giveaway/honeyglow-woods-hero-728w.webp` (728×409, 74KB)
- `assets/images/ui/honey-drips.webp` (52×52, 1.5KB) — shared with homepage

### index.html ✅ (fully optimised)
- Removed unused `fonts.googleapis.com` preconnect (Cloudflare intercepts via cf-fonts)
- Removed `dns-prefetch` for `unpkg.com`
- **Self-hosted Lucide icons** at `/assets/js/lucide.min.js` (pinned v0.383.0); removed external unpkg script
- **hero-bg.webp** recompressed at q75: 144KB → 104KB
- **Avatar images created:**
  - `assets/images/ui/avatar-168.webp` (168×168, 5.9KB) — used in hero with `fetchpriority="high"`
  - `assets/images/ui/avatar-400.webp` (400×400, 15KB) — used in about section (lazy)
- `honey-drips.png` → `honey-drips.webp` (header line ~840, footer line ~1476)
- **Twitch iframe:** converted `src` → `data-src`, added IntersectionObserver script (rootMargin: 400px) to lazy-load on scroll
- **Twitch VOD thumbnails:** `640x360` → `320x180` in `renderTwitchVodItems()` URL replacement

---

## Patterns to apply to new pages

When optimising any new page, check for:

1. **Preconnect / dns-prefetch** — add for any third-party origin used on the page; remove any that aren't actually used
2. **LCP image** — must have `fetchpriority="high"` and `loading="eager"`; consider `<picture>` with WebP source
3. **Below-fold images** — `loading="lazy"` + `decoding="async"` + explicit `width`/`height` attributes
4. **srcset** — resize hero/feature images to at least 2 widths (mobile ≈ half display width, full); use ImageMagick `convert` (not `magick`)
5. **WebP conversion** — all PNGs used decoratively should be WebP; use `convert input.png -quality 85 output.webp`
6. **Recompress existing WebP** — if a WebP is >100KB, recompress at q75: `convert input.webp -quality 75 input.webp`
7. **Third-party scripts** — pin and self-host where possible (CDN like unpkg@latest is a cache-busting risk); put in `/assets/js/`
8. **Iframes (third-party embeds)** — use `data-src` + IntersectionObserver instead of `src` + `loading="lazy"`
9. **Font preconnects** — only `fonts.gstatic.com` (crossorigin) is needed; `fonts.googleapis.com` preconnect is intercepted by cf-fonts

---

## ImageMagick notes
- Command is `convert` (not `magick`) on this system
- WebP recompression: `convert input.webp -quality 75 output.webp`
- Resize + WebP: `convert input.jpg -resize WxH -quality 85 output.webp`
- Shell sandbox bash path: `/sessions/peaceful-trusting-shannon/mnt/AyUpGee/`
- File tool path: `/Users/gilleshubbard/Documents/AyUpGee/`

---

## Project structure (key files)
```
AyUpGee/
├── index.html              # Homepage
├── giveaway.html           # Giveaway page
├── privacy.html            # Privacy policy
├── assets/
│   ├── js/
│   │   ├── lucide.min.js   # Self-hosted Lucide v0.383.0
│   │   └── cookie-consent.js
│   ├── images/
│   │   ├── ui/             # Shared UI assets (honey-drips, hero-bg, avatars)
│   │   ├── og/             # Open Graph images (social-profile.jpg — keep as-is for OG meta)
│   │   └── giveaway/       # Giveaway page images
│   └── css/
└── functions/              # Cloudflare Pages Functions (API routes)
    └── api/
        ├── notices/        # Notice banner
        ├── twitch/         # Schedule + VODs
        └── social/         # TikTok, Instagram, YouTube feeds
```

---

## Design system

### Overall aesthetic
Cosy, dreamy, night-sky gaming vibe. Dark mode is the default (`data-theme="night"` on `<html>`); a light "day" mode is available via toggle (stored in `localStorage` as `aug-theme`). The look is soft, glowing, and playful — not harsh or corporate.

### Colour palette
Five named scales plus neutrals, all defined as CSS custom properties in `:root`:

| Scale | Purpose | Key tokens |
|---|---|---|
| **Sky** (teal/cyan) | Brand, primary CTAs, borders, links | `--sky-400` (#5fd4d6) is the main brand colour |
| **Dream** (purple) | Accent, gradients, orbs | `--dream-400` (#c58fe3) |
| **Blossom** (pink) | Highlight, live badge, danger | `--blossom-300/400/500` |
| **Twilight** (blue-purple) | Info, secondary accent | `--twilight-500` (#7d89da) |
| **Moon** (golden/honey) | Glow, honey motif, warnings | `--moon-400` (#ffd166) is the "honey" colour |
| **Night** (deep purple-navy) | Dark surfaces, backgrounds | `--night-900` (#161427) is the darkest bg |
| **Cream** | Light mode backgrounds | `--cream-50` (#fffdf8) is light mode bg |
| **Ink** | Light mode text / borders | `--ink-900` (#1f1d33) is body text |

**Semantic tokens (light mode → dark mode overrides):**
- `--brand` = sky-400 / sky-300
- `--accent` = dream-400 / dream-300
- `--highlight` = blossom-300 (same both modes)
- `--bg` = cream-50 / night-900
- `--surface` = white / night-800
- `--text` = ink-900 / #f3f1fb
- `--live` = blossom-500/400 (the red-pink "LIVE" badge colour)
- `--honey` = moon-400 (used for honey-drip decorative motif)

### Gradients
- `--grad-aurora`: sky-300 → dream-300 (110deg) — used on schedule date chips, feature highlights
- `--grad-dusk`: twilight-500 → dream-300 → blossom-200 (160deg) — hero/feature backgrounds
- `--grad-day`: sky-100 → cream-50 (180deg) — light mode page bg
- `--grad-night`: night-700 → night-900 (180deg) — dark page sections
- `--grad-moon`: radial moon-200 — used for glow overlays

### Glows & shadows
- `--glow-sky`: `0 8px 26px rgba(52,188,194,.35)` — primary buttons, live cards
- `--glow-dream`: purple glow on accent elements
- `--glow-blossom`: pink glow on blossom buttons
- `--glow-moon`: golden glow for honey/moon elements
- Shadows scale xs → xl; purple-tinted (`rgba(70,60,120,...)`)

### Typography
- **Display / headings:** `Fredoka` (Google Fonts) — rounded, friendly, weighted 400–700
- **Body / UI:** `Nunito` (Google Fonts) — clean, rounded, weighted 400–800 + italic
- Both served via Cloudflare cf-fonts (Google Fonts CSS link intercepted and proxied)
- Type scale: `--text-2xs` (0.69rem) through `--text-5xl` (4rem)
- Semantic type tokens: `--type-hero`, `--type-h1` through `--type-h3`, `--type-lead`, `--type-body`, `--type-label`, `--type-caption`

### Spacing & layout
- Spacing scale: `--space-1` (0.25rem) through `--space-10` (8rem)
- Max container width: `--container: 1180px` with `--gutter: 1.5rem`
- Sections: `.section` (padding `--space-8` top/bottom), `.section--sm` (`--space-7`)

### Border radius
Pill-heavy design — most interactive elements use `--radius-pill` (999px). Cards use `--radius-lg` (22px) or `--radius-xl` (30px).

### Glass morphism
Used throughout on hero card, nav, mobile menu, notices. Pattern: `background: color-mix(in srgb, var(--surface) 72%, transparent)` + `backdrop-filter: blur(14px) saturate(1.2)`.

### Animations & motion
- `--dur-fast` / `--dur-base` / `--dur-slow` for transitions
- `--ease-soft` cubic-bezier for smooth feel
- `aug-float` keyframe animation on hero orbs (large blurred colour blobs)
- `.reveal` + `.visible` classes for scroll-triggered fade-in (IntersectionObserver, threshold 0.08, rootMargin -32px bottom)
- Parallax mouse effect on hero orbs
- Nav hides on scroll-down, reveals on scroll-up

### Key UI components
- **`.aug-btn`** — pill-shaped buttons; variants: `--primary` (sky glow), `--accent` (dream), `--blossom`, `--secondary` (bordered), `--ghost`; sizes `--sm`, `--md`, `--lg`
- **`.aug-card`** — rounded card with border + shadow; variants `--glass`, `--hover` (lifts on hover), `--feature`
- **`.aug-badge`** — tiny pill label; variants `--brand`, `--accent`, `--live` (pulsing red-pink)
- **`.aug-avatar`** — circular avatar with optional ring (`--ring`) and live badge overlay
- **`.aug-sched`** — schedule row card; today highlighted with brand glow, off-days muted
- **`.aug-notice`** — notice banner injected above hero; uses glass morphism

### Decorative motifs
- **Honey drips** (`honey-drips.webp`) — appears in header brand-mark and footer; part of the "AyUpGee" logo
- **Hero orbs** — three large blurred colour blobs (dream/purple, moon/gold, sky/teal) floating behind the hero card with CSS animation + JS parallax
- **Starfield** — 70 tiny animated dots in the hero background, created by JS
- **Hero card browser chrome** — the hero card is styled as a browser window (dots, URL bar) for a playful meta effect

---

## Known remaining issues / future work
- **CLS 0.219 on homepage** — caused by `/api/notices` inserting a banner above the hero card ~725ms after load, adding `padding-top` to `.hero__inner`. Accepted trade-off for now.
- **privacy.html** — Privacy Policy link has low contrast (flagged by Lighthouse); not yet addressed
- **`player.twitch.tv/undefined`** — appeared in Lighthouse cache report; source not identified in index.html JS. May be from a Cloudflare Worker or cookie-consent.js. Worth investigating if it recurs.
- **social-profile.jpg in OG meta tags** — deliberately kept as `.jpg` since social crawlers expect a stable URL; do not change these
