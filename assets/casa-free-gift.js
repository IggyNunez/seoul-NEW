/* casa-free-gift.js — free-gift presence automation (Mini Sunset Orb promo).
 *
 * TWO MECHANISMS:
 *  1. Fetch shim (first-paint path): a POST to /cart/add(.js) whose payload
 *     contains a qualifying variant gets the gift appended to the SAME
 *     request, so the drawer's first render already includes it — no pop-in,
 *     no second round-trip. Buy-box adds are FormData (product-form.js), so
 *     the shim converts FormData→JSON faithfully before appending.
 *  2. Reconciler (convergence net): on every `cart:update` it reads /cart.js
 *     and converges the gift's presence — removes it when the last qualifying
 *     line leaves (or when it was duplicated/quantity-tampered), adds it when
 *     a qualifying line arrived via a path the shim doesn't know (quick-add,
 *     drawer upsell).
 *
 * INTEGRATION CONTRACTS (see the 2026-08-25 architecture review):
 *  - Loads AFTER casa-edd.js (theme.liquid order): page fetch → THIS shim →
 *    EDD's shim → network. EDD then stamps its canonical delivery property on
 *    the gift item too, which keeps a gift line distinct from any PAID line
 *    of the same variant (`_free_gift` splits them regardless).
 *  - Writes are flush-aware: awaits flushPendingCartUpdates() on every
 *    cart-items-component before touching the cart (the product-form.js
 *    pattern), so we never race the drawer's serial edit queue.
 *  - This file NEVER morphs the DOM. It dispatches a `cart:update`
 *    CustomEvent carrying the re-rendered `sections`; cart-items-component's
 *    own handler morphs with its optimistic-state protections intact. Its
 *    source ('casa-free-gift') is deliberately NOT in cart-drawer's
 *    auto-open allowlist.
 *  - Market gate: the gift is only ADDED when the storefront country (script
 *    tag data attr, server-rendered) is in the allowlist. REMOVAL runs in
 *    every market, so a market-switched session still cleans up.
 *  - Theme editor: hard bail in designMode — never mutate a preview cart.
 *
 * CONFIG IS DATA, NEVER CODE: the qualifying-variant → gift-variant mapping
 * comes from (a) the PDP's casa-fg-data JSON (blocks/variant-picker.liquid)
 * and (b) data-casa-fg-qualifying attributes on rendered cart rows
 * (cart-products.liquid + casa-cart-items.liquid). No product ids appear in
 * this file. Mapping is cached in sessionStorage so a quick-add from a
 * collection page still resolves after one render cycle.
 */
