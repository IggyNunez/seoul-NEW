/**
 * casa-edd.js — Estimated-Delivery normaliser (global, loaded from theme.liquid).
 *
 * PROBLEM: the c-edd-estimated-delivery-date app injects a client-computed
 * properties[Estimated delivery]="Jul 10 - Jul 14" into ONLY the PDP buy-box form.
 * Shopify hashes line-item properties into the line KEY, so adding the same variant
 * once tagged (buy box) and once bare (any section CTA), or twice with a drifted
 * date, splits it into two cart lines.
 *
 * FIX: intercept every POST /cart/add(.js) and normalise the `Estimated delivery`
 * line-item property to ONE canonical value per variant, so every add of a variant
 * carries the identical property -> Shopify merges into a single line. The date stays
 * a real (non-underscore) line-item property, so it still shows at checkout, on the
 * order, and via the native cart render.
 *
 * Canonical value for a variant (first match wins):
 *   1. the value already on that variant's cart line (reuse — matches an existing
 *      tagged OR bare line exactly, and absorbs date drift);
 *   2. the value resolved earlier this page load (session cache — makes concurrent
 *      / repeat fresh adds deterministic);
 *   3. the app's injected value for that variant on the current page (buy box);
 *   4. none (bare surfaces — merges, line simply has no date).
 *
 * Covers every AJAX add path (buy-box FormData + all JSON items[] section CTAs) with
 * no per-path edits; future add surfaces inherit it. The only adds it can't see are
 * the rare network-error form.submit() full-page fallbacks.
 */
