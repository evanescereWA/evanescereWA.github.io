/* Evanescere — Smoke
   Real-time Navier–Stokes fluid simulation on the GPU (WebGL2), rendered as lit vapour.
   Exposes window.Smoke. Fails soft: if WebGL2 is unavailable the CSS fog fallback shows. */
(function () {
  'use strict';

  var canvas = document.getElementById('smoke');
  var root = document.documentElement;
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;

  var API = { ok: false, moods: {}, setMood: function () {}, splat: function () {}, burst: function () {}, kick: function () {} };
  window.Smoke = API;
  if (!canvas) return;

  var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) { root.classList.add('no-gl'); return; }
  root.classList.add('has-gl');

  var cfg = {
    simRes: coarse ? 96 : 128,
    dyeRes: coarse ? 512 : 1024,
    densityDissipation: 0.55,
    velocityDissipation: 0.28,
    pressure: 0.8,
    pressureIters: coarse ? 14 : 20,
    curl: 16,
    splatRadius: 0.2,
    splatForce: 5200
  };

  /* ---------- Shaders ---------- */
  var VS = '#version 300 es\nprecision highp float;\nin vec2 aPos;\nout vec2 vUv,vL,vR,vT,vB;\nuniform vec2 texel;\nvoid main(){vUv=aPos*.5+.5;vL=vUv-vec2(texel.x,0.);vR=vUv+vec2(texel.x,0.);vT=vUv+vec2(0.,texel.y);vB=vUv-vec2(0.,texel.y);gl_Position=vec4(aPos,0.,1.);}';
  var HEAD = '#version 300 es\nprecision highp float;precision highp sampler2D;\nin vec2 vUv,vL,vR,vT,vB;\nout vec4 o;\n';

  var FS = {
    splat: HEAD + 'uniform sampler2D uT;uniform float aspect,radius;uniform vec3 color;uniform vec2 point;\nvoid main(){vec2 p=vUv-point;p.x*=aspect;vec3 s=exp(-dot(p,p)/radius)*color;o=vec4(texture(uT,vUv).xyz+s,1.);}',
    advect: HEAD + 'uniform sampler2D uV,uS;uniform vec2 texel;uniform float dt,diss;\nvoid main(){vec2 c=vUv-dt*texture(uV,vUv).xy*texel;o=texture(uS,c)/(1.+diss*dt);}',
    div: HEAD + 'uniform sampler2D uV;\nvoid main(){float L=texture(uV,vL).x,R=texture(uV,vR).x,T=texture(uV,vT).y,B=texture(uV,vB).y;vec2 C=texture(uV,vUv).xy;if(vL.x<0.)L=-C.x;if(vR.x>1.)R=-C.x;if(vT.y>1.)T=-C.y;if(vB.y<0.)B=-C.y;o=vec4(.5*(R-L+T-B),0.,0.,1.);}',
    curl: HEAD + 'uniform sampler2D uV;\nvoid main(){float L=texture(uV,vL).y,R=texture(uV,vR).y,T=texture(uV,vT).x,B=texture(uV,vB).x;o=vec4(.5*(R-L-T+B),0.,0.,1.);}',
    vort: HEAD + 'uniform sampler2D uV,uC;uniform float curl,dt;\nvoid main(){float L=texture(uC,vL).x,R=texture(uC,vR).x,T=texture(uC,vT).x,B=texture(uC,vB).x,C=texture(uC,vUv).x;vec2 f=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));f/=length(f)+1e-4;f*=curl*C;f.y*=-1.;vec2 v=texture(uV,vUv).xy+f*dt;o=vec4(clamp(v,-1000.,1000.),0.,1.);}',
    press: HEAD + 'uniform sampler2D uP,uD;\nvoid main(){float L=texture(uP,vL).x,R=texture(uP,vR).x,T=texture(uP,vT).x,B=texture(uP,vB).x;o=vec4((L+R+B+T-texture(uD,vUv).x)*.25,0.,0.,1.);}',
    grad: HEAD + 'uniform sampler2D uP,uV;\nvoid main(){float L=texture(uP,vL).x,R=texture(uP,vR).x,T=texture(uP,vT).x,B=texture(uP,vB).x;vec2 v=texture(uV,vUv).xy-vec2(R-L,T-B);o=vec4(v,0.,1.);}',
    clear: HEAD + 'uniform sampler2D uT;uniform float v;\nvoid main(){o=v*texture(uT,vUv);}',

    /* Display: tone-mapped density, relief lighting for volume, drifting ambient fog, vignette, grain */
    display: HEAD +
      'uniform sampler2D uDye;uniform vec2 texel,res,ptr;uniform float time,glow,aspect,scroll;\n' +
      'uniform vec3 cDeep,cMid,cHigh,cHeat,cBg;\n' +
      'float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}\n' +
      'float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}\n' +
      'float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n(p);p=p*2.03+vec2(7.1,3.7);a*=.5;}return s;}\n' +
      'void main(){\n' +
      ' vec2 uv=vUv;vec2 q=vec2(uv.x*aspect,uv.y);\n' +
      ' vec2 tx=texel*2.5;\n' +
      ' float c0=texture(uDye,uv).x;\n' +
      ' float dl=texture(uDye,uv-vec2(tx.x,0.)).x,dr=texture(uDye,uv+vec2(tx.x,0.)).x,dt=texture(uDye,uv+vec2(0.,tx.y)).x,db=texture(uDye,uv-vec2(0.,tx.y)).x;\n' +
      ' float den=(c0*2.+dl+dr+dt+db)/6.;\n' +
      ' float heat=texture(uDye,uv).y;\n' +
      // soft emboss: light from the upper left gives the vapour volume without looking like foil
      ' float shade=clamp(((dl-dr)*-.5+(dt-db)*.7)*2.4,-1.,1.);\n' +
      ' float t=1.-exp(-den*1.55);\n' +
      ' vec3 col=mix(cDeep,cMid,smoothstep(0.,.5,t));col=mix(col,cHigh,smoothstep(.4,1.,t));\n' +
      ' col=mix(col,cHeat,clamp(heat*1.2,0.,1.)*.5);\n' +
      ' vec3 c=cBg+col*t*(.9+shade*.28);\n' +
      // ambient fog that never stops drifting
      ' float f=fbm(q*1.6+vec2(time*.012,-time*.02-scroll*.0004));\n' +
      ' float f2=fbm(q*3.4-vec2(time*.02,time*.016)+f);\n' +
      ' c+=cMid*(f*f2*.2)*(.55+.45*smoothstep(1.,0.,uv.y));\n' +
      // pointer bloom
      ' float pd=length((uv-ptr)*vec2(aspect,1.));c+=cHigh*exp(-pd*pd*28.)*glow*.1;\n' +
      // vignette + grain
      ' float vg=smoothstep(1.25,.25,length((uv-.5)*vec2(1.,.9)));c*=.55+.45*vg;\n' +
      ' c+=(h(gl_FragCoord.xy+fract(time)*91.)-.5)*.03;\n' +
      ' c=pow(max(c,0.),vec3(.96));\n' +
      ' o=vec4(c,1.);}'
  };

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  var vs = compile(gl.VERTEX_SHADER, VS);
  function program(fsrc) {
    var p = gl.createProgram();
    var f = compile(gl.FRAGMENT_SHADER, fsrc);
    if (!vs || !f) return null;
    gl.attachShader(p, vs); gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(p)); return null; }
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p: p, u: u };
  }

  var P = {};
  for (var k in FS) { P[k] = program(FS[k]); if (!P[k]) { root.classList.add('no-gl'); root.classList.remove('has-gl'); return; } }

  // fullscreen triangle pair
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  var idx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  function blit(target) {
    if (target) { gl.viewport(0, 0, target.w, target.h); gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); }
    else { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  /* ---------- Framebuffers ---------- */
  function makeFBO(w, h, filter) {
    gl.activeTexture(gl.TEXTURE0);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex: tex, fbo: fbo, w: w, h: h, tx: 1 / w, ty: 1 / h, attach: function (id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; } };
  }
  function makeDouble(w, h, filter) {
    var a = makeFBO(w, h, filter), b = makeFBO(w, h, filter);
    return { w: w, h: h, tx: a.tx, ty: a.ty, get read() { return a; }, get write() { return b; }, swap: function () { var t = a; a = b; b = t; } };
  }
  function resolution(base) {
    var ar = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (ar < 1) ar = 1 / ar;
    var mn = Math.round(base), mx = Math.round(base * ar);
    return gl.drawingBufferWidth > gl.drawingBufferHeight ? { w: mx, h: mn } : { w: mn, h: mx };
  }

  var velocity, dye, divergence, curl, pressure, simW, simH;
  function initTargets() {
    var s = resolution(cfg.simRes), d = resolution(cfg.dyeRes);
    simW = s.w; simH = s.h;
    velocity = makeDouble(s.w, s.h, gl.LINEAR);
    dye = makeDouble(d.w, d.h, gl.LINEAR);
    divergence = makeFBO(s.w, s.h, gl.NEAREST);
    curl = makeFBO(s.w, s.h, gl.NEAREST);
    pressure = makeDouble(s.w, s.h, gl.NEAREST);
  }

  /* ---------- Canvas sizing ---------- */
  var quality = 1;
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75) * quality;
    var w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    var cap = 2.4e6, px = w * h;
    if (px > cap) { var s = Math.sqrt(cap / px); w = Math.round(w * s); h = Math.round(h * s); }
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
    return false;
  }
  resize();
  initTargets();

  /* ---------- Palette / mood (smoothly interpolated) ---------- */
  function hex(h) { return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; }
  var moods = {
    hero:   { deep: '#0b1330', mid: '#4d6a96', high: '#d3e4ff', heat: '#8fb8ff', bg: '#04060a' },
    deep:   { deep: '#080d26', mid: '#3d5683', high: '#bcd2f5', heat: '#7d9fe0', bg: '#03050a' },
    steel:  { deep: '#0a1226', mid: '#506f94', high: '#d8e6f7', heat: '#9ac2e8', bg: '#04060a' },
    teal:   { deep: '#06161f', mid: '#3f7d8e', high: '#cdeff2', heat: '#86d4d4', bg: '#03070a' },
    violet: { deep: '#150f33', mid: '#6b5d9e', high: '#e1d8ff', heat: '#b79bff', bg: '#05050b' }
  };
  var keys = ['deep', 'mid', 'high', 'heat', 'bg'];
  var cur = {}, tgt = {};
  keys.forEach(function (k) { cur[k] = hex(moods.hero[k]); tgt[k] = cur[k].slice(); });
  API.setMood = function (name) { var m = moods[name]; if (!m) return; keys.forEach(function (k) { tgt[k] = hex(m[k]); }); };

  /* ---------- Splats ---------- */
  var aspect = function () { return canvas.width / canvas.height; };
  function splat(x, y, dx, dy, amount, heat) {
    gl.useProgram(P.splat.p);
    var a = aspect(), r = cfg.splatRadius / 100; if (a > 1) r *= a;
    gl.uniform1i(P.splat.u.uT, velocity.read.attach(0));
    gl.uniform1f(P.splat.u.aspect, a);
    gl.uniform2f(P.splat.u.point, x, y);
    gl.uniform3f(P.splat.u.color, dx, dy, 0);
    gl.uniform1f(P.splat.u.radius, r);
    gl.uniform2f(P.splat.u.texel, velocity.tx, velocity.ty);
    blit(velocity.write); velocity.swap();
    gl.uniform1i(P.splat.u.uT, dye.read.attach(0));
    gl.uniform3f(P.splat.u.color, amount, heat || 0, 0);
    gl.uniform1f(P.splat.u.radius, r * 1.15);
    gl.uniform2f(P.splat.u.texel, dye.tx, dye.ty);
    blit(dye.write); dye.swap();
  }
  API.splat = function (x, y, dx, dy, amount, heat) { splat(x, y, dx * cfg.splatForce, dy * cfg.splatForce, amount == null ? 0.2 : amount, heat || 0); };
  API.burst = function (x, y, n, power) {
    n = n || 6; power = power || 1;
    // a puff: soft outward flow from a small cluster, never opposing splats (that makes noisy shear)
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, d = Math.random() * 0.02 * power;
      var px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      var s = (0.3 + Math.random() * 0.4) * 0.006 * power * cfg.splatForce;
      splat(px, py, Math.cos(a) * s, Math.sin(a) * s + 40 * power, 0.12 * power, 0.45);
    }
  };
  // scroll-driven wind: smoke is pushed from the viewport edges as the page moves
  API.kick = function (vel) {
    var s = Math.max(-1, Math.min(1, vel / 40));
    if (Math.abs(s) < 0.04) return;
    var side = Math.random() < 0.5 ? 0.04 + Math.random() * 0.1 : 0.86 + Math.random() * 0.1;
    var y = Math.random();
    splat(side, y, (side < 0.5 ? 1 : -1) * Math.abs(s) * 900, -s * 1500, Math.min(0.5, Math.abs(s) * 0.5), Math.abs(s));
  };

  /* ---------- Pointer input ---------- */
  var ptr = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, moved: false, glow: 0, has: false };
  function pointerAt(cx, cy) {
    var x = cx / window.innerWidth, y = 1 - cy / window.innerHeight;
    if (!ptr.has) { ptr.px = x; ptr.py = y; ptr.has = true; }
    ptr.px = ptr.x; ptr.py = ptr.y; ptr.x = x; ptr.y = y; ptr.moved = true; ptr.glow = 1;
  }
  window.addEventListener('pointermove', function (e) { pointerAt(e.clientX, e.clientY); }, { passive: true });
  window.addEventListener('touchmove', function (e) { var t = e.touches[0]; if (t) pointerAt(t.clientX, t.clientY); }, { passive: true });
  window.addEventListener('pointerdown', function (e) { var x = e.clientX / innerWidth, y = 1 - e.clientY / innerHeight; if (!reduceMotion) API.burst(x, y, 5, 0.9); }, { passive: true });

  function applyPointer() {
    if (!ptr.moved) return;
    ptr.moved = false;
    var dx = ptr.x - ptr.px, dy = ptr.y - ptr.py;
    var a = window.innerWidth / window.innerHeight;
    if (a < 1) dx *= a; else dy /= a;
    var sp = Math.sqrt(dx * dx + dy * dy);
    if (sp < 1e-5) return;
    var amount = Math.min(0.42, 0.05 + sp * 14);
    splat(ptr.x, ptr.y, dx * cfg.splatForce, dy * cfg.splatForce, amount, Math.min(1, sp * 18));
  }

  /* ---------- Ambient emitters: it breathes even when untouched ---------- */
  function ambient(t, dt) {
    var a = window.innerWidth / window.innerHeight;
    var amp = 0.55;
    for (var i = 0; i < 3; i++) {
      var ph = t * (0.07 + i * 0.031) + i * 2.1;
      var x = 0.5 + 0.42 * Math.sin(ph * 1.3 + i) * Math.cos(ph * 0.7);
      var y = 0.18 + 0.1 * Math.sin(ph * 0.9 + i * 1.7);
      var vx = Math.cos(ph * 1.1 + i) * 160 * amp, vy = (260 + 120 * Math.sin(ph * 2.0)) * amp;
      splat(x, y, vx, vy, 0.035 * amp + 0.012 * Math.sin(ph * 3.1) * amp, 0);
    }
    // occasional drifting plume across the upper field
    if (Math.random() < dt * 0.35) {
      var y2 = 0.45 + Math.random() * 0.45, dir = Math.random() < 0.5 ? 1 : -1;
      splat(dir > 0 ? -0.02 : 1.02, y2, dir * 900, (Math.random() - 0.5) * 380, 0.2, 0.2);
    }
  }

  /* ---------- Simulation step ---------- */
  function step(dt) {
    gl.disable(gl.BLEND);
    gl.useProgram(P.curl.p);
    gl.uniform2f(P.curl.u.texel, velocity.tx, velocity.ty);
    gl.uniform1i(P.curl.u.uV, velocity.read.attach(0));
    blit(curl);

    gl.useProgram(P.vort.p);
    gl.uniform2f(P.vort.u.texel, velocity.tx, velocity.ty);
    gl.uniform1i(P.vort.u.uV, velocity.read.attach(0));
    gl.uniform1i(P.vort.u.uC, curl.attach(1));
    gl.uniform1f(P.vort.u.curl, cfg.curl);
    gl.uniform1f(P.vort.u.dt, dt);
    blit(velocity.write); velocity.swap();

    gl.useProgram(P.div.p);
    gl.uniform2f(P.div.u.texel, velocity.tx, velocity.ty);
    gl.uniform1i(P.div.u.uV, velocity.read.attach(0));
    blit(divergence);

    gl.useProgram(P.clear.p);
    gl.uniform2f(P.clear.u.texel, velocity.tx, velocity.ty);
    gl.uniform1i(P.clear.u.uT, pressure.read.attach(0));
    gl.uniform1f(P.clear.u.v, cfg.pressure);
    blit(pressure.write); pressure.swap();

    gl.useProgram(P.press.p);
    gl.uniform2f(P.press.u.texel, velocity.tx, velocity.ty);
    gl.uniform1i(P.press.u.uD, divergence.attach(0));
    for (var i = 0; i < cfg.pressureIters; i++) {
      gl.uniform1i(P.press.u.uP, pressure.read.attach(1));
      blit(pressure.write); pressure.swap();
    }

    gl.useProgram(P.grad.p);
    gl.uniform2f(P.grad.u.texel, velocity.tx, velocity.ty);
    gl.uniform1i(P.grad.u.uP, pressure.read.attach(0));
    gl.uniform1i(P.grad.u.uV, velocity.read.attach(1));
    blit(velocity.write); velocity.swap();

    gl.useProgram(P.advect.p);
    gl.uniform2f(P.advect.u.texel, velocity.tx, velocity.ty);
    var vid = velocity.read.attach(0);
    gl.uniform1i(P.advect.u.uV, vid);
    gl.uniform1i(P.advect.u.uS, vid);
    gl.uniform1f(P.advect.u.dt, dt);
    gl.uniform1f(P.advect.u.diss, cfg.velocityDissipation);
    blit(velocity.write); velocity.swap();

    gl.uniform2f(P.advect.u.texel, velocity.tx, velocity.ty);
    gl.uniform1i(P.advect.u.uV, velocity.read.attach(0));
    gl.uniform1i(P.advect.u.uS, dye.read.attach(1));
    gl.uniform1f(P.advect.u.diss, cfg.densityDissipation);
    blit(dye.write); dye.swap();
  }

  var scrollY = 0;
  API.scroll = function (y) { scrollY = y; };

  function draw(t) {
    gl.useProgram(P.display.p);
    var u = P.display.u;
    gl.uniform1i(u.uDye, dye.read.attach(0));
    gl.uniform2f(u.texel, dye.tx, dye.ty);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform2f(u.ptr, ptr.x, ptr.y);
    gl.uniform1f(u.glow, ptr.glow);
    gl.uniform1f(u.time, t);
    gl.uniform1f(u.aspect, aspect());
    gl.uniform1f(u.scroll, scrollY);
    gl.uniform3fv(u.cDeep, cur.deep); gl.uniform3fv(u.cMid, cur.mid); gl.uniform3fv(u.cHigh, cur.high);
    gl.uniform3fv(u.cHeat, cur.heat); gl.uniform3fv(u.cBg, cur.bg);
    blit(null);
  }

  /* ---------- Loop with adaptive quality ---------- */
  var last = performance.now(), time = 0, running = true, ema = 16, slow = 0, tier = 0, frames = 0, warm = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) { last = now; return; }
    var raw = Math.min(now - last, 100); last = now;
    var dt = Math.min(raw / 1000, 0.0333);
    time += dt;
    frames++;

    // adaptive quality: step down resolution if we can't hold ~40fps
    ema += (raw - ema) * 0.05;
    if (frames > 90) {
      if (ema > 27) slow++; else slow = Math.max(0, slow - 1);
      if (slow > 60 && tier < 3) {
        tier++; slow = 0;
        if (tier === 1) { cfg.dyeRes *= 0.7; cfg.pressureIters = Math.max(10, cfg.pressureIters - 6); }
        else if (tier === 2) { cfg.dyeRes *= 0.7; cfg.simRes = Math.max(64, cfg.simRes * 0.75); }
        else { quality = 0.75; }
        initTargets(); resize();
      }
    }

    for (var k = 0; k < keys.length; k++) { var key = keys[k]; for (var c = 0; c < 3; c++) cur[key][c] += (tgt[key][c] - cur[key][c]) * Math.min(1, dt * 1.6); }

    if (!reduceMotion) { ambient(time, dt); }
    applyPointer();
    ptr.glow += (0 - ptr.glow) * Math.min(1, dt * 0.8);
    step(Math.max(dt, 0.004));
    draw(time);

    // reduced motion: let the scene settle, then freeze to a still frame
    if (reduceMotion && time > 2.5) { running = false; }
  }

  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (resize()) initTargets(); }, 150); });
  document.addEventListener('visibilitychange', function () { running = !document.hidden && !(reduceMotion && time > 2.5); last = performance.now(); });
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); running = false; root.classList.add('no-gl'); });

  // seed a few plumes so the first frame is already atmospheric
  for (var i = 0; i < 9; i++) {
    var sx = 0.1 + Math.random() * 0.8, sy = 0.05 + Math.random() * 0.5;
    splat(sx, sy, (Math.random() - 0.5) * 900, 300 + Math.random() * 600, 0.22 + Math.random() * 0.2, Math.random() * 0.3);
  }
  for (var j = 0; j < 40; j++) { step(0.016); }

  API.ok = true;
  API.moods = moods;
  requestAnimationFrame(function (t) { last = t; requestAnimationFrame(frame); });
})();
