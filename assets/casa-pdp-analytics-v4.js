/*
 * casa-pdp-analytics-v4.js — PDP engagement instrumentation (OctaMirror v4).
 *
 * Publishes one event stream three ways so any analytics layer can pick
 * it up without theme changes:
 *   1. Shopify.analytics.publish('casa_pdp', payload)  -> Web Pixels
 *      (a custom pixel subscribes with analytics.subscribe('casa_pdp', ...))
 *   2. window.dataLayer.push({ event: 'casa_pdp', ...payload })  -> GTM / GA4
 *   3. document 'casa:pdp' CustomEvent  -> Clarity custom tags, in-page use
 *
 * Every payload: { name, section, value, label, ts, product, variant }.
 *
 * Events (name):
 *   pdp_view · scroll_depth (value 25|50|75|90) · section_view (section)
 *   gallery_slide (value index, label caption) · gallery_interaction
 *   gallery_complete · gallery_toggle (label off|on) · video_play /
 *   video_progress (value 25|50|100, label video id)
 *   transform_interaction (label scrub|toggle) · size_impression ·
 *   size_interaction (label size) · variant_select (label variant title)
 *   ugc_interaction · review_interaction · explainer_engaged ·
 *   install_interaction · faq_interaction (label question)
 *   sticky_cta_impression · sticky_cta_click · add_to_cart
 *   (label last engaged section) · checkout_start
 *
 * Loaded once per page from the transform chapter (casa-mirror-transform-v4); guarded so a Section
 * Rendering re-render never double-binds. No PII. No third-party requests.
 */
