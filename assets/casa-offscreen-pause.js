/*
 * casa-offscreen-pause.js — site-wide off-screen pause for decorative videos.
 *
 * CONTRACT (lint-enforced by .claude/scripts/casa-lint.py):
 *   <video data-casa-pause muted loop playsinline preload="metadata|none">
 *   (preload="none" is the lazy-src variant: the section ships data-src only,
 *   copies it to src near the viewport, flips preload to auto, then calls
 *   window.casa.offscreenPauseRefresh() — see casa-brand-story et al.)
 *   — NEVER the `autoplay` attribute. This script is the video's sole playback
 *   owner: it plays the video while on-screen and pauses it off-screen, so
 *   Safari doesn't keep decoding scrolled-past video on the main thread
 *   (the Calini PDP shipped 11% dropped scroll frames from exactly that).
 *   A native `autoplay` attribute would re-issue play() behind our back and
 *   fight the pause — the documented casa-hero bounce/flash bug.
 *
 *   Interaction-driven videos (hover cards, menu videos, lightboxes) must NOT
 *   carry data-casa-pause — they keep their own handlers and this script never
 *   touches them. Sections with bespoke playback JS keep a
 *   `perf-justified: playback owned by <owner>` comment next to their markup.
 *
 * Why a single external asset (not per-section inline JS): a stale Shopify
 * code-editor save overwrites whole section .liquid files (see commit 3a25401,
 * which silently deleted an inline pause script). Theme-editor saves never
 * touch assets/*.js. If a clobber reverts a section's markup to <video autoplay>,
 * behavior degrades to "plays unpaused" — a perf regression, never a broken
 * page — and lint flags the reverted file on its next edit.
 *
 * Design notes (hard-won, see memory + casa-spectrum-strip.js):
 *   - Geometry (getBoundingClientRect) is the source of truth, NOT
 *     entry.isIntersecting — iOS re-fires observers with stale flags when the
 *     URL bar collapses/expands.
 *   - rootMargin 0: a positive margin is right for lazy-LOADING but delays a
 *     PAUSE by the whole margin.
 *   - muted/playsInline PROPERTIES set before play(); play() promise swallowed
 *     (iOS Low Power Mode rejects even muted programmatic play — the poster
 *     stands and reads as an intentional still).
 *   - Playback STARTS wait for a 180ms scroll settle (pauses never do):
 *     first decode + layer creation inside active scroll frames is the
 *     measured first-scroll jank on high-refresh displays.
 *   - MutationObserver covers storefront dynamic DOM (Section Rendering API
 *     innerHTML swaps — e.g. the collection filter grid re-injects the promo
 *     banner video on every filter tap; shopify:section:load fires only in the
 *     theme editor). Removed nodes are paused and unobserved: IO holds strong
 *     references, and iOS keeps detached <video> decoding briefly.
 */
