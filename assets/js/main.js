/* Evanescere — choreography
   Two modes share one page:
   • Tunnel (default): scrolling is the camera moving forward through smoke. Each section is a scene
     at depth; the previous one rushes past and dissolves, the next resolves out of the fog.
   • Classic: ordinary vertical scroll with reveals. Used for reduced motion, no WebGL, or on request. */
(function () {
  'use strict';

  var doc = document, root = doc.documentElement;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var smooth = function (a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var coarse = !fine;
  var smoke = window.Smoke || { ok: false, setMood: function () {}, burst: function () {}, setCamera: function () {}, setPulse: function () {} };
  var hasGsap = !!(window.gsap && window.ScrollTrigger);

  if (!hasGsap) { root.classList.remove('js'); root.classList.add('no-js'); initPlain(); return; }

  var gsap = window.gsap, ST = window.ScrollTrigger;
  gsap.registerPlugin(ST);

  var classic = false;
  try { classic = /[?&]classic/.test(location.search) || sessionStorage.getItem('evn-classic') === '1'; } catch (e) {}
  var tunnelOn = smoke.ok && !reduce && !classic;

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
  function wordmark(id) { var el = $(id); return el ? split(el, 'chars').chars : []; }
  var heroWordChars = wordmark('#heroWord');
  var footChars = wordmark('#footWord');
  var loaderChars = wordmark('#loaderWord');

  var manifestoWords = $$('.manifesto__text .wd');
  var vanishSplit = splits.filter(function (s) { return s.el.id === 'vanish'; })[0];

  if (!reduce) {
    gsap.set(heroWordChars, { opacity: 0 });
    if (!tunnelOn) {
      splits.forEach(function (s) {
        if (s.el.classList.contains('manifesto__text') || s.el.id === 'vanish') return;
        gsap.set(s.mode === 'chars' ? s.chars : s.words, { opacity: 0 });
      });
    }
  }
  splits.forEach(function (s) { s.el.classList.add('is-split'); });

  /* ------------------------------------------------------------------
     3D world: every section is broken into panels placed in real 3D space.
     The camera flies forward (scroll = throttle); nothing scrolls or pans.
     ------------------------------------------------------------------ */
  var T = { panels: [], groups: [], stops: [], K: 1.5, lastD: 0, W: 0, H: 0, narrow: false, space: null, ready: false, lastCam: -1e9, curGroup: -1, anchors: {}, world: null, stage: null };
  var PERSP = 1000;
  var CAM_K = 0.0042, FOG_K = 0.0032; // scroll/world px → fog units
  var GROUPS = [
    { id: 'top', name: 'Intro', mood: 'hero' }, { id: 'manifesto', name: 'The premise', mood: 'deep' }, { id: 'name', name: 'The name', mood: 'deep' },
    { id: 'services', name: 'Services', mood: 'steel' }, { id: 'process', name: 'Process', mood: 'teal' }, { id: 'approach', name: 'Approach', mood: 'steel' },
    { id: 'engagements', name: 'Engagements', mood: 'ember' }, { id: 'faq', name: 'Questions', mood: 'deep' }, { id: 'contact', name: 'Start a project', mood: 'violet' }
  ];

  // Where everything lives. d = depth along the flight path (world px), x/y = offset from the path.
  // element references are cached on first use: once panels are lifted out of their containers the original selectors no longer match
  var ELC = {};
  function qa(sel) { return ELC[sel] || (ELC[sel] = $$(sel)); }
  function q1(sel) { return qa(sel)[0]; }
  function specs(W, H, n) {
    var out = [], vw = W / 100, vh = H / 100;
    var wide = function (f, max) { return Math.min(max, W * f); };
    var P = function (o) { out.push(o); };
    P({ g: 0, key: 'hero', els: [q1('#top')], full: true, d: 0, stop: 1 });
    P({ g: 1, key: 'prem', els: [q1('#manifesto > .label'), q1('.manifesto__text')], d: 1500, y: -4 * vh, w: wide(n ? 0.9 : 0.84, 1120), stop: 1 });
    qa('.manifesto__pillars li').forEach(function (li, i) {
      P({ g: 1, key: 'pil' + i, els: [li], d: n ? 2050 + i * 340 : 2000 + i * 150, x: n ? 0 : (i - 1) * 0.3 * W, y: n ? 0 : (i === 1 ? 10 : 7) * vh, w: n ? wide(0.84, 420) : wide(0.24, 330), stop: n ? 1 : (i === 0 ? 1 : 0) });
    });
    P({ g: 2, key: 'nmeta', els: [q1('.name__meta')], d: n ? 3500 : 3300, x: n ? 0 : 0.18 * W, y: n ? -30 * vh : -29 * vh, w: n ? wide(0.9, 520) : wide(0.5, 640) });
    P({ g: 2, key: 'ntitle', els: [q1('.name__title')], d: n ? 3500 : 3500, x: n ? 0 : -0.04 * W, y: n ? -2 * vh : -3 * vh, w: wide(n ? 0.92 : 0.86, 1200), stop: 1 });
    P({ g: 2, key: 'nbody', els: [q1('.name__body')], d: n ? 3850 : 3780, x: n ? 0 : 0.2 * W, y: n ? 26 * vh : 27 * vh, w: n ? wide(0.88, 460) : wide(0.36, 470) });
    P({ g: 3, key: 'shead', els: [q1('.services__head')], d: 5200, y: -2 * vh, w: wide(n ? 0.92 : 0.8, 980), stop: 1 });
    qa('.svc__row').forEach(function (r, i) {
      P({ g: 3, key: 'svc' + i, els: [r], d: 5900 + i * 540, x: n ? 0 : (i % 2 ? 1 : -1) * 0.235 * W, y: n ? (i % 2 ? 11 : -11) * vh : (i % 2 ? -9 : 9) * vh, w: n ? wide(0.9, 480) : wide(0.4, 540), stop: 1 });
    });
    P({ g: 4, key: 'phead', els: [q1('.process__head')], d: 9400, y: -2 * vh, w: wide(n ? 0.9 : 0.8, 1000), stop: 1 });
    qa('.step').forEach(function (st, i) {
      P({ g: 4, key: 'stp' + i, els: [st], d: 10100 + i * 640, x: n ? 0 : (i % 2 ? 1 : -1) * 0.23 * W, y: n ? (i % 2 ? 9 : -9) * vh : (i % 2 ? 7 : -7) * vh, w: n ? wide(0.9, 460) : wide(0.4, 520), stop: 1 });
    });
    P({ g: 5, key: 'ahead', els: [q1('.approach__head')], d: 12900, y: -2 * vh, w: wide(n ? 0.9 : 0.7, 900), stop: 1 });
    qa('.tile').forEach(function (t, i) {
      P({ g: 5, key: 'til' + i, els: [t], d: 13500 + i * 500, x: n ? 0 : (i % 2 ? 1 : -1) * 0.24 * W, y: n ? (i % 2 ? 10 : -10) * vh : (i % 2 ? 8 : -8) * vh, w: n ? wide(0.9, 460) : wide(0.38, 500), stop: 1 });
    });
    P({ g: 6, key: 'ehead', els: [q1('.engage__head')], d: 15500, y: n ? 0 : -1 * vh, w: wide(n ? 0.9 : 0.7, 900), stop: 1 });
    qa('.plan').forEach(function (pl, i) {
      P({ g: 6, key: 'pln' + i, els: [pl], d: n ? 16200 + i * 700 : 16200 + (i === 1 ? -80 : 0), x: n ? 0 : (i - 1) * 0.3 * W, y: n ? 0 : 0, w: n ? wide(0.9, 440) : wide(0.275, 380), stop: n ? 1 : (i === 1 ? 1 : 0) });
    });
    P({ g: 7, key: 'faq', els: [q1('.faq')], d: n ? 18500 : 17600, w: wide(n ? 0.94 : 0.9, 1180), stop: 1 });
    P({ g: 8, key: 'chead', els: [q1('.contact__head'), q1('.contact__direct')], d: n ? 19500 : 19000, x: n ? 0 : -0.25 * W, y: n ? -22 * vh : -2 * vh, w: n ? wide(0.9, 520) : wide(0.36, 480), stop: 1 });
    P({ g: 8, key: 'cform', els: [q1('.brief')], d: n ? 20000 : 19000, x: n ? 0 : 0.21 * W, y: n ? 12 * vh : 0, w: n ? wide(0.94, 560) : wide(0.5, 680), stop: 1 });
    P({ g: 8, key: 'foot', els: [q1('.foot')], full: true, bottom: true, d: n ? 20900 : 19900, stop: 1 });
    return out;
  }

  function buildWorld() {
    var main = $('#main');
    var stage = doc.createElement('div'); stage.className = 'stage';
    var world = doc.createElement('div'); world.className = 'world';
    stage.appendChild(world);
    T.space = doc.createElement('div'); T.space.className = 'scroll-space';
    var defs = specs(innerWidth, innerHeight, innerWidth < 900);
    defs.forEach(function (sp) {
      var el = doc.createElement('div'); el.className = 'panel' + (sp.full ? ' panel--full' : '');
      sp.els.forEach(function (e) { if (e) { e.parentNode && e.parentNode.removeChild(e); el.appendChild(e); } });
      world.appendChild(el);
      var units = $$('.wd', el).filter(function (u) { return !u.closest('.manifesto__text') && !u.closest('#top'); });
      T.panels.push({ el: el, key: sp.key, g: sp.g, units: units, vis: false, emerged: true, hit: false, sig: '', d: 0, px: 0, py: 0, fit: 1 });
    });
    main.appendChild(stage); main.appendChild(T.space);
    T.world = world; T.stage = stage;
    root.classList.add('tunnel');
  }
  if (tunnelOn) buildWorld();
  window.__evn = T; // debugging handle

  function panelOf(el) {
    var pe = el && el.closest ? el.closest('.panel') : null;
    for (var i = 0; i < T.panels.length; i++) if (T.panels[i].el === pe) return T.panels[i];
    return null;
  }

  function layoutWorld() {
    var W = window.innerWidth, H = window.innerHeight, n = W < 900;
    T.W = W; T.H = H; T.narrow = n;
    // gentler speed on phones where a swipe covers a lot of ground
    T.K = n ? 1.7 : 1.5;
    var defs = specs(W, H, n);
    var last = 0;
    T.stops = []; T.anchors = {};
    defs.forEach(function (sp, i) {
      var p = T.panels[i], el = p.el;
      el.style.display = 'block'; el.style.transform = 'none'; el.style.filter = ''; el.style.opacity = '';
      if (p.key === 'cform') fitSteps();
      if (sp.full) { el.style.width = W + 'px'; el.style.height = sp.bottom ? 'auto' : H + 'px'; }
      else { el.style.width = (sp.w || W * 0.8) + 'px'; el.style.height = ''; }
      var w = el.offsetWidth, h = el.offsetHeight;
      p.w = w; p.h = h; p.sig = '';
      p.fit = sp.full ? 1 : Math.min(1, (W * 0.94) / w, (H * 0.9) / h);
      p.d = sp.d; p.px = sp.x || 0; p.py = sp.y || 0;
      if (sp.bottom) p.py = (H - h) / 2;
      el.style.display = p.vis ? 'block' : 'none';
      if (sp.stop) T.stops.push(sp.d);
      var g = GROUPS[sp.g];
      if (T.anchors[g.id] === undefined) T.anchors[g.id] = sp.d;
      last = Math.max(last, sp.d);
    });
    T.lastD = last;
    T.stops.sort(function (a, b) { return a - b; });
    T.space.style.height = (last / T.K + H) + 'px';
    T.total = last / T.K;
    T.ready = true; T.lastCam = -1e9;
  }

  /* ------------------------------------------------------------------
     Smooth scroll (Lenis) wired into GSAP's ticker
     ------------------------------------------------------------------ */
  var lenis = null;
  if (window.Lenis && !reduce) {
    lenis = new window.Lenis({ duration: tunnelOn ? 1.5 : 1.2, easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); }, smoothWheel: true, autoRaf: false });
    lenis.on('scroll', ST.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }
  function scrollY() { return lenis ? lenis.scroll : window.scrollY; }
  function anchorY(el) {
    var p = panelOf(el);
    if (p) return p.d / T.K;
    if (el && el.id && T.anchors[el.id] !== undefined) return T.anchors[el.id] / T.K;
    return 0;
  }
  var navBusy = false;
  function goTo(target, instant) {
    var y;
    if (typeof target === 'number') y = target;
    else if (tunnelOn) y = anchorY(target);
    else y = target.getBoundingClientRect().top + window.scrollY;
    if (lenis) {
      var dist = Math.abs(y - scrollY());
      navBusy = true;
      lenis.scrollTo(y, { duration: instant ? 0 : clamp(1.4 + dist / 5000, 1.6, 3.4), easing: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }, immediate: !!instant, onComplete: function () { navBusy = false; } });
    } else window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  }

  /* ------------------------------------------------------------------
     Navigation, menu, HUD
     ------------------------------------------------------------------ */
  var nav = $('#nav'), burger = $('#burger'), menu = $('#menu'), progressBar = $('#progressBar');
  var hudNo = $('#hudNo'), hudName = $('#hudName'), veil = $('#veil');
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
    var cl = e.target.closest('[data-classic]');
    if (cl) { try { sessionStorage.setItem('evn-classic', '1'); } catch (er) {} location.reload(); return; }
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (id.length < 2) return;
    var t = (id === '#top' || id === '#main') ? 0 : $(id);
    if (t === null || t === undefined) return;
    e.preventDefault();
    if (a.hasAttribute('data-pick')) pickEngagement(a.getAttribute('data-pick'));
    var go = function () { t === 0 ? goTo(0) : goTo(t); };
    if (menuOpen) { setMenu(false); setTimeout(go, 250); } else go();
  });

  function onScroll() {
    var y = scrollY();
    var max = tunnelOn ? Math.max(1, T.total) : Math.max(1, doc.documentElement.scrollHeight - window.innerHeight);
    if (progressBar) progressBar.style.transform = 'scaleY(' + clamp(y / max, 0, 1) + ')';
    if (!tunnelOn && !menuOpen) {
      if (y > 140 && y > lastY + 4) nav.classList.add('is-hidden');
      else if (y < lastY - 4 || y < 140) nav.classList.remove('is-hidden');
    }
    lastY = y;
  }
  if (lenis) lenis.on('scroll', onScroll); else window.addEventListener('scroll', onScroll, { passive: true });

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
      var view = !!t && t.getAttribute('data-cursor') === 'view';
      cursor.classList.toggle('is-hover', !!t && !view);
      cursor.classList.toggle('is-view', view);
    });
    doc.addEventListener('mouseleave', function () { cursor.style.opacity = 0; });
    doc.addEventListener('mouseenter', function () { cursor.style.opacity = ''; });
    window.addEventListener('pointerdown', function () { cursor.classList.add('is-down'); });
    window.addEventListener('pointerup', function () { cursor.classList.remove('is-down'); });

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
  var reactive = [], pt = { x: -9999, y: -9999 }, heroLive = true;
  function measureReactive() {
    var sy = tunnelOn ? 0 : window.scrollY;
    reactive.forEach(function (o) { o.el.style.cssText = ''; });
    reactive.forEach(function (o) {
      var r = o.el.getBoundingClientRect();
      o.cx = r.left + r.width / 2; o.cy = r.top + sy + r.height / 2; o.f = 0; o.on = false;
    });
  }
  function buildReactive() {
    reactive = [];
    heroChars.forEach(function (el) { reactive.push({ el: el, R: Math.max(120, innerWidth * 0.1), blur: 9, push: 26 }); });
    heroWordChars.forEach(function (el) { reactive.push({ el: el, R: Math.max(160, innerWidth * 0.15), blur: 14, push: 40 }); });
    measureReactive();
  }
  if (!tunnelOn) ST.create({ trigger: $('.hero'), start: 'top top', end: 'bottom top', onToggle: function (s) { heroLive = s.isActive; } });

  function tickReactive() {
    if (!heroLive || !reactive.length) return;
    var sy = tunnelOn ? 0 : scrollY();
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

  /* ------------------------------------------------------------------
     3D WORLD: per-frame camera + panel state
     ------------------------------------------------------------------ */
  var vanishRand = vanishSplit ? vanishSplit.chars.map(function () { return Math.random(); }) : [];
  var vanishDir = vanishSplit ? vanishSplit.chars.map(function () { return [(Math.random() - 0.5) * 70, -30 - Math.random() * 80, (Math.random() - 0.5) * 30]; }) : [];
  var tilt = { x: 0, y: 0, tx: 0, ty: 0, lx: 9, ly: 9 };
  if (tunnelOn && fine && !reduce) window.addEventListener('pointermove', function (e) { tilt.tx = (e.clientX / innerWidth - 0.5) * 2; tilt.ty = -(e.clientY / innerHeight - 0.5) * 2; }, { passive: true });

  function emergeUnits(p, e) {
    var N = p.units.length, i, u, a, k;
    if (!N) return;
    if (e >= 1) {
      if (!p.emerged) { for (i = 0; i < N; i++) { u = p.units[i]; u.classList.remove('emerging'); u.style.cssText = ''; } p.emerged = true; }
      return;
    }
    p.emerged = false;
    var blurMax = coarse ? 5 : 12;
    for (i = 0; i < N; i++) {
      u = p.units[i];
      u.classList.add('emerging');
      k = (i / Math.max(1, N)) * 0.5;
      a = clamp((e - k) / 0.5, 0, 1); a = a * a * (3 - 2 * a);
      u.style.cssText = 'opacity:' + a.toFixed(3) + ';filter:blur(' + ((1 - a) * blurMax).toFixed(2) + 'px);transform:translate3d(0,' + ((1 - a) * 22).toFixed(1) + 'px,0) scale(' + (0.955 + 0.045 * a).toFixed(4) + ')';
    }
  }

  var FAR = 1600, NEAR = 620;
  function worldTick() {
    if (!T.ready) return;
    var y = scrollY(), cam = y * T.K;
    smoke.setCamera(cam * FOG_K);

    // the world leans toward the pointer: depth reads as parallax
    tilt.x += (tilt.tx - tilt.x) * 0.06; tilt.y += (tilt.ty - tilt.y) * 0.06;
    if (Math.abs(tilt.x - tilt.lx) > 1e-4 || Math.abs(tilt.y - tilt.ly) > 1e-4) {
      tilt.lx = tilt.x; tilt.ly = tilt.y;
      T.world.style.transform = 'rotateX(' + (tilt.y * 2.2).toFixed(3) + 'deg) rotateY(' + (tilt.x * 3).toFixed(3) + 'deg)';
      smoke.setLook(tilt.x * 0.07, tilt.y * 0.05);
    }
    if (cam === T.lastCam) return;
    T.lastCam = cam;

    var n = T.panels.length, nearest = 0, nearAbs = 1e9, i, p, dz;
    for (i = 0; i < n; i++) {
      p = T.panels[i]; dz = p.d - cam;
      var fa = Math.abs(dz - 150);
      if (fa < nearAbs) { nearAbs = fa; nearest = i; }
      if (dz > FAR || dz < -NEAR) {
        if (p.vis) { p.el.style.display = 'none'; p.vis = false; p.sig = ''; if (p.hit) { p.el.classList.remove('is-hit'); p.hit = false; } }
        continue;
      }
      if (!p.vis) { p.el.style.display = 'block'; p.vis = true; }

      // depth cues: panels surface out of the fog ahead, and dissolve once they pass the camera
      var op, bl;
      if (dz >= 0) { op = 1 - smooth(480, 1400, dz); bl = smooth(0, 1500, dz) * (coarse ? 9 : 16); }
      else { op = 1 - smooth(40, 500, -dz); bl = smooth(0, 500, -dz) * (coarse ? 10 : 22); }
      if (p.key === 'foot' && dz > 0) op *= 1 - smooth(450, 760, dz);
      var sig = dz.toFixed(1) + p.fit;
      if (sig !== p.sig) {
        p.sig = sig;
        var st = p.el.style;
        st.transform = 'translate3d(' + p.px.toFixed(1) + 'px,' + p.py.toFixed(1) + 'px,' + (-dz).toFixed(1) + 'px) translate(-50%,-50%) scale(' + p.fit.toFixed(4) + ')';
        st.opacity = op >= 0.999 ? '' : op.toFixed(3);
        st.filter = bl < 0.15 ? '' : 'blur(' + bl.toFixed(2) + 'px)';
      }
      var hit = dz > -140 && dz < 460;
      if (hit !== p.hit) { p.hit = hit; p.el.classList.toggle('is-hit', hit); }

      emergeUnits(p, dz >= 0 ? clamp((1300 - dz) / 900, 0, 1) : 1);

      if (p.key === 'prem' && manifestoWords.length) {
        var pr = clamp((780 - dz) / 780, 0, 1), N = manifestoWords.length;
        for (var w = 0; w < N; w++) {
          var a = clamp(pr * (N + 5) - w, 0, 1);
          manifestoWords[w].style.opacity = (0.14 + 0.86 * a).toFixed(3);
          if (!coarse) manifestoWords[w].style.filter = a < 1 ? 'blur(' + ((1 - a) * 5).toFixed(1) + 'px)' : '';
        }
      } else if (p.key === 'ntitle' && vanishSplit) {
        var pv = dz < 10 ? clamp((-dz + 10) / 380, 0, 1) : 0;
        for (var c = 0; c < vanishSplit.chars.length; c++) {
          var av = clamp((pv - vanishRand[c] * 0.55) / 0.45, 0, 1), d = vanishDir[c];
          vanishSplit.chars[c].style.cssText = av <= 0 ? '' : 'opacity:' + (1 - av).toFixed(3) + ';filter:blur(' + (av * 16).toFixed(1) + 'px);transform:translate3d(' + (d[0] * av).toFixed(1) + 'px,' + (d[1] * av).toFixed(1) + 'px,0) rotate(' + (d[2] * av).toFixed(1) + 'deg)';
        }
      } else if (p.key === 'foot' && footChars.length) {
        var fp = clamp((700 - dz) / 650, 0, 1), M = footChars.length;
        for (var f = 0; f < M; f++) {
          var fa2 = clamp(fp * (M + 4) - f, 0, 1);
          footChars[f].style.cssText = fa2 >= 1 ? '' : 'opacity:' + fa2.toFixed(3) + ';filter:blur(' + ((1 - fa2) * 16).toFixed(1) + 'px);transform:translate3d(0,' + ((1 - fa2) * 55).toFixed(1) + '%,0)';
        }
      }
    }

    heroLive = cam < 60;
    if (T.needMeasure && cam < 4) { T.needMeasure = false; if (!reduce) measureReactive(); }

    // the fog thickens in the voids between rooms
    var pulse = smooth(380, 1100, nearAbs) * 0.85;
    smoke.setPulse(pulse);
    if (veil) veil.style.opacity = (pulse * 0.4).toFixed(3);

    var gi = T.panels[nearest].g;
    if (gi !== T.curGroup) {
      T.curGroup = gi;
      smoke.setMood(GROUPS[gi].mood);
      if (hudNo) { hudNo.textContent = pad(gi + 1) + ' / ' + pad(GROUPS.length); hudName.textContent = GROUPS[gi].name; }
    }
  }

  /* ------------------------------------------------------------------
     Navigation without scrolling: keys and idle-snap move between stops
     ------------------------------------------------------------------ */
  var lastInput = 0, snapping = false;
  function nextStop(dir) {
    var cam = scrollY() * T.K, i;
    if (dir > 0) { for (i = 0; i < T.stops.length; i++) if (T.stops[i] > cam + 60) return T.stops[i]; return T.stops[T.stops.length - 1]; }
    for (i = T.stops.length - 1; i >= 0; i--) if (T.stops[i] < cam - 60) return T.stops[i];
    return 0;
  }
  if (tunnelOn) {
    ['wheel', 'touchstart', 'pointerdown'].forEach(function (ev) { window.addEventListener(ev, function () { lastInput = performance.now(); snapping = false; navBusy = false; }, { passive: true }); });
    doc.addEventListener('keydown', function (e) {
      if (menuOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      var k = e.key, dir = 0;
      if (k === 'ArrowDown' || k === 'PageDown' || k === 'ArrowRight' || (k === ' ' && !e.shiftKey && tag !== 'button' && tag !== 'a')) dir = 1;
      else if (k === 'ArrowUp' || k === 'PageUp' || k === 'ArrowLeft' || (k === ' ' && e.shiftKey && tag !== 'button' && tag !== 'a')) dir = -1;
      else if (k === 'Home') { e.preventDefault(); goTo(0); return; }
      else if (k === 'End') { e.preventDefault(); goTo(T.total); return; }
      if (!dir) return;
      e.preventDefault(); lastInput = performance.now();
      goTo(nextStop(dir) / T.K);
    });
    // after a pause, glide to the nearest stop so you always land on something readable (mouse only)
    if (fine && lenis) gsap.ticker.add(function () {
      if (snapping || navBusy || menuOpen || !T.ready || performance.now() - lastInput < 380 || performance.now() - lastInput > 4000) return;
      var cam = scrollY() * T.K, best = null, bd = 1e9;
      for (var i = 0; i < T.stops.length; i++) { var dd = Math.abs(T.stops[i] - cam); if (dd < bd) { bd = dd; best = T.stops[i]; } }
      lastInput = 0;
      if (best === null || bd < 8 || bd > 520) return;
      snapping = true;
      lenis.scrollTo(best / T.K, { duration: 0.95, easing: function (t) { return 1 - Math.pow(1 - t, 3); }, onComplete: function () { snapping = false; } });
    });
  }

  /* ------------------------------------------------------------------
     Classic mode: ordinary scroll with reveals
     ------------------------------------------------------------------ */
  function setupClassic() {
    $$('[data-mood]').forEach(function (sec) {
      ST.create({ trigger: sec, start: 'top 55%', end: 'bottom 55%', onToggle: function (s) { if (s.isActive) smoke.setMood(sec.getAttribute('data-mood')); } });
    });
    ST.create({ trigger: doc.body, start: 'top top', end: 'bottom bottom', onUpdate: function (self) { smoke.setCamera(self.scroll() * CAM_K); } });

    if (reduce) {
      $$('.reveal-up').forEach(function (e) { e.style.opacity = 1; });
      manifestoWords.forEach(function (w) { w.style.opacity = 1; });
      return;
    }
    gsap.to('.hero__inner', { y: -90, opacity: 0, filter: 'blur(22px)', ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: '70% top', scrub: true } });
    gsap.to('#heroWord', { y: -150, opacity: 0, filter: 'blur(30px)', scale: 1.04, ease: 'none', scrollTrigger: { trigger: '.hero', start: '5% top', end: '85% top', scrub: true } });
    gsap.to('.hero__foot', { opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: '5% top', end: '30% top', scrub: true } });

    splits.forEach(function (s) {
      var el = s.el;
      if (el.hasAttribute('data-hero') || el.classList.contains('manifesto__text') || el.id === 'vanish') return;
      var units = s.mode === 'chars' ? s.chars : s.words;
      gsap.fromTo(units, { opacity: 0, y: '0.45em', filter: 'blur(14px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.4, ease: 'expo.out', stagger: s.mode === 'chars' ? 0.025 : 0.045, clearProps: 'filter,transform',
          scrollTrigger: { trigger: el, start: 'top 86%', once: true } });
    });
    if (manifestoWords.length) {
      gsap.fromTo(manifestoWords, { opacity: 0.14, filter: fine ? 'blur(5px)' : 'blur(0px)' },
        { opacity: 1, filter: 'blur(0px)', ease: 'none', stagger: 0.12, scrollTrigger: { trigger: '.manifesto__text', start: 'top 82%', end: 'bottom 48%', scrub: 0.4 } });
    }
    gsap.from('.manifesto__pillars li', { y: 40, opacity: 0, filter: 'blur(8px)', duration: 1.2, ease: 'expo.out', stagger: 0.12, scrollTrigger: { trigger: '.manifesto__pillars', start: 'top 88%', once: true } });
    if (vanishSplit) {
      gsap.to(vanishSplit.chars, { opacity: 0, filter: 'blur(16px)', yPercent: function () { return -30 - Math.random() * 60; }, xPercent: function () { return (Math.random() - 0.5) * 60; }, rotate: function () { return (Math.random() - 0.5) * 24; }, ease: 'none', stagger: { amount: 0.7, from: 'random' }, scrollTrigger: { trigger: '#vanish', start: 'top 38%', end: 'bottom -10%', scrub: 0.5 } });
      gsap.from('.name__body', { y: 30, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.name__body', start: 'top 90%', once: true } });
    }
    gsap.from('.svc__row', { y: 50, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.09, clearProps: 'transform', scrollTrigger: { trigger: '#svcList', start: 'top 85%', once: true } });
    [['.tile', '.approach__grid'], ['.plan', '.engage__grid']].forEach(function (p) {
      gsap.from(p[0], { y: 70, opacity: 0, filter: 'blur(10px)', duration: 1.3, ease: 'expo.out', stagger: 0.14, clearProps: 'filter,transform', scrollTrigger: { trigger: p[1], start: 'top 86%', once: true } });
    });
    gsap.from('.engage__sub', { y: 20, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.engage__sub', start: 'top 92%', once: true } });
    gsap.from('.qa', { y: 30, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.08, clearProps: 'transform', scrollTrigger: { trigger: '#faqList', start: 'top 86%', once: true } });
    gsap.from('.brief', { y: 60, opacity: 0, filter: 'blur(12px)', duration: 1.4, ease: 'expo.out', clearProps: 'filter,transform', scrollTrigger: { trigger: '.brief', start: 'top 90%', once: true } });
    gsap.from('.contact__sub, .contact__direct', { y: 20, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: '.contact__head', start: 'top 70%', once: true } });
    if (footChars.length) {
      gsap.fromTo(footChars, { yPercent: 55, opacity: 0, filter: 'blur(18px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', ease: 'none', stagger: 0.05, scrollTrigger: { trigger: '.foot', start: 'top 92%', end: 'top 25%', scrub: 0.6 } });
    }

    var mm = gsap.matchMedia();
    mm.add('(min-width: 900px)', function () {
      var track = $('#processTrack'), pinEl = $('#processPin'), bar = $('#processBar'), steps = $$('.step'), current = -1;
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
  function relayout() { if (tunnelOn) { layoutWorld(); } else { ST.refresh(); } }
  $$('.qa__q').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.closest('.qa'), open = !item.classList.contains('is-open');
      $$('.qa.is-open').forEach(function (o) { if (o !== item) { o.classList.remove('is-open'); $('.qa__q', o).setAttribute('aria-expanded', 'false'); } });
      item.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      setTimeout(relayout, 900);
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
  var stepsWrap = $('#briefSteps');
  function fitSteps() {
    var a = $('.bstep.is-active', form);
    if (a && stepsWrap) stepsWrap.style.height = a.offsetHeight + 'px';
  }
  function setStep(n, focus) {
    idx = n; errEl.textContent = '';
    stepEls.forEach(function (el, i) {
      var active = i === n;
      el.classList.toggle('is-active', active);
      el.classList.toggle('is-past', i < n);
      if (active) el.removeAttribute('inert'); else el.setAttribute('inert', '');
    });
    fitSteps();
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
    fitSteps();
    var r = form.getBoundingClientRect();
    smoke.burst((r.left + r.width / 2) / innerWidth, 1 - (r.top + r.height / 2) / innerHeight, 16, 1.5);
    if (viaMail) { var p = $('.bstep--done p:last-child', form); if (p) p.textContent = 'Your email app should have opened with the brief ready to send. If it did not, write to ' + MAIL + ' and we will take it from there.'; }
  }
  function submit() {
    var fd = new FormData(form), data = {};
    fd.forEach(function (v, k) { data[k] = v; });
    if (data._gotcha) { done(data.name); return; }
    delete data._gotcha;
    var subject = 'New project brief: ' + (data.name || 'Website enquiry');
    var lines = [['Project', data.project], ['Budget', data.budget], ['Timeline', data.timeline], ['Engagement', data.engagement], ['Name', data.name], ['Email', data.email], ['Company / site', data.company], ['Message', data.message]]
      .filter(function (l) { return l[1]; }).map(function (l) { return l[0] + ': ' + l[1]; });
    if (!ENDPOINT) {
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

  var yr = $('#year'); if (yr) yr.textContent = new Date().getFullYear();

  /* ------------------------------------------------------------------
     Layout upkeep (tunnel): fonts, resize, content changes
     ------------------------------------------------------------------ */
  if (tunnelOn) {
    var rzT;
    var queue = function () { clearTimeout(rzT); rzT = setTimeout(function () { layoutWorld(); T.needMeasure = true; }, 160); };
    window.addEventListener('resize', queue);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var r = entries[i].contentRect, pp = null;
          for (var k = 0; k < T.panels.length; k++) if (T.panels[k].el === entries[i].target) { pp = T.panels[k]; break; }
          if (pp && r.height > 0 && Math.abs(r.height - pp.h) > 3) { queue(); return; }
        }
      });
      T.panels.forEach(function (p) { ro.observe(p.el); });
    }
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { fitSteps(); queue(); });
    window.addEventListener('resize', fitSteps);
    gsap.ticker.add(worldTick);
  } else {
    var rz2; window.addEventListener('resize', function () { clearTimeout(rz2); rz2 = setTimeout(function () { if (!reduce) measureReactive(); }, 200); });
  }

  /* ------------------------------------------------------------------
     Loader → intro
     ------------------------------------------------------------------ */
  var loader = $('#loader'), count = $('#loaderCount');
  var seen = false; try { seen = sessionStorage.getItem('evn-seen') === '1'; } catch (e) {}

  function intro() {
    doc.body.classList.remove('is-loading');
    if (lenis) lenis.start();
    if (tunnelOn) { layoutWorld(); worldTick(); } else { setupClassic(); ST.refresh(); }
    buildReactive();
    onScroll();
    if (reduce) { $$('.reveal-up').forEach(function (e) { e.style.opacity = 1; }); return; }
    var tl = gsap.timeline();
    tl.fromTo(heroChars, { opacity: 0, filter: 'blur(22px)', y: '0.35em' }, { opacity: 1, filter: 'blur(0px)', y: 0, duration: 1.8, ease: 'expo.out', stagger: { each: 0.045, from: 'random' }, clearProps: 'filter,transform' }, 0)
      .fromTo(heroWordChars, { opacity: 0, filter: 'blur(30px)', yPercent: 30 }, { opacity: 1, filter: 'blur(0px)', yPercent: 0, duration: 2.2, ease: 'expo.out', stagger: { each: 0.07, from: 'start' }, clearProps: 'filter,transform' }, 0.25)
      .to('.reveal-up', { opacity: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.12 }, 0.7);
    gsap.set('.reveal-up', { y: 24 });
    setTimeout(function () { smoke.burst(0.5, 0.42, 10, 1.2); }, 250);
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

  function initPlain() {
    var l = $('#loader'); if (l) l.style.display = 'none';
    $$('.qa__q').forEach(function (b) { b.addEventListener('click', function () { var i = b.closest('.qa'); i.classList.toggle('is-open'); b.setAttribute('aria-expanded', String(i.classList.contains('is-open'))); }); });
  }
})();
