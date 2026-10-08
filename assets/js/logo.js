/* Evanescere — the mark, made of smoke (3D)
   Tens of thousands of soft smoke particles, each a tiny wisp, flow along the brand mark in real 3D: they stream
   down the stroke, vanish at the tail and re-form at the crown. Sweep the cursor through them and they scatter
   and swirl, then drift back and re-form the mark. The cloud turns gently with the pointer so you can see its depth.
   No simulation grid, so there is no square, no edge, nothing to cut off.
   Exposes window.Logo.setActive(bool): it only runs while the mark is on screen. */
(function () {
  'use strict';

  var canvas = document.getElementById('logoSmoke');
  var API = { setActive: function () {} };
  window.Logo = API;
  if (!canvas) return;

  var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var qs = (location.search.match(/[?&]q=(\w+)/) || [])[1];
  var COUNT = qs === 'low' ? 9000 : (qs === 'mid' ? 18000 : (coarse ? 24000 : 60000));

  // The mark (same path as the nav icon), in a 32 x 32 box
  var MARK = 'M7 25c0-6 4-8 8-10s4-6 1-9c5 1 9 5 8 10-1 6-7 8-9 9 5-1 8-4 8-7';

  var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) {
    var c2 = canvas.getContext('2d');
    if (c2) { canvas.width = canvas.height = 600; c2.strokeStyle = 'rgba(220,230,255,.85)'; c2.lineCap = 'round'; c2.translate(300 - 15.4 * 24, 300 - 15.7 * 24); c2.scale(24, 24); c2.lineWidth = 1.7; c2.stroke(new Path2D(MARK)); }
    return;
  }

  /* ---- sample the mark into a lookup table: position + unit normal along its length ---- */
  var LUT = 480, lx = new Float32Array(LUT + 1), ly = new Float32Array(LUT + 1), nx = new Float32Array(LUT + 1), ny = new Float32Array(LUT + 1);
  (function () {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.setAttribute('d', MARK);
    var L = svg.getTotalLength(), S = 0.078;
    for (var i = 0; i <= LUT; i++) {
      var a = svg.getPointAtLength(L * i / LUT), b = svg.getPointAtLength(Math.min(L, L * i / LUT + 0.05)), c = svg.getPointAtLength(Math.max(0, L * i / LUT - 0.05));
      lx[i] = (a.x - 15.4) * S; ly[i] = -(a.y - 15.7) * S;
      var tx = (b.x - c.x), ty = -(b.y - c.y), m = Math.sqrt(tx * tx + ty * ty) || 1;
      nx[i] = -ty / m; ny[i] = tx / m;
    }
  })();

  /* ---- particles ---- */
  var N = COUNT;
  var pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
  var u0 = new Float32Array(N), spd = new Float32Array(N), off = new Float32Array(N), zo = new Float32Array(N), ph = new Float32Array(N), sz = new Float32Array(N), al = new Float32Array(N);
  var seed = 1337;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function gauss() { return (rnd() + rnd() + rnd() + rnd() - 2) * 1.2; }
  // The smoke is made of strands: particles on one strand share an offset, ripple and speed, so they line up
  // into silky filaments instead of reading as dust.
  var S = 72, sOff = [], sPh = [], sZ = [], sSpd = [], sAl = [], sSz = [];
  for (var q = 0; q < S; q++) {
    sOff.push(gauss() * (q % 3 ? 0.04 : 0.02)); sPh.push(rnd() * 6.283); sZ.push(gauss() * 0.11);
    sSpd.push(0.012 + rnd() * 0.012); sAl.push(0.04 + rnd() * 0.05); sSz.push(7 + rnd() * 5);
  }
  var rz = new Float32Array(N);
  for (var i = 0; i < N; i++) {
    var st = (rnd() * S) | 0;
    u0[i] = rnd(); spd[i] = sSpd[st];
    off[i] = sOff[st] + gauss() * 0.003; zo[i] = sZ[st] + gauss() * 0.006; ph[i] = sPh[st]; rz[i] = rnd() * 6.283;
    var big = rnd() < 0.05;                                   // a few large, faint puffs give the cloud body and glow
    if (big) { st = (rnd() * S) | 0; off[i] = sOff[st] + gauss() * 0.02; ph[i] = sPh[st]; spd[i] = sSpd[st]; }
    sz[i] = big ? 20 + rnd() * 18 : sSz[st];
    al[i] = big ? 0.04 : sAl[st];
  }
  // 7 floats per vertex: x y z | size alpha bright speed
  var buf = new Float32Array(N * 7);

  var time = 0;
  function homeAt(i, t, out) {
    var u = u0[i] + t * spd[i]; u -= Math.floor(u);
    var f = u * LUT, k = f | 0, w = f - k, k2 = Math.min(LUT, k + 1);
    var x = lx[k] + (lx[k2] - lx[k]) * w, y = ly[k] + (ly[k2] - ly[k]) * w;
    var ex = nx[k] + (nx[k2] - nx[k]) * w, ey = ny[k] + (ny[k2] - ny[k]) * w;
    // the stroke breathes: wavy filaments, a little wider where the smoke is thinning at the tail
    var o = off[i] * (0.8 + 0.7 * u) + Math.sin(u * 11 + ph[i] + t * 0.7) * 0.012 + Math.sin(u * 4.3 - t * 0.35 + ph[i] * 2) * 0.02;
    out[0] = x + ex * o; out[1] = y + ey * o;
    out[2] = zo[i] + Math.sin(u * 5.2 + ph[i] * 1.7 + t * 0.45) * 0.05;
    return u;
  }
  var tmp = [0, 0, 0];
  for (var j = 0; j < N; j++) { homeAt(j, 0, tmp); pos[j * 3] = tmp[0]; pos[j * 3 + 1] = tmp[1]; pos[j * 3 + 2] = tmp[2]; }

  /* ---- pointer ---- */
  var ptr = { x: 9, y: 9, vx: 0, vy: 0, on: false, burst: 0, bx: 0, by: 0 };
  var rot = [0, 0], rotT = [0, 0], inside = false;
  function uv(e) { var r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)]; }
  if (!reduce) {
    canvas.addEventListener('pointermove', function (e) {
      var p = uv(e);
      if (ptr.on) { ptr.vx = ptr.vx * 0.5 + (p[0] - ptr.x) * 30 * 0.5; ptr.vy = ptr.vy * 0.5 + (p[1] - ptr.y) * 30 * 0.5; }
      ptr.x = p[0]; ptr.y = p[1]; ptr.on = true; inside = true;
      rotT[0] = p[0] * 0.38; rotT[1] = -p[1] * 0.22;
    });
    canvas.addEventListener('pointerleave', function () { ptr.on = false; ptr.x = ptr.y = 9; inside = false; });
    canvas.addEventListener('pointerdown', function (e) { var p = uv(e); ptr.burst = 1; ptr.bx = p[0]; ptr.by = p[1]; });
  }

  /* ---- physics ---- */
  var R = 0.26;
  function stepParticles(dt) {
    var K = 7.5, C = 3.1;                                      // spring back to the mark, lightly damped: it swirls home
    var px = ptr.x, py = ptr.y, on = ptr.on, bur = ptr.burst;
    for (var i = 0; i < N; i++) {
      var i3 = i * 3;
      homeAt(i, time, tmp);
      var x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2], vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
      vx += ((tmp[0] - x) * K - vx * C) * dt; vy += ((tmp[1] - y) * K - vy * C) * dt; vz += ((tmp[2] - z) * K - vz * C) * dt;
      if (on) {
        var dx = x - px, dy = y - py, d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          var d = Math.sqrt(d2) + 1e-4, f = 1 - d / R; f *= f;
          var rx = dx / d, ry = dy / d, sg = rz[i] > 3.14 ? 1 : -1;
          vx += (rx * 2.6 - ry * 1.5 * sg + ptr.vx * 0.9) * f * dt * 14;
          vy += (ry * 2.6 + rx * 1.5 * sg + ptr.vy * 0.9) * f * dt * 14;
          vz += (rz[i] - 3.14) * 0.5 * f * dt * 6;
        }
      }
      if (bur > 0.01) {
        var bx = x - ptr.bx, by = y - ptr.by, b2 = bx * bx + by * by;
        if (b2 < 0.09) { var bd = Math.sqrt(b2) + 1e-4, bf = (1 - bd / 0.3); vx += bx / bd * bf * 3.2 * bur; vy += by / bd * bf * 3.2 * bur; vz += (rz[i] - 3.14) * 0.4 * bf * bur; }
      }
      x += vx * dt; y += vy * dt; z += vz * dt;
      pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z; vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      // vertex data
      var u = (u0[i] + time * spd[i]) % 1;
      var sp = Math.sqrt(vx * vx + vy * vy);
      var fade = Math.min(1, u / 0.08) * Math.min(1, (1 - u) / 0.22);             // forms at the crown, vanishes down the tail
      var lit = 0.62 + 0.38 * Math.max(-1, Math.min(1, -off[i] / 0.04 * 0.6 + (z * -2.2)));
      var o = i * 7;
      buf[o] = x; buf[o + 1] = y; buf[o + 2] = z;
      buf[o + 3] = sz[i] * (1 + Math.min(1.2, sp * 0.5));
      buf[o + 4] = al[i] * fade * (0.55 + 0.45 * u0[i]);
      buf[o + 5] = lit; buf[o + 6] = Math.min(1, sp * 1.1);
    }
    ptr.burst *= Math.pow(0.02, dt);
  }

  /* ---- render ---- */
  var VS = '#version 300 es\nprecision highp float;\nin vec3 aPos;in vec4 aMisc;\nuniform vec2 rot;uniform float scale;\nout vec4 vM;out float vZ;\n' +
    'void main(){\n' +
    ' float cy=cos(rot.x),sy=sin(rot.x),cx=cos(rot.y),sx=sin(rot.y);\n' +
    ' vec3 p=aPos;p=vec3(cy*p.x+sy*p.z,p.y,-sy*p.x+cy*p.z);p=vec3(p.x,cx*p.y-sx*p.z,sx*p.y+cx*p.z);\n' +
    ' float s=1./(1.-p.z*.55);\n' +
    ' gl_Position=vec4(p.xy*s,0.,1.);\n' +
    ' gl_PointSize=max(1.,aMisc.x*scale*s);vM=aMisc;\n' +
    ' vM.y*=smoothstep(1.,.68,max(abs(p.x*s),abs(p.y*s)));vZ=p.z;}';
  var FS = '#version 300 es\nprecision highp float;\nin vec4 vM;in float vZ;uniform vec3 cMid,cHigh,cLight;out vec4 o;\n' +
    'void main(){vec2 q=gl_PointCoord*2.-1.;float r2=dot(q,q);if(r2>1.)discard;\n' +
    ' float a=exp(-r2*3.4)*vM.y;\n' +
    ' float depth=clamp(.5-vZ*2.2,0.,1.);\n' +
    ' vec3 col=mix(cMid*.7,cHigh,clamp(vM.z*.9+depth*.35,0.,1.));col=mix(col,cLight,vM.w*.55);\n' +
    ' col*=.55+.7*depth;\n' +
    ' o=vec4(col*a,a);}';
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; } return s; }
  var prog = gl.createProgram(), v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
  if (!v || !f) { canvas.style.display = 'none'; return; }
  gl.attachShader(prog, v); gl.attachShader(prog, f); gl.bindAttribLocation(prog, 0, 'aPos'); gl.bindAttribLocation(prog, 1, 'aMisc'); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); canvas.style.display = 'none'; return; }
  var U = {}; ['rot', 'scale', 'cMid', 'cHigh', 'cLight'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
  var vao = gl.createVertexArray(), vbo = gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, buf.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
  gl.bindVertexArray(null);

  var col = { mid: [0.44, 0.38, 0.65], high: [0.9, 0.86, 1.0], light: [0.8, 0.7, 1.0] };
  function draw() {
    var pal = window.Smoke && window.Smoke.palette && window.Smoke.palette();
    if (pal) { col.mid = pal.mid; col.high = pal.high; col.light = pal.light; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(prog);
    gl.uniform2f(U.rot, rot[0], rot[1]);
    gl.uniform1f(U.scale, canvas.width / 700);
    gl.uniform3fv(U.cMid, col.mid); gl.uniform3fv(U.cHigh, col.high); gl.uniform3fv(U.cLight, col.light);
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.bindVertexArray(null);
  }

  function fit() {
    var d = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    var w = Math.max(2, Math.round(canvas.clientWidth * d)), h = Math.max(2, Math.round(canvas.clientHeight * d));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  var active = false, running = false, lastT = 0, frames = 0, warmed = false;
  function warm() { for (var i = 0; i < 20; i++) { time += 0.016; stepParticles(0.016); } warmed = true; }
  function frame(now) {
    if (!active) { running = false; return; }
    requestAnimationFrame(frame);
    var dt = Math.min((now - lastT) / 1000, 0.033); lastT = now;
    if (++frames % 45 === 0) fit();
    if (!reduce) { time += dt; stepParticles(Math.max(dt, 0.006)); }
    ptr.vx *= 0.9; ptr.vy *= 0.9;
    if (!inside) { rotT[0] = Math.sin(time * 0.31) * 0.24; rotT[1] = Math.sin(time * 0.23) * 0.1; }
    rot[0] += (rotT[0] - rot[0]) * Math.min(1, dt * 3.5); rot[1] += (rotT[1] - rot[1]) * Math.min(1, dt * 3.5);
    draw();
  }
  API.setActive = function (on) {
    on = !!on;
    if (on === active) return;
    active = on;
    if (on) {
      fit();
      if (!warmed) warm();
      if (reduce) { draw(); return; }
      if (!running) { running = true; lastT = performance.now(); requestAnimationFrame(frame); }
    }
  };
  window.addEventListener('resize', function () { fit(); });
  if (window.ResizeObserver) new ResizeObserver(function () { fit(); if (!running && warmed) draw(); }).observe(canvas);
  API.ok = true;
})();
