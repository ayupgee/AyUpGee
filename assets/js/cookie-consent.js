/**
 * AyUpGee Cookie Consent
 * - Shows a banner on first visit
 * - Stores choice in localStorage
 * - Updates Google Consent Mode v2 on accept
 * - Never fires analytics until accepted
 */
(function () {
  'use strict';

  const KEY = 'ayg_cookie_consent';

  // Already decided — nothing to do
  if (localStorage.getItem(KEY)) return;

  // ── Styles ─────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #ayg-cookie-banner {
      position: fixed;
      bottom: 1.5rem;
      left: 50%;
      transform: translateX(-50%) translateY(120%);
      z-index: 9999;
      width: calc(100% - 2rem);
      max-width: 680px;
      background: rgba(30, 27, 53, 0.92);
      backdrop-filter: blur(18px) saturate(1.2);
      -webkit-backdrop-filter: blur(18px) saturate(1.2);
      border: 1.5px solid #34315e;
      border-radius: 22px;
      padding: 1.25rem 1.5rem;
      box-shadow: 0 16px 40px rgba(0,0,0,.4), 0 0 0 1px rgba(95,212,214,.08);
      display: flex;
      align-items: center;
      gap: 1.25rem;
      transition: transform 0.4s cubic-bezier(.34,1.56,.64,1), opacity 0.3s ease;
      opacity: 0;
      font-family: 'Nunito', system-ui, sans-serif;
    }
    #ayg-cookie-banner.visible {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
    #ayg-cookie-banner .ayg-cb__icon {
      font-size: 2rem;
      flex-shrink: 0;
      line-height: 1;
    }
    #ayg-cookie-banner .ayg-cb__text {
      flex: 1;
      font-size: .875rem;
      color: #b3afd0;
      line-height: 1.5;
    }
    #ayg-cookie-banner .ayg-cb__text strong {
      color: #f3f1fb;
      font-weight: 700;
    }
    #ayg-cookie-banner .ayg-cb__text a {
      color: #98e7e1;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    #ayg-cookie-banner .ayg-cb__text a:hover {
      color: #5fd4d6;
    }
    #ayg-cookie-banner .ayg-cb__actions {
      display: flex;
      gap: .625rem;
      flex-shrink: 0;
    }
    #ayg-cookie-banner .ayg-cb__btn {
      font-family: 'Fredoka', 'Trebuchet MS', system-ui, sans-serif;
      font-size: .9375rem;
      font-weight: 600;
      padding: .5rem 1.1rem;
      border-radius: 999px;
      cursor: pointer;
      border: 1.5px solid transparent;
      line-height: 1;
      white-space: nowrap;
      transition: filter .15s ease, transform .15s ease;
    }
    #ayg-cookie-banner .ayg-cb__btn:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    #ayg-cookie-banner .ayg-cb__btn--decline {
      background: transparent;
      border-color: #454275;
      color: #837fa8;
    }
    #ayg-cookie-banner .ayg-cb__btn--decline:hover {
      border-color: #6f6ba0;
      color: #b3afd0;
    }
    #ayg-cookie-banner .ayg-cb__btn--accept {
      background: linear-gradient(110deg, #98e7e1 0%, #eeb5ea 100%);
      color: #1a2e3a;
      border-color: transparent;
      box-shadow: 0 4px 16px rgba(95,212,214,.3);
    }
    @media (max-width: 560px) {
      #ayg-cookie-banner {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
        bottom: 1rem;
      }
      #ayg-cookie-banner .ayg-cb__actions {
        width: 100%;
      }
      #ayg-cookie-banner .ayg-cb__btn {
        flex: 1;
        text-align: center;
      }
    }
  `;
  document.head.appendChild(style);

  // ── Banner HTML ────────────────────────────────────────────────────────────
  const banner = document.createElement('div');
  banner.id = 'ayg-cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Cookie consent');
  banner.innerHTML = `
    <div class="ayg-cb__text">
      🍪 We use cookies to see how people find and enjoy our site. No ads, no cross-site tracking, just basic analytics.
      <a href="/privacy">Privacy Policy</a>
    </div>
    <div class="ayg-cb__actions">
      <button class="ayg-cb__btn ayg-cb__btn--decline" id="ayg-cookie-decline">Decline</button>
      <button class="ayg-cb__btn ayg-cb__btn--accept" id="ayg-cookie-accept">Accept 🐝</button>
    </div>
  `;
  document.body.appendChild(banner);

  // Trigger slide-up
  requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('visible')));

  // ── Actions ────────────────────────────────────────────────────────────────
  function dismiss() {
    banner.classList.remove('visible');
    setTimeout(() => banner.remove(), 450);
  }

  document.getElementById('ayg-cookie-accept').addEventListener('click', function () {
    localStorage.setItem(KEY, 'granted');
    if (typeof gtag === 'function') {
      gtag('consent', 'update', { analytics_storage: 'granted' });
    }
    dismiss();
  });

  document.getElementById('ayg-cookie-decline').addEventListener('click', function () {
    localStorage.setItem(KEY, 'denied');
    dismiss();
  });
})();
