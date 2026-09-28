import { Component } from '@theme/component';
import {
  supportsViewTransitions,
  startViewTransition,
  onAnimationEnd,
  prefersReducedMotion,
  debounce,
  preloadImage,
  isLowPowerDevice,
} from '@theme/utilities';
import { scrollIntoView } from '@theme/scrolling';
import { ZoomMediaSelectedEvent } from '@theme/events';
import { DialogCloseEvent } from '@theme/dialog';
/**
 * A custom element that renders a zoom dialog.
 *
 * Casa: the enlarged gallery is a horizontal left/right slideshow on both
 * mobile and desktop (see product-media-gallery-content.liquid); ‹ ›
 * controls, arrow keys, and thumbnail clicks all page through
 * selectThumbnail(), which scrolls the gallery <ul> horizontally.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog - The dialog element.
 * @property {HTMLElement[]} media - The media elements.
 * @property {HTMLElement} thumbnails - The thumbnails elements.
 *
 * @extends Component<Refs>
 */
export class ZoomDialog extends Component {
  requiredRefs = ['dialog', 'media', 'thumbnails'];

  #highResImagesLoaded = /** @type {Set<string>} */ (new Set());

  connectedCallback() {
    super.connectedCallback();
    this.refs.dialog.addEventListener('scroll', this.handleScroll);
    // The enlarged gallery scrolls the <ul> (horizontally on desktop, per
    // the min-width:750px rules in product-media-gallery-content.liquid),
    // not the <dialog>. Listen there too so the active thumbnail tracks a
    // swipe or arrow-key page, not just a dialog scroll.
    this.galleryEl = this.refs.media?.[0]?.parentElement ?? null;
    this.galleryEl?.addEventListener('scroll', this.handleScroll);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.refs.dialog.removeEventListener('scroll', this.handleScroll);
    this.galleryEl?.removeEventListener('scroll', this.handleScroll);
  }

  /**
   * Opens the zoom dialog.
   *
   * @param {number} index - The index of the media to zoom.
   * @param {PointerEvent} event - The pointer event.
   */
  async open(index, event) {
    event.preventDefault();

    const { dialog, media, thumbnails } = this.refs;
    const targetImage = media[index];
    const targetThumbnail = thumbnails.children[index];

    const open = () => {
      dialog.showModal();

      for (const target of [targetThumbnail, targetImage]) {
        target?.scrollIntoView({ behavior: 'instant' });
      }
    };

    /** @type {HTMLElement | null} */
    const sourceImage = event.target instanceof Element ? event.target.closest('li,slideshow-slide') : null;

    if (!supportsViewTransitions() || isLowPowerDevice() || !sourceImage || !targetImage) return open();

    const itemTransitionName = `gallery-item-open`;
    sourceImage.style.setProperty('view-transition-name', itemTransitionName);

    const focalPoint = sourceImage.dataset.focalPoint;
    if (focalPoint) {
      document.documentElement.style.setProperty('--gallery-media-focal-point', focalPoint);
    }

    await startViewTransition(() => {
      open();
      sourceImage.style.removeProperty('view-transition-name');
      targetImage.style.setProperty('view-transition-name', itemTransitionName);
    });

    document.documentElement.style.removeProperty('--gallery-media-focal-point');
    targetImage.style.removeProperty('view-transition-name');

    this.selectThumbnail(index, { behavior: 'instant' });
  }

