import { Component } from '@theme/component';
import {
  fetchConfig,
  onAnimationEnd,
  prefersReducedMotion,
  resetShimmer,
  startViewTransition,
} from '@theme/utilities';
import { morphSection, sectionRenderer } from '@theme/section-renderer';
import {
  ThemeEvents,
  CartUpdateEvent,
  QuantitySelectorUpdateEvent,
  CartAddEvent,
  DiscountUpdateEvent,
} from '@theme/events';
import { cartPerformance } from '@theme/performance';

/** @typedef {import('./utilities').TextComponent} TextComponent */

/**
 * A custom element that displays a cart items component.
 *
 * @typedef {object} Refs
 * @property {HTMLElement[]} quantitySelectors - The quantity selector elements.
 * @property {HTMLTableRowElement[]} cartItemRows - The cart item rows.
 * @property {TextComponent} cartTotal - The cart total.
 *
 * @extends {Component<Refs>}
 */
/**
 * Debounce window (ms) after the last +/- tap before the settled quantity is sent to the
 * server. Firing ONE request per burst (instead of one per tap) keeps Shopify's cart
 * rate-limit from throttling a fast burst — see the rationale on the class below.
 */
const CHANGE_DEBOUNCE_MS = 350;

class CartItemsComponent extends Component {
  // Debounce the network, keep the UI optimistic. Rapid +/- taps update the stepper and
  // the morph-proof #desiredByKey map SYNCHRONOUSLY, but the /cart/change request fires
  // only after the burst settles (CHANGE_DEBOUNCE_MS). One request per burst instead of
  // one per tap stops Shopify's cart rate-limit from throttling the burst — a throttled
  // request used to reconcile the stepper back to the last-committed value, so the count
  // climbed then jumped back down. No request in flight during the burst also means no
  // morph mid-burst to stomp the optimistic value; the stale-reapply window that made a
  // plain debounce unsafe when it was first removed is now covered by #desiredByKey
  // (re-asserted after every render), which did not exist back then. Removals flush
  // immediately — they are a deliberate action, not a burst.
  #boundOnChange = this.#onQuantityChange.bind(this);

  /** @type {ReturnType<typeof setTimeout> | undefined} - debounce timer for the network flush */
  #flushTimer;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #reviewBadgeTimer;

  /** @type {HTMLElement | undefined} - visually-hidden polite live region for a11y announcements */
  #liveRegion;

  /**
   * @type {Map<string, {key: string, quantity: number, action: string}>}
   * Latest desired state per cart line-item key. Rapid taps on a line coalesce to the
   * last value here; the queue drains one line at a time so editing several items at
   * once never cancels one, and a stale response can't clobber another line.
   */
  #pendingByKey = new Map();

  /**
   * @type {Map<string, number>}
   * Monotonic per-line versions. If the shopper changes their mind while a request is in
   * flight (especially change -> remove), the older response is ignored instead of being
   * allowed to morph stale cart HTML back into the drawer.
   */
  #versionByKey = new Map();

  /**
   * @type {Set<string>}
   * Lines the shopper has removed locally but Shopify has not confirmed yet. Cross-surface
   * add/update responses that still contain one of these keys are older than the local
   * intent, so they must not reintroduce the removed row visually.
   */
  #removingKeys = new Set();

  /**
   * @type {Map<string, number>}
   * The shopper's INTENDED absolute quantity per line while they're actively editing —
   * the optimistic source of truth the server morph can't overwrite. `#pendingByKey`
   * holds only what's queued-but-unsent (and is emptied the instant a request drains);
   * this map persists across that gap so a tap that lands right after a morph reset the
   * <input> to the server snapshot still increments from the shopper's real number, not
   * the stale reset. Cleared per line once the server confirms it (or the edit fails).
   */
  #desiredByKey = new Map();

  /** @type {boolean} - true while the serial update queue is draining */
  #draining = false;

  /** @type {Promise<void> | undefined} - current drain promise for external callers */
  #drainPromise;

  /** @type {boolean} - set on disconnect so an in-flight drain stops touching the DOM */
  #disconnected = false;

