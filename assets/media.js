import { Component } from '@theme/component';
import { ThemeEvents, MediaStartedPlayingEvent } from '@theme/events';
import { DialogCloseEvent } from '@theme/dialog';

/**
 * A deferred media element
 * @typedef {Object} Refs
 * @property {HTMLElement} deferredMediaPlayButton - The button to show the deferred media content
 * @property {HTMLElement} toggleMediaButton - The button to toggle the media
 *
 * @extends {Component<Refs>}
 */
class DeferredMedia extends Component {
  /** @type {boolean} */
  isPlaying = false;

  #abortController = new AbortController();
  /** @type {IntersectionObserver | null} */
  #autoplayObserver = null;
  /** @type {HTMLVideoElement | null} */
  #autoplayVideo = null;
  /** @type {number | null} */
  #autoplaySyncRaf = null;

  connectedCallback() {
    super.connectedCallback();
    // Casa: a gallery slide is re-parented by the slideshow on cold-load init (and
    // whenever the media set changes) — a DOM move fires disconnectedCallback, which
    // abort()s this controller and pauses the video, then connectedCallback on the
    // SAME node. The original one-shot #abortController was created once and never
    // reset, so it stayed aborted across that round-trip: every listener re-added
    // below was silently dropped ({ signal } already aborted) and the autoplay loop
    // was left frozen mid-play. That's the intermittent "gallery video is frozen"
    // bug (load-timing race — warm reloads dodge the re-parent). Re-create the
    // controller every connect so the observer + backstops actually rebind.
    this.#abortController.abort();
    this.#abortController = new AbortController();
    const signal = this.#abortController.signal;
    // If we're to use deferred media for images, we will need to run this only when it's not an image type media
    document.addEventListener(ThemeEvents.mediaStartedPlaying, this.pauseMedia.bind(this), { signal });
    window.addEventListener(DialogCloseEvent.eventName, this.pauseMedia.bind(this), { signal });

    // iOS Safari ignores the autoplay attribute on server-rendered videos that
    // aren't yet visible; play() must be called explicitly on intersection.
    // Casa: detect the autoplay video off the <deferred-media> wrapper's OWN
    // autoplay attribute (snippets/video.liquid keeps it on the wrapper), NOT the
    // video's — we strip the video's attribute just below, so keying detection on
    // `:scope > video[autoplay]` meant a re-parent could never re-find the video on
    // reconnect and the loop stayed frozen. The wrapper's attribute survives, so
    // reconnect re-detects and re-observes.
    const autoplayVideo = this.hasAttribute('autoplay') ? this.querySelector(':scope > video') : null;
    if (autoplayVideo instanceof HTMLVideoElement) {
      // Casa: strip the autoplay ATTRIBUTE and drive playback via the
      // IntersectionObserver below instead. On iOS Safari the autoplay attribute
      // makes the player discard the poster the instant it starts — before the
      // first frame decodes — so the video paints white for a beat as a slide
      // scrolls in. The live (Prestige) PDP autoplays on scroll the exact same
      // way but WITHOUT the attribute (JS play() only), which keeps the poster
      // painted until a frame is ready. Match that. We run before the slide is
      // ever visible, so iOS never acts on the attribute. muted/loop/playsinline
      // are untouched, so the IO-driven play() still runs inline.
      autoplayVideo.removeAttribute('autoplay');
      this.#autoplayVideo = autoplayVideo;
      this.#observeAutoplayVideo(autoplayVideo);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.pauseMedia();
    if (this.#autoplaySyncRaf) {
      cancelAnimationFrame(this.#autoplaySyncRaf);
      this.#autoplaySyncRaf = null;
    }
    this.#abortController.abort();
    this.#autoplayObserver?.disconnect();
    this.#autoplayObserver = null;
    this.#autoplayVideo = null;
  }

  /**
   * Plays/pauses the autoplay video as it enters/leaves the viewport.
   * Required for iOS Safari, which ignores the autoplay attribute on
   * <video> elements that aren't visible when the page parses.
   * @param {HTMLVideoElement} video
   */
  #observeAutoplayVideo(video) {
    // Casa: an autoplaying <video> draws nothing until it has decoded its first
    // frame (preload="metadata" ships no frame). On iOS Safari the autoplay
    // attribute drops the poster the instant it scrolls in, so the bare <video>
    // paints a white/partial box for a beat before the picture arrives. Hold it
    // transparent (CSS .casa-video-loading) so the poster <img> sibling shows
    // through, and reveal the video the moment it has a frame. No-JS / load
    // failure falls back to the poster image, never a white box.
    if (video.readyState < 2 /* HAVE_CURRENT_DATA */) {
      video.classList.add('casa-video-loading');
      const reveal = () => video.classList.remove('casa-video-loading');
      const signal = this.#abortController.signal;
      video.addEventListener('loadeddata', reveal, { once: true, signal });
      video.addEventListener('playing', reveal, { once: true, signal });
    }

    // Casa: IO entries are triggers only — geometry is the source of truth,
    // NOT entry.isIntersecting. iOS re-fires observers with stale flags when
    // the URL bar collapses/expands (see assets/casa-offscreen-pause.js),
    // which can pause an on-screen video or restart one already scrolled
    // past. Reduced-motion users get the poster, never a JS-driven loop
    // (casa-animations.css only covers CSS animations, not play()).
    this.#autoplayObserver = new IntersectionObserver((entries) => {
      if (entries.length === 0) return;
      this.#syncAutoplayVideo();
      // Multiple thresholds so the callback fires as the video crosses ~half
      // visible in either direction — the play/pause boundary the sync gate
      // uses. 0 is essential too: without it the callback never fires once the
      // video drops below the lowest threshold on its way off-screen, so the
      // sync never runs on full exit and the video decodes off-screen forever.
    }, { threshold: [0, 0.25, 0.5, 0.75] });
    this.#autoplayObserver.observe(video);

