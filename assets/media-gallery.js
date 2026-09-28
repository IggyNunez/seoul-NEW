import { Component } from '@theme/component';
import { ThemeEvents, VariantUpdateEvent, ZoomMediaSelectedEvent } from '@theme/events';

/**
 * A custom element that renders a media gallery.
 *
 * @typedef {object} Refs
 * @property {import('./zoom-dialog').ZoomDialog} [zoomDialogComponent] - The zoom dialog component.
 * @property {import('./slideshow').Slideshow} [slideshow] - The slideshow component.
 * @property {HTMLElement[]} [media] - The media elements.
 *
 * @extends Component<Refs>
 */
export class MediaGallery extends Component {
  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#controller;
    const target = this.closest('.shopify-section, dialog');

    target?.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate, { signal });
    this.refs.zoomDialogComponent?.addEventListener(ThemeEvents.zoomMediaSelected, this.#handleZoomMediaSelected, {
      signal,
    });

    // Casa: remember the currently-selected variant's media id so a later
    // variant update can tell a real image change (scroll to it) from a no-op
    // such as a size swap (stay put). On first render the server hoists the
    // variant's image to slide 0.
    this.#lastVariantMediaId =
      this.querySelector('slideshow-slides > slideshow-slide .product-media[data-media-id]')?.dataset.mediaId ?? null;
  }

  #controller = new AbortController();

  /**
   * Media id of the variant image the gallery is currently centred on. Lets a
   * variant update distinguish "the variant's image changed" (scroll to it)
   * from "only a non-image option changed, e.g. size" (leave the shopper put).
   * @type {string | null}
   */
  #lastVariantMediaId = null;

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#controller.abort();
  }

  /**
   * Handles a variant update event.
   *
   * Horizon's default is to `replaceWith` the whole gallery on every variant
   * change. But the server hoists the selected variant's image to slide 0, so
   * two variants that share the same media still yield galleries that differ
   * only in ORDER — and replacing then remounts the scroll-snap carousel. On
   * iOS Safari a freshly-mounted `scroll-snap-type: x mandatory` scroller
   * leaves its off-screen slides unpainted until nudged, so the shopper swipes
   * into a blank white slide (the "blank image after the variant" bug).
   *
   * Fix — "select, don't reorder": when the media SET is unchanged (only the
   * order differs) keep the live gallery and scroll to the newly-selected
   * variant's image in place. Only fall back to a full replace when the set of
   * media actually changes (e.g. `hide_variants` swapping which image appears,
   * or a combined-listing product swap).
   *
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #handleVariantUpdate = (event) => {
    const source = event.detail.data.html;

    if (!source) return;
    const newMediaGallery = source.querySelector('media-gallery');

    if (!newMediaGallery) return;

    const currentIds = this.#mediaIdSet(this);
    const nextIds = this.#mediaIdSet(newMediaGallery);

    if (currentIds && currentIds === nextIds) {
      // Refresh the per-variant badge overlay (discount %, etc.) from the fresh
      // render — with the carousel DOM now kept, it would otherwise go stale on
      // products whose variants differ in price. It's a decorative sibling of
      // the slideshow, so swapping it can't trigger the iOS scroll-snap blank.
      const newBadges = newMediaGallery.querySelector(':scope > .casa-gallery-badges');
      const currentBadges = this.querySelector(':scope > .casa-gallery-badges');
      if (newBadges && currentBadges) currentBadges.replaceWith(newBadges);

      // Same media, only reordered by the variant. Keep the DOM — replacing it
      // is what triggers the iOS remount blank. The server's freshly-rendered
      // gallery carries the variant's image at slide 0; read it from there.
      const targetMediaId =
        newMediaGallery.querySelector('slideshow-slides > slideshow-slide .product-media[data-media-id]')?.dataset
          .mediaId ?? null;

      if (targetMediaId && targetMediaId !== this.#lastVariantMediaId) {
        // The variant's image genuinely changed — scroll to it in place.
        this.#lastVariantMediaId = targetMediaId;
        this.#selectMediaById(targetMediaId);
      } else {
        // No image change (e.g. a size swap): stay put, and only re-assert the
        // active slide to defeat iOS's scroll-snap re-snap back to slide 0.
        this.#pinActiveSlide();
      }
      return;
    }

    this.replaceWith(newMediaGallery);
  };

  /**
   * Re-asserts the active slide after a variant update that did NOT replace the
   * gallery, defeating iOS Safari's scroll-snap re-snap to the first slide.
   * Re-asserts across three frames because the reflow + scroll-snap
   * re-application happens asynchronously after the variant-update listeners run.
   */
  #pinActiveSlide() {
    const slideshow = this.slideshow;
    const index = slideshow?.current ?? 0;
    if (!slideshow || index <= 0) return;

    const reassert = () => {
      if (this.isConnected && slideshow.current !== index) {
        slideshow.select(index, undefined, { animate: false });
      }
    };
    requestAnimationFrame(() => {
      reassert();
      requestAnimationFrame(() => {
        reassert();
        requestAnimationFrame(reassert);
      });
    });
  }

  /**
   * Scrolls the live gallery to the slide showing the given media id, without
   * remounting anything. Re-asserts across three frames because iOS Safari
   * re-applies scroll-snap asynchronously after the variant-update reflow (the
   * same reason #pinActiveSlide re-asserts).
   *
   * @param {string} mediaId - The media id to centre on.
   */
  #selectMediaById(mediaId) {
    const slideshow = this.slideshow;
    if (!slideshow || !mediaId) return;

    const slides = slideshow.slides;
    if (!slides?.length) return;

    const index = slides.findIndex(
      (slide) => slide.querySelector('.product-media[data-media-id]')?.dataset.mediaId === mediaId
    );
    // index 0 is valid here — the variant's image can legitimately be the first
    // slide, so do NOT add an `index <= 0` bail (unlike #pinActiveSlide).
    if (index < 0) return;

    const select = () => {
      if (this.isConnected && slideshow.current !== index) {
        slideshow.select(index, undefined, { animate: false });
      }
    };

    select();
    requestAnimationFrame(() => {
      select();
      requestAnimationFrame(() => {
        select();
        requestAnimationFrame(select);
      });
    });
  }

  /**
   * An order-independent fingerprint of the gallery's media, used to decide
   * whether a variant update changed WHICH media is shown (→ replace) or merely
   * reordered the same media (→ keep the DOM and scroll in place).
   *
   * @param {ParentNode} root - The gallery (live or freshly-rendered) to read.
   * @returns {string} Sorted, comma-joined media ids (empty string if none).
   */
  #mediaIdSet(root) {
    const ids = Array.from(
      root.querySelectorAll('slideshow-slides > slideshow-slide .product-media[data-media-id]')
    ).map((el) => el.dataset.mediaId);
    return ids.length ? ids.slice().sort().join(',') : '';
  }

  /**
   * Handles the 'zoom-media:selected' event.
   * @param {ZoomMediaSelectedEvent} event - The zoom-media:selected event.
   */
  #handleZoomMediaSelected = async (event) => {
    this.slideshow?.select(event.detail.index, undefined, { animate: false });
  };

  /**
   * Zooms the media gallery.
   *
   * @param {number} index - The index of the media to zoom.
   * @param {PointerEvent} event - The pointer event.
   */
  zoom(index, event) {
    this.refs.zoomDialogComponent?.open(index, event);
  }

  /**
   * Preloads an image.
   * @param {number} index - The index of the media to preload.
   */
  preloadImage(index) {
    const zoomDialogMedia = this.refs.zoomDialogComponent?.refs.media[index];
    if (!zoomDialogMedia) return;

    this.refs.zoomDialogComponent?.loadHighResolutionImage(zoomDialogMedia);
  }

  get slideshow() {
    return this.refs.slideshow;
  }

  get media() {
    return this.refs.media;
  }

  get presentation() {
    return this.dataset.presentation;
  }
}

if (!customElements.get('media-gallery')) {
  customElements.define('media-gallery', MediaGallery);
}