  connectedCallback() {
    super.connectedCallback();
    // Custom-element instances are reused across disconnect/reconnect — clear the flag the
    // teardown sets, or the drain / retry / reassert paths guarded by it would no-op FOREVER
    // after the first unmount (e.g. a theme-editor section remount), silently deadening the
    // steppers.
    this.#disconnected = false;

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.addEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#boundOnChange);
    // Commit a debounced-but-unsent tap when the PAGE is actually leaving (navigation, tab
    // close, backgrounding) — the reliable, iOS-safe signal. NOT on element detach, which
    // also fires during theme-editor churn and would mutate the cart with no shopper intent.
    document.addEventListener('visibilitychange', this.#onVisibilityChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#disconnected = true;
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.removeEventListener(ThemeEvents.quantitySelectorUpdate, this.#boundOnChange);
    document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    // Just tear down here — do NOT beacon on detach. A detach is often editor churn or a DOM
    // move, not the shopper leaving; the visibilitychange listener owns the genuine-navigation
    // commit. A debounced tap lost to a bare detach self-heals on the next load.
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    this.#pendingByKey.clear();
    this.#desiredByKey.clear();
    this.#versionByKey.clear();
    this.#removingKeys.clear();
    clearTimeout(this.#reviewBadgeTimer);
  }

  /**
   * Commits any debounced-but-unsent change when the page goes hidden (navigation / tab
   * close / backgrounding) so the shopper's last tap isn't lost. Never in the theme editor —
   * a stray /cart/change there would mutate the preview cart with no shopper intent.
   */
  #onVisibilityChange = () => {
    if (document.visibilityState !== 'hidden') return;
    if (window.Shopify?.designMode) return;
    this.#flushPendingBeacon();
  };

  /**
   * Handles QuantitySelectorUpdateEvent change event.
   * @param {QuantitySelectorUpdateEvent} event - The event.
   */
  #onQuantityChange(event) {
    if (!(event.target instanceof Node) || !this.contains(event.target)) return;

    const { quantity, cartLine: line, lineKey } = event.detail;

    // RC-4: resolve the row by stable line key when the selector carried one, falling back
    // to the 1-based index (legacy markup / quick-order). One of them must resolve a row.
    const lineItemRow = (lineKey && this.#rowForKey(lineKey)) || (line ? this.refs.cartItemRows[line - 1] : null);
    if (!(lineItemRow instanceof HTMLElement)) return;
    const key = lineItemRow.dataset.key;
    if (!key) return;

    if (quantity === 0) {
      return this.onLineItemRemove(lineItemRow);
    }

    // The row is already on its way out; a late tap during the remove animation (or
    // from the drawer's duplicate responsive stepper) must not downgrade that clear
    // back into a quantity change.
    if (this.#removingKeys.has(key) || lineItemRow.hasAttribute('data-removing')) return;

    const textComponent = /** @type {TextComponent | undefined} */ (lineItemRow.querySelector('text-component'));
    textComponent?.shimmer();

    // Record the shopper's intended quantity in morph-proof JS state BEFORE queueing.
    // Re-asserted onto the input after every render, so rapid taps that outrun the
    // network keep counting up instead of snapping back to the last server value.
    this.#desiredByKey.set(key, quantity);

    // Queue by stable line-item key (not the position index, which shifts when another
    // line is removed) so the change targets the right line and coalesces with the
    // shopper's other taps on this same line. Debounced: the request fires once the
    // burst settles, so a fast burst is one request the rate-limit won't throttle.
    const variantId = this.#variantIdForRow(lineItemRow);
    this.#enqueueUpdate({ key, quantity, action: 'change', variantId }, true);
  }

  /**
   * Resolves a cart row from whatever the caller has: a click Event (RC-4 — a remove
   * button now dispatches on:click="/onLineItemRemove" with no index, so the row is keyed
   * off the event target), an already-resolved row Element, or a 1-based line index
   * (the quantity-zero path and legacy/stale-markup fallback).
   * @param {Event | Element | number} source
   * @returns {HTMLTableRowElement | null}
   */
  #resolveRow(source) {
    if (source instanceof Element) return /** @type {HTMLTableRowElement | null} */ (source.closest('tr[data-key]'));
    if (source instanceof Event) {
      const target = source.target;
      return target instanceof Element ? /** @type {HTMLTableRowElement | null} */ (target.closest('tr[data-key]')) : null;
    }
    if (typeof source === 'number' && Number.isFinite(source)) {
      return /** @type {HTMLTableRowElement | null} */ (this.refs.cartItemRows[source - 1] ?? null);
    }
    return null;
  }

  /**
   * Handles the line item removal. Addressed by KEY, not index (RC-4): the row is resolved
   * from the click event's target (or a row/index passed by internal callers), so a shifted
   * or morph-rebuilt refs array can't retarget the delete onto the wrong line.
   * @param {Event | Element | number} source - click event, row element, or 1-based index.
   */
  onLineItemRemove(source) {
    const cartItemRowToRemove = this.#resolveRow(source);

    if (!cartItemRowToRemove) return;

    const key = cartItemRowToRemove.dataset.key;
    if (!key) return;

    const rowsToRemove = [
      cartItemRowToRemove,
      // Get all nested lines of the row to remove
      ...this.refs.cartItemRows.filter((row) => row.dataset.parentKey === cartItemRowToRemove.dataset.key),
    ];

    rowsToRemove.forEach((row) => row.setAttribute('data-removing', ''));

    // The line is going away — drop any optimistic intent so it can't be re-asserted
    // onto a stale/removed row.
    const variantId = this.#variantIdForRow(cartItemRowToRemove);
    this.#desiredByKey.delete(key);
    this.#removingKeys.add(key);
    const giftRemoval = cartItemRowToRemove.dataset.casaFgGift === '1';
    if (giftRemoval) document.dispatchEvent(new CustomEvent('casa:gift-remove'));
    this.#enqueueUpdate({ key, quantity: 0, action: 'clear', variantId, giftRemoval });

    // If the cart item row is the last row, optimistically trigger the cart empty state
    const isEmptyCart = rowsToRemove.length == this.refs.cartItemRows.length;

    const template = document.getElementById('empty-cart-template');
    if (isEmptyCart && template instanceof HTMLTemplateElement) {
      const clone = document.importNode(template.content, true);

      startViewTransition(() => {
        this.replaceChildren(clone);
      }, [this.isDrawer ? 'empty-cart-drawer' : 'empty-cart-page']);

      return;
    }

    // Add class to the row to trigger the animation
    rowsToRemove.forEach((row) => {
      const remove = () => row.remove();

      if (prefersReducedMotion()) return remove();

      row.style.setProperty('--row-height', `${row.clientHeight}px`);
      row.classList.add('removing');

      // Remove the row after the animation ends
      onAnimationEnd(row, remove);
    });
  }

  /**
   * Queues a cart-line update. Rapid taps on the same line coalesce to the latest
   * desired quantity; the queue then drains one line at a time.
   * @param {{key: string, quantity: number, action: string, variantId?: string, giftRemoval?: boolean}} config
   * @param {boolean} [debounce] - true for +/- taps: wait CHANGE_DEBOUNCE_MS after the
   *   last tap before sending, so a burst becomes ONE request. false (removals) drains now.
   */
  #enqueueUpdate(config, debounce = false) {
    if (this.#removingKeys.has(config.key) && config.action !== 'clear') return;

    const existing = this.#pendingByKey.get(config.key);
    // Once remove is queued, it is sticky. The drawer can briefly keep duplicate hidden
    // steppers in the DOM during the remove animation, and their late events must not
    // resurrect the line by replacing the clear with a change.
    if (existing?.action === 'clear' && config.action !== 'clear') return;

    const version = (this.#versionByKey.get(config.key) ?? 0) + 1;
    this.#versionByKey.set(config.key, version);
    this.#pendingByKey.set(config.key, { ...config, version });
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    if (debounce) {
      this.#flushTimer = setTimeout(() => {
        this.#flushTimer = undefined;
        this.#drainUpdates();
      }, CHANGE_DEBOUNCE_MS);
      return;
    }
    this.#drainUpdates();
  }

  /**
   * Public coordination hook used by product-form before /cart/add.js. It forces any
   * debounced cart edits to reach Shopify first, so add/delete/change requests do not race
   * into inconsistent server order when shoppers act faster than the network.
   * @returns {Promise<void>}
   */
  flushPendingCartUpdates() {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    return this.#drainUpdates();
  }

  /**
   * Best-effort commit of any debounced-but-unsent change as the page leaves, using keepalive
   * so the POST survives navigation. No section morph — the page is going away; this only
   * keeps the server consistent with the shopper's last tap. Never in the theme editor.
   */
  #flushPendingBeacon() {
    if (window.Shopify?.designMode) return;
    for (const config of this.#pendingByKey.values()) {
      try {
        fetch(config.giftRemoval ? Theme.routes.cart_update_url : Theme.routes.cart_change_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(config.giftRemoval
            ? { updates: { [config.key]: 0 }, attributes: { _casa_free_gift_choice: 'removed' } }
            : { id: config.key, quantity: config.quantity }),
          keepalive: true,
        });
      } catch (e) {
        /* best effort — nothing to recover on an unmounting component */
      }
    }
  }

  /**
   * Drains the update queue SERIALLY — one request in flight at a time. This is the
   * heart of the fix: because responses never overlap, one line's morph can't clobber
   * another line, and every queued line commits (nothing is cancelled when you edit
   * several items at once). Taps that arrive mid-drain are picked up by the loop.
   */
  #drainUpdates() {
    if (this.#draining) return this.#drainPromise ?? Promise.resolve();
    // A pending debounce timer is now redundant — this drain flushes everything queued.
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    this.#draining = true;

    const { cartTotal } = this.refs;
    cartTotal?.shimmer();

    this.#drainPromise = (async () => {
      try {
        while (this.#pendingByKey.size > 0 && !this.#disconnected) {
          const entry = this.#pendingByKey.entries().next().value;
          if (!entry) break;
          const [key, config] = entry;
          this.#pendingByKey.delete(key);
          await this.#sendUpdate(config);
          // The morph just reset every stepper to the server snapshot; re-assert the
          // shopper's intent on every line they're still editing so a concurrently-edited
          // item doesn't visibly flicker back to its old value.
          this.#reassertDesired();
          // ...and strip any line still queued-for-removal that the morph re-inserted (RC-2).
          this.#reassertRemoving();
        }
      } finally {
        this.#draining = false;
        this.#drainPromise = undefined;
        resetShimmer(this);
        cartTotal?.removeAttribute('shimmer');
        this.#enableCartItems();
      }
    })();

    return this.#drainPromise;
  }

  /**
   * @param {{key: string, version?: number}} config
   * @returns {boolean}
   */
  #isCurrentConfig(config) {
    return this.#versionByKey.get(config.key) === config.version;
  }

  /**
   * Re-asserts the shopper's intended quantity (#desiredByKey) onto every line they're
   * actively editing, after a morph reset the inputs to the server snapshot. Iterates
   * #desiredByKey — NOT just #pendingByKey — so a line whose request already drained but
   * isn't server-confirmed yet still shows the shopper's number instead of snapping back
   * and dropping the taps that outran the network. Rows that have gone away (removed) are
   * pruned so the map can't leak.
   *
   * Resets ALL quantity inputs in the row, not just the first: the DRAWER renders TWO
   * quantity-selectors per line (compact + standard, CSS-toggled by viewport), so a lone
   * querySelector would re-assert only one and leave the other (which may be the visible
   * one on mobile) snapped back to the server value. Mirrors #handleCartError.
   */
  #reassertDesired() {
    if (this.#disconnected) return;
    for (const [key, quantity] of this.#desiredByKey) {
      const inputs = this.#rowForKey(key)?.querySelectorAll('.quantity-selector input[type="number"]');
      if (!inputs || !inputs.length) {
        this.#desiredByKey.delete(key);
        continue;
      }
      inputs.forEach((input) => {
        if (input instanceof HTMLInputElement && input.value !== String(quantity)) {
          input.value = String(quantity);
        }
      });
    }
    if (this.#desiredByKey.size) this.#updateCartQuantitySelectorButtonStates();
  }

  /**
   * Synchronously strips any row still queued-for-removal that a morph or fresh render
   * just re-inserted. The removal mirror of #reassertDesired: a `/cart/change` response
   * for delete #1 legitimately still contains the lines whose deletes are #2..N in the
   * queue (the server hasn't processed them yet), so morphing that response re-adds rows
   * the shopper already watched animate out (RC-2 resurrection — DOM went 1→3→2→1 over
   * ~8s under delete-spam). The row already animated, so it is removed with NO animation.
   *
   * Ordering contract (see call sites): on the #sendUpdate success path the confirmed-gone
   * key is deleted from #removingKeys BEFORE the morph, so it is no longer in the set here
   * and its (correctly absent) row is untouched; on the transient-failure path the key is
   * likewise deleted before the reconcile render, so a genuinely failed remove is allowed
   * to restore. Only keys the shopper still intends to remove remain — those get stripped.
   * Nested bundle child rows (data-parent-key) of a removing line are cleared too, matching
   * onLineItemRemove.
   */
  #reassertRemoving() {
    if (this.#disconnected) return;
    for (const key of this.#removingKeys) {
      const escaped = CSS.escape(key);
      this.querySelectorAll(`[data-key="${escaped}"], [data-parent-key="${escaped}"]`).forEach((row) => row.remove());
    }
  }

  /**
   * @param {string} key - The cart line-item key.
   * @returns {Element | null} The current row for that key (queried live so it survives morphs).
   */
  #rowForKey(key) {
    return this.querySelector(`[data-key="${CSS.escape(key)}"]`);
  }

  /**
   * @param {Element | null | undefined} row
   * @returns {string | undefined}
   */
  #variantIdForRow(row) {
    const selector = row?.querySelector('[data-variant-id]');
    return selector instanceof HTMLElement ? selector.dataset.variantId : undefined;
  }

  /**
   * Sends a single cart-line change to Shopify and morphs the result. Addresses the
   * line by its stable `id` (line-item key), not the position index, so a prior remove
   * can't retarget it. Awaited by the drain loop, so requests never overlap.
   * @param {{key: string, quantity: number, action: string, variantId?: string, version?: number, giftRemoval?: boolean}} config
   * @returns {Promise<void>}
   */
  async #sendUpdate(config) {
    const { key, quantity, action } = config;
    const marker = cartPerformance.createStartingMarker(`${action}:user-action`);

    const sectionsToUpdate = new Set([this.sectionId]);
    document.querySelectorAll('cart-items-component').forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) sectionsToUpdate.add(item.dataset.sectionId);
    });

    const body = JSON.stringify({
      ...(config.giftRemoval
        ? { updates: { [key]: 0 }, attributes: { _casa_free_gift_choice: 'removed' } }
        : { id: key, quantity }),
      sections: Array.from(sectionsToUpdate).join(','),
      sections_url: window.location.pathname,
    });

    try {
      // Retry transient failures with backoff. Shopify rate-limits the cart endpoint, so a
      // burst can come back 503/429 or as a non-JSON Cloudflare challenge — none the
      // shopper's fault. Retrying holds the optimistic quantity instead of snapping the
      // stepper back to the last-committed value (the "climbs to 7, jumps back to 2" bug).
      // Genuine 422 validation errors return JSON with an `errors` field and are NOT
      // retried — they resolve to the inline message immediately.
      const MAX_ATTEMPTS = 3;
      let parsed = null;
      let lastError = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !this.#disconnected; attempt++) {
        if (!this.#isCurrentConfig(config)) return;
        try {
          const response = await fetch(
            config.giftRemoval ? Theme.routes.cart_update_url : Theme.routes.cart_change_url,
            fetchConfig('json', { body })
          );
          const responseText = await response.text();
          const contentType = response.headers.get('content-type') || '';
          // A challenged / rate-limited / timed-out request comes back as a non-JSON body
          // (Cloudflare interstitial, 429/503). Validation errors return JSON with a 422
          // and are handled below, so only bail here when the body isn't cart JSON.
          if (!response.ok && !contentType.includes('application/json')) {
            throw new Error(`Cart update failed: HTTP ${response.status}`);
          }

          let candidate;
          try {
            candidate = JSON.parse(responseText);
          } catch (parseError) {
            throw new Error('Cart update returned a non-JSON response');
          }

          if (candidate.errors) {
            // A genuine validation error ("max 5 per order") — the server rejected this
            // quantity, so drop the optimistic intent and let the stepper snap to truth.
            this.#desiredByKey.delete(key);
            this.#handleCartError(key, candidate);
            return;
          }

          // Guard the section body BEFORE accepting the response: Shopify can return valid
          // cart JSON (errors falsy) with the requested section missing/empty. Treat that
          // as transient (retry, then reconcile) rather than morphing a 0-count section
          // over the cart or raising an unhandled rejection.
          const sectionHtml = candidate.sections?.[this.sectionId];
          if (typeof sectionHtml !== 'string' || !sectionHtml.includes(`shopify-section-${this.sectionId}`)) {
            throw new Error('Cart section missing from response');
          }

          parsed = candidate;
          break;
        } catch (err) {
          lastError = err;
          // Backoff before the next attempt (300ms, then 600ms); no wait after the last. Kept
          // short so a flapping line doesn't freeze the serial queue behind it for seconds.
          if (attempt < MAX_ATTEMPTS && !this.#disconnected) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 300));
          }
        }
      }

      if (this.#disconnected) return;
      if (!this.#isCurrentConfig(config)) return;

      if (!parsed) {
        // Every attempt failed transiently — route to the catch for a silent, truth-based
        // reconcile (no alarming error card).
        throw lastError || new Error('Cart update failed after retries');
      }

      const sectionHtml = parsed.sections[this.sectionId];
      const newSectionHTML = new DOMParser().parseFromString(sectionHtml, 'text/html');
      const newCartHiddenItemCount = newSectionHTML.querySelector('[ref="cartItemCount"]')?.textContent;
      const newCartItemCount = newCartHiddenItemCount ? parseInt(newCartHiddenItemCount, 10) : 0;

      this.#updateQuantitySelectors(parsed, action === 'clear' ? config.variantId : undefined);

      if (action === 'clear') {
        const isStillPresent = parsed.items?.some((item) => item.key === key);
        if (!isStillPresent) this.#removingKeys.delete(key);
      }

      this.dispatchEvent(
        new CartUpdateEvent(parsed, this.sectionId, {
          itemCount: newCartItemCount,
          source: 'cart-items-component',
          sections: parsed.sections,
        })
      );

      // Await the morph (it is async): a failed morph now rejects INTO this try/catch
      // rather than escaping as an unhandled rejection. morphSection mutates the DOM
      // synchronously, so #reassertDesired below still runs against the morphed DOM.
      await morphSection(this.sectionId, sectionHtml, this.isDrawer ? 'hydration' : 'full');
      // Re-assert the shopper's intent SYNCHRONOUSLY — the morph just reset every stepper
      // to the server snapshot; doing this in the same task stops a tap right after the
      // morph from reading a stale value and incrementing from the wrong base.
      this.#reassertDesired();
      // Strip any OTHER line still queued-for-removal that this morph re-inserted; the
      // confirmed-gone key for THIS clear was already dropped from #removingKeys above.
      this.#reassertRemoving();

      // This line's intent is now confirmed by the server AND nothing newer is queued —
      // stop overriding so the input tracks the server again. (If a newer tap is still
      // pending, keep the desired value; the next drain re-sends it.)
      const confirmedQty = parsed.items?.find((item) => item.key === key)?.quantity;
      if (!this.#pendingByKey.has(key) && confirmedQty === this.#desiredByKey.get(key)) {
        this.#desiredByKey.delete(key);
      }

      this.#updateCartQuantitySelectorButtonStates();
      this.#reloadReviewBadges();
    } catch (error) {
      console.error(error);
      // Transient failure after every retry: drop the optimistic intent and reconcile the
      // stepper to the server's REAL value from a fresh render — NOT input.defaultValue,
      // which can be a stale mid-burst snapshot and was itself the visible snap-back. The
      // reconcile is the feedback (no alarming card); announced politely for AT users. A
      // failed remove is covered too — the fresh render restores anything not deleted.
      this.#desiredByKey.delete(key);
      this.#removingKeys.delete(key);
      await sectionRenderer
        .renderSection(this.sectionId, { cache: false })
        .then(() => {
          // Fresh server truth still contains rows the shopper is mid-removing — strip them.
          this.#reassertRemoving();
          this.#updateCartQuantitySelectorButtonStates();
        })
        .catch((e) => console.error(e));
      this.#announceCartUpdateFailure();
    } finally {
      cartPerformance.measureFromMarker(marker);
    }
  }

  /**
   * Handles the discount update.
   * @param {DiscountUpdateEvent} event - The event.
   */
  handleDiscountUpdate = (event) => {
    this.#handleCartUpdate(event);
  };

  /**
   * Handles a cart validation error (e.g. "max 5 per order") for a specific line.
   * Addressed by KEY, not index (RC-4): the row is resolved live by data-key and the error
   * cell is found within it by class, so a stale/ghost refs array can't reset the wrong
   * line's stepper or paint the error on the wrong row.
   * @param {string} key - The cart line-item key.
   * @param {Object} parsedResponseText - The parsed response text.
   * @param {string} parsedResponseText.errors - The errors.
   */
  #handleCartError = (key, parsedResponseText) => {
    // Reconcile the stepper back to the last server-known value when the row is still
    // present. Reset ALL of its quantity inputs: the DRAWER renders two quantity-selectors
    // per row (compact + standard), so resetting one would leave the other stale. Missing
    // nodes must NOT throw here — this runs on the failure path and a throw would skip
    // resetShimmer and re-freeze the cart.
    const row = this.#rowForKey(key);
    const quantityInputs = row ? row.querySelectorAll('.quantity-selector input[type="number"]') : [];
    quantityInputs.forEach((input) => {
      if (input instanceof HTMLInputElement) input.value = input.defaultValue;
    });

    const cartItemErrorContainer = row?.querySelector('.cart-items__error, .casa-cart-items__error');
    const cartItemError = row?.querySelector('.cart-item__error-text');

    if (
      parsedResponseText.errors &&
      cartItemError instanceof HTMLElement &&
      cartItemErrorContainer instanceof HTMLElement
    ) {
      cartItemError.textContent = parsedResponseText.errors;
      cartItemErrorContainer.classList.remove('hidden');
    }
  };

  /**
   * Handles the cart update.
   *
   * @param {DiscountUpdateEvent | CartUpdateEvent | CartAddEvent} event
   */
  #handleCartUpdate = (event) => {
    if (event instanceof DiscountUpdateEvent) {
      sectionRenderer
        .renderSection(this.sectionId, { cache: false })
        .then(() => {
          // A discount render is fresh server truth — strip any mid-removal rows it re-added.
          this.#reassertRemoving();
          this.#reloadReviewBadges();
        })
        .catch((e) => console.error(e));
      return;
    }
    if (event.target === this) return;

    const cartItemsHtml = event.detail.data.sections?.[this.sectionId];
    if (typeof cartItemsHtml === 'string' && cartItemsHtml.includes(`shopify-section-${this.sectionId}`)) {
      if (this.#containsRemovingKey(cartItemsHtml)) return;
      // morphSection is async and throws on a malformed section — guard the payload
      // and catch the rejection so a bad cross-surface event can't raise an unhandled
      // rejection. Fall back to a fresh server render.
      morphSection(this.sectionId, cartItemsHtml)
        .then(() => {
          // A cross-surface morph (another line, a discount, the cart icon) also resets
          // our steppers — re-assert any line the shopper is mid-edit so their taps hold.
          this.#reassertDesired();
          // Defense in depth beyond the #containsRemovingKey skip above: strip any mid-removal row.
          this.#reassertRemoving();
          this.#updateCartQuantitySelectorButtonStates();
          this.#reloadReviewBadges();
        })
        .catch(() => {
          sectionRenderer
            .renderSection(this.sectionId, { cache: false })
            .then(() => {
              this.#reassertDesired();
              this.#reassertRemoving();
              this.#reloadReviewBadges();
            })
            .catch((e) => console.error(e));
        });
    } else {
      sectionRenderer
        .renderSection(this.sectionId, { cache: false })
        .then(() => {
          this.#reassertDesired();
          this.#reassertRemoving();
          this.#reloadReviewBadges();
        })
        .catch((e) => console.error(e));
    }
  };

  /**
   * @param {string} html
   * @returns {boolean}
   */
  #containsRemovingKey(html) {
    if (!this.#removingKeys.size) return false;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const key of this.#removingKeys) {
      if (doc.querySelector(`[data-key="${CSS.escape(key)}"]`)) return true;
    }
    return false;
  }

  /**
   * Clears the cart-items-disabled state. (The disable was removed in favour of
   * AbortController-based coalescing; this stays as a defensive no-op cleanup in case
   * the class is ever set elsewhere.)
   */
  #enableCartItems() {
    this.classList.remove('cart-items-disabled');
  }

  /**
   * Updates quantity selectors for all matching variants in the cart.
   * @param {Object} updatedCart - The updated cart object.
   * @param {Array<{variant_id: number, quantity: number}>} [updatedCart.items] - The cart items.
   * @param {string} [removedVariantId] - Variant to reset to zero when its last line was removed.
   */
  #updateQuantitySelectors(updatedCart, removedVariantId) {
    if (!updatedCart.items) return;

    /** @type {Map<string, number>} */
    const quantityByVariant = new Map();
    for (const item of updatedCart.items) {
      const variantId = item.variant_id?.toString();
      if (!variantId) continue;
      quantityByVariant.set(variantId, (quantityByVariant.get(variantId) ?? 0) + item.quantity);
    }

    if (removedVariantId && !quantityByVariant.has(removedVariantId)) {
      quantityByVariant.set(removedVariantId, 0);
    }

    for (const [variantId, quantity] of quantityByVariant) {
      const selectors = document.querySelectorAll(
        `quantity-selector-component[data-variant-id="${CSS.escape(variantId)}"], cart-quantity-selector-component[data-variant-id="${CSS.escape(variantId)}"]`
      );

      for (const selector of selectors) {
        const input = selector.querySelector('input[data-cart-quantity]');
        if (!input) continue;

        input.setAttribute('data-cart-quantity', quantity.toString());

        // Update the quantity selector's internal state
        if ('updateCartQuantity' in selector && typeof selector.updateCartQuantity === 'function') {
          selector.updateCartQuantity();
        }
      }
    }
  }

  /**
   * Updates button states for all cart quantity selector components.
   */
  #updateCartQuantitySelectorButtonStates() {
    for (const selector of document.querySelectorAll('cart-quantity-selector-component')) {
      /** @type {any} */ (selector).updateButtonStates?.();
    }
  }

  /**
   * Casa addition: re-initialise Judge.me preview badges after a cart morph.
   * Casa renders a `casa-judgeme-rating` badge on each cart line; morphSection
   * swaps in fresh server HTML that Judge.me's loader hasn't hydrated, so the
   * badge degrades from "4.7 (223)" to "223 reviews" until reloaded. Poll briefly
   * because jdgm-loader can race the morph (mirrors casa-recently-viewed.liquid).
   * @param {number} [attempt] - The current poll attempt.
   */
  /**
   * Screen-reader-only announcement that a cart update failed. Sighted users get the
   * visible stepper snap-back; this is the invisible equivalent for AT users (WCAG
   * 4.1.3) so a silent revert isn't silent to them. No visible UI is shown.
   */
  #announceCartUpdateFailure() {
    const message = Theme.translations?.cart_update_error;
    if (!message) return;
    if (!this.#liveRegion || !this.#liveRegion.isConnected) {
      const region = document.createElement('div');
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.className = 'visually-hidden';
      this.appendChild(region);
      this.#liveRegion = region;
    }
    // Clear then set so an identical repeat message is still re-announced.
    this.#liveRegion.textContent = '';
    const region = this.#liveRegion;
    setTimeout(() => {
      if (region.isConnected) region.textContent = message;
    }, 100);
  }

  #reloadReviewBadges(attempt = 0) {
    // Bail if the component was torn down (theme editor unmounts sections
    // constantly) so a queued poll can't keep firing on a detached element.
    if (!this.isConnected) return;
    const jdgm = /** @type {any} */ (window).jdgm;
    if (jdgm && typeof jdgm.reloadAllElements === 'function') {
      jdgm.reloadAllElements();
      return;
    }
    if (attempt < 30) {
      this.#reviewBadgeTimer = setTimeout(() => this.#reloadReviewBadges(attempt + 1), 400);
    }
  }

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset;

    if (!sectionId) throw new Error('Section id missing');

    return sectionId;
  }

  /**
   * @returns {boolean} Whether the component is a drawer.
   */
  get isDrawer() {
    return this.dataset.drawer !== undefined;
  }
}

if (!customElements.get('cart-items-component')) {
  customElements.define('cart-items-component', CartItemsComponent);
}