(function () {
  'use strict';
  if (window.__casaFreeGiftInstalled) return;
  window.__casaFreeGiftInstalled = true;
  if (window.Shopify && window.Shopify.designMode) return;

  var GIFT_PROP = '_free_gift';
  var CACHE_KEY = 'casa-fg-map-v1';
  var script = document.currentScript;
  var CHOICE_ATTR = '_casa_free_gift_choice';
  var giftChoice = (script && script.getAttribute('data-casa-fg-choice')) || '';
  var COUNTRY = (script && script.getAttribute('data-casa-fg-country')) || (window.Shopify && window.Shopify.country) || '';
  var ALLOW = ((script && script.getAttribute('data-casa-fg-allow')) || 'US').toUpperCase().split(',');
  var marketAllowed = ALLOW.indexOf(String(COUNTRY).toUpperCase()) !== -1;

  var routes = (window.Theme && window.Theme.routes) || {};
  var ADD_URL = routes.cart_add_url || '/cart/add';
  var CHANGE_URL = routes.cart_change_url || '/cart/change';
  var CART_URL = routes.cart_url || '/cart';
  var UPDATE_URL = routes.cart_update_url || '/cart/update';

  // ---- qualifying-variant → {gift, available} mapping ----------------------
  var map = {};
  try {
    var stored = sessionStorage.getItem(CACHE_KEY);
    if (stored) map = JSON.parse(stored) || {};
  } catch (e) {}

  function rememberMapping(variantId, giftId, available) {
    if (!variantId || !giftId) return;
    var k = String(variantId);
    var next = { gift: String(giftId), available: available !== false };
    var prev = map[k];
    if (prev && prev.gift === next.gift && prev.available === next.available) return;
    map[k] = next;
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function harvestMappings() {
    var before = JSON.stringify(map);
    // (a) PDP payloads — blocks/variant-picker.liquid ships giftVariantId per qualifying variant
    var blocks = document.querySelectorAll('script[id^="casa-fg-data-"]');
    for (var i = 0; i < blocks.length; i++) {
      try {
        var data = JSON.parse(blocks[i].textContent);
        var variants = (data && data.variants) || {};
        for (var vid in variants) {
          if (!Object.prototype.hasOwnProperty.call(variants, vid)) continue;
          var entry = variants[vid];
          if (entry && entry.giftVariantId) rememberMapping(vid, entry.giftVariantId, entry.giftAvailable);
        }
      } catch (e) {}
    }
    // (b) rendered cart rows — both renderers stamp qualifying lines
    var rows = document.querySelectorAll('[data-casa-fg-qualifying]');
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      rememberMapping(
        row.getAttribute('data-variant-id') || rowVariantFromKey(row),
        row.getAttribute('data-casa-fg-qualifying'),
        row.getAttribute('data-casa-fg-available') !== 'false'
      );
    }
    return JSON.stringify(map) !== before;
  }

  function rowVariantFromKey(row) {
    // drawer rows carry only data-key ("<variantId>:<hash>")
    var key = row.getAttribute('data-key') || '';
    var idx = key.indexOf(':');
    return idx > 0 ? key.slice(0, idx) : null;
  }

  function mappingFor(variantId) {
    return map[String(variantId)] || null;
  }

  // ---- fetch shim: same-request gift injection -----------------------------
  var nativeFetch = window.fetch;

  function isAddUrl(url) {
    try {
      var path = new URL(url, window.location.href).pathname.replace(/\/+$/, '');
      return /\/cart\/add(\.js)?$/.test(path);
    } catch (e) {
      return false;
    }
  }

  function formToJson(fd) {
    // Faithful FormData→JSON for /cart/add: one item + top-level sections.
    // Only the keys /cart/add consumes are mapped; anything else is dropped
    // deliberately (form_type/utf8/etc. are form-transport noise).
    var item = { quantity: 1, properties: {} };
    var body = { items: [item] };
    var hasId = false;
    fd.forEach(function (value, key) {
      if (key === 'id') {
        item.id = value;
        hasId = true;
      } else if (key === 'quantity') {
        var q = parseInt(value, 10);
        if (!isNaN(q) && q > 0) item.quantity = q;
      } else if (key === 'selling_plan' && value) {
        item.selling_plan = value;
      } else if (key === 'sections') {
        body.sections = value;
      } else if (key === 'sections_url') {
        body.sections_url = value;
      } else {
        var m = /^properties\[(.+)\]$/.exec(key);
        if (m) item.properties[m[1]] = value;
      }
    });
    if (!hasId) return null;
    if (Object.keys(item.properties).length === 0) delete item.properties;
    return body;
  }

  function giftFromItems(items) {
    // first qualifying item in the payload whose gift is known + available
    for (var i = 0; i < items.length; i++) {
      var entry = items[i] && items[i].id != null ? mappingFor(items[i].id) : null;
      if (entry && entry.available) return entry.gift;
    }
    return null;
  }

  function payloadHasVariant(items, variantId) {
    for (var i = 0; i < items.length; i++) {
      if (items[i] && String(items[i].id) === String(variantId)) return true;
    }
    return false;
  }

  function injectGift(input, init) {
    // Returns a replacement [input, init] or null to pass through untouched.
    if (!marketAllowed || giftGaveUp || giftChoice) return null;
    harvestMappings();
    var body = init && init.body;
    var parsed = null;

    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      parsed = formToJson(body);
    } else if (typeof body === 'string' && body) {
      try {
        var p = JSON.parse(body);
        if (p && (Array.isArray(p.items) || p.id != null)) {
          parsed = Array.isArray(p.items) ? p : { items: [p] };
          if (!Array.isArray(p.items)) {
            // preserve any top-level sections on a bare {id,quantity} body
            if (p.sections) parsed.sections = p.sections;
            if (p.sections_url) parsed.sections_url = p.sections_url;
          }
        }
      } catch (e) {
        parsed = null;
      }
    }
    if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) return null;

    var gift = giftFromItems(parsed.items);
    if (!gift) return null;
    if (payloadHasVariant(parsed.items, gift)) return null; // already there (incl. our own reconciler add)

    var giftItem = { id: gift, quantity: 1, properties: {} };
    giftItem.properties[GIFT_PROP] = '1';
    parsed.items.push(giftItem);

    var headers = Object.assign({}, (init && init.headers) || {});
    headers['Content-Type'] = 'application/json';
    return [input, Object.assign({}, init, { body: JSON.stringify(parsed), headers: headers })];
  }

  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : input && input.url ? input.url : '';
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (method === 'POST' && isAddUrl(url)) {
        var replaced = injectGift(input, init);
        if (replaced) return nativeFetch(replaced[0], replaced[1]);
      }
    } catch (e) {
      /* never break an add on a bug in here */
    }
    return nativeFetch(input, init);
  };

  // ---- reconciler: stateless convergence on cart:update --------------------
  var giftGaveUp = false; // set on a 422 gift add (sold out) — stop for the session
  var busy = false;
  var dirty = false;
  var debounceTimer = null;
  var recheckArmed = false;

  function sectionIds() {
    var ids = [];
    var comps = document.querySelectorAll('cart-items-component');
    for (var i = 0; i < comps.length; i++) {
      var id = comps[i].dataset ? comps[i].dataset.sectionId : null;
      if (id && ids.indexOf(id) === -1) ids.push(id);
    }
    return ids;
  }

  function flushComponents() {
    var comps = document.querySelectorAll('cart-items-component');
    var waits = [];
    for (var i = 0; i < comps.length; i++) {
      var c = comps[i];
      if (c && typeof c.flushPendingCartUpdates === 'function') {
        try {
          waits.push(c.flushPendingCartUpdates());
        } catch (e) {}
      }
    }
    return Promise.all(waits);
  }

  function fetchCart() {
    return nativeFetch(CART_URL + '.js', { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('Cart read failed');
      return r.json();
    });
  }

  function cartWrite(url, payload) {
    var ids = sectionIds();
    if (ids.length) {
      payload.sections = ids.join(',');
      payload.sections_url = window.location.pathname;
    }
    return nativeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().then(function (json) {
        if (!r.ok && r.status !== 422) throw new Error('Gift update failed');
        return { status: r.status, json: json };
      });
    });
  }

  function announce(result) {
    // Hand the re-rendered sections to the theme's own morph pipeline.
    var cart = result && result.json ? result.json : {};
    document.dispatchEvent(
      new CustomEvent('cart:update', {
        bubbles: true,
        detail: {
          resource: cart,
          sourceId: 'casa-free-gift',
          data: {
            source: 'casa-free-gift',
            itemCount: typeof cart.item_count === 'number' ? cart.item_count : undefined,
            sections: cart.sections || (result && result.json && result.json.sections) || undefined,
          },
        },
      })
    );
  }

  function choiceWrite(choice, lines) {
    var payload = { attributes: {}, updates: {} };
    payload.attributes[CHOICE_ATTR] = choice;
    (lines || []).forEach(function (line) { payload.updates[line.key] = 0; });
    giftChoice = choice;
    return cartWrite(UPDATE_URL + '.js', payload).then(function (result) {
      if (result.status >= 400 || result.json.errors) throw new Error('Gift update rejected');
      announce(result);
      return result;
    });
  }

  function priceChoice(cart) {
    return 'price:' + ((cart && cart.discount_codes) || []).map(function (code) {
      return code.code.toUpperCase();
    }).sort().join(',');
  }

  function reconcile() {
    if (busy) {
      dirty = true;
      return;
    }
    busy = true;
    dirty = false;

    flushComponents()
      .then(fetchCart)
      .then(function (cart) {
        giftChoice = (cart.attributes && cart.attributes[CHOICE_ATTR]) || '';
        var items = (cart && cart.items) || [];
        var giftLines = [];
        var qualifying = null; // mapping entry of the first qualifying line
        var unknownVariants = false;

        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (it.properties && it.properties[GIFT_PROP]) {
            giftLines.push(it);
            continue;
          }
          var entry = mappingFor(it.variant_id);
          if (entry) {
            if (!qualifying) qualifying = entry;
          } else {
            unknownVariants = true;
          }
        }

        // Removal runs in EVERY market; addition only where allowed.
        if (!qualifying) {
          if (giftChoice) return choiceWrite('', giftLines);
          if (giftLines.length) {
            // remove all gift lines, serially (there is almost always exactly one)
            var chain = Promise.resolve();
            giftLines.forEach(function (line) {
              chain = chain.then(function () {
                return cartWrite(CHANGE_URL + '.js', { id: line.key, quantity: 0 });
              });
            });
            return chain.then(function (last) {
              announce(last);
            });
          }
          // Nothing to do — but if the cart holds variants we can't classify
          // yet (quick-add before the drawer morph landed), look again once.
          if (unknownVariants && !recheckArmed) {
            recheckArmed = true;
            setTimeout(function () {
              recheckArmed = false;
              if (harvestMappings()) schedule();
            }, 700);
          }
          return null;
        }

        if (giftChoice.indexOf('price:') === 0 && giftChoice !== priceChoice(cart)) {
          return choiceWrite('', []).then(function () { dirty = true; });
        }

        if (giftChoice === 'removed' && giftLines.length) return choiceWrite('removed', giftLines);
        var chargedGift = giftLines.some(function (line) {
          return typeof line.final_line_price === 'number' && line.final_line_price > 0;
        });
        if (chargedGift) return choiceWrite(priceChoice(cart), giftLines);

        // A qualifying line is present.
        if (giftLines.length === 0) {
          if (!marketAllowed || giftGaveUp || giftChoice || !qualifying.available) return null;
          var payload = { items: [{ id: qualifying.gift, quantity: 1, properties: {} }] };
          payload.items[0].properties[GIFT_PROP] = '1';
          return cartWrite(ADD_URL + '.js', payload).then(function (res) {
            if (res.status === 422) {
              giftGaveUp = true; // sold out / not sellable — the PDP promise keys off availability too
              return;
            }
            announce(res);
          });
        }

        // Exactly one gift line at quantity 1; fix tampering, drop extras.
        var ops = Promise.resolve();
        var wrote = false;
        if (giftLines[0].quantity !== 1) {
          wrote = true;
          ops = ops.then(function () {
            return cartWrite(CHANGE_URL + '.js', { id: giftLines[0].key, quantity: 1 });
          });
        }
        for (var g = 1; g < giftLines.length; g++) {
          (function (line) {
            wrote = true;
            ops = ops.then(function () {
              return cartWrite(CHANGE_URL + '.js', { id: line.key, quantity: 0 });
            });
          })(giftLines[g]);
        }
        return ops.then(function (last) {
          if (wrote) announce(last);
        });
      })
      .catch(function (e) {
        /* network hiccup — the next cart:update converges */
      })
      .then(function () {
        busy = false;
        if (dirty) schedule();
      });
  }

  function schedule() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(reconcile, 180);
  }

  document.addEventListener('cart:update', function (event) {
    // Our own announce() also lands here; the run it triggers is a no-op
    // read that confirms convergence, which is exactly the point.
    harvestMappings();
    schedule();
  });
  document.addEventListener('casa:gift-remove', function () { giftChoice = 'removed'; });
  document.addEventListener('discount:update', function () { schedule(); });

  // Initial pass — covers a cart persisted from a previous session (e.g. the
  // mirror was removed on another device, or the market changed since).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      harvestMappings();
      schedule();
    });
  } else {
    harvestMappings();
    schedule();
  }
})();