(function () {
  'use strict';
  if (window.__casaPdpAnalyticsBound) return;
  window.__casaPdpAnalyticsBound = true;
  window.casa = window.casa || {};

  var product = (function () {
    var el = document.querySelector('[data-casa-analytics]');
    return el ? { handle: el.dataset.productHandle || '', id: el.dataset.productId || '' } : { handle: '', id: '' };
  })();
  var lastSection = 'buybox';
  var sent = {};

  function publish(name, opts) {
    opts = opts || {};
    var payload = {
      name: name,
      section: opts.section || lastSection,
      value: typeof opts.value === 'number' ? opts.value : null,
      label: opts.label || '',
      ts: Date.now(),
      product: product.handle,
      variant: currentVariant()
    };
    try {
      if (window.Shopify && window.Shopify.analytics && typeof window.Shopify.analytics.publish === 'function') {
        window.Shopify.analytics.publish('casa_pdp', payload);
      }
    } catch (e) { /* analytics must never break the page */ }
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: 'casa_pdp' }, payload));
    } catch (e) { /* noop */ }
    try {
      document.dispatchEvent(new CustomEvent('casa:pdp', { detail: payload }));
    } catch (e) { /* noop */ }
  }
  /* v4 chapters call window.casa.pdpEvent(name, { section, label, value }). */
  window.casa.pdpEvent = function (name, opts) { publish(String(name || 'interaction'), opts || {}); };
  document.addEventListener('casa:gallery:chip', function (e) { publish('gallery_chip', { section: 'gallery', label: (e.detail && e.detail.label) || '' }); });
  function once(key, name, opts) {
    if (sent[key]) return;
    sent[key] = true;
    publish(name, opts);
  }
  function currentVariant() {
    var input = document.querySelector('product-form-component input[name="id"], form[action*="/cart/add"] input[name="id"]');
    return input ? String(input.value || '') : '';
  }

  /* ── PDP view ─────────────────────────────────────────────────────── */
  publish('pdp_view', { section: 'page' });

  /* ── Sections in view + last engaged section ──────────────────────── */
  /* Shared sections are not edited to carry data-casa-section; map their
     wrapper classes here instead so the shared files stay untouched. */
  var wrapperMap = [
    ['.casa-day-night-transform-section', 'transformation'],
    ['.casa-sizing-section', 'sizing'],
    ['.casa-install-steps-section', 'install'],
    ['.casa-reviews-ugc-section', 'ugc'],
    ['.casa-faq2-section', 'faq'],
    ['.shopify-section:has(product-recommendations)', 'recommendations'],
    ['.shopify-section:has(.jdgm-rev-widg)', 'reviews']
  ];
  wrapperMap.forEach(function (pair) {
    try {
      document.querySelectorAll(pair[0]).forEach(function (el) {
        if (!el.hasAttribute('data-casa-section')) el.setAttribute('data-casa-section', pair[1]);
      });
    } catch (e) { /* :has() unsupported — those two just go unlabelled */ }
  });
  var sectionEls = document.querySelectorAll('[data-casa-section]');
  if ('IntersectionObserver' in window && sectionEls.length) {
    /* A section counts as viewed when it crosses the middle 30% band of the
       viewport — a ratio threshold would never fire for sections taller than
       ~3 screens (FAQ, reviews) on a phone. */
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var name = en.target.dataset.casaSection;
        lastSection = name;
        once('section:' + name, 'section_view', { section: name });
        if (name === 'sizing' || name === 'presence') once('size_impression', 'size_impression', { section: name });
      });
    }, { threshold: [0], rootMargin: '-35% 0px -35% 0px' });
    sectionEls.forEach(function (el) { io.observe(el); });
  }

  /* Explainer counts as "engaged" after 2.5s of ≥50% visibility. */
  var explainer = document.querySelector('[data-casa-section="explainer"], [data-casa-section="anatomy"]');
  if (explainer && 'IntersectionObserver' in window) {
    var timer = null;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && en.intersectionRatio >= 0.5) {
          if (!timer) timer = setTimeout(function () { once('explainer_engaged', 'explainer_engaged', { section: 'explainer' }); }, 2500);
        } else if (timer) { clearTimeout(timer); timer = null; }
      });
    }, { threshold: [0.5] }).observe(explainer);
  }

  /* ── Scroll depth (rAF-throttled, passive) ────────────────────────── */
  var marks = [25, 50, 75, 90];
  var ticking = false;
  function checkDepth() {
    ticking = false;
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) return;
    var pct = Math.round(((window.scrollY || doc.scrollTop) / max) * 100);
    marks.forEach(function (m) {
      if (pct >= m) once('depth:' + m, 'scroll_depth', { value: m, section: 'page' });
    });
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; window.requestAnimationFrame(checkDepth); }
  }, { passive: true });

  /* ── Gallery ──────────────────────────────────────────────────────── */
  var galleryTotal = 0;
  var galleryMax = 0;
  document.addEventListener('slideshow:select', function (e) {
    var g = e.target.closest && e.target.closest('media-gallery');
    if (!g || (e.target.closest && e.target.closest('dialog'))) return;
    var d = e.detail || {};
    if (typeof d.index !== 'number') return;
    var cap = g.querySelector('[data-casa-gal-cap]');
    galleryTotal = cap ? parseInt(cap.dataset.casaGalTotal, 10) || 0 : g.querySelectorAll('slideshow-container slideshow-slide').length;
    var label = '';
    if (cap) {
      var t = cap.querySelector('[data-casa-gal-text]');
      label = t ? t.textContent.trim() : '';
    }
    if (d.index > 0) once('gallery_interaction', 'gallery_interaction', { section: 'buybox' });
    publish('gallery_slide', { section: 'buybox', value: d.index + 1, label: label });
    galleryMax = Math.max(galleryMax, d.index + 1);
    if (galleryTotal && galleryMax >= galleryTotal) once('gallery_complete', 'gallery_complete', { section: 'buybox', value: galleryTotal });
  });
  document.addEventListener('casa:gallery:toggle', function (e) {
    publish('gallery_toggle', { section: 'buybox', label: (e.detail && e.detail.state) || '' });
    publish('transform_interaction', { section: 'buybox', label: 'toggle' });
  });

  /* ── Video play + progress (gallery, controls, install) ───────────── */
  document.addEventListener('play', function (e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO') return;
    if (v.dataset.casaPause !== undefined && !v.dataset.casaVideo) return; /* decorative loops owned by offscreen-pause */
    var id = v.dataset.casaVideo || v.currentSrc || 'video';
    /* Loops that casa-offscreen-pause.js starts on scroll are impressions,
       not intent; only a user-started video (gallery, deferred media) is a play. */
    var evt = v.dataset.casaPause !== undefined ? 'video_impression' : 'video_play';
    once('vplay:' + id, evt, { label: id });
    if (v.__casaProg) return;
    v.__casaProg = true;
    v.addEventListener('timeupdate', function () {
      if (!v.duration) return;
      var p = v.currentTime / v.duration;
      if (p >= 0.25) once('vp25:' + id, 'video_progress', { value: 25, label: id });
      if (p >= 0.5) once('vp50:' + id, 'video_progress', { value: 50, label: id });
      if (p >= 0.98) once('vp100:' + id, 'video_progress', { value: 100, label: id });
    }, { passive: true });
  }, true);

  /* ── Transformation scrub ─────────────────────────────────────────── */
  document.addEventListener('input', function (e) {
    if (e.target.matches && e.target.matches('[data-casa-dn-scrub]')) {
      once('transform_scrub', 'transform_interaction', { section: 'transformation', label: 'scrub' });
    }
  }, { passive: true });

  /* ── Sizing chips + variant selection ─────────────────────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var chip = t.closest('[data-casa-sz-chip], [data-casa-sz-hot], [data-casa-sz-mirror]');
    if (chip) {
      publish('size_interaction', { section: 'sizing', label: chip.dataset.casaSzChip || chip.dataset.casaSzHot || chip.dataset.casaSzMirror || '' });
      return;
    }
    if (t.closest('[data-casa-section="ugc"], [data-casa-section="rooms"], [data-casa-section="owners"]')) { once('ugc_interaction', 'ugc_interaction', { section: 'ugc' }); }
    if (t.closest('.jdgm-widget, .jdgm-rev-widg')) { once('review_interaction', 'review_interaction', { section: 'reviews' }); }
    if (t.closest('[data-casa-section="install"], [data-casa-section="wall"]')) { once('install_interaction', 'install_interaction', { section: 'install' }); }
    var faq = t.closest('.casa-faq2-section details summary, .casa-faq2-section [aria-expanded], .casa-faq2-section button');
    if (faq) { publish('faq_interaction', { section: 'faq', label: (faq.textContent || '').trim().slice(0, 80) }); }
    var sticky = t.closest('casa-sticky-cart [ref="addToCartButton"]');
    if (sticky) { publish('sticky_cta_click', { section: 'sticky' }); }
    var checkout = t.closest('[name="checkout"], a[href*="/checkout"], button[form*="cart"], .cart-drawer__checkout, [data-checkout]');
    if (checkout) { once('checkout_start', 'checkout_start', { section: 'cart' }); }
  }, true);
  document.addEventListener('variant:update', function (e) {
    var d = e.detail || {};
    var r = d.resource || d.variant || {};
    publish('variant_select', { section: lastSection, label: r.title || '' });
  });

  /* ── Sticky CTA impression ────────────────────────────────────────── */
  var stickyEl = document.querySelector('casa-sticky-cart');
  if (stickyEl && 'MutationObserver' in window) {
    new MutationObserver(function () {
      if (stickyEl.getAttribute('data-stuck') === 'true') once('sticky_cta_impression', 'sticky_cta_impression', { section: 'sticky' });
    }).observe(stickyEl, { attributes: true, attributeFilter: ['data-stuck'] });
  }

  /* ── Add to cart (Horizon dispatches cart:update with a source item) ─ */
  document.addEventListener('cart:update', function (e) {
    var d = e.detail || {};
    var src = d.data && d.data.source ? d.data.source : (d.source || '');
    if (String(src).indexOf('product-form') === -1 && String(src).indexOf('sticky') === -1 && src !== '') return;
    publish('add_to_cart', { section: lastSection, label: lastSection });
  });
})();
