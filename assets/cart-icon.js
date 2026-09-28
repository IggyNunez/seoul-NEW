import { Component } from '@theme/component';
import { onAnimationEnd } from '@theme/utilities';
import { ThemeEvents, CartUpdateEvent } from '@theme/events';

/**
 * A custom element that displays a cart icon.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} cartBubble - The cart bubble element.
 * @property {HTMLElement} cartBubbleText - The cart bubble text element.
 * @property {HTMLElement} cartBubbleCount - The cart bubble count element.
 *
 * @extends {Component<Refs>}
 */
class CartIcon extends Component {
  requiredRefs = ['cartBubble', 'cartBubbleText', 'cartBubbleCount'];

  /** @type {number} */
  get currentCartCount() {
    return parseInt(this.refs.cartBubbleCount.textContent ?? '0', 10);
  }

  set currentCartCount(value) {
    this.refs.cartBubbleCount.textContent = value < 100 ? String(value) : '';
    const hiddenCountText = this.refs.cartBubbleText.querySelector('.visually-hidden');
    if (hiddenCountText) {
      const label = hiddenCountText.textContent?.split(':')[0]?.trim() || 'Total items in cart';
      hiddenCountText.textContent = `${label}: ${value}`;
    }
  }

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
    window.addEventListener('pageshow', this.onPageShow);
    this.ensureCartBubbleIsCorrect();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    document.removeEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
    window.removeEventListener('pageshow', this.onPageShow);
  }

  /**
   * Handles the page show event when the page is restored from cache.
   * @param {PageTransitionEvent} event - The page show event.
   */
  onPageShow = (event) => {
    if (event.persisted) {
      this.ensureCartBubbleIsCorrect();
    }
  };

  /**
   * Handles the cart update event.
   * @param {CartUpdateEvent} event - The cart update event.
   */
  onCartUpdate = async (event) => {
    // A rejected add (over-max / sold-out) still fires cart:update with `didError: true`
    // and `itemCount` = the ATTEMPTED quantity, even though the server added nothing (or
    // only the max allowed). Feeding that into the "from the product form -> ADD to the
    // current count" branch below over-counts the bubble until the next reload (bubble
    // shows 8 while the cart really holds 5). Reconcile from the authoritative cart.
    if (event.detail.data?.didError) {
      try {
        const cart = await fetch(`${Theme.routes.cart_url}.js`).then((r) => r.json());
        this.renderCartBubble(cart.item_count, false, false);
      } catch (error) {
        console.error(error);
      }
      return;
    }

    const itemCountFromSections = this.#cartCountFromSections(event.detail.data?.sections);
    if (Number.isFinite(itemCountFromSections)) {
      this.renderCartBubble(itemCountFromSections, false);
      return;
    }

    const itemCount = event.detail.data?.itemCount;
    if (!Number.isFinite(itemCount)) {
      try {
        const cart = await fetch(`${Theme.routes.cart_url}.js`).then((r) => r.json());
        this.renderCartBubble(cart.item_count, false);
      } catch (error) {
        console.error(error);
      }
      return;
    }

    const comingFromProductForm = event.detail.data?.source === 'product-form-component';

    this.renderCartBubble(itemCount, comingFromProductForm);
  };

  /**
   * @param {Record<string, string> | undefined} sections
   * @returns {number | undefined}
   */
  #cartCountFromSections(sections) {
    if (!sections) return undefined;

    for (const sectionHtml of Object.values(sections)) {
      if (typeof sectionHtml !== 'string') continue;
      const doc = new DOMParser().parseFromString(sectionHtml, 'text/html');
      const count = parseInt(doc.querySelector('[ref="cartItemCount"]')?.textContent ?? '', 10);
      if (Number.isFinite(count)) return count;
    }

    return undefined;
  }

  /**
   * Renders the cart bubble.
   * @param {number} itemCount - The number of items in the cart.
   * @param {boolean} comingFromProductForm - Whether the cart update is coming from the product form.
   */
  renderCartBubble = async (itemCount, comingFromProductForm, animate = true) => {
    // If the cart update is coming from the product form, we add to the current cart count, otherwise we set the new cart count

    this.refs.cartBubbleCount.classList.toggle('hidden', itemCount === 0);
    this.refs.cartBubble.classList.toggle('visually-hidden', itemCount === 0);

    this.currentCartCount = comingFromProductForm ? this.currentCartCount + itemCount : itemCount;

    this.classList.toggle('header-actions__cart-icon--has-cart', itemCount > 0);

    sessionStorage.setItem(
      'cart-count',
      JSON.stringify({
        value: String(this.currentCartCount),
        timestamp: Date.now(),
      })
    );

    if (!animate || itemCount === 0) return;

    // Ensure element is visible before starting animation
    // Use requestAnimationFrame to ensure the browser sees the state change
    await new Promise((resolve) => requestAnimationFrame(resolve));

    this.refs.cartBubble.classList.add('cart-bubble--animating');
    await onAnimationEnd(this.refs.cartBubbleText);

    this.refs.cartBubble.classList.remove('cart-bubble--animating');
  };

  /**
   * Checks if the cart count is correct.
   */
  ensureCartBubbleIsCorrect = () => {
    // Ensure refs are available
    if (!this.refs.cartBubbleCount) return;

    const sessionStorageCount = sessionStorage.getItem('cart-count');

    // If no session storage data, nothing to check
    if (sessionStorageCount === null) return;

    const visibleCount = this.refs.cartBubbleCount.textContent;

    try {
      const { value, timestamp } = JSON.parse(sessionStorageCount);

      // Check if the stored count matches what's visible
      if (value === visibleCount) return;

      // Only update if timestamp is recent (within 10 seconds)
      if (Date.now() - timestamp < 10000) {
        const count = parseInt(value, 10);

        if (count >= 0) {
          this.renderCartBubble(count, false, false);
        }
      }
    } catch (_) {
      // no-op
    }
  };
}

if (!customElements.get('cart-icon')) {
  customElements.define('cart-icon', CartIcon);
}