    this.#bindAutoplayBackstops();
    this.#scheduleAutoplaySync();
  }

  #bindAutoplayBackstops() {
    const signal = this.#abortController.signal;
    window.addEventListener('scroll', this.#scheduleAutoplaySync, { passive: true, signal });
    window.addEventListener('resize', this.#scheduleAutoplaySync, { passive: true, signal });
    document.addEventListener('visibilitychange', this.#scheduleAutoplaySync, { signal });
    document.addEventListener('slideshow:select', this.#scheduleAutoplaySync, { signal });
  }

  #scheduleAutoplaySync = () => {
    if (this.#autoplaySyncRaf) return;
    this.#autoplaySyncRaf = requestAnimationFrame(() => {
      this.#autoplaySyncRaf = null;
      this.#syncAutoplayVideo();
    });
  };

  #syncAutoplayVideo() {
    const video = this.#autoplayVideo;
    if (!(video instanceof HTMLVideoElement)) return;

    const rect = video.getBoundingClientRect();
    const zeroSize = rect.width === 0 && rect.height === 0; // display:none / detached
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    // Play only when the video is the slide you're actually looking at, keyed
    // on the VISIBLE FRACTION of the video — not the slide's aria-hidden. The PDP
    // gallery is a one-at-a-time horizontal scroll-snap carousel: the current
    // slide is ~100% visible, neighbours ~0% off to the side. aria-hidden was
    // unreliable — the slideshow only updates it on click-navigation, so a video
    // *swiped* to centre stayed flagged hidden and never played (the dfe9f2cf
    // regression). Fraction is unambiguous: high when centred (in view / slid-to),
    // low when a neighbour peeks or the gallery scrolls off-page — which also
    // keeps an off-screen slide from decoding (the thing dfe9f2cf was after).
    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    const visibleFraction = zeroSize ? 0 : (visibleWidth * visibleHeight) / (rect.width * rect.height);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Still pause inside a genuinely hidden container (closed dialog / [hidden]);
    // that's independent of carousel position.
    const inHiddenContainer = Boolean(this.closest('[hidden], dialog:not([open])'));

    if (document.hidden || inHiddenContainer || reduceMotion || visibleFraction < 0.5) {
      video.pause();
      return;
    }

    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  /**
   * Updates the visual hint for play/pause state
   * @param {boolean} isPlaying - Whether the video is currently playing
   */
  updatePlayPauseHint(isPlaying) {
    const toggleMediaButton = this.refs.toggleMediaButton;
    if (toggleMediaButton instanceof HTMLElement) {
      toggleMediaButton.classList.remove('hidden');
      const playIcon = toggleMediaButton.querySelector('.icon-play');
      if (playIcon) playIcon.classList.toggle('hidden', isPlaying);
      const pauseIcon = toggleMediaButton.querySelector('.icon-pause');
      if (pauseIcon) pauseIcon.classList.toggle('hidden', !isPlaying);
    }
  }

  /**
   * Shows the deferred media content
   */
  showDeferredMedia = () => {
    this.loadContent(true);
    this.isPlaying = true;
    this.updatePlayPauseHint(this.isPlaying);
  };

  /**
   * Loads the content
   * @param {boolean} [focus] - Whether to focus the content
   */
  loadContent(focus = true) {
    if (this.getAttribute('data-media-loaded')) return;

    this.dispatchEvent(new MediaStartedPlayingEvent(this));

    const content = this.querySelector('template')?.content.firstElementChild?.cloneNode(true);

    if (!content) return;

    this.setAttribute('data-media-loaded', 'true');
    this.appendChild(content);

    if (focus && content instanceof HTMLElement) {
      content.focus();
    }

    this.refs.deferredMediaPlayButton?.classList.add('deferred-media__playing');

    if (content instanceof HTMLVideoElement && content.getAttribute('autoplay')) {
      // force autoplay for safari
      content.play();
    }
  }

  /**
   * Toggle play/pause state of the media
   */
  toggleMedia() {
    if (this.isPlaying) {
      this.pauseMedia();
    } else {
      this.playMedia();
    }
  }

  playMedia() {
    /** @type {HTMLIFrameElement | null} */
    const iframe = this.querySelector('iframe[data-video-type]');
    if (iframe) {
      iframe.contentWindow?.postMessage(
        iframe.dataset.videoType === 'youtube'
          ? '{"event":"command","func":"playVideo","args":""}'
          : '{"method":"play"}',
        '*'
      );
    } else {
      this.querySelector('video')?.play();
    }
    this.isPlaying = true;
    this.updatePlayPauseHint(this.isPlaying);
  }

  /**
   * Pauses the media
   */
  pauseMedia() {
    /** @type {HTMLIFrameElement | null} */
    const iframe = this.querySelector('iframe[data-video-type]');

    if (iframe) {
      iframe.contentWindow?.postMessage(
        iframe.dataset.videoType === 'youtube'
          ? '{"event":"command","func":"' + 'pauseVideo' + '","args":""}'
          : '{"method":"pause"}',
        '*'
      );
    } else {
      this.querySelector('video')?.pause();
    }
    this.isPlaying = false;

    // If we've already revealed the deferred media, we should toggle the play/pause hint
    if (this.getAttribute('data-media-loaded')) {
      this.updatePlayPauseHint(this.isPlaying);
    }
  }
}