  /**
   * Loads a high-resolution image for a specific media container
   * @param {HTMLElement} mediaContainer - The media container element
   */
  loadHighResolutionImage(mediaContainer) {
    if (!mediaContainer.classList.contains('product-media-container--image')) return false;

    const image = mediaContainer.querySelector('img.product-media__image');
    if (!image || !(image instanceof HTMLImageElement)) return false;

    const highResolutionUrl = image.getAttribute('data_max_resolution');
    if (!highResolutionUrl || this.#highResImagesLoaded.has(highResolutionUrl)) return false;

    preloadImage(highResolutionUrl);

    const newImage = new Image();
    newImage.className = image.className;
    newImage.alt = image.alt;
    newImage.setAttribute('data_max_resolution', highResolutionUrl);

    // When the high-resolution image loads, replace the existing image
    newImage.onload = () => {
      image.replaceWith(newImage);
      this.#highResImagesLoaded.add(highResolutionUrl);
    };

    newImage.src = highResolutionUrl;
  }

  /**
   * Handles the scroll event of the dialog, which is used to update the active thumbnail when the corresponding image is visible in the main view.
   * @param {Event} event - The scroll event.
   */
  handleScroll = debounce(async () => {
    const { media, thumbnails } = this.refs;

    const mostVisibleElement = await getMostVisibleElement(media);
    const activeIndex = media.indexOf(mostVisibleElement);
    const targetThumbnail = thumbnails.children[activeIndex];

    if (!targetThumbnail || !(targetThumbnail instanceof HTMLElement)) return;

    Array.from(thumbnails.querySelectorAll('button')).forEach((button, i) => {
      button.setAttribute('aria-selected', `${i === activeIndex}`);
    });

    this.loadHighResolutionImage(mostVisibleElement);
    this.syncActiveVideo(activeIndex);
    this.dispatchEvent(new ZoomMediaSelectedEvent(activeIndex));
  }, 50);

  /**
   * Play the active slide's video (muted) and pause every other. The zoom
   * dialog's deferred-media autoplay observer doesn't fire in-dialog, so a
   * gallery video sat paused when it became the active slide ("won't play
   * in the slideshow", merchant 2026-08-12). Drive playback from whichever
   * panel is active — on open, arrow/key nav, thumbnail click, and swipe.
   * Videos are muted, so play() needs no separate gesture (and every entry
   * point is inside a user gesture anyway).
   * @param {number} activeIndex
   */
  syncActiveVideo(activeIndex) {
    const active = this.refs.media[activeIndex]?.querySelector('video') ?? null;
    this.activeVideo = active;
    this.refs.media.forEach((el) => {
      const video = el.querySelector('video');
      if (!video) return;
      if (video === active) {
        this.bindVideoControls(video);
        this.kickVideo(video);
      } else if (!video.paused) {
        video.pause();
      }
    });
  }

  /**
   * Give every zoom video a click-to-play/pause control and a play-button
   * affordance, bound once. Autoplay (kickVideo) works on permissive
   * browsers, but Safari — especially Low Power Mode — blocks the
   * out-of-gesture replay, leaving the video paused with no way to start it
   * ("video still not playing", merchant 2026-08-12). A click is always a
   * user gesture, so tapping the video (or the play button that shows while
   * paused) reliably plays it everywhere. The button's visibility follows
   * the real paused state via a class on the panel.
   * @param {HTMLVideoElement} video
   */
  bindVideoControls(video) {
    if (video.dataset.casaZoomBound) return;
    video.dataset.casaZoomBound = '1';

    const panel = video.closest('.product-media-container');
    video.style.cursor = 'pointer';

    video.addEventListener('click', (event) => {
      event.stopPropagation();
      if (video.paused) {
        const played = video.play();
        if (played && typeof played.catch === 'function') played.catch(() => {});
      } else {
        video.pause();
      }
    });

    if (panel) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dialog-zoomed-gallery__play';
      button.setAttribute('aria-label', 'Play video');
      button.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const played = video.play();
        if (played && typeof played.catch === 'function') played.catch(() => {});
      });
      panel.appendChild(button);

