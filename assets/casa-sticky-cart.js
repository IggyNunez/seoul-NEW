/**
 * Casa Sticky Cart Component
 * Enhanced sticky add-to-cart with cart drawer awareness
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
    this.hiddenByFooter = false;
  }

  connectedCallback() {
    // Get refs
    this.stickyBar = this.querySelector('[ref="stickyBar"]');
    this.addToCartButton = this.querySelector('[ref="addToCartButton"]');
    this.quantityDisplay = this.querySelector('[ref="quantityDisplay"]');
    this.quantityNumber = this.querySelector('[ref="quantityNumber"]');
    this.productImage = this.querySelector('[ref="productImage"]');
    this.variantTitle = this.querySelector('[ref="variantTitle"]');

    if (!this.stickyBar || !this.addToCartButton) return;

    // Remove installments widget — Shopify injects shopify-payment-terms via JS
    // after render so CSS alone can't reliably hide it; nuke it from the DOM.
    this.removeInstallments();
    this.installmentsObserver = new MutationObserver(() => this.removeInstallments());
    this.installmentsObserver.observe(this, { childList: true, subtree: true });

    // Setup observers
    this.setupBuyButtonsObserver();
    this.setupCartDrawerObserver();

    // Setup event listeners
    this.addToCartButton.addEventListener('click', this.handleAddToCartClick.bind(this));

    // Listen for variant changes
    document.addEventListener('variant:changed', this.handleVariantChange.bind(this));

    // Listen for quantity changes
    document.addEventListener('quantity:changed', this.handleQuantityChange.bind(this));

    // Get initial quantity
    this.currentQuantity = parseInt(this.dataset.initialQuantity) || 1;
  }

  disconnectedCallback() {
    this.buyButtonsObserver?.disconnect();
    this.footerObserver?.disconnect();
    this.cartDrawerObserver?.disconnect();
    this.installmentsObserver?.disconnect();
  }

  /**
   * Remove installments / Shop Pay payment terms from the sticky bar.
   * Shopify injects <shopify-payment-terms> via JS after render, so we
   * must actively remove it rather than relying on CSS alone.
   */
  removeInstallments() {
    this.querySelectorAll(
      '.price-installments, shopify-payment-terms, payment-terms, [id^="installments-form"]'
    ).forEach(el => el.remove());
  }

  /**
   * Setup IntersectionObserver for buy buttons visibility
   */
  setupBuyButtonsObserver() {
    const buyButtonsBlock = document.querySelector('.cpm__block--buy, .buy-buttons-block');
    if (!buyButtonsBlock) return;

    const footer = document.querySelector('footer') || document.querySelector('[class*="footer"]');

    // Observer for buy buttons
    this.buyButtonsObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      if (!entry.isIntersecting && !this.isStuck) {
        const rect = entry.target.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top < 0) {
          this.showStickyBar();
        }
      } else if (entry.isIntersecting && this.isStuck) {
        this.hiddenByFooter = false;
        this.hideStickyBar();
      }
    });

    this.buyButtonsObserver.observe(buyButtonsBlock);

    // Observer for footer - hide sticky bar at page bottom
    if (footer) {
      this.footerObserver = new IntersectionObserver((entries) => {
        const [entry] = entries;
        if (!entry) return;

        if (entry.isIntersecting && this.isStuck) {
          this.hiddenByFooter = true;
          this.hideStickyBar();
        } else if (!entry.isIntersecting && this.hiddenByFooter) {
          const buyRect = buyButtonsBlock.getBoundingClientRect();
          if (buyRect.bottom < 0 || buyRect.top < 0) {
            this.hiddenByFooter = false;
            this.showStickyBar();
          }
        }
      }, { rootMargin: '200px 0px 0px 0px' });

      this.footerObserver.observe(footer);
    }
  }

  /**
   * Setup MutationObserver for cart drawer open/close state
   */
  setupCartDrawerObserver() {
    const hideWhenCartOpen = this.dataset.hideWhenCartOpen === 'true';
    if (!hideWhenCartOpen) return;

    // Try multiple selectors for cart drawer
    const cartDrawer = document.querySelector('cart-drawer-component dialog') ||
                       document.querySelector('.cart-drawer dialog') ||
                       document.querySelector('[data-cart-drawer] dialog') ||
                       document.querySelector('dialog[data-cart-drawer]');

    if (!cartDrawer) {
      // Also try watching for cart drawer to be added dynamically
      const body = document.body;
      const bodyObserver = new MutationObserver(() => {
        const drawer = document.querySelector('cart-drawer-component dialog') ||
                       document.querySelector('.cart-drawer dialog');
        if (drawer && !this.cartDrawerObserver) {
          this.watchCartDrawer(drawer);
          bodyObserver.disconnect();
        }
      });
      bodyObserver.observe(body, { childList: true, subtree: true });
      return;
    }

    this.watchCartDrawer(cartDrawer);
  }

  /**
   * Watch cart drawer for open attribute changes
   */
  watchCartDrawer(dialog) {
    this.cartDrawerObserver = new MutationObserver(() => {
      const isOpen = dialog.hasAttribute('open');
      this.isCartOpen = isOpen;
      this.stickyBar.dataset.cartOpen = isOpen.toString();
    });

    this.cartDrawerObserver.observe(dialog, {
      attributes: true,
      attributeFilter: ['open']
    });

    // Set initial state
    this.isCartOpen = dialog.hasAttribute('open');
    this.stickyBar.dataset.cartOpen = this.isCartOpen.toString();
  }

  /**
   * Show sticky bar
   */
  showStickyBar() {
    if (this.isCartOpen) return;
    this.isStuck = true;
    this.stickyBar.dataset.stuck = 'true';
  }

  /**
   * Hide sticky bar
   */
  hideStickyBar() {
    this.isStuck = false;
    this.stickyBar.dataset.stuck = 'false';
  }

  /**
   * Handle add to cart button click
   */
  handleAddToCartClick() {
    // Find the main add to cart button and click it
    const mainAddToCart = document.querySelector(
      `.cpm [data-product-id="${this.dataset.productId}"] [ref="addToCartButton"], ` +
      `product-form-component[data-product-id="${this.dataset.productId}"] [ref="addToCartButton"]`
    );

    if (mainAddToCart) {
      mainAddToCart.click();
    }

    // Show added state
    this.addToCartButton.dataset.added = 'true';

    // Reset after animation
    setTimeout(() => {
      this.addToCartButton.dataset.added = 'false';
    }, 2000);
  }

  /**
   * Handle variant change events
   */
  handleVariantChange(event) {
    const variant = event.detail?.variant;
    if (!variant) return;

    // Update variant availability
    this.dataset.variantAvailable = variant.available ? 'true' : 'false';
    this.dataset.currentVariantId = variant.id;

    // Update variant title
    if (this.variantTitle) {
      this.variantTitle.textContent = variant.title;
    }

    // Update button state
    if (variant.available) {
      this.addToCartButton.disabled = false;
      this.addToCartButton.querySelector('[ref="buttonText"]').innerHTML = `
        <span class="casa-sticky-cart__button-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="21" r="1"/>
            <circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
          </svg>
        </span>
        <span>Add to Cart</span>
        ${this.currentQuantity > 1 ? `<span class="casa-sticky-cart__quantity">(${this.currentQuantity})</span>` : ''}
      `;
    } else {
      this.addToCartButton.disabled = true;
      const buttonText = this.addToCartButton.querySelector('[ref="buttonText"]');
      buttonText.innerHTML = '<span>Sold Out</span>';
    }

    // Update image if variant has one
    if (variant.featured_image && this.productImage) {
      this.productImage.src = variant.featured_image.src;
      this.productImage.alt = variant.featured_image.alt || variant.title;
    }
  }

  /**
   * Handle quantity change events
   */
  handleQuantityChange(event) {
    const quantity = event.detail?.quantity;
    if (!quantity) return;

    this.currentQuantity = quantity;

    if (this.quantityNumber) {
      this.quantityNumber.textContent = quantity;
    }

    if (this.quantityDisplay) {
      this.quantityDisplay.style.display = quantity > 1 ? 'inline' : 'none';
    }
  }
}

// Register custom element
if (!customElements.get('casa-sticky-cart')) {
  customElements.define('casa-sticky-cart', CasaStickyCart);
}
