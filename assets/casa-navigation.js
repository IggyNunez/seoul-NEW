/**
 * Seoul Glow Lab - Navigation Controller
 * Handles mobile drawer, submenu panels, and keyboard interactions.
 * Standalone vanilla JS — no Horizon Component dependency.
 */

(function () {
  'use strict';

  // Wrapped in an init so a theme-editor header re-render (which replaces
  // #casa-drawer and every trigger button) can re-bind against the fresh
  // nodes; the marker keeps a surviving drawer from double-binding.
  function casaNavInit() {

  // ── Elements ──────────────────────────────────────────────────────
  const drawer = document.getElementById('casa-drawer');
  const overlay = document.getElementById('casa-drawer-overlay');
  const body = document.body;

  if (!drawer || !overlay) return;
  if (drawer.dataset.casaNavBound) return;
  drawer.dataset.casaNavBound = '1';

  // ── Drawer Toggle ─────────────────────────────────────────────────
  // iOS tap-stall rules (2026-07-04): the tap handler mutates classes and
  // NOTHING else synchronously. Focus forces a full-document style+layout
  // flush, and the 72px frost must not exist while the panel is moving
  // (a sliding backdrop-filter re-blurs every frame) — so focus is
  // deferred past first paint and the frost is gated on .is-settled,
  // added once the 200ms slide is over.
  // Settle must land after the slowest gated transition: drawer/submenu
  // slide is 200ms, the overlay fade it also gates is 300ms — a shorter
  // value would composite the overlay's live blur under a tweening opacity.
  const SLIDE_MS = 300;

  // iOS Bug C (ghost click): ~300ms after pointerup Safari dispatches a
  // synthetic click at the original tap coordinates — by then the drawer
  // has slid away and the click lands on page content behind it. Capture-
  // phase shield swallows out-of-drawer clicks for 800ms after any drawer
  // action (mirrors sections/casa-collection-main.liquid, 974b416/ce5bfc7).
  //
  // The allow-list MUST also exempt every surface a drawer action opens on
  // top of the nav drawer, or the shield eats that surface's first taps:
  //   • #casa-localization-drawer + .casa-locale-backdrop — currency picker
  //     (opened from the in-drawer locale footer).
  //   • #search-modal, cart-drawer-component — the Search / Cart quick actions.
  // Each runs closeDrawer() (which re-arms the shield) then opens its surface;
  // without the exemption every tap on that surface in the ~800ms window is
  // stopPropagation'd in capture phase — the control silently does nothing and
  // it reads as "needs two taps" on mobile.
  //
  // Exemption is only ghost-safe when the surface opens AFTER the ~300ms iOS
  // ghost-click (GHOST_SAFE_OPEN_DELAY) — otherwise the ghost could land on a
  // now-visible control and fire it. The currency drawer already defers 350ms
  // (sections/casa-header.liquid); the quick actions below match it.
  const SHIELD_ALLOW =
    '#casa-drawer, #casa-drawer-overlay, .casa-submenu-panel, [data-casa-drawer-toggle], ' +
    '#casa-localization-drawer, .casa-locale-backdrop, #search-modal, cart-drawer-component';
  const GHOST_SAFE_OPEN_DELAY = 350;
  let shieldUntil = 0;
  let freshTouchTarget = null;
  function armClickShield() {
    shieldUntil = performance.now() + 800;
    freshTouchTarget = null;
  }
  function touchControl(target) {
    return target instanceof Element
      ? target.closest('button, a, input, select, textarea, [role="button"]') || target
      : null;
  }
  document.documentElement.addEventListener('pointerdown', function (e) {
    if (performance.now() > shieldUntil || !e.isTrusted || !e.isPrimary || e.pointerType !== 'touch') return;
    freshTouchTarget = touchControl(e.target);
  }, true);
  document.documentElement.addEventListener('pointercancel', function () {
    freshTouchTarget = null;
  }, true);
  document.documentElement.addEventListener('click', function (e) {
    if (performance.now() > shieldUntil) return;
    if (e.target.closest(SHIELD_ALLOW)) return;
    if (freshTouchTarget && touchControl(e.target) === freshTouchTarget) {
      freshTouchTarget = null;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }, true);

  function scheduleSettle(el) {
    clearTimeout(el.__casaSettleTimer);
    el.__casaSettleTimer = setTimeout(function () {
      if (el.classList.contains('active')) el.classList.add('is-settled');
    }, SLIDE_MS);
  }

  function unsettle(el) {
    clearTimeout(el.__casaSettleTimer);
    el.classList.remove('is-settled');
  }

  function afterPaint(fn) {
    requestAnimationFrame(function () { requestAnimationFrame(fn); });
  }

  function setToggleExpanded(expanded) {
    document.querySelectorAll('[data-casa-drawer-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }

  // casa-offscreen-pause gates on body.casa-drawer-active (videos behind
  // the open drawer keep re-invalidating the frost's backdrop every video
  // frame). Deferred so the fetchless tap frame stays clean.
  function refreshVideoGate() {
    if (window.casa && typeof window.casa.offscreenPauseRefresh === 'function') {
      window.casa.offscreenPauseRefresh();
    }
  }

  /* Background scroll lock. `overflow: hidden` alone does NOT stop touch
     scrolling on iOS — the page kept moving behind the open drawer (merchant
     recording 2026-08-18), and opening the drawer jerked the page underneath
     by up to 202px. This is the same full lock the collection filter drawer
     needed on a real iPhone (9bc4b6d): pin the body, hold the scroll offset
     visually with a negative top, and put it back on close. Paired with
     `overscroll-behavior: contain` on .casa-drawer__content so a swipe that
     reaches either end of the menu cannot chain out to the page — together
     they make the menu the only scrollable surface while it is open. */
  let savedScrollY = 0;

  function openDrawer() {
    armClickShield();
    savedScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    drawer.classList.add('active');
    overlay.classList.add('active');
    body.classList.add('casa-drawer-active');
    body.style.top = '-' + savedScrollY + 'px';
    body.classList.add('casa-nav-drawer-locked');
    body.style.overflow = 'hidden';
    setToggleExpanded(true);
    scheduleSettle(drawer);
    scheduleSettle(overlay);
    afterPaint(function () {
      if (!drawer.classList.contains('active')) return;
      refreshVideoGate();
      const firstFocusable = drawer.querySelector('button, a, [tabindex]');
      if (firstFocusable) firstFocusable.focus({ preventScroll: true });
    });
  }

  function closeDrawer() {
    armClickShield();
    // Close any open submenus first
    closeAllSubmenus();
    drawer.classList.remove('active');
    overlay.classList.remove('active');
    unsettle(drawer); // slide-out runs blur-free
    unsettle(overlay);
    body.classList.remove('casa-drawer-active');
    /* Unlock in this order: drop the locked class FIRST (which strips
       position: fixed), clear the offset, then jump back to where the
       customer was — otherwise the page lands at the top. */
    body.classList.remove('casa-nav-drawer-locked');
    body.style.top = '';
    body.style.overflow = '';
    window.scrollTo(0, savedScrollY);
    setToggleExpanded(false);
    // iOS Bug D (paint stall): force a layout read + explicit inline
    // transform in the same task as the class toggle so WebKit commits the
    // closed position now, then release the override across two frames so
    // the CSS class owns the next open (ce5bfc7 pattern).
    void drawer.offsetWidth;
    drawer.style.transform = 'translateX(-100%)';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        drawer.style.transform = '';
      });
    });
    afterPaint(function () {
      refreshVideoGate();
      // Return focus to the toggle button — unless something else (search
      // modal, cart drawer via the quick actions) already took focus.
      const ae = document.activeElement;
      if (ae && ae !== document.body && !drawer.contains(ae)) return;
      const toggle = document.querySelector('.casa-menu-toggle');
      if (toggle) toggle.focus({ preventScroll: true });
    });
  }

  function toggleDrawer() {
    if (drawer.classList.contains('active')) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  // ── Submenu Panels ────────────────────────────────────────────────
  function setSubmenuTriggerExpanded(id, expanded) {
    const trigger = document.querySelector('[data-casa-submenu-open="' + id + '"]');
    if (trigger) trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function openSubmenu(id) {
    // Close any other open submenu first — defensive against double-
    // active state where two submenus could stack with their partial-
    // frost panels letting the drawer's chevrons bleed through.
    closeAllSubmenus();
    const panel = document.getElementById('casa-submenu-' + id);
    if (panel) {
      panel.classList.add('active');
      setSubmenuTriggerExpanded(id, true);
      // Body class lets us hide the parent drawer behind the open
      // submenu (otherwise its top-row chevrons bleed through the
      // partial-frost panel).
      body.classList.add('casa-submenu-active');
      scheduleSettle(panel);
      // Focus the back button — deferred past first paint (focus forces
      // a synchronous full-document layout flush inside the tap frame).
      afterPaint(function () {
        if (!panel.classList.contains('active')) return;
        const backBtn = panel.querySelector('.casa-submenu-back');
        if (backBtn) backBtn.focus({ preventScroll: true });
      });
    }
  }

  function closeSubmenu(id) {
    const panel = document.getElementById('casa-submenu-' + id);
    if (panel) {
      panel.classList.remove('active');
      unsettle(panel);
      setSubmenuTriggerExpanded(id, false);
      // The closing panel goes visibility:hidden, which drops keyboard/
      // VoiceOver focus to <body>. Hand it back to the submenu's trigger —
      // unless focus already moved somewhere deliberate.
      afterPaint(function () {
        const ae = document.activeElement;
        if (ae && ae !== document.body && !panel.contains(ae)) return;
        const trigger = document.querySelector('[data-casa-submenu-open="' + id + '"]');
        if (trigger) trigger.focus({ preventScroll: true });
      });
    }
    // If no submenus remain active, drop the body class so the
    // parent drawer becomes visible again.
    if (!document.querySelector('.casa-submenu-panel.active')) {
      body.classList.remove('casa-submenu-active');
    }
  }

  function closeAllSubmenus() {
    const panels = document.querySelectorAll('.casa-submenu-panel.active');
    panels.forEach(function (panel) {
      panel.classList.remove('active');
      unsettle(panel);
      // Panel id format: 'casa-submenu-<handle>' — strip prefix for trigger lookup.
      var handle = panel.id.replace(/^casa-submenu-/, '');
      setSubmenuTriggerExpanded(handle, false);
    });
    body.classList.remove('casa-submenu-active');
  }

  // ── Event Listeners ───────────────────────────────────────────────

  // Overlay click closes drawer
  overlay.addEventListener('click', closeDrawer);

  // Drawer toggle buttons
  document.querySelectorAll('[data-casa-drawer-toggle]').forEach(function (btn) {
    btn.addEventListener('click', toggleDrawer);
  });

  // Drawer close buttons
  document.querySelectorAll('[data-casa-drawer-close]').forEach(function (btn) {
    btn.addEventListener('click', closeDrawer);
  });

  // Submenu open triggers
  document.querySelectorAll('[data-casa-submenu-open]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = this.getAttribute('data-casa-submenu-open');
      openSubmenu(id);
    });
  });

  // Submenu close (back) buttons
  document.querySelectorAll('[data-casa-submenu-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = this.getAttribute('data-casa-submenu-close');
      closeSubmenu(id);
    });
  });

  // Quick-action: Search → close drawer + open the same search modal
  // the header search button uses (`<dialog id="search-modal">`).
  document.querySelectorAll('[data-casa-drawer-quick-search]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      closeDrawer();
      // Open AFTER the ~300ms iOS ghost-click (GHOST_SAFE_OPEN_DELAY): the
      // shield now exempts #search-modal, so opening earlier would let the
      // ghost tap a search control. Also lets the drawer-close transition
      // finish before the modal layers on top.
      setTimeout(function () {
        var modal = document.getElementById('search-modal');
        if (modal && typeof modal.showModal === 'function') {
          // <dialog> native API. Use showModal to get the backdrop.
          if (!modal.open) modal.showModal();
        } else if (modal && typeof modal.showDialog === 'function') {
          // Some Horizon builds expose showDialog instead.
          modal.showDialog();
        } else {
          // Fallback: trigger the header search button so its
          // existing on:click handler runs.
          var headerSearch = document.querySelector('.casa-header__btn[aria-label="Search"], button[aria-label="Search"]:not([data-casa-drawer-quick-search])');
          if (headerSearch) headerSearch.click();
        }
      }, GHOST_SAFE_OPEN_DELAY);
    });
  });

  // Quick-action: Cart → close drawer + open the same cart drawer
  // the header cart button uses (`<cart-drawer-component>`).
  document.querySelectorAll('[data-casa-drawer-quick-cart]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      closeDrawer();
      // Open AFTER the ~300ms iOS ghost-click (GHOST_SAFE_OPEN_DELAY): the
      // shield now exempts cart-drawer-component, so opening earlier would let
      // the ghost tap a cart control (checkout / remove / close).
      setTimeout(function () {
        var cartDrawer = document.querySelector('cart-drawer-component');
        if (cartDrawer && typeof cartDrawer.open === 'function') {
          cartDrawer.open();
        } else {
          // Fallback: click the existing header cart button if found.
          var headerCart = document.querySelector('.casa-header__cart-btn');
          if (headerCart) {
            headerCart.click();
          } else {
            // Last resort: navigate to the cart page.
            window.location.href = '/cart';
          }
        }
      }, GHOST_SAFE_OPEN_DELAY);
    });
  });

  // ── Keyboard Handling ─────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (!drawer.isConnected) return; // stale init after a header re-render
    if (e.key === 'Escape') {
      // Close topmost open submenu first, then drawer
      var openPanel = document.querySelector('.casa-submenu-panel.active');
      if (openPanel) {
        var handle = openPanel.id.replace(/^casa-submenu-/, '');
        closeSubmenu(handle);
      } else if (drawer.classList.contains('active')) {
        closeDrawer();
      }
    }
  });

  // ── Expose globally for inline onclick handlers (optional) ───────
  window.CasaNav = {
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    toggleDrawer: toggleDrawer,
    openSubmenu: openSubmenu,
    closeSubmenu: closeSubmenu,
  };
  }

  casaNavInit();
  // Theme editor: a header re-render replaces the drawer + triggers.
  document.addEventListener('shopify:section:load', function () { casaNavInit(); });
})();

