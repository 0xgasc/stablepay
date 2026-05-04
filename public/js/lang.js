/**
 * StablePay shared language module.
 *
 * URL-based language is the source of truth: /es/pricing means Spanish,
 * /fr/dashboard means French. Vercel rewrites strip the prefix and serve the
 * normal static page; this script reads the prefix client-side and feeds it to
 * each page's existing translation loader.
 *
 * Falls back to localStorage('language') when the URL has no prefix, then 'en'.
 *
 * Also auto-prefixes every internal <a href="/..."> nav link with the current
 * language, so navigating between pages preserves the choice without needing
 * every page's HTML to be rewritten.
 *
 * Public API on window.SP_LANG:
 *   getLang()  — current language code ('en' | 'es' | 'fr' | 'pt')
 *   setLang(l) — switch language: persists, updates URL, triggers a reload-style
 *                refresh of the page so translations re-apply cleanly
 */
(function () {
  const SUPPORTED = ['en', 'es', 'fr', 'pt'];
  const PREFIX_RE = /^\/(en|es|fr|pt)(\/|$)/;
  // Routes that must NEVER get a language prefix (server-rendered or API):
  const NO_PREFIX_RE = /^\/(api|public|locales|js|css|favicon|pay|receipt|health)(\/|$|\.)/;

  function getLangFromPath() {
    const m = window.location.pathname.match(PREFIX_RE);
    return m ? m[1] : null;
  }

  function getLang() {
    const fromUrl = getLangFromPath();
    if (fromUrl) {
      // Mirror to localStorage so a no-prefix navigation later keeps the choice.
      try { localStorage.setItem('language', fromUrl); } catch {}
      return fromUrl;
    }
    let stored = null;
    try { stored = localStorage.getItem('language'); } catch {}
    return SUPPORTED.includes(stored) ? stored : 'en';
  }

  function stripLangFromPath(path) {
    return path.replace(PREFIX_RE, '/');
  }

  function buildLangPath(lang, path) {
    const stripped = stripLangFromPath(path);
    if (lang === 'en') return stripped; // English is the default; no prefix.
    const tail = stripped === '/' ? '' : stripped;
    return '/' + lang + tail;
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    try { localStorage.setItem('language', lang); } catch {}
    const newPath = buildLangPath(lang, window.location.pathname);
    const newUrl = newPath + window.location.search + window.location.hash;
    if (newUrl !== window.location.pathname + window.location.search + window.location.hash) {
      // Full navigation so the destination page loads with translations applied
      // from scratch — pushState alone wouldn't re-render hard-coded English text
      // on pages that load translations only on DOMContentLoaded.
      window.location.assign(newUrl);
    }
  }

  /**
   * Walk all internal <a href="/..."> links and prefix them with the current
   * language so cross-page navigation persists the choice without per-page edits.
   * Skips API routes, anchor-only links, and links already prefixed.
   */
  function rewriteInternalLinks() {
    const lang = getLang();
    if (lang === 'en') return; // No prefix needed for default.
    const prefix = '/' + lang;
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      // Skip external, anchor, mailto, tel, and protocol-relative
      if (!href.startsWith('/') || href.startsWith('//')) return;
      if (PREFIX_RE.test(href)) return; // Already prefixed
      if (NO_PREFIX_RE.test(href)) return; // Server route or static asset
      const newHref = href === '/' ? prefix : prefix + href;
      a.setAttribute('href', newHref);
    });
  }

  window.SP_LANG = { getLang, setLang, getLangFromPath, rewriteInternalLinks };

  // Eagerly mirror URL → localStorage NOW so any per-page script that runs after
  // this one (and reads localStorage('language') for its initial render) picks up
  // the URL-derived language synchronously. Otherwise the page would briefly load
  // English then re-render once the URL was honored.
  getLang();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', rewriteInternalLinks);
  } else {
    rewriteInternalLinks();
  }
})();
