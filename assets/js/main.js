/* Evanescere — choreography
   Loader, smooth scroll, text dissolves, pinned process, cursor, FAQ and the brief form. */
(function () {
  'use strict';

  var doc = document, root = doc.documentElement;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var smoke = window.Smoke || { ok: false, setMood: function () {}, burst: function () {}, kick: function () {}, scroll: function () {} };
  var hasGsap = !!(window.gsap && window.ScrollTrigger);

  // Without GSAP the page is still a complete, readable site.
  if (!hasGsap) { root.classList.remove('js'); root.classList.add('no-js'); initPlain(); return; }

  var gsap = window.gsap, ST = window.ScrollTrigger;
  gsap.registerPlugin(ST);

  /* ------------------------------------------------------------------
     Text splitting — wraps words (and optionally chars) preserving markup
     ------------------------------------------------------------------ */
  function split(el, mode) {
    var out = { words: [], chars: [] };
    var isHeading = /^H[1-6]$/.test(el.tagName);
    if (isHeading && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = doc.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (tok) {
            if (!tok) return;
            if (/^\s+$/.test(tok)) { frag.appendChild(doc.createTextNode(' ')); return; }
            var w = doc.createElement('span'); w.className = 'w';
            if (isHeading || el.hasAttribute('aria-label') || el.closest('[aria-label]')) w.setAttribute('aria-hidden', 'true');
            if (mode === 'chars') {
              Array.from(tok).forEach(function (ch) { var c = doc.createElement('span'); c.className = 'c'; c.textContent = ch; w.appendChild(c); out.chars.push(c); });
            } else { w.classList.add('wd'); w.textContent = tok; }
            out.words.push(w);
            frag.appendChild(w);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') { walk(n); }
      });
    })(el);
    return out;
  }

  var splits = [];
  $$('[data-split]').forEach(function (el) {
    var mode = el.getAttribute('data-split');
    var r = split(el, mode); r.el = el; r.mode = mode;
    splits.push(r);
  });
  var heroChars = [];
  splits.forEach(function (s) { if (s.el.hasAttribute('data-hero')) heroChars = heroChars.concat(s.chars); });

  // Standalone wordmarks (hero, loader, footer)
  function wordmark(id) { var el = $(id); return el ? split(el, 'chars').chars : []; }
  var heroWordChars = wordmark('#heroWord');
  var footChars = wordmark('#footWord');
  var loaderChars = wordmark('#loaderWord');

  // Initial hidden states (the JS-only CSS hides unsplit containers; units start hidden here)
  if (!reduce) {
    splits.forEach(function (s) {
      if (s.el.classList.contains('manifesto__text') || s.el.id === 'vanish') return;
      gsap.set(s.mode === 'chars' ? s.chars : s.words, { opacity: 0 });
    });
    gsap.set(heroWordChars, { opacity: 0 });
  }
  splits.forEach(function (s) { s.el.classList.add('is-split'); });
  var manifestoWords = $$('.manifesto__text .wd');

  /* ------------------------------------------------------------------
     Smooth scroll (Lenis) wired into GSAP's ticker
     ------------------------------------------------------------------ */
  var lenis = null;
  if (window.Lenis && !reduce) {
    lenis = new window.Lenis({ duration: 1.2, easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); }, smoothWheel: true, autoRaf: false });
    lenis.on('scroll', ST.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }
  function scrollY() { return lenis ? lenis.scroll : window.scrollY; }
  function goTo(target, instant) {
    if (lenis) lenis.scrollTo(target, { duration: instant ? 0 : 1.7, easing: function (t) { return 1 - Math.pow(1 - t, 4); }, immediate: !!instant });
    else {
      var y = typeof target === 'number' ? target : target.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  /* ------------------------------------------------------------------
     Navigation, menu, progress
     ------------------------------------------------------------------ */
  var nav = $('#nav'), burger = $('#burger'), menu = $('#menu'), progressBar = $('#progressBar');
  var menuOpen = false, lastY = 0;

  function setMenu(open) {
    menuOpen = open;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.classList.toggle('is-open', open);
    menu.setAttribute('aria-hidden', String(!open));
    if (open) { menu.removeAttribute('inert'); nav.classList.remove('is-hidden'); } else { menu.setAttribute('inert', ''); }
    if (lenis) { open ? lenis.stop() : lenis.start(); } else { doc.body.style.overflow = open ? 'hidden' : ''; }
  }
  burger.addEventListener('click', function () { setMenu(!menuOpen); });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menuOpen) { setMenu(false); burger.focus(); } });

  doc.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (id.length < 2) return;
    var t = id === '#top' ? 0 : $(id);
    if (t === null || t === undefined) return;
    e.preventDefault();
    if (a.hasAttribute('data-pick')) pickEngagement(a.getAttribute('data-pick'));
    if (menuOpen) { setMenu(false); setTimeout(function () { goTo(t); }, 250); } else { goTo(t); }
  });

  function onScroll() {
    var y = scrollY(), max = Math.max(1, doc.documentElement.scrollHeight - window.innerHeight);
    if (progressBar) progressBar.style.transform = 'scaleY(' + clamp(y / max, 0, 1) + ')';
    if (!menuOpen) {
      if (y > 140 && y > lastY + 4) nav.classList.add('is-hidden');
      else if (y < lastY - 4 || y < 140) nav.classList.remove('is-hidden');
    }
    lastY = y;
    smoke.scroll(y);
  }
  if (lenis) lenis.on('scroll', function (e) { onScroll(); smoke.kick(e.velocity); });
  else window.addEventListener('scroll', function () { onScroll(); }, { passive: true });

  /* ------------------------------------------------------------------
     Cursor, magnetism, spotlight
     ------------------------------------------------------------------ */
  var cursor = $('.cursor');
  if (fine && cursor) {
    var ring = $('.cursor__ring'), dot = $('.cursor__dot');
    var cx = innerWidth / 2, cy = innerHeight / 2, rx = cx, ry = cy, shown = false;
    window.addEventListener('pointermove', function (e) {
      cx = e.clientX; cy = e.clientY;
      if (!shown) { shown = true; rx = cx; ry = cy; root.classList.add('has-cursor'); }
    }, { passive: true });
    gsap.ticker.add(function () {
      rx += (cx - rx) * 0.2; ry += (cy - ry) * 0.2;
      ring.style.transform = 'translate3d(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px,0)';
      dot.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0)';
    });
    doc.addEventListener('mouseover', function (e) {
      var t = e.target.closest('a, button, .chip, [data-cursor]');
      cursor.classList.toggle('is-hover', !!t && t.getAttribute('data-cursor') !== 'view');
      cursor.classList.toggle('is-view', !!t && t.getAttribute('data-cursor') === 'view');
    });
    doc.addEventListener('mouseleave', function () { cursor.style.opacity = 0; });
    doc.addEventListener('mouseenter', function () { cursor.style.opacity = ''; });
    window.addEventListener('pointerdown', function () { cursor.classList.add('is-down'); });
    window.addEventListener('pointerup', function () { cursor.classList.remove('is-down'); });

    // magnetic buttons + liquid fill origin
    $$('[data-magnetic]').forEach(function (el) {
      var qx = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
      var qy = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--x', (e.clientX - r.left) + 'px'); el.style.setProperty('--y', (e.clientY - r.top) + 'px');
        qx((e.clientX - (r.left + r.width / 2)) * 0.28); qy((e.clientY - (r.top + r.height / 2)) * 0.38);
      });
      el.addEventListener('pointerenter', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--x', (e.clientX - r.left) + 'px'); el.style.setProperty('--y', (e.clientY - r.top) + 'px');
      });
      el.addEventListener('pointerleave', function () { qx(0); qy(0); });
    });

    // service rows: spotlight follows the cursor and the row exhales a little smoke
    $$('.svc__row').forEach(function (row) {
      row.addEventListener('pointermove', function (e) { row.style.setProperty('--mx', (e.clientX - row.getBoundingClientRect().left) + 'px'); });
      row.addEventListener('pointerenter', function (e) { smoke.burst(e.clientX / innerWidth, 1 - e.clientY / innerHeight, 3, 0.6); });
    });
  }
  $$('.spot').forEach(function (el) {
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* ------------------------------------------------------------------
     Hero: letters dissolve into the smoke near the cursor
     ------------------------------------------------------------------ */
  var reactive = [];
  var pt = { x: -9999, y: -9999 };
  function measureReactive() {
    var sy = window.scrollY;
    reactive.forEach(function (o) { o.el.style.cssText = ''; });
    reactive.forEach(function (o) {
      var r = o.el.getBoundingClientRect();
      o.cx = r.left + r.width / 2; o.cy = r.top + sy + r.height / 2; o.f = 0;
    });
  }
  function buildReactive() {
    reactive = [];
    heroChars.forEach(function (el) { reactive.push({ el: el, R: Math.max(120, innerWidth * 0.1), blur: 9, push: 26 }); });
    heroWordChars.forEach(function (el) { reactive.push({ el: el, R: Math.max(160, innerWidth * 0.15), blur: 14, push: 40 }); });
    measureReactive();
  }
  var heroEl = $('.hero');
  var heroLive = true;
  ST.create({ trigger: heroEl, start: 'top top', end: 'bottom top', onToggle: function (s) { heroLive = s.isActive; } });

  function tickReactive() {
    if (!heroLive || !reactive.length) return;
    var sy = scrollY();
    for (var i = 0; i < reactive.length; i++) {
      var o = reactive[i];
      var dx = o.cx - pt.x, dy = (o.cy - sy) - pt.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var target = d < o.R ? Math.pow(1 - d / o.R, 1.6) : 0;
      o.f += (target - o.f) * (target > o.f ? 0.22 : 0.07);
      if (o.f < 0.004) { if (o.on) { o.el.style.cssText = ''; o.on = false; } continue; }
      o.on = true;
      var nx = d > 1 ? dx / d : 0, ny = d > 1 ? dy / d : 0;
      o.el.style.cssText = 'opacity:' + (1 - o.f * 0.85).toFixed(3) + ';filter:blur(' + (o.f * o.blur).toFixed(2) + 'px);transform:translate3d(' + (nx * o.f * o.push).toFixed(1) + 'px,' + (ny * o.f * o.push * 0.6 - o.f * o.push * 0.8).toFixed(1) + 'px,0) rotate(' + (nx * o.f * 6).toFixed(2) + 'deg)';
    }
  }
  if (fine && !reduce) {
    window.addEventListener('pointermove', function (e) { pt.x = e.clientX; pt.y = e.clientY; }, { passive: true });
    doc.addEventListener('mouseleave', function () { pt.x = pt.y = -9999; });
  } else if (!reduce) {
    window.addEventListener('touchmove', function (e) { var t = e.touches[0]; if (t) { pt.x = t.clientX; pt.y = t.clientY; } }, { passive: true });
    window.addEventListener('touchend', function () { setTimeout(function () { pt.x = pt.y = -9999; }, 500); }, { passive: true });
  }
  if (!reduce) gsap.ticker.add(tickReactive);

  var rzT;
  window.addEventListener('resize', function () { clearTimeout(rzT); rzT = setTimeout(function () { if (!reduce) measureReactive(); }, 200); });

  /* ------------------------------------------------------------------
     Scroll choreography
     ------------------------------------------------------------------ */
  function setupScroll() {
    // Mood: the smoke subtly changes character from section to section
    $$('[data-mood]').forEach(function (sec) {
      ST.create({ trigger: sec, start: 'top 55%', end: 'bottom 55%', onToggle: function (s) { if (s.isActive) smoke.setMood(sec.getAttribute('data-mood')); } });
    });

    if (reduce) {
      $$('.reveal-up').forEach(function (e) { e.style.opacity = 1; });
      manifestoWords.forEach(function (w) { w.style.opacity = 1; });
      return;
    }

    // Hero turns to vapour as you leave it
    gsap.to('.hero__inner', { y: -90, opacity: 0, filter: 'blur(22px)', ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: '70% top', scrub: true } });
    gsap.to('#heroWord', { y: -150, opacity: 0, filter: 'blur(30px)', scale: 1.04, ease: 'none', scrollTrigger: { trigger: '.hero', start: '5% top', end: '85% top', scrub: true } });
    gsap.to('.hero__foot', { opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: '5% top', end: '30% top', scrub: true } });

    // Headings and body copy materialise out of the fog
    splits.forEach(function (s) {
      var el = s.el;
      if (el.hasAttribute('data-hero') || el.classList.contains('manifesto__text') || el.id === 'vanish') return;
      var units = s.mode === 'chars' ? s.chars : s.words;
      gsap.fromTo(units, { opacity: 0, y: '0.45em', filter: 'blur(14px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.4, ease: 'expo.out', stagger: s.mode === 'chars' ? 0.025 : 0.045, clearProps: 'filter,transform',
          scrollTrigger: { trigger: el, start: 'top 86%', once: true } });
    });

    // Manifesto: clears like fog as you read
    if (manifestoWords.length) {
      gsap.fromTo(manifestoWords, { opacity: 0.14, filter: fine ? 'blur(5px)' : 'blur(0px)' },
        { opacity: 1, filter: 'blur(0px)', ease: 'none', stagger: 0.12,
          scrollTrigger: { trigger: '.manifesto__text', start: 'top 82%', end: 'bottom 48%', scrub: 0.4 } });
    }
    gsap.from('.manifesto__pillars li', { y: 40, opacity: 0, filter: 'blur(8px)', duration: 1.2, ease: 'expo.out', stagger: 0.12, scrollTrigger: { trigger: '.manifesto__pillars', start: 'top 88%', once: true } });

    // “vanishes.” literally vanishes as it scrolls away
    var van = splits.filter(function (s) { return s.el.id === 'vanish'; })[0];
    if (van) {
      gsap.to(van.chars, {
        opacity: 0, filter: 'blur(16px)', yPercent: function () { return -30 - Math.random() * 60; }, xPercent: function () { return (Math.random() - 0.5) * 60; }, rotate: function () { return (Math.random() - 0.5) * 24; },
        ease: 'none', stagger: { amount: 0.7, from: 'random' },
        scrollTrigger: { trigger: '#vanish', start: 'top 38%', end: 'bottom -10%', scrub: 0.5,
          onUpdate: function (self) { if (self.progress > 0.02 && self.progress < 0.98 && Math.random() < 0.18) { var r = $('#vanish').getBoundingClientRect(); smoke.burst((r.left + Math.random() * r.width) / innerWidth, 1 - (r.top + r.height / 2) / innerHeight, 2, 0.7); } } }
      });
      gsap.from('.name__body', { y: 30, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.name__body', start: 'top 90%', once: true } });
    }

    // Services
    gsap.from('.svc__row', { y: 50, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.09, clearProps: 'transform', scrollTrigger: { trigger: '#svcList', start: 'top 85%', once: true } });

    // Approach + engagements
    [['.tile', '.approach__grid'], ['.plan', '.engage__grid']].forEach(function (p) {
      gsap.from(p[0], { y: 70, opacity: 0, filter: 'blur(10px)', duration: 1.3, ease: 'expo.out', stagger: 0.14, clearProps: 'filter,transform', scrollTrigger: { trigger: p[1], start: 'top 86%', once: true } });
    });
    gsap.from('.engage__sub', { y: 20, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.engage__sub', start: 'top 92%', once: true } });

    // FAQ + contact
    gsap.from('.qa', { y: 30, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.08, clearProps: 'transform', scrollTrigger: { trigger: '#faqList', start: 'top 86%', once: true } });
    gsap.from('.brief', { y: 60, opacity: 0, filter: 'blur(12px)', duration: 1.4, ease: 'expo.out', clearProps: 'filter,transform', scrollTrigger: { trigger: '.brief', start: 'top 90%', once: true } });
    gsap.from('.contact__sub, .contact__direct', { y: 20, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: '.contact__head', start: 'top 70%', once: true } });

    // Footer wordmark rises from the smoke
    if (footChars.length) {
      gsap.fromTo(footChars, { yPercent: 55, opacity: 0, filter: 'blur(18px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', ease: 'none', stagger: 0.05,
        scrollTrigger: { trigger: '.foot', start: 'top 92%', end: 'top 25%', scrub: 0.6 } });
    }

    // Process: pinned horizontal journey on desktop, simple reveals on mobile
    var mm = gsap.matchMedia();
    mm.add('(min-width: 900px)', function () {
      var track = $('#processTrack'), pinEl = $('#processPin'), bar = $('#processBar'), steps = $$('.step');
      var current = -1;
      function dist() { var pl = parseFloat(getComputedStyle(pinEl).paddingLeft) || 0; return Math.max(0, track.scrollWidth - (pinEl.clientWidth - pl * 2)); }
      function activate(i) {
        if (i === current) return;
        steps.forEach(function (s, k) { s.classList.toggle('is-active', k === i); });
        if (current !== -1) smoke.burst(0.25 + Math.random() * 0.5, 0.35 + Math.random() * 0.3, 7, 1.1);
        current = i;
      }
      activate(0);
      gsap.to(track, { x: function () { return -dist(); }, ease: 'none',
        scrollTrigger: { trigger: '.process', start: 'top top', end: function () { return '+=' + dist() * 1.15; }, pin: pinEl, scrub: 0.7, anticipatePin: 1, invalidateOnRefresh: true,
          onUpdate: function (self) { bar.style.transform = 'scaleX(' + self.progress + ')'; activate(clamp(Math.round(self.progress * (steps.length - 1)), 0, steps.length - 1)); } } });
      return function () { steps.forEach(function (s) { s.classList.remove('is-active'); }); };
    });
    mm.add('(max-width: 899px)', function () {
      gsap.from('.step', { y: 60, opacity: 0, filter: 'blur(10px)', duration: 1.2, ease: 'expo.out', stagger: 0.1, clearProps: 'filter,transform', scrollTrigger: { trigger: '#processTrack', start: 'top 85%', once: true } });
    });
  }

  /* ------------------------------------------------------------------
     FAQ accordion
     ------------------------------------------------------------------ */
  $$('.qa__q').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.closest('.qa'), open = !item.classList.contains('is-open');
      $$('.qa.is-open').forEach(function (o) { if (o !== item) { o.classList.remove('is-open'); $('.qa__q', o).setAttribute('aria-expanded', 'false'); } });
      item.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      setTimeout(function () { ST.refresh(); }, 900);
    });
  });

  /* ------------------------------------------------------------------
     The brief (multi-step form)
     ------------------------------------------------------------------ */
  var form = $('#brief');
  var stepEls = $$('.bstep', form), idx = 0, total = 4, busy = false;
  var nextBtn = $('#briefNext'), backBtn = $('#briefBack'), nextLabel = $('#briefNextLabel');
  var errEl = $('#briefError'), barEl = $('#briefBar'), countEl = $('#briefCount');
  var ENDPOINT = (form.getAttribute('data-endpoint') || '').trim();
  var MAIL = 'contact@evanescere.xyz';

  function pickEngagement(name) {
    var h = $('input[name="engagement"]', form);
    if (!h) { h = doc.createElement('input'); h.type = 'hidden'; h.name = 'engagement'; form.appendChild(h); }
    h.value = name;
  }

  function setStep(n, focus) {
    idx = n; errEl.textContent = '';
    stepEls.forEach(function (el, i) {
      var active = i === n;
      el.classList.toggle('is-active', active);
      el.classList.toggle('is-past', i < n);
      if (active) el.removeAttribute('inert'); else el.setAttribute('inert', '');
    });
    countEl.textContent = '0' + (n + 1) + ' / 0' + total;
    barEl.style.transform = 'scaleX(' + ((n + 1) / total) + ')';
    backBtn.disabled = n === 0;
    nextLabel.textContent = n === total - 1 ? 'Send brief' : 'Next';
    if (focus) {
      var f = $('input:checked, input:not([type=hidden]), textarea', stepEls[n]);
      setTimeout(function () { if (f) f.focus({ preventScroll: true }); }, 400);
    }
  }
  function valid(n) {
    errEl.textContent = '';
    $$('.is-invalid', form).forEach(function (e) { e.classList.remove('is-invalid'); });
    if (n < 3) {
      var names = ['project', 'budget', 'timeline'];
      if (!$('input[name="' + names[n] + '"]:checked', form)) { errEl.textContent = 'Choose an option to continue.'; return false; }
      return true;
    }
    var nm = form.elements.name, em = form.elements.email, ok = true;
    if (!nm.value.trim()) { nm.classList.add('is-invalid'); ok = false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em.value.trim())) { em.classList.add('is-invalid'); ok = false; }
    if (!ok) { errEl.textContent = 'Please add your name and a valid email.'; (nm.classList.contains('is-invalid') ? nm : em).focus(); }
    return ok;
  }
  function next() {
    if (busy) return;
    if (!valid(idx)) return;
    if (idx < total - 1) { setStep(idx + 1, true); } else { submit(); }
  }
  nextBtn.addEventListener('click', next);
  backBtn.addEventListener('click', function () { if (idx > 0) setStep(idx - 1, true); });
  form.addEventListener('submit', function (e) { e.preventDefault(); next(); });
  form.addEventListener('change', function (e) {
    if (e.target.type === 'radio' && idx < 3) setTimeout(function () { if (valid(idx)) setStep(idx + 1, true); }, 420);
  });

  function done(name, viaMail) {
    form.classList.add('is-done');
    var n = $('#doneName'); if (n && name) n.textContent = ', ' + name.split(' ')[0];
    stepEls.forEach(function (el) { var d = el.getAttribute('data-step') === 'done'; el.classList.toggle('is-active', d); el.classList.remove('is-past'); if (d) el.removeAttribute('inert'); else el.setAttribute('inert', ''); });
    barEl.style.transform = 'scaleX(1)';
    var r = form.getBoundingClientRect();
    smoke.burst((r.left + r.width / 2) / innerWidth, 1 - (r.top + r.height / 2) / innerHeight, 16, 1.5);
    if (viaMail) { var p = $('.bstep--done p:last-child', form); if (p) p.textContent = 'Your email app should have opened with the brief ready to send. If it did not, write to ' + MAIL + ' and we will take it from there.'; }
  }
  function submit() {
    var fd = new FormData(form), data = {};
    fd.forEach(function (v, k) { data[k] = v; });
    if (data._gotcha) { done(data.name); return; } // honeypot: pretend success
    delete data._gotcha;
    var subject = 'New project brief: ' + (data.name || 'Website enquiry');
    var lines = [['Project', data.project], ['Budget', data.budget], ['Timeline', data.timeline], ['Engagement', data.engagement], ['Name', data.name], ['Email', data.email], ['Company / site', data.company], ['Message', data.message]]
      .filter(function (l) { return l[1]; }).map(function (l) { return l[0] + ': ' + l[1]; });

    if (!ENDPOINT) { // no form service configured: hand off to the visitor's email client
      window.location.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
      done(data.name, true); return;
    }
    busy = true; nextBtn.disabled = true; nextLabel.textContent = 'Sending…'; errEl.textContent = '';
    data._subject = subject; data._replyto = data.email;
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); done(data.name); })
      .catch(function () { errEl.textContent = 'Something went wrong sending that. Please email us directly at ' + MAIL + '.'; nextLabel.textContent = 'Send brief'; })
      .then(function () { busy = false; nextBtn.disabled = false; });
  }
  setStep(0);

  /* ------------------------------------------------------------------
     Footer bits
     ------------------------------------------------------------------ */
  var yr = $('#year'); if (yr) yr.textContent = new Date().getFullYear();
  var toTop = $('#toTop'); // handled by the generic anchor handler

  /* ------------------------------------------------------------------
     Loader → intro
     ------------------------------------------------------------------ */
  var loader = $('#loader'), count = $('#loaderCount');
  var seen = false; try { seen = sessionStorage.getItem('evn-seen') === '1'; } catch (e) {}

  function intro() {
    doc.body.classList.remove('is-loading');
    if (lenis) lenis.start();
    buildReactive();
    setupScroll();
    ST.refresh();
    onScroll();
    if (reduce) return;
    var tl = gsap.timeline();
    tl.fromTo(heroChars, { opacity: 0, filter: 'blur(22px)', y: '0.35em' }, { opacity: 1, filter: 'blur(0px)', y: 0, duration: 1.6, ease: 'expo.out', stagger: { each: 0.04, from: 'random' }, clearProps: 'filter,transform' }, 0)
      .fromTo(heroWordChars, { opacity: 0, filter: 'blur(30px)', yPercent: 30 }, { opacity: 1, filter: 'blur(0px)', yPercent: 0, duration: 2, ease: 'expo.out', stagger: { each: 0.07, from: 'start' }, clearProps: 'filter,transform' }, 0.25)
      .to('.reveal-up', { opacity: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.12 }, 0.7);
    gsap.set('.reveal-up', { y: 24 });
    // the first exhale of smoke
    setTimeout(function () { smoke.burst(0.5, 0.42, 14, 1.6); smoke.burst(0.22, 0.6, 6, 1.1); smoke.burst(0.78, 0.55, 6, 1.1); }, 250);
  }

  function runLoader() {
    doc.body.classList.add('is-loading');
    var state = { n: 0 };
    var ready = new Promise(function (res) { var f = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve(); f.then(res, res); setTimeout(res, 2500); });
    var minTime = seen || reduce ? 0.5 : 2.1;

    if (reduce) { loader.style.display = 'none'; doc.body.classList.remove('is-loading'); intro(); return; }

    var tl = gsap.timeline();
    tl.to(loaderChars, { opacity: 1, duration: 1, stagger: { each: 0.06 }, ease: 'power2.out' }, 0.1)
      .fromTo(loaderChars, { filter: 'blur(20px)', y: 20 }, { filter: 'blur(0px)', y: 0, duration: 1.3, ease: 'expo.out', stagger: { each: 0.06 } }, 0.1)
      .to(state, { n: 100, duration: minTime, ease: 'power2.inOut', onUpdate: function () { count.textContent = ('00' + Math.round(state.n)).slice(-3); } }, 0);
    tl.eventCallback('onComplete', function () {
      ready.then(function () {
        try { sessionStorage.setItem('evn-seen', '1'); } catch (e) {}
        var out = gsap.timeline({ onComplete: function () { loader.style.display = 'none'; } });
        out.to(loaderChars, { opacity: 0, filter: 'blur(26px)', y: -70, x: function () { return (Math.random() - 0.5) * 60; }, rotate: function () { return (Math.random() - 0.5) * 16; }, duration: 1, ease: 'power2.in', stagger: { each: 0.04, from: 'random' } }, 0)
          .to('.loader__meta', { opacity: 0, duration: 0.5 }, 0)
          .to(loader, { opacity: 0, duration: 0.9, ease: 'power1.inOut' }, 0.5)
          .add(intro, 0.55);
      });
    });
  }

  runLoader();

  /* ------------------------------------------------------------------
     Fallback when GSAP is missing: still a complete site
     ------------------------------------------------------------------ */
  function initPlain() {
    var l = $('#loader'); if (l) l.style.display = 'none';
    $$('.qa__q').forEach(function (b) { b.addEventListener('click', function () { var i = b.closest('.qa'); i.classList.toggle('is-open'); b.setAttribute('aria-expanded', String(i.classList.contains('is-open'))); }); });
  }
})();
