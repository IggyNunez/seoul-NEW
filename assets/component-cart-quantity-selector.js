import { QuantitySelectorComponent } from '@theme/component-quantity-selector';
import { QuantitySelectorUpdateEvent } from '@theme/events';

/**
 * A custom element that allows the user to select a quantity in the cart.
 * Extends QuantitySelectorComponent but uses absolute max limits instead of effective max.
 * Semantics: "What should the total quantity BE in the cart" vs "How many to ADD to cart"
 *
 * @extends {QuantitySelectorComponent}
 */
class CartQuantitySelectorComponent extends QuantitySelectorComponent {
  /**
   * Gets the effective maximum value for cart quantity selector
   * Cart page: uses absolute max (how much can be in cart total)
   * @returns {number | null} The effective max, or null if no max
   */
  getEffectiveMax() {
    const { max } = this.getCurrentValues();
    return max; // Cart uses absolute max, not max minus cart quantity
  }

  /**
   * Updates button states based on current value and limits
   * Cart buttons are always managed client-side, never server-disabled.
   * Minus is never disabled — at minimum, it removes the line item.
   */
  updateButtonStates() {
    const { minusButton, plusButton } = this.refs;
    const { value } = this.getCurrentValues();
    const effectiveMax = this.getEffectiveMax();

    minusButton.disabled = false;
    plusButton.disabled = effectiveMax !== null && value >= effectiveMax;
  }

  /**
   * Decrease quantity; if already at minimum, remove the line item by dispatching a 0-quantity update.
   * @param {Event} event
   */
  decreaseQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;
    event.preventDefault();

    const { quantityInput } = this.refs;
    const { min, value } = this.getCurrentValues();

    if (value <= min) {
      const cartLine = Number(quantityInput.dataset.cartLine) || undefined;
      this.dispatchEvent(new QuantitySelectorUpdateEvent(0, cartLine));
      return;
    }

    super.decreaseQuantity(event);
  }
}

if (!customElements.get('cart-quantity-selector-component')) {
  customElements.define('cart-quantity-selector-component', CartQuantitySelectorComponent);
}
