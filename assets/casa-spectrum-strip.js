/*
 * casa-spectrum-strip.js
 * Off-screen pause for casa-spectrum-strip (Calini PDP "FLOOR REFLECTION" section).
 *
 * Why this lives in assets/ and not inline in the section:
 *   The original inline pause logic (commit 9fedf00, 2026-05-17) was clobbered the
 *   next day by a Shopify theme-editor save ("Update from Shopify", 3a25401). The
 *   visual editor re-serializes section .liquid but does NOT touch assets/*.js, so
 *   keeping the behaviour here makes it survive two-way sync.
 *
 * What it does:
 *   - Pauses the 1080p autoplay video while it is scrolled out of view (Safari keeps
 *     decoding off-screen <video> on the main thread → scroll jitter + poster flash).
 *   - Pauses the 6 infinite SVG dichroic/beam CSS animations while the diagram is
 *     out of view (sets data-casa-anim="paused"; the CSS gate is in the section).
 *
 * Design notes:
 *   - Geometry is the source of truth (getBoundingClientRect), NOT entry.isIntersecting:
 *     iOS re-fires the observer on URL-bar collapse with a stale isIntersecting flag.
 *   - rootMargin 0 so it pauses at the real viewport edge (a positive margin is right
 *     for lazy-LOADING but delays a PAUSE by the whole margin).
 *   - Video has no `autoplay` attribute (the section drops it) so the browser's autoplay
 *     controller can't fight this JS owner. We set the muted PROPERTY before play() —
 *     iOS rejects programmatic muted autoplay otherwise.
 *   - Animations default to RUNNING in CSS; JS only adds the paused state. If this asset
 *     ever fails to load, the section degrades to "always animate", never "frozen".
 */
(function () {
  'use strict';
  if (window.__casaSpecInit) return;
  window.__casaSpecInit = true;

  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Shared overlay gate (casa-offscreen-pause.js). Pause the video while a
  // page-covering overlay is open; delegating shim tolerates the utility not
  // having loaded yet (→ false, plays as before). See applyVideo + wire().
  function overlayOpen() {
    return !!(window.casa && window.casa.overlayOpen && window.casa.overlayOpen());
  }

  function inView(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.width === 0 && r.height === 0) return false; // not rendered
    return r.bottom > 0 && r.top < vh;
  }

  function applyVideo(video) {
    if (!video) return;
    if (inView(video) && !reduceMQ.matches && !overlayOpen()) {
      video.muted = true;          // iOS: muted PROPERTY, not just the attribute
      video.playsInline = true;
      // iOS Low Power Mode can reject even a muted programmatic play(). We swallow it:
      // there are no controls and the poster is a real frame, so a non-playing video
      // reads as an intentional still image rather than a broken player.
      var p = video.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } else if (!video.paused) {
      try { video.pause(); } catch (e) {}
    }
  }

  function applyAnim(diagram) {
    if (!diagram) return;
    diagram.dataset.casaAnim = inView(diagram) ? 'running' : 'paused';
  }

  function wire(root) {
    if (!root || root.dataset.casaSpecWired) return;
    root.dataset.casaSpecWired = '1';

    var video = root.querySelector('.casa-spec__video');
    var diagram = root.querySelector('.casa-spec__diagram-svg');

    var apply = function () { applyVideo(video); applyAnim(diagram); };

    if (!('IntersectionObserver' in window)) {
      apply(); // no IO: leave it on, behave like before
      return;
    }

    var io = new IntersectionObserver(function () { apply(); },
      { rootMargin: '0px', threshold: [0, 0.01] });
    if (video) io.observe(video);
    if (diagram) io.observe(diagram);
    root.__casaSpecIO = io;

    var onRM = function () { apply(); };
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onRM);
    root.__casaSpecRM = onRM;

    // Overlay open/close fires no IO edge — re-gate via the shared subscription.
    root.__casaSpecOverlayUnsub = (window.casa && window.casa.onOverlayToggle)
      ? window.casa.onOverlayToggle(apply) : null;

    apply(); // initial state
  }

  function teardown(root) {
    if (!root) return;
    // Defensive: stop decode in case iOS keeps a detached <video> alive briefly after unload.
    var v = root.querySelector('.casa-spec__video');
    if (v && !v.paused) { try { v.pause(); } catch (e) {} }
    if (root.__casaSpecIO) { root.__casaSpecIO.disconnect(); root.__casaSpecIO = null; }
    if (root.__casaSpecRM && reduceMQ.removeEventListener) {
      reduceMQ.removeEventListener('change', root.__casaSpecRM);
    }
    root.__casaSpecRM = null;
    if (root.__casaSpecOverlayUnsub) { try { root.__casaSpecOverlayUnsub(); } catch (e) {} }
    root.__casaSpecOverlayUnsub = null;
    delete root.dataset.casaSpecWired;
  }

  function wireAll(scope) {
    var els = (scope || document).querySelectorAll('.casa-spec');
    for (var i = 0; i < els.length; i++) wire(els[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wireAll(); });
  } else {
    wireAll();
  }

  // Theme editor mounts/unmounts sections constantly — re-wire and clean up.
  document.addEventListener('shopify:section:load', function (e) { wireAll(e.target); });
  document.addEventListener('shopify:section:unload', function (e) {
    if (!e.target) return;
    var els = e.target.querySelectorAll('.casa-spec');
    for (var i = 0; i < els.length; i++) teardown(els[i]);
  });
})();