if (!customElements.get('deferred-media')) {
  customElements.define('deferred-media', DeferredMedia);
}

/**
 * A product model
 */
class ProductModel extends DeferredMedia {
  #abortController = new AbortController();

  connectedCallback() {
    super.connectedCallback();
    // Casa: mirror the DeferredMedia reconnect fix for the model-viewer's own
    // controller. A slide re-parent (disconnect→reconnect on the same node) aborts
    // this controller in disconnectedCallback, and the one-shot field was never
    // reset — so after a move the tap-to-pause pointer listeners never rebound.
    // Recreate it every connect, and re-bind the listeners here if the model was
    // already loaded before the move (loadContent early-returns once
    // data-media-loaded is set, so setupModelViewerUI won't re-run on its own).
    this.#abortController.abort();
    this.#abortController = new AbortController();
    if (this.modelViewerUI) this.#bindModelPointerEvents();
  }

  loadContent() {
    super.loadContent();

    Shopify.loadFeatures([
      {
        name: 'model-viewer-ui',
        version: '1.0',
        onLoad: this.setupModelViewerUI.bind(this),
      },
    ]);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
  }

  pauseMedia() {
    super.pauseMedia();
    this.modelViewerUI?.pause();
  }

  playMedia() {
    super.playMedia();
    this.modelViewerUI?.play();
  }

  /**
   * @param {Error[]} errors
   */
  async setupModelViewerUI(errors) {
    if (errors) return;

    if (!Shopify.ModelViewerUI) {
      await this.#waitForModelViewerUI();
    }

    if (!Shopify.ModelViewerUI) return;

    const element = this.querySelector('model-viewer');
    if (!element) return;

    this.modelViewerUI = new Shopify.ModelViewerUI(element);
    if (!this.modelViewerUI) return;

    this.playMedia();

    this.#bindModelPointerEvents();
  }

  /**
   * Binds the tap-to-pause pointer listeners on the model-viewer element.
   * Extracted so a reconnect (slide re-parent) can rebind them with a fresh
   * abort signal — setupModelViewerUI only runs on first load (loadContent
   * early-returns once data-media-loaded is set).
   */
  #bindModelPointerEvents() {
    const element = this.querySelector('model-viewer');
    if (!element) return;

    const signal = this.#abortController.signal;

    // Track pointer events to detect taps
    let pointerStartX = 0;
    let pointerStartY = 0;

    element.addEventListener(
      'pointerdown',
      (/** @type {PointerEvent} */ event) => {
        pointerStartX = event.clientX;
        pointerStartY = event.clientY;
      },
      { signal }
    );

    element.addEventListener(
      'click',
      (/** @type {PointerEvent} */ event) => {
        const distanceX = Math.abs(event.clientX - pointerStartX);
        const distanceY = Math.abs(event.clientY - pointerStartY);
        const totalDistance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

        // Try to ensure that this is a tap, not a drag.
        if (totalDistance < 10) {
          // When the model is paused, it has its own button overlay for playing the model again.
          // If we're receiving a click event, it means the model is playing, all we can do is pause it.
          this.pauseMedia();
        }
      },
      { signal }
    );
  }

  /**
   * Waits for Shopify.ModelViewerUI to be defined.
   * This seems to be necessary for Safari since Shopify.ModelViewerUI is always undefined on the first try.
   * @returns {Promise<void>}
   */
  async #waitForModelViewerUI() {
    const maxAttempts = 10;
    const interval = 50;

    for (let i = 0; i < maxAttempts; i++) {
      if (Shopify.ModelViewerUI) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

if (!customElements.get('product-model')) {
  customElements.define('product-model', ProductModel);
}