(function () {
  'use strict';
  if (window.__casaOffscreenPause) return;
  window.__casaOffscreenPause = true;

  var SEL = 'video[data-casa-pause]';
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var wired = []; // live list of managed videos
  var gateIO = null;

  // Scroll-settle gate for playback STARTS only (pauses are never deferred).
  // Starting a video mid-scroll means first decode + GPU layer creation land
  // inside active scroll frames — measured on a 240Hz display as the
  // first-scroll-down jank (91ms worst frame, 6× the settled jank rate).
  // 180ms matches the casa-product-card.js hover/scroll settle constant.
  var SETTLE_MS = 180;
  var lastScrollT = -SETTLE_MS; // performance.now() of the last scroll event; negative = gate inert until the first scroll
  var settleTimer = null;

  function scheduleSettleRecheck() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function () { settleTimer = null; applyAll(); }, SETTLE_MS + 20);
  }

  function inView(el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false; // display:none / detached
    var vh = window.innerHeight || document.documentElement.clientHeight;
    return r.bottom > 0 && r.top < vh;
  }

  // ── Shared overlay gate (single source of truth) ──────────────────────────
  // A page-covering overlay — desktop mega-menu, mobile nav drawer, mobile
  // collection-filter drawer, quick-view, or a video-testimonial lightbox —
  // hides the page beneath AND, via its frost backdrop-filter, forces a full
  // re-blur of every video frame under it, so a still-decoding video costs
  // compositor time for zero visible pixels. Each clause cross-checks the body
  // class against a LIVE open node so a stranded class (theme editor re-rendering
  // the header mid-open) self-heals. This governs our own data-casa-pause videos
  // (see apply) AND is exposed on window.casa so the self-managed sections that
  // own their own playback (casa-hero, casa-day-night, casa-categories,
  // casa-ugc-gallery, casa-spectrum-strip) consult ONE predicate, not a copy.
  function overlayOpen() {
    var b = document.body;
    // !! → a real boolean (each clause yields a matched node); callers compare it
    // with === (the body-observer state-flip gate) and expect true/false.
    return !!(
      (b.classList.contains('casa-drawer-active') &&
        document.querySelector('.casa-drawer.active')) ||
      (b.classList.contains('casa-col-drawer-locked') &&
        document.querySelector('.casa-col-main__drawer.is-open')) ||
      (b.classList.contains('casa-mega-open') &&
        document.querySelector('.casa-nav-item.is-open')) ||
      (b.classList.contains('casa-qv-open') &&
        document.querySelector('.casa-qv-overlay')) ||
      (b.classList.contains('casa-vtm-open') &&
        document.querySelector('.casa-vtm__modal--open, .casa-vtm-section__modal--open'))
    );
  }

  // Expose the predicate + a subscribe API. Overlay open/close toggles a <body>
  // class but fires NO scroll/resize/IO edge, so self-managed sections that own
  // their own playback subscribe via onOverlayToggle to re-gate on open/close.
  // (A section whose inline script parses before this deferred asset simply
  // guards on onOverlayToggle and retries on DOMContentLoaded — by which point
  // this has run — so no subscription is lost; no shared queue is needed.)
  window.casa = window.casa || {};
  window.casa.overlayOpen = overlayOpen;
  var overlaySubs = window.casa.overlaySubscribers || (window.casa.overlaySubscribers = []);
  window.casa.onOverlayToggle = function (fn) {
    if (typeof fn === 'function' && overlaySubs.indexOf(fn) === -1) overlaySubs.push(fn);
    return function () { var i = overlaySubs.indexOf(fn); if (i !== -1) overlaySubs.splice(i, 1); };
  };
  function notifyOverlaySubs() {
    for (var i = 0; i < overlaySubs.length; i++) { try { overlaySubs[i](); } catch (e) {} }
  }

  function apply(video) {
    // Tab hidden, reduced-motion, a page-covering overlay (see overlayOpen —
    // owners also call offscreenPauseRefresh on open/close), or scrolled
    // off-screen: pause so nothing decodes for zero visible pixels.
    if (document.hidden || reduceMQ.matches || overlayOpen() || !inView(video)) {
      if (!video.paused) { try { video.pause(); } catch (e) {} }
      return;
    }
    if (!video.paused) return; // already playing — keeps per-frame re-gates free
    if (window.performance && performance.now() - lastScrollT < SETTLE_MS) {
      scheduleSettleRecheck(); // retry after the scroll pauses
      return;
    }
    video.muted = true;       // property, not just attribute — iOS requirement
    video.playsInline = true;
    var p = video.play();
    if (p && typeof p.catch === 'function') p.catch(function () {}); // LPM etc.
  }

  function applyAll() { for (var i = 0; i < wired.length; i++) apply(wired[i]); }

  function wire(video) {
    if (video.__casaOP) return;
    video.__casaOP = true;
    wired.push(video);
    if (gateIO) gateIO.observe(video);
    apply(video);
  }

  function unwire(video) {
    if (!video.__casaOP) return;
    video.__casaOP = false;
    try { video.pause(); } catch (e) {}
    if (gateIO) gateIO.unobserve(video);
    var i = wired.indexOf(video);
    if (i !== -1) wired.splice(i, 1);
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(SEL)) wire(root);
    var vids = root.querySelectorAll(SEL);
    for (var i = 0; i < vids.length; i++) wire(vids[i]);
  }

  function unscan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(SEL)) unwire(root);
    var vids = root.querySelectorAll(SEL);
    for (var i = 0; i < vids.length; i++) unwire(vids[i]);
  }

  function init() {
    if (!('IntersectionObserver' in window)) {
      // Very old browsers: behave like plain autoplay (degrade to the old
      // behavior — playing — never to a frozen page).
      scan(document);
      return;
    }
    // IO entries are triggers only; apply() re-reads real geometry.
    gateIO = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) apply(entries[i].target);
    }, { rootMargin: '0px', threshold: [0, 0.01] });

    scan(document);

    // Storefront dynamic DOM (Section Rendering API swaps, quick views).
    // childList/subtree only; wiring deferred off the mutation microtask so we
    // never compete with an iOS tap's paint frame (drawer Bug A class).
    var mo = new MutationObserver(function (records) {
      var added = null, removed = null, i, j, n;
      for (i = 0; i < records.length; i++) {
        for (j = 0; j < records[i].addedNodes.length; j++) {
          n = records[i].addedNodes[j];
          if (n.nodeType === 1 && (n.tagName === 'VIDEO' || (n.querySelector && n.querySelector(SEL)))) {
            (added = added || []).push(n);
          }
        }
        for (j = 0; j < records[i].removedNodes.length; j++) {
          n = records[i].removedNodes[j];
          if (n.nodeType === 1 && (n.tagName === 'VIDEO' || (n.querySelector && n.querySelector(SEL)))) {
            (removed = removed || []).push(n);
          }
        }
      }
      if (removed) for (i = 0; i < removed.length; i++) unscan(removed[i]);
      if (added) setTimeout(function () {
        for (var k = 0; k < added.length; k++) scan(added[k]);
      }, 0);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // iOS URL-bar collapse isn't guaranteed to fire the IO promptly; a cheap
    // debounced resize re-gate closes that hole (≤ a few rect reads).
    var rafId = null;
    window.addEventListener('resize', function () {
      if (rafId) return;
      rafId = requestAnimationFrame(function () { rafId = null; applyAll(); });
    }, { passive: true });

    // Scroll re-gate: iOS can also skip IO *exit* entries entirely during
    // momentum scroll (the documented casa-hero lesson — a missed exit leaves
    // an off-screen video decoding indefinitely). rAF-throttled; apply() is a
    // no-op for videos already in the right state, so steady-state cost is a
    // handful of rect reads per frame.
    var scrollRaf = null;
    window.addEventListener('scroll', function () {
      lastScrollT = window.performance ? performance.now() : 0;
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(function () { scrollRaf = null; applyAll(); });
    }, { passive: true });

    document.addEventListener('visibilitychange', applyAll);
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', applyAll);

    // Overlay open/close toggles a <body> class but fires no scroll/resize/IO
    // edge. One page-wide observer re-gates our own videos (belt-and-braces —
    // overlay owners also call offscreenPauseRefresh) AND pings the self-managed
    // section subscribers (casa-hero et al.) so they re-gate at the same instant.
    // Act only when the overlay-open STATE actually flips, so unrelated body-class
    // churn (submenu toggles, policy-page TOC, any future writer) can't fan out.
    var lastOverlay = overlayOpen();
    var bodyClassMO = new MutationObserver(function () {
      var now = overlayOpen();
      if (now === lastOverlay) return;
      lastOverlay = now;
      applyAll();
      notifyOverlaySubs();
    });
    bodyClassMO.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // Theme editor lifecycle.
    document.addEventListener('shopify:section:load', function (e) { scan(e.target); });
    document.addEventListener('shopify:section:unload', function (e) { unscan(e.target); });
  }

  // Lazy-src hook: sections that copy data-src → src late (bandwidth-deferred
  // videos) call this after load() so playback starts without waiting for the
  // next IO edge crossing / scroll tick. Safe no-op before init (empty list).
  window.casa = window.casa || {};
  window.casa.offscreenPauseRefresh = applyAll;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
