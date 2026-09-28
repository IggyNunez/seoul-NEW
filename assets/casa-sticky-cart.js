/**
 * Casa Sticky Cart Component
 * Section-agnostic Apple-style sticky add-to-cart.
 *
 * Mounted globally from layout/theme.liquid on every product page. The
 * observer scans a priority list of buy-button selectors and locks onto
 * the FIRST one found, so the same bar works across:
 *   1. casa-product-main (Casa custom PDP — `.cpm__block--buy`)
 *   2. Stock product-information / blocks/buy-buttons.liquid
 *      (`.buy-buttons-block`)
 *   3. Generic fallback — any cart form's submit button
 * If none match (e.g. on a non-PDP wrapped in casa-sticky-cart by mistake)
 * it early-returns and stays hidden.
 *
 * Cart drawer detection covers both the legacy <dialog> implementation
 * (current cart-drawer.js extends DialogComponent) and the future
 * div-based replacement (cart-drawer-component[open] /
 * cart-drawer-component [data-state="open"]) per CLAUDE.md anti-dialog
 * guidance.
 */

class CasaStickyCart extends HTMLElement {
  constructor() {
    super();
    this.isStuck = false;
    this.isCartOpen = false;
    this.currentQuantity = 1;
    this.buyButtonsObserver = null;
    this.footerObserver = null;
    this.cartDrawerObserver = null;
    this.cartDrawerWatchdog = null;
    this.installmentsObserver = null;
    this.observedTarget = null;
    this.sectionEl = null;
    this.desktopMql = null;
    this.handleBreakpointChange = null;
    this.resizeRaf = null;
    this.handleResize = this.handleResize.bind(this);
    this.lastChromeBottom = -1;
  }

  connectedCallback() {
    // Get refs
    this.stickyBar = this; // bar lives on the host element itself
    this.addToCartButton = this.querySelector('[ref="addToCartButton"]');
    this.productImage = this.querySelector('[ref="productImage"]');
    this.compareDisplay = this.querySelector('[ref="compareDisplay"]');

    if (!this.addToCartButton) return;

    // Strip Shopify-injected installments widget (Shop Pay terms).
    // It's injected after render, so we both scrub now and watch for it.
    this.removeInstallments();
    this.installmentsObserver = new MutationObserver(() => this.removeInstallments());
    this.installmentsObserver.observe(this, { childList: true, subtree: true });

    // Find a buy-button container to observe (priority list)
    const target = this.findBuyButtonsTarget();
    if (!target) {
      // No PDP buy button on this page — bar stays hidden, no error.
      return;
    }
    this.observedTarget = target;

    this.setupBuyButtonsObserver(target);
    this.setupCartDrawerObserver();

    // Wire button click — proxy to the in-page CTA, which already runs
    // through product-form-component / Cart AJAX API.
    this.addToCartButton.addEventListener('click', this.handleAddToCartClick);

    // Cache the add-to-cart label so a later "Sold Out" overwrite can be reverted when
    // an available variant is re-selected (otherwise the label sticks while clickable).
    this.defaultButtonLabel = this.querySelector('[ref="buttonText"]')?.innerHTML ?? null;

    // Listen for variant + quantity changes from the in-page form. Horizon dispatches
    // 'variant:update' (assets/events.js); the old 'variant:changed' name is dispatched
    // by nothing, which is why the bar used to freeze on the first variant.
    document.addEventListener('variant:update', this.handleVariantChange);
    document.addEventListener('quantity:changed', this.handleQuantityChange);

    this.currentQuantity = parseInt(this.dataset.initialQuantity, 10) || 1;

    // Decide compare-at strikethrough visibility once layout has settled.
    // Bar is offscreen (transform: translateY(110%)) so no visible flash.
    requestAnimationFrame(() => this.decideCompareVisibility());

    // Re-decide on resize / rotation. Currency switching reloads the page
    // (Shopify Markets), so currency change is covered by the initial run.
    window.addEventListener('resize', this.handleResize, { passive: true });

    // Reserve the bar's height for --casa-vh-fit consumers (casa-base.css).
    this.publishChromeBottom();
  }

