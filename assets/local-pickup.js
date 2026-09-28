import { Component } from '@theme/component';
import { morph } from '@theme/morph';
import { ThemeEvents, VariantUpdateEvent } from '@theme/events';

class LocalPickup extends Component {
  /** @type {AbortController | undefined} */
  #activeFetch;

  /** @type {Element | null} */
  #section = null;

  connectedCallback() {
    super.connectedCallback();

    this.#section = this.closest(`.shopify-section, dialog`);
    this.#section?.addEventListener(ThemeEvents.variantUpdate, this.#variantUpdated);
  }

  // A proper prototype-level override (the previous instance-property
  // assignment shadowed Component's disconnectedCallback, so its
  // MutationObserver was never disconnected).
  disconnectedCallback() {
    super.disconnectedCallback();
    this.#section?.removeEventListener(ThemeEvents.variantUpdate, this.#variantUpdated);
    this.#section = null;
  }

  /** @type {(event: VariantUpdateEvent) => void} */
  #variantUpdated = (event) => {
    if (event.detail.data.newProduct) {
      this.dataset.productUrl = event.detail.data.newProduct.url;
    }

    const variantId = event.detail.resource ? event.detail.resource.id : null;
    const variantAvailable = event.detail.resource ? event.detail.resource.available : null;
    if (variantId !== this.dataset.variantId) {
      if (variantId && variantAvailable) {
        this.removeAttribute('hidden');
        this.dataset.variantId = variantId;
        this.#fetchAvailability(variantId);
      } else {
        this.setAttribute('hidden', '');
      }
    }
  };

  #createAbortController() {
    if (this.#activeFetch) this.#activeFetch.abort();
    this.#activeFetch = new AbortController();
    return this.#activeFetch;
  }

  /**
   * Fetches the availability of a variant.
   * @param {string} variantId - The ID of the variant to fetch availability for.
   */
  #fetchAvailability = (variantId) => {
    if (!variantId) return;

    const abortController = this.#createAbortController();

    const url = this.dataset.productUrl;
    fetch(`${url}?variant=${variantId}&section_id=${this.dataset.sectionId}`, {
      signal: abortController.signal,
    })
      .then((response) => response.text())
      .then((text) => {
        if (abortController.signal.aborted) return;

        const html = new DOMParser().parseFromString(text, 'text/html');
        const wrapper = html.querySelector(`local-pickup[data-variant-id="${variantId}"]`);
        if (wrapper) {
          this.removeAttribute('hidden');
          morph(this, wrapper);
        } else this.setAttribute('hidden', '');
      })
      .catch((_e) => {
        if (abortController.signal.aborted) return;
        this.setAttribute('hidden', '');
      });
  };
}

if (!customElements.get('local-pickup')) {
  customElements.define('local-pickup', LocalPickup);
}