/* ── A11y cleanup: aria-hide empty product-card link wrappers ────
   Shopify auto-injects <a class="casa-product-card__link"> wrappers
   inside product card info blocks (see comment in
   snippets/casa-product-card.liquid:989). Some of those wrappers
   render with no children — the legit image-wrapping link covers
   the click target, the empty inner wrapper just duplicates the
   href without adding usable content. Lighthouse "Agentic Browsing"
   and axe both flag these as "Links must have discernible text."

   Fix: when a .casa-product-card__link has no text content AND no
   child elements, hide it from the accessibility tree. Click-through
   still works (the other wrapping <a> covers the card). */
(function () {
  'use strict';
  function hideEmptyCardLinks(root) {
    var links = (root || document).querySelectorAll('a.casa-product-card__link');
    links.forEach(function (a) {
      var hasText = (a.textContent || '').trim().length > 0;
      var hasChildren = a.children.length > 0;
      if (!hasText && !hasChildren) {
        a.setAttribute('aria-hidden', 'true');
        a.setAttribute('tabindex', '-1');
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { hideEmptyCardLinks(); });
  } else {
    hideEmptyCardLinks();
  }
  /* Re-run on shopify:section:load so theme-editor section reloads
     pick up the cleanup. Cheap — querySelectorAll is fast. */
  document.addEventListener('shopify:section:load', function (e) {
    hideEmptyCardLinks(e.target);
  });
})();
