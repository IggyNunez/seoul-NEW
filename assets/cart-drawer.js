import { DialogComponent, DialogOpenEvent } from '@theme/dialog';
import { CartAddEvent } from '@theme/events';

/**
 * A custom element that manages a cart drawer.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog - The dialog element.
 *
 * @extends {DialogComponent}
 */
class CartDrawerComponent extends DialogComponent {
  /** @type {number} */
  #summaryThreshold = 0.5;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    this.addEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    this.removeEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
  }

  /**
   * @param {CartAddEvent | CartUpdateEvent} event
   */
  #handleCartAdd = (event) => {
    if (!this.hasAttribute('auto-open')) return;

    /* CartAddEvent and CartUpdateEvent share the same 'cart:update' event name
       (see assets/events.js), so this listener fires for EVERY cart mutation —
       genuine adds, quantity changes, and removals alike. Only a genuine ADD
       should auto-open the drawer, so we ALLOWLIST the known add sources below
       rather than infer intent from item count: a removal that leaves other
       items in the cart still reports itemCount > 0, which would read as an add
       and reopen the drawer right after the shopper X-closes it.

       In-cart editing (quantity steppers, remove/trash) is dispatched by
       cart-items-component; its async response can land AFTER the drawer is
       closed. It isn't an add source, so the allowlist already keeps it out —
       this explicit early return documents that and defends the behavior even
       if the allowlist is ever loosened. New add surfaces must add their source
       to the allowlist to auto-open (a deny-by-default that can't regress). */
    const data = event?.detail?.data ?? {};
    const source = data.source || '';
    if (source === 'cart-items-component') return;

    const isAdd =
      source === 'product-form-component' ||
      source === 'quick-add' ||
      source === 'casa-quickview';

    if (!isAdd) return;
    this.showDialog();
  };

  open() {
    this.showDialog();

    /**
     * Close cart drawer when installments CTA is clicked to avoid overlapping dialogs
     */
    customElements.whenDefined('shopify-payment-terms').then(() => {
      const installmentsContent = document.querySelector('shopify-payment-terms')?.shadowRoot;
      const cta = installmentsContent?.querySelector('#shopify-installments-cta');
      cta?.addEventListener('click', this.closeDialog, { once: true });
    });
  }

  close() {
    this.closeDialog();
  }

  #updateStickyState() {
    const { dialog } = /** @type {Refs} */ (this.refs);
    if (!dialog) return;

    // Refs do not cross nested `*-component` boundaries (e.g., `cart-items-component`), so we query within the dialog.
    const content = dialog.querySelector('.cart-drawer__content');
    const summary = dialog.querySelector('.cart-drawer__summary');

    if (!content || !summary) {
      // Ensure the dialog doesn't get stuck in "unsticky" mode when summary disappears (e.g., empty cart).
      dialog.setAttribute('cart-summary-sticky', 'false');
      return;
    }

    const drawerHeight = dialog.getBoundingClientRect().height;
    const summaryHeight = summary.getBoundingClientRect().height;
    const ratio = summaryHeight / drawerHeight;
    dialog.setAttribute('cart-summary-sticky', ratio > this.#summaryThreshold ? 'false' : 'true');
  }
}

if (!customElements.get('cart-drawer-component')) {
  customElements.define('cart-drawer-component', CartDrawerComponent);
}
