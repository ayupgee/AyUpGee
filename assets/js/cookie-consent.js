/**
 * AyUpGee Cookie Consent
 * - Shows a banner on first visit
 * - Stores choice in localStorage
 * - Updates Google Consent Mode v2 on accept
 * - Never fires analytics until accepted
 */
(function () {
  'use strict';

  const KEY = 'aug_cookie_consent';

  // Already decided — nothing to do
  if (localStorage.getItem(KEY)) return;

  // ── Styles ─────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #aug-cookie-banner {
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
    #aug-cookie-banner.visible {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
    #aug-cookie-banner .aug-cb__icon {
      font-size: 2rem;
      flex-shrink: 0;
      line-height: 1;
    }
    #aug-cookie-banner .aug-cb__text {
      flex: 1;
      font-size: .875rem;
      color: #b3afd0;
      line-height: 1.5;
    }
    #aug-cookie-banner .aug-cb__text strong {
      color: #f3f1fb;
      font-weight: 700;
    }
    #aug-cookie-banner .aug-cb__text a {
      color: #98e7e1;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    #aug-cookie-banner .aug-cb__text a:hover {
      color: #5fd4d6;
    }
    #aug-cookie-banner .aug-cb__actions {
      display: flex;
      gap: .625rem;
      flex-shrink: 0;
    }
    #aug-cookie-banner .aug-cb__btn {
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
    #aug-cookie-banner .aug-cb__btn:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    #aug-cookie-banner .aug-cb__btn--decline {
      background: transparent;
      border-color: #454275;
      color: #837fa8;
    }
    #aug-cookie-banner .aug-cb__btn--decline:hover {
      border-color: #6f6ba0;
      color: #b3afd0;
    }
    #aug-cookie-banner .aug-cb__btn--accept {
      background: linear-gradient(110deg, #98e7e1 0%, #eeb5ea 100%);
      color: #1a2e3a;
      border-color: transparent;
      box-shadow: 0 4px 16px rgba(95,212,214,.3);
    }
    @media (max-width: 560px) {
      #aug-cookie-banner {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
        bottom: 1rem;
      }
      #aug-cookie-banner .aug-cb__actions {
        width: 100%;
      }
      #aug-cookie-banner .aug-cb__btn {
        flex: 1;
        text-align: center;
      }
    }
  `;
  document.head.appendChild(style);

  // ── Banner HTML ────────────────────────────────────────────────────────────
  const banner = document.createElement('div');
  banner.id = 'aug-cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Cookie consent');
  banner.innerHTML = `
    <div class="aug-cb__text">
      🍪 We use cookies to see how people find and enjoy our site. No ads, no cross-site tracking, just basic analytics.
      <a href="/privacy">Privacy Policy</a>
    </div>
    <div class="aug-cb__actions">
      <button class="aug-cb__btn aug-cb__btn--decline" id="aug-cookie-decline">Decline</button>
      <button class="aug-cb__btn aug-cb__btn--accept" id="aug-cookie-accept">Accept 🐝</button>
    </div>
  `;
  document.body.appendChild(banner);

  // Trigger slide-up
  requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('visible')));

  // ── Actions ────────────────────────────────────────────────────────────────
  function save(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* storage unavailable */ }
  }

  function dismiss() {
    banner.classList.remove('visible');
    banner.style.opacity = '0';
    banner.style.pointerEvents = 'none';
    setTimeout(() => { try { banner.remove(); } catch (e) {} }, 450);
  }

  document.getElementById('aug-cookie-accept').addEventListener('click', function () {
    save('granted');
    if (typeof gtag === 'function') {
      gtag('consent', 'update', { analytics_storage: 'granted' });
    }
    dismiss();
  });

  document.getElementById('aug-cookie-decline').addEventListener('click', function () {
    save('denied');
    dismiss();
  });
})();
