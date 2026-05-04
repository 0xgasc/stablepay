/**
 * Shared i18n loader. Pages opt in by:
 *   <html lang="en" data-i18n-page="pricing">
 *   <script src="/js/lang.js"></script>
 *   <script src="/js/i18n.js"></script>
 *
 * Then mark text with data-i18n="key.path", data-i18n-attr="placeholder:key.path"
 * (for input placeholders, alt, title, etc.), and provide locale JSON at
 * /locales/{page}-{lang}.json (en, es, fr, pt).
 *
 * Falls back gracefully:
 *   - missing locale file → keep original text
 *   - missing key in locale → keep original text
 *   - lang === 'en' but no en file → no-op (English is default markup)
 */
(function () {
  const page = document.documentElement.dataset.i18nPage;
  if (!page) return;

  function getLang() {
    return (window.SP_LANG && window.SP_LANG.getLang()) || 'en';
  }

  function valueAt(obj, dottedKey) {
    return dottedKey.split('.').reduce((o, k) => (o && o[k] != null) ? o[k] : null, obj);
  }

  function applyTranslations(translations) {
    if (!translations) return;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const v = valueAt(translations, key);
      if (v == null) return;
      if (el.tagName === 'TITLE') document.title = v;
      else if (typeof v === 'string' && v.includes('<')) el.innerHTML = v;
      else el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      // format: "attrName:key.path,attrName:key.path"
      const spec = el.getAttribute('data-i18n-attr');
      spec.split(',').forEach((pair) => {
        const [attr, key] = pair.split(':').map((s) => s.trim());
        if (!attr || !key) return;
        const v = valueAt(translations, key);
        if (v != null) el.setAttribute(attr, v);
      });
    });
  }

  async function load(lang) {
    try {
      const res = await fetch(`/locales/${page}-${lang}.json`, { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  async function init() {
    const lang = getLang();
    const t = await load(lang);
    if (t) applyTranslations(t);
    else if (lang !== 'en') {
      // Fall back to English if the chosen language file is missing.
      const en = await load('en');
      if (en) applyTranslations(en);
    }
  }

  window.SP_I18N = { init, applyTranslations, load };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