      const reflect = () => panel.classList.toggle('is-video-paused', video.paused);
      video.addEventListener('play', reflect);
      video.addEventListener('pause', reflect);
      reflect();
    }
  }

  /**
   * Start (and keep) the active slide's video playing. The dialog's
   * deferred-media observer pauses the video exactly ONCE on activation
   * (verified: play → pause 2ms later at t=0, then left alone), so a
   * single replay after that settles makes playback stick. Bounded to a
   * few attempts so it can never thrash, and guarded on this.activeVideo
   * so a replay can't resurrect a video the shopper has paged away from.
   * @param {HTMLVideoElement} video
   * @param {number} attempt
   */
  kickVideo(video, attempt = 0) {
    if (video !== this.activeVideo) return;
    const played = video.play();
    if (played && typeof played.catch === 'function') played.catch(() => {});
    if (attempt < 4) {
      setTimeout(() => {
        if (video === this.activeVideo && video.paused) this.kickVideo(video, attempt + 1);
      }, 250);
    }
  }

  /**
   * Closes the zoom dialog.
   */
  async close() {
    const { dialog, media } = this.refs;

    if (!supportsViewTransitions() || isLowPowerDevice()) return this.closeDialog();

    // Find the most visible image using IntersectionObserver
    const mostVisibleElement = await getMostVisibleElement(media);

    // Get the index and set up transition
    const activeIndex = media.indexOf(mostVisibleElement);
    const itemTransitionName = `gallery-item-close`;

    const mediaGallery = /** @type {import('./media-gallery').MediaGallery | undefined} */ (
      this.closest('media-gallery')
    );

    const slideshowActive = mediaGallery?.presentation === 'carousel';

    const slide = slideshowActive ? mediaGallery.slideshow?.slides?.[activeIndex] : mediaGallery?.media?.[activeIndex];

    if (!slide) return this.closeDialog();
    const focalPoint = slide.dataset.focalPoint;
    if (focalPoint) {
      document.documentElement.style.setProperty('--gallery-media-focal-point', focalPoint);
    }

    dialog.classList.add('dialog--closed');

    await onAnimationEnd(this.refs.thumbnails);

    mostVisibleElement.style.setProperty('view-transition-name', itemTransitionName);

    await startViewTransition(() => {
      mostVisibleElement.style.removeProperty('view-transition-name');
      slide.style.setProperty('view-transition-name', itemTransitionName);
      this.closeDialog();
    });

    slide.style.removeProperty('view-transition-name');
    dialog.classList.remove('dialog--closed');
    document.documentElement.style.removeProperty('--gallery-media-focal-point');
  }

  closeDialog() {
    const { dialog, media } = this.refs;
    // Stop kickVideo retries and pause any playing gallery video so it
    // doesn't keep running after close.
    this.activeVideo = null;
    media.forEach((el) => {
      const video = el.querySelector('video');
      if (video && !video.paused) video.pause();
    });
    dialog.close();
    window.dispatchEvent(new DialogCloseEvent());
  }

  /**
   * Closes the dialog on Escape; pages the enlarged slideshow on Arrow keys.
   * Desktop shows the gallery as a horizontal left/right slideshow (the
   * layout mobile already uses), so arrow keys are the keyboard equivalent
   * of the on-screen ‹ › controls.
   *
   * @param {KeyboardEvent} event - The keyboard event.
   */
  handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.next();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previous();
    }
  }

  /**
   * The index of the currently-shown media. On the horizontal slideshow
   * this is read straight from the settled scroll position (deterministic,
   * no race with the async aria-selected update). Other layouts fall back
   * to the selected thumbnail.
   * @returns {number}
   */
  getCurrentIndex() {
    const { media, thumbnails } = this.refs;
    const gallery = media?.[0]?.parentElement;
    if (gallery && gallery.scrollWidth > gallery.clientWidth + 1 && gallery.clientWidth > 0) {
      return Math.round(gallery.scrollLeft / gallery.clientWidth);
    }
    const buttons = Array.from(thumbnails?.querySelectorAll('button') ?? []);
    const index = buttons.findIndex((button) => button.getAttribute('aria-selected') === 'true');
    return index < 0 ? 0 : index;
  }

  /** Page to the next image (clamped at the last). */
  next() {
    const { media } = this.refs;
    this.selectThumbnail(Math.min(this.getCurrentIndex() + 1, media.length - 1), {
      behavior: prefersReducedMotion() ? 'instant' : 'smooth',
    });
  }

  /** Page to the previous image (clamped at the first). */
  previous() {
    this.selectThumbnail(Math.max(this.getCurrentIndex() - 1, 0), {
      behavior: prefersReducedMotion() ? 'instant' : 'smooth',
    });
  }

  /**
   * Handles the click event of a thumbnail.
   * @param {number} index - The index of the thumbnail to select.
   */
  async handleThumbnailClick(index) {
    const behavior = prefersReducedMotion() ? 'instant' : 'smooth';
    this.selectThumbnail(index, { behavior });
  }

  /**
   * Handles the pointer enter event of a thumbnail.
   * @param {number} index - The index of the thumbnail to load the high-resolution image for.
   */
  async handleThumbnailPointerEnter(index) {
    const { media } = this.refs;
    if (!media[index]) return;

    this.loadHighResolutionImage(media[index]);
  }

  /**
   * Handles the selection of a thumbnail.
   * @param {number} index - The index of the thumbnail to select.
   * @param {Object} options - The options for the selection.
   * @param {ScrollBehavior} options.behavior - The behavior of the scroll.
   */
  async selectThumbnail(index, options = { behavior: 'smooth' }) {
    if (!this.refs.thumbnails || !this.refs.thumbnails.children.length) return;

    // Guard if invalid
    if (isNaN(index) || index < 0 || index >= this.refs.thumbnails.children.length) return;

    const { media, thumbnails } = this.refs;
    const targetThumbnail = thumbnails.children[index];

    if (!targetThumbnail || !(targetThumbnail instanceof HTMLElement)) return;

    Array.from(thumbnails.querySelectorAll('button')).forEach((button, i) => {
      button.setAttribute('aria-selected', `${i === index}`);
    });

    scrollIntoView(targetThumbnail, {
      ancestor: thumbnails,
      behavior: options.behavior,
      block: 'center',
      inline: 'center',
    });

    const targetImage = media[index];

    if (targetImage) {
      const gallery = targetImage.parentElement;
      // On the desktop horizontal slideshow the gallery <ul> scrolls
      // horizontally (scrollWidth > clientWidth); scrollIntoView there
      // picks the wrong ancestor (the dialog) and leaves the panel put,
      // so page the gallery explicitly. The vertical/other layouts keep
      // the stock scrollIntoView.
      //
      // Paging is INSTANT, not smooth: loadHighResolutionImage() below
      // replaces the <img> element, and that reflow mid-animation — with
      // scroll-snap-type: x mandatory — cancels a smooth scroll and snaps
      // the panel back to where it started (verified: smooth left the
      // panel put; instant lands every time, even on rapid clicks). An
      // instant page completes in one frame before the swap, so there is
      // nothing for the reflow to interrupt.
      if (gallery && gallery.scrollWidth > gallery.clientWidth + 1) {
        gallery.scrollTo({ left: targetImage.offsetLeft, behavior: 'instant' });
      } else {
        targetImage.scrollIntoView({ behavior: options.behavior });
      }

      this.loadHighResolutionImage(targetImage);
    }
    this.syncActiveVideo(index);
    this.dispatchEvent(new ZoomMediaSelectedEvent(index));
  }
}

if (!customElements.get('zoom-dialog')) {
  customElements.define('zoom-dialog', ZoomDialog);
}

/**
 * Get the most visible element from a list of elements.
 * @param {HTMLElement[]} elements - The elements to get the most visible element from.
 * @returns {Promise<HTMLElement>} A promise that resolves to the most visible element.
 */
function getMostVisibleElement(elements) {
  return new Promise((resolve) => {
    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries.reduce((prev, current) =>
          current.intersectionRatio > prev.intersectionRatio ? current : prev
        );
        observer.disconnect();
        resolve(/** @type {HTMLElement} */ (mostVisible.target));
      },
      {
        threshold: Array.from({ length: 100 }, (_, i) => i / 100),
      }
    );

    for (const element of elements) {
      observer.observe(element);
    }
  });
}
