/* casa-anim-gate.js — pause decorative CSS animations while their host
   is outside the viewport.

   Contract: put `data-casa-anim-gate` on a section root (or any
   wrapper). Elements carrying .text-grad-shimmer are gated
   automatically — that utility class animates background-position on
   clipped text, which cannot be GPU-composited, so it must not tick
   while off-screen (the footer brand title ticked at 60fps on every
   page of the site before this).

   Off-screen hosts get data-casa-anim="paused"; casa-base.css maps
   that to animation-play-state: paused for the host and its subtree.
   Degrades safe: if this file 404s the attribute is never set and
   animations simply keep running (the old behavior) — never frozen.

   Companion to casa-offscreen-pause.js, which owns <video> playback;
   this file owns CSS animations only. JS-driven video play/pause is
   unaffected by animation-play-state. */
(function () {
  'use strict';
  if (window.__casaAnimGateInit) return;
  window.__casaAnimGateInit = true;

  var SELECTOR = '[data-casa-anim-gate], .text-grad-shimmer';
  var io = null;
  var scrollActive = false;

  function inView(el) {
    // Geometry is the source of truth — iOS can deliver stale
    // isIntersecting around URL-bar collapse/expand.
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  }

  function gate(el) {
    // Paint-property animations (background-clip:text shimmers,
    // background-position drifts, custom-property gradient orbits)
    // repaint their raster every frame; during scroll that paint
    // competes with the GPU's tightest window (4.16ms/frame at 240Hz).
    // The 2026-07-15 Genix recording caught full-viewport raster
    // white-outs mid-scroll in the moods zone while its 6 bg-position
    // + 3 orbit animations ran IN view — the viewport gate alone can't
    // help there. So: while the page is actively scrolling, EVERY
    // gated element holds paused (a paused shimmer is imperceptible
    // under motion); geometry decides again at settle. play-state
    // pause retains progress, so nothing visually jumps on resume.
    if (scrollActive) {
      el.setAttribute('data-casa-anim', 'paused');
      return;
    }
    if (inView(el)) el.removeAttribute('data-casa-anim');
    else el.setAttribute('data-casa-anim', 'paused');
  }

  function ensureIO() {
    if (io) return io;
    io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) gate(entries[i].target);
    }, { rootMargin: '0px' });
    return io;
  }

  function bind(root) {
    if (!('IntersectionObserver' in window)) return; // leave running
    var scope = root && root.querySelectorAll ? root : document;
    var els = scope.querySelectorAll(SELECTOR);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.__casaAnimGated) continue;
      el.__casaAnimGated = true;
      gate(el);
      ensureIO().observe(el);
    }
  }

  function regateAll() {
    var els = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < els.length; i++) gate(els[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { bind(document); });
  } else {
    bind(document);
  }

  // Scroll-settle gate for every gated element (see gate() above).
  // Mirrors casa-offscreen-pause's 2026-07-14 video start gate: work
  // that isn't perceivable mid-scroll doesn't get to compete with
  // scroll raster. Attribute writes happen once per scroll ENGAGE and
  // once per settle — not per scroll frame.
  //
  // Engage on the SECOND event of a burst, never the first. Real
  // scrolling (touch drag, momentum, smooth wheel) streams events
  // ~16ms apart, so the pause still lands within a frame of scroll
  // start. But a lone programmatic jump fires exactly ONE event —
  // the cart drawer's scroll-lock release restoring scrollY on
  // close, Judge.me's scrollTo, anchor jumps — and pausing every
  // in-view gated section for the 200ms settle window on such a
  // jump made iOS Safari re-commit the Apollo moods strip's layers
  // mid-drawer-teardown and paint the strip as a black band
  // (merchant recording 2026-07-19: pause flipped at close+157ms,
  // released at +359ms — exactly the observed blank). A single jump
  // has no sustained raster pressure to protect against; don't
  // pause for it. Settle still re-gates unconditionally so
  // geometry is re-decided after any jump.
  var scrollIdleTimer = null;
  window.addEventListener('scroll', function () {
    if (scrollIdleTimer) {
      clearTimeout(scrollIdleTimer);
      if (!scrollActive) {
        scrollActive = true;
        regateAll();
      }
    }
    scrollIdleTimer = setTimeout(function () {
      scrollIdleTimer = null;
      scrollActive = false;
      regateAll();
    }, 200);
  }, { passive: true });

  // Theme editor mounts/unmounts sections constantly.
  document.addEventListener('shopify:section:load', function (e) { bind(e.target); });
  // Re-gate when the tab becomes visible again (IO delivery can lag).
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) regateAll();
  });
})();
