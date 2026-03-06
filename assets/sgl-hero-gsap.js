/**
 * Seoul Glow Lab — GSAP Hero Animations
 * Targets the native Horizon hero section DOM elements.
 * Loads lazily: waits for GSAP + ScrollTrigger, then animates.
 * Respects prefers-reduced-motion.
 */
(function () {
  'use strict';

  /* ── Bail if user prefers reduced motion ── */
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (prefersReducedMotion.matches) return;

  /* ── Wait for GSAP to be available ── */
  function waitForGSAP(cb, attempts) {
    attempts = attempts || 0;
    if (window.gsap && window.ScrollTrigger) {
      cb();
    } else if (attempts < 50) {
      requestAnimationFrame(function () {
        waitForGSAP(cb, attempts + 1);
      });
    }
  }

  waitForGSAP(function () {
    gsap.registerPlugin(ScrollTrigger);

    /* ── Find the hero section ── */
    var hero = document.querySelector('.hero-wrapper .hero');
    if (!hero) return;

    var sectionWrapper = hero.closest('.hero-wrapper');

    /* ── Gather animated elements ── */
    var contentWrapper = hero.querySelector('.hero__content-wrapper');
    var blocks = contentWrapper ? contentWrapper.querySelectorAll('.block') : [];
    var images = hero.querySelectorAll('.hero__image');
    var videos = hero.querySelectorAll('.hero__video');
    var mediaWrapper = hero.querySelector('.hero__media-wrapper');

    /* ── Set initial states (hidden) ── */
    if (blocks.length) {
      gsap.set(blocks, {
        opacity: 0,
        y: 30
      });
    }

    if (images.length) {
      gsap.set(images, {
        scale: 1.08,
        opacity: 0
      });
    }

    if (videos.length) {
      gsap.set(videos, {
        scale: 1.08,
        opacity: 0
      });
    }

    /* ── Entrance timeline ── */
    var tl = gsap.timeline({
      defaults: {
        ease: 'power3.out',
        duration: 0.9
      },
      delay: 0.15
    });

    /* Media entrance — scale down and fade in */
    if (images.length) {
      tl.to(images, {
        scale: 1,
        opacity: 1,
        duration: 1.2,
        ease: 'power2.out'
      }, 0);
    }

    if (videos.length) {
      tl.to(videos, {
        scale: 1,
        opacity: 1,
        duration: 1.2,
        ease: 'power2.out'
      }, 0);
    }

    /* Blocks entrance — stagger up */
    if (blocks.length) {
      tl.to(blocks, {
        opacity: 1,
        y: 0,
        duration: 0.8,
        stagger: 0.12,
        ease: 'power2.out'
      }, 0.25);
    }

    /* ── Parallax on scroll ── */
    if (mediaWrapper && window.innerWidth >= 750) {
      gsap.to(mediaWrapper, {
        yPercent: 12,
        ease: 'none',
        scrollTrigger: {
          trigger: sectionWrapper,
          start: 'top top',
          end: 'bottom top',
          scrub: true
        }
      });
    }

    /* ── Content fade on scroll (only desktop) ── */
    if (contentWrapper && window.innerWidth >= 750) {
      gsap.to(contentWrapper, {
        opacity: 0.15,
        y: -40,
        ease: 'none',
        scrollTrigger: {
          trigger: sectionWrapper,
          start: '60% top',
          end: 'bottom top',
          scrub: true
        }
      });
    }

    /* ── Refresh ScrollTrigger after images load ── */
    var heroImages = hero.querySelectorAll('img');
    var loaded = 0;
    var total = heroImages.length;

    if (total === 0) return;

    function onImageLoad() {
      loaded++;
      if (loaded >= total) {
        ScrollTrigger.refresh();
      }
    }

    heroImages.forEach(function (img) {
      if (img.complete) {
        onImageLoad();
      } else {
        img.addEventListener('load', onImageLoad, { once: true });
        img.addEventListener('error', onImageLoad, { once: true });
      }
    });
  });
})();
