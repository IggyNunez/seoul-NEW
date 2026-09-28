/**
 * Casa Product Card — global interactions
 *
 * This file is loaded once site-wide from layout/theme.liquid so it runs
 * regardless of whether casa-product-card.liquid is rendered server-side
 * or injected later via AJAX (recommendations, recently viewed, search,
 * infinite scroll, etc).
 *
 * Why this matters: scripts inserted via element.innerHTML do NOT execute
 * per the HTML5 spec. The previous inline <script> in casa-product-card.liquid
 * never ran on PDPs because casa-product-card was only present in the
 * AJAX-loaded "you may also like" section — its inline script never fired,
 * so MutationObserver was never set up, so hover video never bound.
 *
 * Solution: load this once globally, register a MutationObserver, and any
 * future casa-product-card (anywhere, anytime) gets its bindings.
 */
(function () {
  if (window.__casaProductCardBound) return;
  window.__casaProductCardBound = true;

  function cartSectionIds() {
    var ids = Array.prototype.map.call(
      document.querySelectorAll('cart-items-component[data-section-id]'),
      function (el) { return el.getAttribute('data-section-id'); }
    ).filter(Boolean);

    return ids.filter(function (id, index) { return ids.indexOf(id) === index; });
  }

  function cartCountFromSections(sections) {
    if (!sections) return null;

    for (var id in sections) {
      if (!Object.prototype.hasOwnProperty.call(sections, id)) continue;
      var doc = new DOMParser().parseFromString(sections[id] || '', 'text/html');
      var count = parseInt((doc.querySelector('[ref="cartItemCount"]') || {}).textContent || '', 10);
      if (!Number.isNaN(count)) return count;
    }

    return null;
  }

  function waitForCartItemsToSettle() {
    return Promise.all(Array.prototype.map.call(document.querySelectorAll('cart-items-component'), function (component) {
      if (component && typeof component.flushPendingCartUpdates === 'function') {
        return component.flushPendingCartUpdates();
      }
    }));
  }

  function init() {
    // ═══════════════════════════════════════════════════════════════════════
    // VARIANT SWATCHES — Click to swap image & update link
    //
    // Image swap: preload + decode the new variant image, THEN commit src.
    // Matches Horizon's `animate: false` philosophy for product-card variant
    // image swaps — the swap should feel instantaneous, never expose the
    // CDN latency window.
    //
    // The previous opacity-fade implementation assumed CSS
    // `transition: opacity 0.4s` would mask the CDN fetch. That broke under
    // `.casa-col-main--no-anim *` (collection-grid wrapper kills all
    // transitions): opacity snapped, src changed, browser kept painting the
    // OLD variant bytes for ~360 ms until the new WebP arrived — looking
    // like the card "refreshed on the current variant, then switched."
    //
    // Now: preload via `new Image().decode()`, commit src only after decode
    // resolves. No opacity manipulation, no dependency on CSS transitions,
    // no flash. A token guards against rapid clicks (latest one wins).
    //
    // Uses event delegation so swatches added later still work.
    // ═══════════════════════════════════════════════════════════════════════
    document.addEventListener('click', function (e) {
      var swatch = e.target.closest('.casa-product-card__swatch');
      if (!swatch) return;
      e.preventDefault();
      e.stopPropagation();

      var card = swatch.closest('.casa-product-card');
      var swatchContainer = swatch.closest('.casa-product-card__swatches');
      if (!card) return;

      if (swatchContainer) {
        swatchContainer.querySelectorAll('.casa-product-card__swatch').forEach(function (s) {
          s.classList.remove('casa-product-card__swatch--active');
          s.setAttribute('aria-pressed', 'false');
        });
      }
      swatch.classList.add('casa-product-card__swatch--active');
      // Expose the selected state to assistive tech, not just the check badge —
      // otherwise a screen reader announces selected and unselected swatches
      // identically (the AT-equivalent of the selected≡hovered bug). (2026-07-08)
      swatch.setAttribute('aria-pressed', 'true');

      // ─── Atomic reveal (fixes the "group-shot flash") ───
      // While the card is hovered, an overlay layer sits opacity:1 ON TOP of
      // the main image — either the 2nd-image hover photo
      // (.casa-product-card__img--hover) or a hover <video>. The swatch swap
      // replaces the *main* image, but that swap is deferred behind
      // Image.decode() (see commit() below), ~100-500ms on a cold image.
      //
      // The old code dropped the overlay SYNCHRONOUSLY here, on click — so for
      // the whole decode window the customer saw the bare main layer, which
      // still held the ORIGINAL featured image (a group/hero shot). That was
      // the flash. Fix: look the nodes up now, but drop them INSIDE commit(),
      // after the new src is decoded and written — so the reveal is atomic.
      var videoWrap = card.querySelector('.casa-product-card__video');
      var videoEl = videoWrap && videoWrap.querySelector('video');

      var variantUrl = swatch.dataset.variantUrl;
      var variantImage = swatch.dataset.variantImage;
      var variantId = swatch.dataset.variantId;

      var productLink = card.querySelector('.casa-product-card__link');
      if (productLink && variantUrl) {
        productLink.href = variantUrl;
      }

      var variantInput = card.querySelector('.casa-product-card__add-form input[name="id"]');
      if (variantInput && variantId) {
        variantInput.value = variantId;
      }

      var quickViewBtn = card.querySelector('.casa-product-card__quick-view');
      if (quickViewBtn && variantUrl) {
        quickViewBtn.dataset.productUrl = variantUrl;
      }

      var mainImage = card.querySelector('.casa-product-card__img:not(.casa-product-card__img--hover)');
      var hoverImage = card.querySelector('.casa-product-card__img--hover');
      if (!mainImage || !variantImage) return;

      var filename = function (u) { return (u || '').split('?')[0].split('/').pop(); };
      if (filename(mainImage.currentSrc) === filename(variantImage)) return;

      var token = (card.__casaSwatchToken = (card.__casaSwatchToken || 0) + 1);

      var commit = function () {
        if (!card.isConnected) return;
        if (card.__casaSwatchToken !== token) return;
        // 1) Swap both image layers to the now-decoded variant image.
        //    srcset must be written TOO, not just src: the card imgs ship
        //    a responsive srcset from Liquid, and the browser ignores a
        //    src write while a srcset is present — src-only would leave
        //    the grid image stuck on the featured photo. The single-URL
        //    srcset pins the swap to the exact asset the preloader just
        //    decoded (cache hit, keeps the reveal atomic).
        mainImage.src = variantImage;
        mainImage.srcset = variantImage;
        if (hoverImage) {
          hoverImage.src = variantImage;
          hoverImage.srcset = variantImage;
        }
        // 2) Commit the selection PERMANENTLY. The card now represents the
        //    variant the customer picked, so it must stay on that image and
        //    its hover media must not reveal a different colour on a later
        //    hover. is-swatch-selected is set unconditionally (no :hover gate,
        //    no mouseleave cleanup — persistent as of 2026-07-13) and:
        //      - hides the 2nd-image overlay AND the hover video via CSS
        //        (.is-swatch-selected:hover rules in the stylesheet), so the
        //        selected still is what shows on every subsequent hover;
        //      - is read by bindHoverVideo below to skip play() entirely, so
        //        the clip (shot on the ORIGINAL colour — there is no
        //        per-variant clip to swap to) never decodes over the pick.
        //    Cleared only when the card re-renders from the server (AJAX
        //    filter / paginate → a fresh card with no committed selection).
        //    Pausing here handles the clip that was already playing when the
        //    swatch was clicked mid-hover; the src swap above is already
        //    atomic, so this is safe whether or not the pointer is still over
        //    the card.
        card.classList.add('is-swatch-selected');
        if (videoEl) {
          videoEl.pause();
          videoEl.currentTime = 0;
        }
      };

      var preloader = new Image();
      preloader.src = variantImage;

      // If the variant image is already in cache (very common — the swatch
      // thumbnail is the same asset at a smaller width, so the CDN has it
      // warm), commit synchronously: no decode wait, no first-click lag.
      // The old code ALWAYS waited on decode(), which added a ~300ms gap on
      // the first click and was the visible "it won't switch" symptom.
      if (preloader.complete && preloader.naturalWidth > 0) {
        commit();
        return;
      }

      // Cold image: preload + decode to avoid a half-painted flash, then
      // commit. Token guards against rapid clicks (latest one wins).
      var ready = preloader.decode
        ? preloader.decode().catch(function () {})
        : new Promise(function (resolve) {
            if (preloader.complete && preloader.naturalWidth > 0) return resolve();
            preloader.onload = function () { resolve(); };
            preloader.onerror = function () { resolve(); };
          });

      ready.then(commit);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // "+N MORE" PILL — a <button> (not a nested <a>, which would make the
    // browser clone the card link). Navigate to the product page on click.
    // ═══════════════════════════════════════════════════════════════════════
    document.addEventListener('click', function (e) {
      var more = e.target.closest('.casa-product-card__swatch-more');
      if (!more) return;
      e.preventDefault();
      e.stopPropagation();
      var url = more.dataset.moreUrl;
      if (url) window.location.href = url;
    });

    // ═══════════════════════════════════════════════════════════════════════
    // WISHLIST — event delegation so AJAX-injected cards work
    // ═══════════════════════════════════════════════════════════════════════
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.casa-product-card__wishlist');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      btn.classList.toggle('is-active');
      var productId = btn.dataset.productId;
      window.dispatchEvent(new CustomEvent('wishlist:toggle', { detail: { productId: productId } }));
    });

    // ═══════════════════════════════════════════════════════════════════════
    // QUICK VIEW — already event-delegated in the original
    // ═══════════════════════════════════════════════════════════════════════
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.casa-product-card__quick-view');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var productUrl = btn.dataset.productUrl;
      window.dispatchEvent(new CustomEvent('quickview:open', { detail: { productUrl: productUrl } }));
    });

    // ═══════════════════════════════════════════════════════════════════════
    // HOVER VIDEO — works for cards in initial DOM AND cards injected
    // later via AJAX. mouseenter/mouseleave don't bubble, so we attach
    // them per card. A MutationObserver catches new cards as they arrive.
    //
    // Capability gate: on touch devices a tap synthesizes mouseenter, so
    // load()+play() would start the video and NOTHING ever fires mouseleave
    // to pause it — the card keeps decoding forever on iOS. Only
    // hover-capable fine-pointer devices get the bindings at all; the
    // matchMedia check runs at bind time so a hybrid device (iPad +
    // trackpad) that flips later still binds cards injected after the flip.
    //
    // Scroll escape hatch: on desktop, wheel-scrolling with a stationary
    // cursor never fires mouseleave, so a playing card video keeps decoding
    // off-screen. One rAF-throttled passive scroll listener (registered
    // once, lazily on the first bound card) pauses + resets any playing
    // card video whose rect is outside the viewport — same cleanup as
    // mouseleave. These are interaction videos, so they must NOT carry
    // data-casa-pause (casa-offscreen-pause.js contract: it never touches
    // hover videos); this listener is their own owner-side cleanup.
    // ═══════════════════════════════════════════════════════════════════════
    var hoverMQ = window.matchMedia('(hover: hover) and (pointer: fine)');
    // JS-driven playback isn't covered by the casa-animations.css
    // reduced-motion kill-switch (that only stops CSS animations).
    var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

    var playingCardVideos = [];
    var lastScrollT = 0;
    var scrollEscapeBound = false;
    function ensureScrollEscape() {
      if (scrollEscapeBound) return;
      scrollEscapeBound = true;
      var ticking = false;
      window.addEventListener('scroll', function () {
        lastScrollT = performance.now();
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          ticking = false;
          var vh = window.innerHeight || document.documentElement.clientHeight;
          for (var i = playingCardVideos.length - 1; i >= 0; i--) {
            var v = playingCardVideos[i];
            if (v.paused) { playingCardVideos.splice(i, 1); continue; }
            var r = v.getBoundingClientRect();
            if ((r.width === 0 && r.height === 0) || r.bottom <= 0 || r.top >= vh) {
              v.pause();
              v.currentTime = 0;
              playingCardVideos.splice(i, 1);
            }
          }
        });
      }, { passive: true });
    }

    function bindHoverVideo(card) {
      if (!hoverMQ.matches) return; // touch: never bind, never start playback
      if (!card || card.__hoverVideoBound) return;
      var wrap = card.querySelector('.casa-product-card__video');
      var video = wrap && wrap.querySelector('video');
      if (!video) return;
      card.__hoverVideoBound = true;
      ensureScrollEscape();

      // ── Reveal on real playback, never before ──────────────────────────────
      // There is NO poster on the <video> (see casa-product-card.liquid): the
      // base .casa-product-card__img is the still. The wrapper stays opacity:0
      // until we KNOW frames are decoding, so Safari can't flash the still
      // while the clip fetches/rebuffers/loops. Mirrors the hero-video pattern:
      // trust `playing`, backstop with the first non-zero `timeupdate`.
      var reveal = function () { wrap.classList.add('is-playing'); };
      video.addEventListener('playing', reveal);
      var onTime = function () {
        if (video.currentTime > 0) { reveal(); video.removeEventListener('timeupdate', onTime); }
      };
      video.addEventListener('timeupdate', onTime);
      // Any pause — mouseleave, scroll-escape, or a swatch pick (all call
      // video.pause()) — hides the reveal centrally so a frozen last frame
      // never lingers over the still once playback stops.
      video.addEventListener('pause', function () { wrap.classList.remove('is-playing'); });

      // Attach the src + decode at most ONCE. Re-running load() on every hover
      // forces a full media reset → the poster/still repaint we're fixing. After
      // priming, a later hover just resumes play() from the buffered clip.
      var primeAndPlay = function () {
        if (!card.__videoPrimed) {
          card.__videoPrimed = true;
          video.querySelectorAll('source[data-src]').forEach(function (source) {
            if (source.dataset.src && !source.src) source.src = source.dataset.src;
          });
          if (video.dataset.src && !video.src) video.src = video.dataset.src;
          video.load();
        }
        video.play().catch(function () { /* autoplay may be blocked; still stays */ });
        if (playingCardVideos.indexOf(video) === -1) playingCardVideos.push(video);
      };

      card.addEventListener('mouseenter', function () {
        if (reduceMQ.matches) return; // reduced motion: leave the still
        // Leave-grace: a mouseleave that bounces straight back (below) is a
        // third-party hit-test flicker, not the customer leaving — cancel the
        // pending pause and keep playing. Root-caused 2026-07-18 from a 240fps
        // Safari recording: Klaviyo's onsite layer cyclically wins
        // elementFromPoint over the card (~0.87s cadence, stationary cursor),
        // and WebKit fires real mouseleave/mouseenter on the hit-target change
        // (reproduced headless: leave fired at t=4.3s with zero pointer
        // movement, cursor element = input.needsclick). Each bounce used to
        // pause+reset+re-load() the clip — the visible "video → still photo →
        // video restarts" cycle on product cards.
        if (card.__leaveGrace) {
          clearTimeout(card.__leaveGrace);
          card.__leaveGrace = null;
          if (!video.paused) return; // clip never stopped — nothing to do
        }
        // A committed swatch selection pins the card to that variant's still.
        // The clip was shot on the original colour, so replaying it would show
        // the WRONG colour over the pick — skip playback entirely (no wasted
        // decode). The .is-swatch-selected CSS rule also keeps the wrapper
        // hidden, so the selected still (with its scale zoom) is all that
        // shows. (2026-07-13)
        if (card.classList.contains('is-swatch-selected')) return;
        // Hover intent: sweeping the cursor across the grid must not spin
        // up a decoder + GPU layer for every card it crosses. Only fetch
        // and play once the cursor has settled on this card.
        card.__hoverIntent = setTimeout(function fire() {
          card.__hoverIntent = null;
          if (!card.isConnected) return; // SRA swap removed the card mid-delay
          if (card.classList.contains('is-swatch-selected')) return; // variant chosen after the timer armed
          // Scrolling moves cards under a stationary cursor and fires
          // mouseenter per card (measured: 8 enters in one 4s scroll on the
          // merchant's GPU). Scroll is not hover intent — wait for the page
          // to settle, then play for the card the cursor actually rests on.
          if (performance.now() - lastScrollT < 180) {
            card.__hoverIntent = setTimeout(fire, 200);
            return;
          }
          primeAndPlay();
        }, 140);
      });

      card.addEventListener('mouseleave', function () {
        if (card.__hoverIntent) {
          clearTimeout(card.__hoverIntent);
          card.__hoverIntent = null;
        }
        // Defer the pause behind a 280ms grace window. A genuine mouse-away
        // pauses 280ms later (negligible extra decode); a hit-test flicker
        // (Klaviyo re-render, consent banner animation) re-enters within the
        // window, cancels this timer in mouseenter above, and the clip never
        // stops — no still-flash, no restart-from-zero. The scroll-escape and
        // swatch-pick pause paths are untouched (they pause directly).
        if (card.__leaveGrace) clearTimeout(card.__leaveGrace);
        card.__leaveGrace = setTimeout(function () {
          card.__leaveGrace = null;
          video.pause(); // the `pause` listener above removes .is-playing
          video.currentTime = 0;
          var idx = playingCardVideos.indexOf(video);
          if (idx !== -1) playingCardVideos.splice(idx, 1);
        }, 280);
      });
    }

    function bindHoverImageDecode(card) {
      if (!hoverMQ.matches) return; // touch: the hover overlay is display:none
      if (!card || card.__hoverImgBound) return;
      var img = card.querySelector('.casa-product-card__img--hover');
      if (!img || !img.decode) return;
      card.__hoverImgBound = true;
      card.addEventListener('mouseenter', function () {
        // The overlay sits at opacity:0, and a never-painted image is not
        // decoded — so without this nudge the decode + GPU texture upload
        // land on the exact frame the :hover crossfade flips it visible
        // (2026-07-14 240Hz recording: full-frame flashes bracketing the
        // hover swap). decode() is async and idempotent: cold it finishes
        // early in the 400ms fade; warm it resolves immediately.
        img.decode().catch(function () { /* not loaded yet: painter falls back to the old path */ });
      }, { passive: true });
    }

    function bindCard(card) {
      bindHoverVideo(card);
      bindHoverImageDecode(card);
    }

    // Initial pass — bind cards already in the DOM
    document.querySelectorAll('.casa-product-card').forEach(bindCard);

    // Watch for new cards (recommendations API, recently viewed, etc.)
    var cardObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches('.casa-product-card')) {
            bindCard(node);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll('.casa-product-card').forEach(bindCard);
          }
        }
      }
    });
    cardObserver.observe(document.body, { childList: true, subtree: true });

    // ═══════════════════════════════════════════════════════════════════════
    // QUICK ADD — AJAX add then open cart drawer
    // ═══════════════════════════════════════════════════════════════════════
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-casa-add-to-cart]');
      if (!btn || btn.classList.contains('is-loading')) return;

      var variantId = btn.getAttribute('data-casa-add-to-cart');
      var spanEl = btn.querySelector('span');
      var originalText = spanEl ? spanEl.textContent : '';

      btn.classList.add('is-loading');
      btn.disabled = true;
      if (spanEl) spanEl.textContent = 'Adding...';

      waitForCartItemsToSettle()
        .then(function () {
          var sections = cartSectionIds();

          return fetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
              items: [{ id: parseInt(variantId), quantity: 1 }],
              sections: sections.join(','),
              sections_url: window.location.pathname
            })
          });
        })
        .then(function (res) {
          if (!res.ok) throw new Error('Failed');
          return res.json();
        })
        .then(function (data) {
          document.dispatchEvent(new CustomEvent('cart:update', {
            bubbles: true,
            detail: {
              resource: data,
              sourceId: 'casa-product-card',
              data: {
                source: 'quick-add',
                itemCount: cartCountFromSections(data.sections),
                variantId: variantId,
                sections: data.sections || {}
              }
            }
          }));

          if (spanEl) spanEl.textContent = 'Added!';
          var cartBtn = document.querySelector('.casa-header__cart-btn');
          if (cartBtn) cartBtn.click();
          setTimeout(function () {
            if (spanEl) spanEl.textContent = originalText;
            btn.classList.remove('is-loading');
            btn.disabled = false;
          }, 1200);
        })
        .catch(function () {
          if (spanEl) spanEl.textContent = 'Error';
          setTimeout(function () {
            if (spanEl) spanEl.textContent = originalText;
            btn.classList.remove('is-loading');
            btn.disabled = false;
          }, 2000);
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
