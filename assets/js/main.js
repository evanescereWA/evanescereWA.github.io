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
     Tunnel DOM: wrap each section in a scene on a fixed stage
     ------------------------------------------------------------------ */
  var T = { scenes: [], TR: 0, total: 0, H: 0, W: 0, cur: -1, space: null, ready: false, lastY: -1, needMeasure: false };
  var CAM_K = 0.0042; // scroll px → world units of camera travel

  var UNIT_SEL = '.wd, .svc__row, .tile, .plan, .step, .qa, .manifesto__pillars li, .brief, .contact__sub, .contact__direct, .engage__sub, .diff__sub, .name__def, .label';
  var SCENE_CFG = { top: { hold: 0.5 }, manifesto: { hold: 1.8 }, name: { hold: 1.5 }, services: { hold: 0.5 }, difference: { hold: 0.7 }, process: { hold: 0.5 }, approach: { hold: 0.5 }, engagements: { hold: 0.5 }, faq: { hold: 0.5 }, contact: { hold: 0.35 } };

  function buildTunnel() {
    var main = $('#main'), foot = $('.foot');
    var stage = doc.createElement('div'); stage.className = 'stage';
    T.space = doc.createElement('div'); T.space.className = 'scroll-space';
    $$('main > section').forEach(function (sec, i) {
      var scene = doc.createElement('div'); scene.className = 'scene';
      var pan = doc.createElement('div'); pan.className = 'scene__pan';
      sec.parentNode.removeChild(sec); pan.appendChild(sec); scene.appendChild(pan); stage.appendChild(scene);
      var cfg = SCENE_CFG[sec.id] || { hold: 0.5 };
      var units = i === 0 ? [] : $$(UNIT_SEL, sec).filter(function (u) { return !u.closest('.manifesto__text'); });
      T.scenes.push({ el: scene, pan: pan, sec: sec, id: sec.id, name: sec.getAttribute('data-name') || '', mood: sec.getAttribute('data-mood') || 'hero', holdVh: cfg.hold, units: units, live: false, emerged: true, axis: 'y', panMax: 0, start: 0, end: 0, sig: '' });
    });
    var lastPan = T.scenes[T.scenes.length - 1].pan;
    lastPan.appendChild(foot);
    main.appendChild(stage); main.appendChild(T.space);
    root.classList.add('tunnel');
  }
  if (tunnelOn) buildTunnel();
  window.__evn = T; // debugging handle

  function sceneIndexOf(el) {
    for (var i = 0; i < T.scenes.length; i++) if (T.scenes[i].el.contains(el)) return i;
    return -1;
  }

  function layoutTunnel() {
    var H = window.innerHeight, W = window.innerWidth, pos = 0;
    T.H = H; T.W = W; T.TR = Math.max(520, H * 0.92);
    var wide = window.matchMedia('(min-width: 900px)').matches;
    T.scenes.forEach(function (s, i) {
      s.axis = (s.id === 'process' && wide) ? 'x' : 'y';
      if (s.axis === 'x') {
        var track = $('#processTrack', s.sec), pin = $('#processPin', s.sec);
        var pl = parseFloat(getComputedStyle(pin).paddingLeft) || 0;
        s.panMax = Math.max(0, track.scrollWidth - (W - pl * 2));
      } else {
        s.panMax = Math.max(0, s.pan.offsetHeight - H);
      }
      s.hold = s.holdVh * H;
      s.start = pos;
      s.end = pos + s.hold + s.panMax;
      pos = s.end + (i < T.scenes.length - 1 ? T.TR : 0);
    });
    T.total = pos;
    T.space.style.height = (pos + H) + 'px';
    T.ready = true; T.lastY = -1;
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
  function goTo(target, instant) {
    var y;
    if (typeof target === 'number') y = target;
    else if (tunnelOn) { var i = sceneIndexOf(target); y = i <= 0 ? 0 : T.scenes[i].start + 2; }
    else y = target.getBoundingClientRect().top + window.scrollY;
    if (lenis) {
      var dist = Math.abs(y - scrollY());
      lenis.scrollTo(y, { duration: instant ? 0 : clamp(1.4 + dist / 5000, 1.6, 3.4), easing: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }, immediate: !!instant });
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
      var t = e.target.closest('a, button, .chip, [data-cursor], .cmp');
      var view = !!t && (t.getAttribute('data-cursor') === 'view' || t.classList.contains('cmp'));
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
     TUNNEL: per-frame scene state
     ------------------------------------------------------------------ */
  var vanishRand = vanishSplit ? vanishSplit.chars.map(function () { return Math.random(); }) : [];
  var vanishDir = vanishSplit ? vanishSplit.chars.map(function () { return [(Math.random() - 0.5) * 50, -30 - Math.random() * 60, (Math.random() - 0.5) * 22]; }) : [];
  var cmpPlayed = false, cmpTween = null;

  function clearScene(s) {
    s.el.classList.remove('is-live'); s.live = false;
    s.el.style.transform = ''; s.el.style.opacity = ''; s.el.style.filter = ''; s.sig = '';
  }
  function emergeUnits(s, e) {
    var N = s.units.length, i, u, a, k;
    if (e >= 1) {
      if (!s.emerged) { for (i = 0; i < N; i++) { u = s.units[i]; u.classList.remove('emerging'); u.style.cssText = ''; } s.emerged = true; }
      return;
    }
    s.emerged = false;
    var blurMax = coarse ? 5 : 12;
    for (i = 0; i < N; i++) {
      u = s.units[i];
      u.classList.add('emerging');
      k = (i / Math.max(1, N)) * 0.5;
      a = clamp((e - k) / 0.5, 0, 1); a = a * a * (3 - 2 * a);
      u.style.cssText = 'opacity:' + a.toFixed(3) + ';filter:blur(' + ((1 - a) * blurMax).toFixed(2) + 'px);transform:translate3d(0,' + ((1 - a) * 22).toFixed(1) + 'px,0) scale(' + (0.955 + 0.045 * a).toFixed(4) + ')';
    }
  }

  function tunnelTick() {
    if (!T.ready) return;
    var y = scrollY();
    smoke.setCamera(y * CAM_K);
    if (y === T.lastY) return;
    T.lastY = y;

    var TR = T.TR, n = T.scenes.length, cur = 0, pulse = 0, i, s;
    for (i = 0; i < n; i++) {
      s = T.scenes[i];
      var e = i === 0 ? 1 : clamp((y - (s.start - TR)) / TR, 0, 1);
      var x = i === n - 1 ? 0 : clamp((y - s.end) / TR, 0, 1);
      if (!(e > 0 && x < 1)) { if (s.live) clearScene(s); continue; }
      if (!s.live) { s.el.classList.add('is-live'); s.live = true; }
      if (e >= 0.5) cur = i;
      if (i > 0 && e > 0 && e < 1) pulse = Math.max(pulse, Math.sin(Math.PI * e));

      // flight: approach from the fog, pass the camera, dissolve behind it
      var stable = e >= 1 && x <= 0;
      var ee = 1 - Math.pow(1 - e, 3);
      var sc = (0.62 + 0.38 * ee) * (1 + 1.5 * Math.pow(x, 2.1));
      var op = smooth(0, 0.35, e) * (1 - smooth(0.3, 0.85, x));
      var bl = (1 - e) * (1 - e) * (coarse ? 8 : 15) + Math.pow(x, 1.7) * (coarse ? 10 : 22);
      var sig = stable ? 'S' : sc.toFixed(3) + op.toFixed(3) + bl.toFixed(1);
      if (sig !== s.sig) {
        s.sig = sig;
        s.el.style.transform = stable ? '' : 'scale(' + sc.toFixed(4) + ')';
        s.el.style.opacity = stable || op >= 0.999 ? '' : op.toFixed(3);
        s.el.style.filter = bl < 0.1 ? '' : 'blur(' + bl.toFixed(2) + 'px)';
        s.el.style.zIndex = x > 0 ? 20 : 10;
        s.el.style.pointerEvents = (e >= 0.99 && x <= 0.01) ? 'auto' : 'none';
      }

      // dwell: content pans while the camera holds
      var local = y - s.start - s.hold * 0.35;
      var p = s.panMax > 0 ? clamp(local / s.panMax, 0, 1) : 0;
      if (s.axis === 'x') {
        var tr = $('#processTrack', s.sec);
        tr.style.transform = 'translate3d(' + (-p * s.panMax).toFixed(1) + 'px,0,0)';
        var bar = $('#processBar'); if (bar) bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
        var steps = $$('.step', s.sec), act = clamp(Math.round(p * (steps.length - 1)), 0, steps.length - 1);
        if (act !== s.act) { steps.forEach(function (st, k) { st.classList.toggle('is-active', k === act); }); if (s.act !== undefined && e >= 1) smoke.burst(0.25 + Math.random() * 0.5, 0.35 + Math.random() * 0.3, 7, 1.1); s.act = act; }
      } else {
        s.pan.style.transform = s.panMax > 0 ? 'translate3d(0,' + (-p * s.panMax).toFixed(1) + 'px,0)' : '';
      }

      emergeUnits(s, e);

      // scene-specific dwell behaviour
      if (s.id === 'manifesto' && manifestoWords.length) {
        var pr = clamp((y - s.start - s.hold * 0.1) / (s.hold * 0.75), 0, 1), N = manifestoWords.length;
        for (var w = 0; w < N; w++) {
          var a = clamp(pr * (N + 5) - w, 0, 1);
          manifestoWords[w].style.opacity = (0.14 + 0.86 * a).toFixed(3);
          if (!coarse) manifestoWords[w].style.filter = a < 1 ? 'blur(' + ((1 - a) * 5).toFixed(1) + 'px)' : '';
        }
      }
      if (s.id === 'name' && vanishSplit) {
        var pv = clamp((y - s.start - s.hold * 0.4) / (s.hold * 0.55), 0, 1);
        for (var c = 0; c < vanishSplit.chars.length; c++) {
          var av = clamp((pv - vanishRand[c] * 0.65) / 0.35, 0, 1), d = vanishDir[c];
          vanishSplit.chars[c].style.cssText = av <= 0 ? '' : 'opacity:' + (1 - av).toFixed(3) + ';filter:blur(' + (av * 16).toFixed(1) + 'px);transform:translate3d(' + (d[0] * av).toFixed(1) + 'px,' + (d[1] * av).toFixed(1) + 'px,0) rotate(' + (d[2] * av).toFixed(1) + 'deg)';
        }
      }
      if (s.id === 'difference' && !cmpPlayed && e >= 0.9) { cmpPlayed = true; playCompare(); }
    }

    heroLive = T.scenes[0].live && y < T.scenes[0].end + 4;
    if (T.needMeasure && T.scenes[0].live && T.scenes[0].sig === 'S') { T.needMeasure = false; if (!reduce) measureReactive(); }
    smoke.setPulse(pulse);
    if (veil) veil.style.opacity = (pulse * 0.42).toFixed(3);

    if (cur !== T.cur) {
      T.cur = cur;
      var cs = T.scenes[cur];
      smoke.setMood(cs.mood);
      if (hudNo) { hudNo.textContent = pad(cur + 1) + ' / ' + pad(n); hudName.textContent = cs.name; }
    }
  }

  /* ------------------------------------------------------------------
     Before / after
     ------------------------------------------------------------------ */
  var cmp = $('#cmp'), cmpRange = $('#cmpRange');
  function setCmp(v) { cmp.style.setProperty('--pos', v + '%'); }
  function playCompare() {
    if (reduce || !cmp) return;
    var o = { v: 12 };
    cmpRange.value = 12; setCmp(12);
    cmpTween = gsap.to(o, { v: 52, duration: 2.6, ease: 'power3.inOut', delay: 0.3, onUpdate: function () { cmpRange.value = o.v; setCmp(o.v); } });
  }
  if (cmp) cmpRange.addEventListener('input', function () { if (cmpTween) { cmpTween.kill(); cmpTween = null; } setCmp(cmpRange.value); });

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
    gsap.from('.cmp', { y: 60, opacity: 0, duration: 1.3, ease: 'expo.out', scrollTrigger: { trigger: '.cmp', start: 'top 88%', once: true, onEnter: function () { if (!cmpPlayed) { cmpPlayed = true; playCompare(); } } } });
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
  function relayout() { if (tunnelOn) { layoutTunnel(); } else { ST.refresh(); } }
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
    var queue = function () { clearTimeout(rzT); rzT = setTimeout(function () { layoutTunnel(); T.needMeasure = true; }, 160); };
    window.addEventListener('resize', queue);
    if (window.ResizeObserver) { var ro = new ResizeObserver(queue); T.scenes.forEach(function (s) { ro.observe(s.pan); }); }
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { fitSteps(); queue(); });
    window.addEventListener('resize', fitSteps);
    gsap.ticker.add(tunnelTick);
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
    if (tunnelOn) { layoutTunnel(); T.lastY = -1; tunnelTick(); } else { setupClassic(); ST.refresh(); }
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
