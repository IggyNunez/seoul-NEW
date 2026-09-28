(function(){
  // Seoul Glow Lab — policy page enhancement.
  // Shopify's OS 2.0 / Horizon renderer bypasses our policy.liquid
  // template for /policies/* URLs and ships only a bare
  // .shopify-policy__container > .shopify-policy__title +
  // .shopify-policy__body wrapper. This script post-processes that
  // DOM to add the editorial chrome we can't add via Liquid:
  //   • <em>-gradient accent on the last word of the H1
  //   • "LAST UPDATED" subline under the H1 (if Liquid passed a date)
  //   • Sticky table-of-contents sidebar on desktop, built from H5s
  //   • Numbered section markers (01, 02, 03 ...)
  //   • Drop cap on the first paragraph
  //   • "Other policies" cross-link footer
  // Runs on every page; self-gates on container presence so it's
  // a no-op everywhere else.

  if (!document.querySelector('.shopify-policy__container')) return;

  var data = (window.__casaPolicy || {});
  var titleEl = document.querySelector('.shopify-policy__title h1');
  var titleWrap = document.querySelector('.shopify-policy__title');
  var rte = document.querySelector('.shopify-policy__body .rte');
  if (!titleEl || !rte) return;

  // 1) Em-gradient on the last word of the title.
  //    "Refund policy" → "Refund <em>policy</em>"
  //    "Terms of service" → "Terms of <em>service</em>"
  var t = (titleEl.textContent || '').trim();
  var lastSpaceIdx = t.lastIndexOf(' ');
  if (lastSpaceIdx > 0) {
    var head = t.slice(0, lastSpaceIdx);
    var tail = t.slice(lastSpaceIdx + 1);
    var em = document.createElement('em');
    em.textContent = tail;
    titleEl.textContent = head + ' ';
    titleEl.appendChild(em);
  }

  // 2) Last-updated subline under the H1 (rendered only if a date
  //    was passed via window.__casaPolicy.updatedAt).
  if (data.updatedAt) {
    var upd = document.createElement('span');
    upd.className = 'shopify-policy__updated';
    upd.textContent = 'Last updated ' + data.updatedAt;
    titleEl.parentNode.appendChild(upd);
  }

  // 2.5) Some policy bodies (Privacy, Terms) ship section labels as
  //      <strong> inside <p>, not as <h5>. There are two shapes:
  //
  //      Shape A — small <p> with strong as first child:
  //        <p><strong>Label</strong></p>
  //        <p><strong>Label</strong><br>body...</p>
  //
  //      Shape B — one massive <p> with the entire policy inside,
  //      separated by <br>s, where each section starts:
  //        ... <br><strong>Label</strong><br>body ...
  //
  //      Walk every <p> in the prose; for each, build a fragment that
  //      replaces the original. Promote every <strong> at a structural
  //      boundary (preceded by <br> or at the start) into a real <h5>;
  //      everything else stays in regular <p>s, with <br> boundaries
  //      becoming paragraph breaks. This lets the existing h5
  //      numbering + TOC builder pick them up unchanged.

  function isSectionStrong(s){
    var text = (s.textContent || '').trim();
    if (text.length < 3 || text.length > 80) return false;
    var prev = s.previousSibling;
    while (prev && prev.nodeType === 3 && !(prev.textContent || '').trim()) {
      prev = prev.previousSibling;
    }
    if (!prev) return true; // start of the parent
    return prev.nodeType === 1 && prev.tagName === 'BR';
  }

  function flushP(buf){
    if (!buf.length) return null;
    var p = document.createElement('p');
    buf.forEach(function(n){ p.appendChild(n); });
    return (p.textContent || '').trim().length ? p : null;
  }

  // Snapshot the <p> list before we mutate so the forEach is stable
  Array.prototype.slice.call(rte.querySelectorAll('p')).forEach(function(p){
    // Quick skip: if the paragraph has no <strong> at all, leave alone
    if (!p.querySelector('strong')) return;

    var frag = document.createDocumentFragment();
    var buf = [];
    var changed = false;

    Array.prototype.slice.call(p.childNodes).forEach(function(node){
      if (node.nodeType === 1 && node.tagName === 'STRONG' && isSectionStrong(node)) {
        var flushed = flushP(buf);
        if (flushed) frag.appendChild(flushed);
        buf = [];
        var h5 = document.createElement('h5');
        h5.appendChild(node.cloneNode(true));
        frag.appendChild(h5);
        changed = true;
        return;
      }
      if (node.nodeType === 1 && node.tagName === 'BR') {
        var flushedBr = flushP(buf);
        if (flushedBr) {
          frag.appendChild(flushedBr);
          buf = [];
          changed = true; // we're remixing the structure
        }
        return; // drop the <br> itself; paragraph break is the new boundary
      }
      buf.push(node.cloneNode(true));
    });
    var tail = flushP(buf);
    if (tail) frag.appendChild(tail);

    if (changed) {
      p.parentNode.insertBefore(frag, p);
      p.parentNode.removeChild(p);
    }
  });

  // 2.7) Auto-link emails + URLs that the Shopify policy editor leaves
  //      as plain text. Walks every text node in the prose, finds the
  //      patterns, and wraps each match in <a>. Skips text already
  //      inside an <a> (so existing links pass through untouched).
  (function autolink(){
    var emailRe = /\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/gi;
    var urlRe   = /\bhttps?:\/\/[^\s<>"]+/gi;
    var walker  = document.createTreeWalker(rte, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node){
        var p = node.parentElement;
        while (p && p !== rte) {
          if (p.tagName === 'A' || p.tagName === 'CODE' || p.tagName === 'PRE') {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    var nn; while ((nn = walker.nextNode())) nodes.push(nn);

    nodes.forEach(function(node){
      var text = node.nodeValue;
      if (!text) return;
      if (!emailRe.test(text) && !urlRe.test(text)) return;
      emailRe.lastIndex = 0; urlRe.lastIndex = 0;

      var matches = [];
      var m;
      while ((m = emailRe.exec(text)) !== null) {
        matches.push({ idx: m.index, len: m[0].length, value: m[0], type: 'email' });
      }
      while ((m = urlRe.exec(text)) !== null) {
        // Strip trailing punctuation that's likely sentence-attached
        var v = m[0];
        var trailing = v.match(/[.,!?;)\]]+$/);
        var vlen = v.length - (trailing ? trailing[0].length : 0);
        matches.push({ idx: m.index, len: vlen, value: v.slice(0, vlen), type: 'url' });
      }
      matches.sort(function(a, b){ return a.idx - b.idx; });
      // Drop overlapping matches (URL containing an email, or similar)
      var clean = [];
      var lastEnd = -1;
      matches.forEach(function(mm){
        if (mm.idx >= lastEnd) {
          clean.push(mm);
          lastEnd = mm.idx + mm.len;
        }
      });
      if (!clean.length) return;

      var frag = document.createDocumentFragment();
      var cursor = 0;
      clean.forEach(function(mm){
        if (mm.idx > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, mm.idx)));
        }
        var a = document.createElement('a');
        a.textContent = mm.value;
        if (mm.type === 'email') {
          a.href = 'mailto:' + mm.value;
        } else {
          a.href = mm.value;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        frag.appendChild(a);
        cursor = mm.idx + mm.len;
      });
      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }
      node.parentNode.replaceChild(frag, node);
    });
  })();

  // 3) Collect h2 + h5 (Shopify's policy editor uses h5 for section
  //    labels and h2 for major groupings). Slugify each so the TOC
  //    has stable anchors.
  function slugify(s){
    return (s || '').toString().toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || ('section-' + Math.random().toString(36).slice(2,7));
  }
  var headings = rte.querySelectorAll('h2, h5');
  var sections = [];
  var used = {};
  headings.forEach(function(h){
    var label = h.textContent.trim();
    if (!label) return;
    var id = h.id || slugify(label);
    var n = 1, tryId = id;
    while (used[tryId]) tryId = id + '-' + (++n);
    h.id = tryId;
    used[tryId] = true;
    sections.push({ id: tryId, label: label, level: h.tagName.toLowerCase(), el: h });
  });

  // 4) Number the h5 sections (purely visual via data attribute;
  //    CSS reads `data-policy-num` for the `::before` numeral).
  var n = 0;
  sections.forEach(function(s){
    if (s.level === 'h5') {
      n += 1;
      s.el.setAttribute('data-policy-num', n < 10 ? '0' + n : String(n));
    }
  });

  // 5) Drop cap on the very first paragraph after the title.
  var firstP = rte.querySelector('p');
  if (firstP) firstP.classList.add('casa-policy-firstp');

  // 6) Build the desktop TOC sidebar. Skip if there are < 2 h5s — a
  //    one-section policy doesn't need navigation.
  var h5s = sections.filter(function(s){ return s.level === 'h5'; });
  if (h5s.length >= 2) {
    var body = document.querySelector('.shopify-policy__body');
    if (body) {
      var sidebar = document.createElement('aside');
      sidebar.className = 'casa-policy-toc';
      sidebar.setAttribute('aria-label', 'On this page');
      sidebar.innerHTML = '<span class="casa-policy-toc__label">ON THIS PAGE</span><nav class="casa-policy-toc__nav"></nav>';
      var nav = sidebar.querySelector('.casa-policy-toc__nav');
      var idx = 0;
      sections.forEach(function(s){
        if (s.level !== 'h5') return;
        idx += 1;
        var a = document.createElement('a');
        a.href = '#' + s.id;
        a.innerHTML = '<span class="casa-policy-toc__num">' + (idx < 10 ? '0' + idx : idx) + '</span><span class="casa-policy-toc__text">' + s.label + '</span>';
        nav.appendChild(a);
      });
      body.insertBefore(sidebar, body.firstChild);
      body.classList.add('shopify-policy__body--with-toc');

      // Active-section highlight via IntersectionObserver
      if ('IntersectionObserver' in window) {
        var linkByHref = {};
        nav.querySelectorAll('a').forEach(function(a){
          linkByHref[a.getAttribute('href').slice(1)] = a;
        });
        var io = new IntersectionObserver(function(entries){
          entries.forEach(function(e){
            if (e.isIntersecting) {
              nav.querySelectorAll('a.is-active').forEach(function(a){ a.classList.remove('is-active'); });
              var l = linkByHref[e.target.id];
              if (l) l.classList.add('is-active');
            }
          });
        }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });
        h5s.forEach(function(s){ io.observe(s.el); });
      }
    }
  }

  // 7) "Other policies" footer.
  var others = [];
  ['refund', 'privacy', 'shipping', 'terms', 'subscription'].forEach(function(k){
    if (data[k] && data[k + 'Title'] && data[k] !== window.location.pathname) {
      others.push({ url: data[k], title: data[k + 'Title'] });
    }
  });
  if (others.length) {
    var container = document.querySelector('.shopify-policy__container');
    if (container) {
      var foot = document.createElement('div');
      foot.className = 'casa-policy-other';
      foot.innerHTML = '<div class="casa-policy-other__inner"><span class="casa-policy-other__label">OTHER POLICIES</span><ul class="casa-policy-other__list"></ul></div>';
      var ul = foot.querySelector('ul');
      others.forEach(function(o){
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.className = 'casa-policy-other__link';
        a.href = o.url;
        a.textContent = o.title;
        li.appendChild(a);
        ul.appendChild(li);
      });
      container.appendChild(foot);
    }
  }
})();