  disconnectedCallback() {
    this.buyButtonsObserver?.disconnect();
    this.footerObserver?.disconnect();
    this.cartDrawerObserver?.disconnect();
    this.cartDrawerWatchdog?.disconnect();
    this.installmentsObserver?.disconnect();
    this.addToCartButton?.removeEventListener('click', this.handleAddToCartClick);
    document.removeEventListener('variant:update', this.handleVariantChange);
    document.removeEventListener('quantity:changed', this.handleQuantityChange);
    window.removeEventListener('resize', this.handleResize);
    if (this.handleBreakpointChange) {
      this.desktopMql?.removeEventListener('change', this.handleBreakpointChange);
    }
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);
    // Release the chrome reservation — the next page/section may have no bar.
    document.body.style.removeProperty('--casa-chrome-bottom');
    document.documentElement.style.removeProperty('--casa-chrome-bottom');
    this.lastChromeBottom = -1;
    // Tear down any in-flight add-confirmation state so a listener/timer can't fire
    // on a detached element after a mid-add unmount (theme editor churn).
    this.disarmAddFailureCancel();
    clearTimeout(this.addedResetId);
  }

  handleResize() {
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);
    this.resizeRaf = requestAnimationFrame(() => {
      this.decideCompareVisibility();
      this.publishChromeBottom();
      this.resizeRaf = null;
    });
  }

  /**
   * Publish the bar's height onto --casa-chrome-bottom — on BOTH <html>
   * and <body>, the same dual-write casa-header.liquid uses for
   * --header-height — so sections sized with --casa-vh-fit
   * (assets/casa-base.css) reserve space for the bar. Deliberately
   * constant while mounted: the bar sliding in/out on scroll must not
   * re-flow section heights mid-scroll. Only writes when the value
   * changes — body/:root style writes invalidate the whole document.
   */
  publishChromeBottom() {
    const h = Math.round(this.offsetHeight || 0);
    if (h === this.lastChromeBottom) return;
    this.lastChromeBottom = h;
    document.body.style.setProperty('--casa-chrome-bottom', h + 'px');
    document.documentElement.style.setProperty('--casa-chrome-bottom', h + 'px');
  }

  /**
   * Decide whether to show the compare-at strikethrough on the sticky bar.
   *
   * The CSS locks the meta row to one line (variant ellipses, price is
   * flex-shrink: 0, compare is flex-shrink: 0). So the decision is no
   * longer "does this wrap" — it's "does adding the strikethrough force
   * the variant name to ellipsis?" That's the meaningful signal: the
   * variant string IS the information the shopper needs to know they
   * configured the right thing. The strikethrough is anchor-pricing
   * decoration. Never trade information for decoration.
   *
   * Two gates, both must pass:
   *   1. Currency is USD or CAD. Wider currencies (JPY/KRW/IDR/VND/CLP/etc.)
   *      have numeric strings ~50% longer and would force the variant to
   *      ellipsis even when it fits cleanly in USD/CAD.
   *   2. Variant fits without ellipsis WHEN compare is shown. We check
   *      with compare hidden first; if already ellipsised, the variant
   *      name itself is the driver and adding compare can only make
   *      truncation worse. Then we try with compare shown — if it forces
   *      ellipsis, hide the compare. (Detection: scrollWidth > clientWidth
   *      on the variant element.)
   *
   * Re-runs from connectedCallback, handleVariantChange, and resize.
   */
  decideCompareVisibility() {
    // Always measure against a fully-revealed variant — a variant left
    // hidden by a previous pass (narrower width, wider currency) would
    // make everything below read as "fits" and never come back.
    const variantReset = this.querySelector('.casa-sticky-cart__variant');
    if (variantReset) variantReset.hidden = false;

    const compare = this.compareDisplay;
    const meta = compare?.parentElement;
    if (!compare || !meta) {
      this.decideVariantVisibility();
      return;
    }

    const hasCompare =
      compare.dataset.hasCompare === 'true' &&
      compare.textContent.trim().length > 0;
    if (!hasCompare) {
      compare.setAttribute('hidden', '');
      this.decideVariantVisibility();
      return;
    }

    const currency = window.Shopify?.currency?.active;
    if (currency !== 'USD' && currency !== 'CAD') {
      compare.setAttribute('hidden', '');
      this.decideVariantVisibility();
      return;
    }

    const variantEl = meta.querySelector('.casa-sticky-cart__variant');
    if (!variantEl) {
      // Single-variant product (no .__variant emitted by Liquid). Nothing
      // to truncate, just show compare for the allowed currencies.
      compare.removeAttribute('hidden');
      return;
    }

    // Step 1: hide compare, check if variant alone already ellipses.
    compare.setAttribute('hidden', '');
    if (variantEl.scrollWidth > variantEl.clientWidth + 1) {
      this.decideVariantVisibility();
      return; // already truncated; adding compare would worsen it
    }

    // Step 2: variant fits naturally without compare. Try with compare;
    // if it forces ellipsis, hide compare again.
    compare.removeAttribute('hidden');
    if (variantEl.scrollWidth > variantEl.clientWidth + 1) {
      compare.setAttribute('hidden', '');
    }

    this.decideVariantVisibility();
  }

  /**
   * All-or-nothing variant label — same rule the compare-at strikethrough
   * already follows: show it whole, or not at all. Never a stub.
   *
   * Merchant lock (2026-08-13): nothing important may be chopped at any
   * price, device or width. On the narrowest phones with the widest
   * currency there is genuinely not enough room for all three of variant,
   * price and CTA — measured on the 118.1"/300cm neon sign in VND at
   * 280px (Galaxy Fold, folded): the variant needed 77px and had 41, so
   * it rendered as a meaningless `118…`. A fixed CSS breakpoint can't
   * decide this, because whether it fits depends on the currency and the
   * variant string, not the viewport alone — so measure and decide.
   *
   * Price and CTA always win: the price is the number the shopper came
   * back for, and the CTA is the whole point of the bar. The variant is
   * the one that yields, and it stays selected and visible in the buy box
   * further up the page.
   */
  decideVariantVisibility() {
    const variantEl = this.querySelector('.casa-sticky-cart__variant');
    if (!variantEl) return;

    // Reveal first so the measurement reflects the real required width.
    variantEl.hidden = false;
    if (variantEl.scrollWidth > variantEl.clientWidth + 1) {
      variantEl.hidden = true;
    }
  }

  /**
   * Walk the priority list of buy-button selectors. Return the first
   * element found. Section-agnostic — works on every PDP variant.
   *
   * @returns {Element | null}
   */
  findBuyButtonsTarget() {
    const selectors = [
      // 1) Casa custom PDP (sections/casa-product-main.liquid)
      '.cpm__block--buy',
      // 2) Stock Shopify product-information + blocks/buy-buttons.liquid
      '.buy-buttons-block',
      // 3) Forward-compat: explicit data attribute pattern
      '[data-shopify-pdp] form[action*="/cart/add"]',
      // 4) Generic fallback — any add-to-cart form button
      'form[action*="/cart/add"] button[type="submit"][name="add"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /**
   * Strip Shopify-injected Shop Pay installments markup. CSS alone
   * doesn't reliably hide it because the host element renders shadow
   * DOM and reserves height.
   */
  removeInstallments() {
    this.querySelectorAll(
      '.price-installments, shopify-payment-terms, payment-terms, [id^="installments-form"]'
    ).forEach((el) => el.remove());
  }

  /**
   * IntersectionObserver — show bar ONLY when the shopper has scrolled
   * PAST the gate element (its bottom edge is above the viewport).
   * Hide it when the gate scrolls back into view. A separate footer
   * observer hides at the very bottom of the page so the sticky bar
   * doesn't sit on the footer.
   *
   * The gate is breakpoint-dependent:
   *   - Desktop (≥750px, two-column PDP with sticky media gallery):
   *     the whole product section (`.shopify-section` ancestor). The
   *     sticky gallery keeps the product pinned on screen while the
   *     details column scrolls, so the buy BUTTON leaves the viewport
   *     long before the product does — gating on the button made the
   *     bar appear while the gallery + specs were still fully visible.
   *   - Mobile (<750px, single column, no sticky gallery): the buy
   *     button itself, so the bar appears as soon as the CTA is passed.
   *
   * Both elements are observed; every observer fire re-evaluates
   * against whichever gate the current breakpoint selects.
   *
   * Matches Horizon stock <sticky-add-to-cart> behavior on mobile. The
   * earlier "also fire when CTA is below the fold on page load" variant
   * was reverted: on iOS the visible viewport is small (URL bar takes
   * space) so `rect.top > viewportHeight` was true on first paint for
   * almost every PDP, making the sticky bar appear without any user
   * scroll. If a PDP's in-page CTA is below the fold on load, fix
   * THAT (tighter variant cards) — don't paper over it with a
   * persistent sticky bar.
   *
   * @param {Element} target
   */
  setupBuyButtonsObserver(target) {
    this.sectionEl = target.closest('.shopify-section');
    this.desktopMql = window.matchMedia('(min-width: 750px)');
    this.handleBreakpointChange = () => this.evaluateStickyState();
    this.desktopMql.addEventListener('change', this.handleBreakpointChange);

    this.buyButtonsObserver = new IntersectionObserver(() =>
      this.evaluateStickyState()
    );
    this.buyButtonsObserver.observe(target);
    if (this.sectionEl) this.buyButtonsObserver.observe(this.sectionEl);

    // Prefer the real page footer; the loose fallback is only a last resort
    // because showStickyBar() now uses this element as a hard show-suppression
    // gate (not just an extra hide), so it must be the actual footer.
    const footer =
      document.querySelector('footer.casa-footer') ||
      document.querySelector('footer') ||
      document.querySelector('[class*="footer"]');
    this.footerEl = footer;
    if (footer) {
      this.footerObserver = new IntersectionObserver(
        (entries) => {
          const [entry] = entries;
          if (!entry) return;
          // The footer observer ONLY hides the bar — it never re-shows it.
          // The old reshow branch re-fired on the iOS Safari URL-bar
          // viewport-height change (which retriggers this IntersectionObserver
          // around the footer's top edge), popping the bar back over the
          // footer / guarantees band. Once hidden at the footer the bar stays
          // hidden until the in-page buy box scrolls back into view (handled
          // by the buy-buttons observer above). showStickyBar() also guards
          // against showing while the footer is on screen, so a spurious
          // observer fire during an iOS viewport resize can't reappear it.
          if (entry.isIntersecting && this.isStuck) {
            this.hideStickyBar();
          }
        },
        { rootMargin: '200px 0px 0px 0px' }
      );
      this.footerObserver.observe(footer);
    }
  }

  /**
   * Watch the cart drawer for open/close — hide the sticky bar while
   * the drawer is open. Covers three implementations:
   *   - <cart-drawer-component> with nested <dialog> (current Horizon)
   *   - <cart-drawer-component open> (future div-based, per CLAUDE.md)
   *   - <cart-drawer-component> with [data-state="open"] (alt pattern)
   */
  setupCartDrawerObserver() {
    if (this.dataset.hideWhenCartOpen !== 'true') return;

    const findDrawerTargets = () => {
      const host = document.querySelector('cart-drawer-component');
      if (!host) return null;
      const dialog = host.querySelector('dialog');
      // Return the most-specific watchable element. Prefer dialog
      // (today's reality), fall back to host attributes.
      return { host, dialog };
    };

    const start = (targets) => {
      if (!targets) return;
      const { host, dialog } = targets;
      const evaluate = () => {
        const open = Boolean(
          (dialog && dialog.hasAttribute('open')) ||
            host.hasAttribute('open') ||
            host.getAttribute('data-state') === 'open' ||
            host.querySelector('[data-state="open"]')
        );
        this.isCartOpen = open;
        this.dataset.cartOpen = open ? 'true' : 'false';
      };

      this.cartDrawerObserver = new MutationObserver(evaluate);
      // Observe both the dialog (if present) and the host. Cheap, and
      // covers all three implementations without branching.
      if (dialog) {
        this.cartDrawerObserver.observe(dialog, {
          attributes: true,
          attributeFilter: ['open'],
        });
      }
      this.cartDrawerObserver.observe(host, {
        attributes: true,
        attributeFilter: ['open', 'data-state'],
        subtree: false,
      });

      evaluate(); // set initial state
    };

    const targets = findDrawerTargets();
    if (targets) {
      start(targets);
      return;
    }

    // Drawer not yet in DOM — watch <body> until it appears, then bind.
    this.cartDrawerWatchdog = new MutationObserver(() => {
      const found = findDrawerTargets();
      if (found && !this.cartDrawerObserver) {
        start(found);
        this.cartDrawerWatchdog?.disconnect();
        this.cartDrawerWatchdog = null;
      }
    });
    this.cartDrawerWatchdog.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Single source of truth for stuck/unstuck. Reads the gate element's
   * live rect instead of trusting a (possibly stale) observer entry —
   * an observer fire on the buy button must not show the bar on desktop
   * while the section is still on screen, and vice versa.
   */
  evaluateStickyState() {
    const gate =
      this.desktopMql?.matches && this.sectionEl
        ? this.sectionEl
        : this.observedTarget;
    // A detached gate (theme-editor section re-render, combined-listing
    // variant swap morphing <main>) returns an all-zero rect, which would
    // read as "passed" and falsely show the bar. Bail instead.
    if (!gate || !gate.isConnected) return;

    const passed = gate.getBoundingClientRect().bottom <= 0;
    if (passed && !this.isStuck) {
      this.showStickyBar();
    } else if (!passed && this.isStuck) {
      this.hideStickyBar();
    }
  }

  showStickyBar() {
    if (this.isCartOpen) return;
    // Never show while the footer is in view (or imminent). On short pages the
    // footer is already on screen by the time the buy box scrolls off, so the
    // bar simply never appears — which is correct. On long pages it shows in
    // the scroll body and stays hidden through the footer. This is the load-
    // bearing guard against iOS URL-bar viewport-height changes: those fire the
    // IntersectionObservers spuriously around the footer boundary, and without
    // this check the bar would pop back over the guarantees band.
    if (this.footerEl && this.footerEl.getBoundingClientRect().top <= window.innerHeight) return;
    this.isStuck = true;
    this.dataset.stuck = 'true';
  }

  hideStickyBar() {
    this.isStuck = false;
    this.dataset.stuck = 'false';
  }

  /**
   * Click the in-page CTA. Don't reimplement the cart submission —
   * the in-page product-form-component has all the variant/quantity
   * state and runs through the Cart AJAX API + Section Rendering API.
   */
  handleAddToCartClick = () => {
    const productId = this.dataset.productId;
    // Try the most specific selector first — Casa PDP — then stock.
    const inPageCta =
      document.querySelector(
        `.cpm [data-product-id="${productId}"] [ref="addToCartButton"]`
      ) ||
      document.querySelector(
        `product-form-component[data-product-id="${productId}"] [ref="addToCartButton"]`
      ) ||
      document.querySelector(
        `product-form-component[data-product-id="${productId}"] button[type="submit"]`
      ) ||
      document.querySelector(
        `form[action*="/cart/add"] button[type="submit"][name="add"]`
      );

    // If we can't find the in-page CTA there is nothing to add — don't show a
    // false "Added!".
    if (!inPageCta) return;

    // Show "Added!" immediately for responsive feedback, then CANCEL it only if the
    // add actually fails. We key off `cart:error` (product-form dispatches it ONLY on
    // a hard failure — sold out / network / nothing added), NOT `cart:update`: every
    // cart mutation on the page bubbles `cart:update`, so triggering on it would flash
    // a false "Added!" for an unrelated quantity or discount change elsewhere. A
    // max-quantity clamp still adds the item and fires `cart:update` (not `cart:error`),
    // so its confirmation is correctly kept.
    this.showAddedConfirmation();
    this.armAddFailureCancel();

    inPageCta.click();
  };

  /** Flash the "Added!" state and auto-reset it. */
  showAddedConfirmation() {
    this.addToCartButton.dataset.added = 'true';
    clearTimeout(this.addedResetId);
    this.addedResetId = setTimeout(() => {
      this.addToCartButton.dataset.added = 'false';
    }, 1800);
  }

  /** Listen briefly for a hard add failure and revert the optimistic confirmation. */
  armAddFailureCancel() {
    this.disarmAddFailureCancel();
    this.onAddFailure = () => {
      this.addToCartButton.dataset.added = 'false';
      clearTimeout(this.addedResetId);
      this.disarmAddFailureCancel();
    };
    document.addEventListener('cart:error', this.onAddFailure);
    // Auto-disarm after the confirmation window so the listener never lingers.
    this.addFailureWindowId = setTimeout(() => this.disarmAddFailureCancel(), 2000);
  }

  /** Remove the cart:error listener and its window timer. */
  disarmAddFailureCancel() {
    if (this.onAddFailure) {
      document.removeEventListener('cart:error', this.onAddFailure);
      this.onAddFailure = null;
    }
    clearTimeout(this.addFailureWindowId);
  }

  handleVariantChange = (event) => {
    // Horizon's VariantUpdateEvent carries the variant at `event.detail.resource`
    // (NOT `.variant`), and `resource` is null when the chosen combination is unavailable
    // (combined listings). The old code read `.variant` off a never-dispatched event
    // name, so this handler never ran and the bar froze on the first variant.
    const variant = event.detail?.resource ?? null;

    const buttonText = this.querySelector('[ref="buttonText"]');
    const variantDisplay = this.querySelector('[ref="variantDisplay"]');

    // Unavailable combination: no variant object — reflect sold-out and don't add.
    if (!variant) {
      this.dataset.variantAvailable = 'false';
      this.addToCartButton.disabled = true;
      if (buttonText) buttonText.innerHTML = '<span>Sold Out</span>';
      return;
    }

    this.dataset.variantAvailable = variant.available ? 'true' : 'false';
    this.dataset.currentVariantId = variant.id;

    if (variant.available) {
      this.addToCartButton.disabled = false;
      // Restore the real add-to-cart label — a previous sold-out selection may have
      // overwritten it with "Sold Out", which otherwise sticks while the button is live.
      if (buttonText && this.defaultButtonLabel != null) {
        buttonText.innerHTML = this.defaultButtonLabel;
      }
    } else {
      this.addToCartButton.disabled = true;
      if (buttonText) {
        buttonText.innerHTML = '<span>Sold Out</span>';
      }
    }

    // Market-aware price + compare-at (presentment currency). Sourced from the
    // casa-qv-price-data SRA fragment so it matches the buy box on EVERY
    // template — several custom PDPs render no <product-price> element to read
    // a price out of, so parsing event.detail.data.html is not reliable.
    this.applyVariantPrice(variant);

    // Update variant identity (helps the user know what they configured
    // when scrolled away from the buy box). Element only exists on
    // multi-variant products; skip silently if missing.
    if (variantDisplay && variant.title) {
      variantDisplay.textContent = variant.title;
    }

    // Update featured image if variant has one (detailed layout only)
    if (variant.featured_image && this.productImage) {
      this.productImage.src = variant.featured_image.src;
      this.productImage.alt = variant.featured_image.alt || variant.title;
    }
  };

  handleQuantityChange = (event) => {
    const quantity = event.detail?.quantity;
    if (!quantity) return;
    this.currentQuantity = quantity;
  };

  /**
   * Update the sticky bar's price + compare-at for a variant using the
   * presentment-currency strings from the casa-qv-price-data SRA fragment
   * (rendered server-side by Liquid's `money` filter in the buyer's active
   * Market — correct and byte-identical to the buy box in EUR/VND/etc.).
   * Uses the `_plain` (no currency-code) fields to match this bar's own
   * `{{ variant.price | money }}` initial render.
   *
   * The map is fetched lazily; on the first variant change it may not be
   * loaded yet, so we render the formatMoney fallback immediately and
   * re-apply the exact string once the fetch resolves.
   *
   * @param {object} variant
   */
  applyVariantPrice(variant) {
    if (!variant) return;
    this.lastPricedVariant = variant;

    const priceDisplay = this.querySelector('[ref="priceDisplay"]');
    const compareDisplay = this.querySelector('[ref="compareDisplay"]');
    const mapped = this.priceMap ? this.priceMap[String(variant.id)] : null;

    if (priceDisplay && this.dataset.variantAvailable === 'true') {
      if (mapped && mapped.price_plain) {
        priceDisplay.textContent = mapped.price_plain;
      } else if (typeof variant.price === 'number') {
        // Fallback (base formatter) — only until the SRA map resolves.
        priceDisplay.textContent = this.formatMoney(variant.price);
      }
    }

    if (compareDisplay) {
      let compareText = '';
      if (mapped) {
        compareText = mapped.compare_plain || '';
      } else if (typeof variant.compare_at_price === 'number' && variant.compare_at_price > variant.price) {
        compareText = this.formatMoney(variant.compare_at_price);
      }
      if (compareText) {
        compareDisplay.textContent = compareText;
        compareDisplay.dataset.hasCompare = 'true';
      } else {
        compareDisplay.textContent = '';
        delete compareDisplay.dataset.hasCompare;
      }
      this.decideCompareVisibility();
    }

    // Map not loaded yet → fetch once, then re-apply for whatever variant is
    // currently selected. The `this.priceMap` guard means the re-entry won't
    // loop (the map is set by then).
    if (!this.priceMap) {
      this.ensurePriceMap().then(() => {
        if (this.lastPricedVariant) this.applyVariantPrice(this.lastPricedVariant);
      });
    }
  }

  /**
   * Fetch (once, cached) the casa-qv-price-data fragment for the current
   * product and parse its variant → price-string map. The sticky bar lives
   * on the product page, so `location.pathname` IS the product URL; the
   * fragment renders in the same Market context. Resolves to {} on failure
   * so callers keep the formatMoney fallback.
   *
   * @returns {Promise<Object>}
   */
  ensurePriceMap() {
    if (this.priceMap) return Promise.resolve(this.priceMap);
    if (this.priceMapPromise) return this.priceMapPromise;
    const url = window.location.pathname + '?section_id=casa-qv-price-data';
    this.priceMapPromise = fetch(url)
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => {
        const doc = new DOMParser().parseFromString(t, 'text/html');
        const script = doc.querySelector('[data-casa-qv-price-data]');
        this.priceMap = script ? JSON.parse(script.textContent || '{}').variants || {} : {};
        return this.priceMap;
      })
      .catch(() => {
        this.priceMap = {};
        return this.priceMap;
      });
    return this.priceMapPromise;
  }

  /**
   * Minimal money formatter — uses Shopify's currency settings if
   * available, otherwise falls back to a basic dollar format.
   *
   * @param {number} cents
   * @returns {string}
   */
  formatMoney(cents) {
    const value = (cents / 100).toFixed(2);
    if (window.Shopify?.currency?.active) {
      // Best-effort: prepend the storefront's currency code/symbol
      const code = window.Shopify.currency.active;
      // Common case: USD/CAD/AUD — '$' prefix. Otherwise show the code.
      if (['USD', 'CAD', 'AUD', 'NZD', 'SGD'].includes(code)) {
        return `$${value}`;
      }
      return `${value} ${code}`;
    }
    return `$${value}`;
  }
}

if (!customElements.get('casa-sticky-cart')) {
  customElements.define('casa-sticky-cart', CasaStickyCart);
}
