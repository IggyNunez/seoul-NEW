import { Component } from '@theme/component';

/**
 * A custom element that renders a video background.
 *
 * @typedef {object} Refs
 * @property {HTMLElement[]} videoSources - The video sources.
 * @property {HTMLVideoElement} videoElement - The video element.
 *
 * @extends Component<Refs>
 */
export class VideoBackgroundComponent extends Component {
  requiredRefs = ['videoSources', 'videoElement'];

  connectedCallback() {
    super.connectedCallback();

    const { videoSources, videoElement } = this.refs;

    for (const source of videoSources) {
      const { videoSource } = source.dataset;

      if (videoSource) source.setAttribute('src', videoSource);
    }

    videoElement.load();

    // Casa: the <video> carries data-casa-pause (no autoplay attribute), so
    // casa-offscreen-pause.js owns playback. This module loads with
    // fetchpriority="low" and can evaluate after the utility's initial scan
    // already tried (and rejected) play() on the then-sourceless video; the
    // refresh hook re-applies the in-view play now that sources exist.
    // Optional chaining makes it a no-op in the opposite ordering — the
    // utility's own scan covers that case. Deferred a macrotask: for
    // SRA-injected nodes connectedCallback fires synchronously inside the
    // innerHTML swap, and the refresh's rect reads must stay out of that
    // task (the utility defers its own MO wiring for the same reason).
    setTimeout(() => window.casa?.offscreenPauseRefresh?.(), 0);
  }
}

if (!customElements.get('video-background-component')) {
  customElements.define('video-background-component', VideoBackgroundComponent);
}