(function () {
  'use strict';

  if (window.__casaEddInstalled) return; // idempotent — theme editor re-injects scripts
  window.__casaEddInstalled = true;

  var PROP = 'Estimated delivery';
  var FORM_PROP = 'properties[' + PROP + ']';
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!nativeFetch) return;

  var sessionValue = new Map(); // variantId(string) -> string|null (null = attach nothing)
  var inFlight = new Map(); // variantId(string) -> Promise<string|null>
  var cartSnap = null; // { at:number, p:Promise<cart|null> }

  function cartBase() {
    var r = window.Theme && Theme.routes && Theme.routes.cart_url;
    return typeof r === 'string' && r ? r : '/cart';
  }

  function fetchCartOnce() {
    return nativeFetch(cartBase() + '.js', { headers: { Accept: 'application/json' } }).then(function (r) {
      return r.ok ? r.json() : null;
    });
  }

  // Fresh-ish cart snapshot; deduped within an add burst, invalidated per add.
  // Retry once on failure: reuse-in-cart is the branch that stops a split against a
  // pre-existing (possibly date-drifted) line, so a transient /cart.js miss must not
  // silently disable it.
  function getCart() {
    var now = window.performance && performance.now ? performance.now() : 0;
    if (cartSnap && now - cartSnap.at < 1200) return cartSnap.p;
    var p = fetchCartOnce()
      .catch(function () {
        return fetchCartOnce();
      })
      .catch(function () {
        return null;
      });
    cartSnap = { at: now, p: p };
    return p;
  }
  function invalidateCart() {
    cartSnap = null;
  }
  document.addEventListener('cart:update', invalidateCart);

  // The app's injected value for THIS variant on the current page (buy-box form only).
  function pageValueFor(variantId) {
    var inputs = document.querySelectorAll('input[name="' + FORM_PROP + '"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var val = (input.value || '').trim();
      if (!val) continue;
      var form = input.form || (input.closest ? input.closest('form') : null);
      var idField = form ? form.querySelector('[name="id"]') : null;
      if (idField && String(idField.value) === String(variantId)) return val;
    }
    return null;
  }

  // Canonical value for a variant. A shared in-flight promise collapses concurrent
  // adds of the same variant so they can never resolve to different strings.
  function canonicalFor(variantId) {
    variantId = String(variantId);
    if (inFlight.has(variantId)) return inFlight.get(variantId);
    var p = getCart().then(function (cart) {
      var line = null;
      if (cart && cart.items) {
        for (var i = 0; i < cart.items.length; i++) {
          if (String(cart.items[i].variant_id) === variantId) {
            line = cart.items[i];
            break;
          }
        }
      }
      if (line) {
        var lv = line.properties && line.properties[PROP];
        var v = lv ? String(lv) : null;
        sessionValue.set(variantId, v);
        return v;
      }
      if (sessionValue.has(variantId)) return sessionValue.get(variantId);
      var pv = pageValueFor(variantId);
      var out = pv ? pv : null;
      sessionValue.set(variantId, out);
      return out;
    });
    inFlight.set(variantId, p);
    p.catch(function () {}).then(function () {
      if (inFlight.get(variantId) === p) inFlight.delete(variantId);
    });
    return p;
  }

  function isAddUrl(url) {
    try {
      var path = new URL(url, window.location.href).pathname.replace(/\/+$/, '');
      return /\/cart\/add(\.js)?$/.test(path);
    } catch (e) {
      return false;
    }
  }

  function applyToItem(item, value) {
    if (!item || item.id == null) return;
    if (value) {
      item.properties = Object.assign({}, item.properties || {});
      item.properties[PROP] = value;
    } else if (item.properties) {
      delete item.properties[PROP];
    }
  }

  // Normalise a parsed JSON add body ({items:[…]} or a bare {id,quantity}). Mutates + returns it.
  function normaliseJson(body) {
    var items = Array.isArray(body.items) ? body.items : body.id != null ? [body] : [];
    return Promise.all(
      items.map(function (item) {
        return canonicalFor(item.id).then(function (v) {
          applyToItem(item, v);
        });
      })
    ).then(function () {
      return body;
    });
  }

  // Normalise a FormData add body (single-variant buy-box / bundle form). Mutates + returns it.
  function normaliseForm(fd) {
    var id = fd.get('id');
    if (id == null) {
      fd.delete(FORM_PROP);
      return Promise.resolve(fd);
    }
    return canonicalFor(id).then(function (v) {
      fd.delete(FORM_PROP); // remove the app's copies (it injects the input twice)
      if (v) fd.append(FORM_PROP, v);
      return fd;
    });
  }

  // Primary variant id of an add body -> per-variant lock key. Only same-variant adds
  // can split, so they serialise; different variants stay parallel (no added latency).
  function lockKeyFor(body) {
    try {
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        var fid = body.get('id');
        return fid != null ? 'casa-edd-add:' + fid : 'casa-edd-add';
      }
      if (typeof body === 'string' && body) {
        var p = JSON.parse(body);
        var jid = Array.isArray(p.items) ? p.items[0] && p.items[0].id : p.id;
        return jid != null ? 'casa-edd-add:' + jid : 'casa-edd-add';
      }
    } catch (e) {}
    return 'casa-edd-add';
  }

  // Normalise, then fire the add. invalidateCart() first so that INSIDE the cross-tab
  // lock the resolve reads a fresh cart and reuse-in-cart sees any add another tab just
  // committed. Each branch uses two-arg .then(onFulfilled, onRejected): a NORMALISE
  // failure falls back to the un-normalised add, but the add POST fires EXACTLY ONCE —
  // its own rejection propagates to the caller and is never retried here, so a
  // network-rejected (lost-response) add can't double-commit / inflate quantity.
  function normalizeAndAdd(input, init) {
    invalidateCart();
    var body = init && init.body;

    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      return normaliseForm(body).then(
        function () {
          return nativeFetch(input, init);
        },
        function () {
          return nativeFetch(input, init);
        }
      );
    }

    if (typeof body === 'string' && body) {
      var parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        parsed = null;
      }
      if (parsed && (parsed.items || parsed.id != null)) {
        return normaliseJson(parsed).then(
          function (out) {
            return nativeFetch(input, Object.assign({}, init, { body: JSON.stringify(out) }));
          },
          function () {
            return nativeFetch(input, init);
          }
        );
      }
    }

    return nativeFetch(input, init); // URLSearchParams / Request-wrapped / empty -> pass through
  }

  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : input && input.url ? input.url : '';
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (method !== 'POST' || !isAddUrl(url)) return nativeFetch(input, init);

      var run = function () {
        return normalizeAndAdd(input, init);
      };

      // Serialise same-variant adds ACROSS TABS. The per-tab caches can't stop two tabs
      // from resolving DIFFERENT canonical values (one PDP tab has the app's date, a
      // non-PDP tab has none) against a cart that doesn't yet show the other tab's add ->
      // a bare + a dated add of one variant = two lines. The lock makes the 2nd tab
      // resolve only AFTER the 1st tab's add commits, so reuse-in-cart merges them.
      // Falls back to an unlocked add where Web Locks are unavailable (older Safari) or
      // the wait times out — the residual is that rare same-tick two-tab case only.
      if (navigator.locks && typeof navigator.locks.request === 'function') {
        var key = lockKeyFor(init && init.body);
        // Cap the WAIT for a contended same-variant lock at 6s. Use AbortController +
        // setTimeout, NOT AbortSignal.timeout: the latter is Safari 16+, but Web Locks is
        // Safari 15.4+, so on 15.4–15.6 AbortSignal.timeout is absent and a waiter (e.g. a
        // fast ATC double-tap queued behind a stalled add — the lock serialises same-tab
        // too) would hang uncapped. AbortController is Safari 11.1+. Aborting only affects a
        // request still WAITING; once granted it is a no-op, and the `granted` gate below
        // stops any re-run even under a pessimistic implementation.
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var opts = ctrl ? { signal: ctrl.signal } : {};
        if (ctrl)
          setTimeout(function () {
            ctrl.abort();
          }, 6000);
        var granted = false;
        var cb = function () {
          granted = true;
          return run();
        };
        // Only re-run when the lock was NEVER granted (unavailable / aborted / timed out
        // while WAITING). If the callback ran, the add already fired once — propagate its
        // result or rejection; re-running would double-commit.
        return navigator.locks.request(key, opts, cb).catch(function (e) {
          if (granted) throw e;
          return run();
        });
      }
      return run();
    } catch (e) {
      return nativeFetch(input, init); // never break an add on a bug in here
    }
  };
})();
