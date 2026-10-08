/* Evanescere — the mark, made of smoke (3D)
   A dedicated high-resolution fluid simulation (WebGL2), rendered as a thick volume you can look around:
   the 2D flow drives the density, the renderer ray-marches it as a slab with depth, light and parallax. The brand mark is emitted continuously as
   smoke, so it holds its shape the way a candle's plume does: alive, drifting, never static.
   Move across it and the smoke tears, curls and slowly pulls itself back together.
   Exposes window.Logo.setActive(bool): the simulation only runs while the mark is on screen. */
(function () {
  'use strict';

  var canvas = document.getElementById('logoSmoke');
  var API = { setActive: function () {} };
  window.Logo = API;
  if (!canvas) return;

  var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var qs = (location.search.match(/[?&]q=(\w+)/) || [])[1];

  // The mark (same path as the nav icon), in a 32 x 32 box
  var MARK = 'M7 25c0-6 4-8 8-10s4-6 1-9c5 1 9 5 8 10-1 6-7 8-9 9 5-1 8-4 8-7';

  function drawMask(size) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    var x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, size, size);
    var s = size * 0.76 / 19.5;
    x.translate(size / 2 - 15.4 * s, size / 2 - 15.7 * s); x.scale(s, s);
    var path = new Path2D(MARK);
    x.lineCap = 'round'; x.lineJoin = 'round';
    if ('filter' in x) x.filter = 'blur(' + (size * 0.006 / s).toFixed(3) + 'px)';
    // body of the mark: bright at the crown, thinning toward the tail
    var g = x.createLinearGradient(0, 25, 0, 5);
    g.addColorStop(0, 'rgba(255,255,255,.45)'); g.addColorStop(0.5, 'rgba(255,255,255,.9)'); g.addColorStop(1, '#fff');
    x.strokeStyle = g; x.lineWidth = 1.7; x.stroke(path);
    // fainter trailing wisps rising off it: the mark is vanishing as it forms
    x.strokeStyle = 'rgba(255,255,255,.34)'; x.lineWidth = 0.9;
    x.save(); x.translate(0.6, -1.9); x.stroke(path); x.restore();
    x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 0.8;
    x.save(); x.translate(-0.9, -3.8); x.stroke(path); x.restore();
    return c;
  }

  var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
    // Fallback: the mark as a soft still
    var c2 = canvas.getContext('2d');
    if (c2) { canvas.width = canvas.height = 600; c2.drawImage(drawMask(600), 0, 0); canvas.style.mixBlendMode = 'screen'; canvas.style.opacity = '0.8'; }
    return;
  }

  var SIM = coarse ? 128 : 192;
  var DYE = qs === 'low' ? 384 : (qs === 'mid' ? 640 : (coarse ? 640 : 1024));
  var ITERS = coarse ? 14 : 20;

  var VS = '#version 300 es\nprecision highp float;\nin vec2 aPos;\nout vec2 vUv,vL,vR,vT,vB;\nuniform vec2 texel;\nvoid main(){vUv=aPos*.5+.5;vL=vUv-vec2(texel.x,0.);vR=vUv+vec2(texel.x,0.);vT=vUv+vec2(0.,texel.y);vB=vUv-vec2(0.,texel.y);gl_Position=vec4(aPos,0.,1.);}';
  var HEAD = '#version 300 es\nprecision highp float;precision highp sampler2D;\nin vec2 vUv,vL,vR,vT,vB;\nout vec4 o;\n';
  var NOISE = 'float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}\nfloat n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}\n';

  var FS = {
    splat: HEAD + 'uniform sampler2D uT;uniform float aspect,radius;uniform vec3 color;uniform vec2 point;\nvoid main(){vec2 p=vUv-point;p.x*=aspect;vec3 s=exp(-dot(p,p)/radius)*color;o=vec4(texture(uT,vUv).xyz+s,1.);}',
    advect: HEAD + 'uniform sampler2D uV,uS;uniform vec2 texel;uniform float dt,diss;\nvoid main(){vec2 c=vUv-dt*texture(uV,vUv).xy*texel;o=texture(uS,c)/(1.+diss*dt);}',
    div: HEAD + 'uniform sampler2D uV;\nvoid main(){float L=texture(uV,vL).x,R=texture(uV,vR).x,T=texture(uV,vT).y,B=texture(uV,vB).y;vec2 C=texture(uV,vUv).xy;if(vL.x<0.)L=-C.x;if(vR.x>1.)R=-C.x;if(vT.y>1.)T=-C.y;if(vB.y<0.)B=-C.y;o=vec4(.5*(R-L+T-B),0.,0.,1.);}',
    curl: HEAD + 'uniform sampler2D uV;\nvoid main(){float L=texture(uV,vL).y,R=texture(uV,vR).y,T=texture(uV,vT).x,B=texture(uV,vB).x;o=vec4(.5*(R-L-T+B),0.,0.,1.);}',
    vort: HEAD + 'uniform sampler2D uV,uC;uniform float curl,dt;\nvoid main(){float L=texture(uC,vL).x,R=texture(uC,vR).x,T=texture(uC,vT).x,B=texture(uC,vB).x,C=texture(uC,vUv).x;vec2 f=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));f/=length(f)+1e-4;f*=curl*C;f.y*=-1.;vec2 v=texture(uV,vUv).xy+f*dt;o=vec4(clamp(v,-1000.,1000.),0.,1.);}',
    press: HEAD + 'uniform sampler2D uP,uD;\nvoid main(){float L=texture(uP,vL).x,R=texture(uP,vR).x,T=texture(uP,vT).x,B=texture(uP,vB).x;o=vec4((L+R+B+T-texture(uD,vUv).x)*.25,0.,0.,1.);}',
    grad: HEAD + 'uniform sampler2D uP,uV;\nvoid main(){float L=texture(uP,vL).x,R=texture(uP,vR).x,T=texture(uP,vT).x,B=texture(uP,vB).x;vec2 v=texture(uV,vUv).xy-vec2(R-L,T-B);o=vec4(v,0.,1.);}',
    clear: HEAD + 'uniform sampler2D uT;uniform float v;\nvoid main(){o=v*texture(uT,vUv);}',
    // the mark is breathed out continuously, modulated by noise so the plume is never uniform
    emit: HEAD + NOISE + 'uniform sampler2D uT,uMask;uniform float dt,rate,time;\nvoid main(){float m=texture(uMask,vUv).r;float nz=.25+1.5*smoothstep(.2,.8,n(vUv*7.+vec2(0.,-time*.22)))*(.5+.8*n(vUv*17.+vec2(time*.1,-time*.3)+4.));vec2 e2=smoothstep(vec2(0.),vec2(.1),vUv)*smoothstep(vec2(1.),vec2(.9),vUv);float edge=e2.x*e2.y;vec3 base=texture(uT,vUv).rgb*mix(1.,edge,min(1.,dt*14.));o=vec4(base+vec3(m*rate*dt*nz,0.,0.),1.);}',
    // gentle turbulence + buoyancy around the mark keeps the smoke curling
    force: HEAD + NOISE + 'uniform sampler2D uV,uMask,uD;uniform float dt,time,amp,buoy;\nvoid main(){\n float m=texture(uMask,vUv).r;float mb=(m+texture(uMask,vUv+vec2(.03,0.)).r+texture(uMask,vUv-vec2(.03,0.)).r+texture(uMask,vUv+vec2(0.,.03)).r+texture(uMask,vUv-vec2(0.,.03)).r)*.2;\n vec2 f=vec2(n(vUv*4.5+vec2(time*.2,3.1)),n(vUv*4.5-vec2(time*.17,-8.7)))-.5;\n vec2 v=texture(uV,vUv).xy+(f*amp*mb+vec2(0.,1.)*buoy*texture(uD,vUv).r)*dt;\n o=vec4(v,0.,1.);}',
    display: HEAD + 'uniform sampler2D uDye,uVel;uniform vec2 rot;uniform float time,steps,frm;uniform vec3 cMid,cHigh,cLight;\n' +
      'float hs(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.x+p.y)*p.z);}\n' +
      'float vn(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hs(i),hs(i+vec3(1,0,0)),f.x),mix(hs(i+vec3(0,1,0)),hs(i+vec3(1,1,0)),f.x),f.y),mix(mix(hs(i+vec3(0,0,1)),hs(i+vec3(1,0,1)),f.x),mix(hs(i+vec3(0,1,1)),hs(i+vec3(1,1,1)),f.x),f.y),f.z);}\n' +
      'mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,s,0.,-s,c);}\n' +
      'mat3 ry(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}\n' +
      'void main(){\n' +
      ' vec2 p=(vUv-.5)*2.;\n' +
      ' mat3 R=ry(rot.x)*rx(rot.y);\n' +
      ' vec3 ro=R*vec3(0.,0.,-2.25);vec3 rd=R*normalize(vec3(p*.43,1.6));\n' +
      ' vec3 bmin=vec3(-.62,-.62,-.42),bmax=vec3(.62,.62,.42);\n' +
      ' vec3 inv=1./rd;vec3 t0=(bmin-ro)*inv,t1=(bmax-ro)*inv;vec3 tmn=min(t0,t1),tmx=max(t0,t1);\n' +
      ' float tn=max(max(tmn.x,tmn.y),tmn.z),tf=min(min(tmx.x,tmx.y),tmx.z);\n' +
      ' if(tf<=max(tn,0.)){o=vec4(0.);return;}\n' +
      ' float dt=(tf-tn)/steps;float t=tn+dt*fract(52.9829189*fract(dot(gl_FragCoord.xy+5.588238*frm,vec2(.06711056,.00583715))));\n' +
      ' float T=1.;vec3 acc=vec3(0.);vec3 L=normalize(vec3(-.45,.7,-.55));\n' +
      ' for(int i=0;i<48;i++){\n' +
      '  if(float(i)>=steps)break;\n' +
      '  vec3 q=ro+rd*t;vec2 uv=q.xy+.5;\n' +
      '  float edge=smoothstep(0.,.1,uv.x)*smoothstep(1.,.9,uv.x)*smoothstep(0.,.1,uv.y)*smoothstep(1.,.9,uv.y);\n' +
      '  float d2=textureLod(uDye,uv,0.).r*edge;\n' +
      '  if(d2>.012){\n' +
      '   float vm=length(textureLod(uVel,uv,0.).xy);\n' +
      '   float nzv=vn(q*3.4+vec3(0.,time*.14,time*.07));\n' +
      '   float zc=(nzv-.5)*.34;float zc2=(vn(q*2.6+vec3(7.,time*.1,3.))-.5)*.36;\n' +  // two thin sheets, each drifting in depth
      '   float th=.03+.03*d2+.05*smoothstep(0.,40.,vm);\n' +                     // thin: depth without sideways smear. disturbed smoke puffs toward the viewer
      '   float zp=exp(-pow((q.z-zc)/th,2.))+.8*exp(-pow((q.z-zc2)/th,2.));\n' +
      '   float d=d2*zp*(.7+.6*nzv)*3.8;\n' +
      '   if(d>.01){\n' +
      '    float dl=textureLod(uDye,uv+L.xy*.045,0.).r*(exp(-pow((q.z+L.z*.045-zc)/th,2.))+.8*exp(-pow((q.z+L.z*.045-zc2)/th,2.)));\n' +
      '    float sh=exp(-dl*2.6);\n' +
      '    float a=1.-exp(-d*dt*6.);\n' +
      '    vec3 col=mix(cMid*.45,cMid,sh)+cHigh*sh*sh*.85+cLight*pow(1.-clamp(abs(q.z)/.4,0.,1.),2.)*.12;\n' +
      '    acc+=T*a*col;T*=1.-a;if(T<.02)break;}}\n' +
      '  t+=dt;}\n' +
      ' o=vec4(acc,1.-T);}'
  };

  function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; } return s; }
  var vs = compile(gl.VERTEX_SHADER, VS);
  function program(src) {
    var p = gl.createProgram(), f = compile(gl.FRAGMENT_SHADER, src);
    if (!vs || !f) return null;
    gl.attachShader(p, vs); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(p)); return null; }
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p: p, u: u };
  }
  var P = {};
  for (var k in FS) { P[k] = program(FS[k]); if (!P[k]) { canvas.style.display = 'none'; return; } }

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  var idx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(0);
  function blit(t) {
    if (t) { gl.viewport(0, 0, t.w, t.h); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); }
    else { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }
  function makeFBO(w, h, filter) {
    gl.activeTexture(gl.TEXTURE0);
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    var fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex: tex, fbo: fbo, w: w, h: h, tx: 1 / w, ty: 1 / h, attach: function (id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; } };
  }
  function makeDouble(w, h, f) { var a = makeFBO(w, h, f), b = makeFBO(w, h, f); return { w: w, h: h, tx: a.tx, ty: a.ty, get read() { return a; }, get write() { return b; }, swap: function () { var t = a; a = b; b = t; } }; }

  var velocity = makeDouble(SIM, SIM, gl.LINEAR), dye = makeDouble(DYE, DYE, gl.LINEAR);
  var divergence = makeFBO(SIM, SIM, gl.NEAREST), curl = makeFBO(SIM, SIM, gl.NEAREST), pressure = makeDouble(SIM, SIM, gl.NEAREST);

  // mask texture (mark), bound on unit 5
  var maskTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drawMask(Math.min(DYE, 1024)));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  function splat(x, y, dx, dy, amount, radius) {
    gl.useProgram(P.splat.p);
    gl.uniform1f(P.splat.u.aspect, 1); gl.uniform2f(P.splat.u.point, x, y); gl.uniform1f(P.splat.u.radius, radius || 0.0011);
    gl.uniform1i(P.splat.u.uT, velocity.read.attach(0)); gl.uniform3f(P.splat.u.color, dx, dy, 0); gl.uniform2f(P.splat.u.texel, velocity.tx, velocity.ty);
    blit(velocity.write); velocity.swap();
    gl.uniform1i(P.splat.u.uT, dye.read.attach(0)); gl.uniform3f(P.splat.u.color, amount, 0, 0); gl.uniform2f(P.splat.u.texel, dye.tx, dye.ty);
    blit(dye.write); dye.swap();
  }

  var time = 0;
  function step(dt) {
    gl.disable(gl.BLEND);
    // emit the mark + turbulence
    gl.useProgram(P.emit.p);
    gl.uniform2f(P.emit.u.texel, dye.tx, dye.ty);
    gl.uniform1i(P.emit.u.uT, dye.read.attach(0)); gl.uniform1i(P.emit.u.uMask, 5);
    gl.uniform1f(P.emit.u.dt, dt); gl.uniform1f(P.emit.u.rate, 1.0); gl.uniform1f(P.emit.u.time, time);
    blit(dye.write); dye.swap();

    gl.useProgram(P.force.p);
    gl.uniform2f(P.force.u.texel, velocity.tx, velocity.ty);
    gl.uniform1i(P.force.u.uV, velocity.read.attach(0)); gl.uniform1i(P.force.u.uD, dye.read.attach(1)); gl.uniform1i(P.force.u.uMask, 5);
    gl.uniform1f(P.force.u.dt, dt); gl.uniform1f(P.force.u.time, time); gl.uniform1f(P.force.u.amp, 36); gl.uniform1f(P.force.u.buoy, 9);
    blit(velocity.write); velocity.swap();

    gl.useProgram(P.curl.p); gl.uniform2f(P.curl.u.texel, velocity.tx, velocity.ty); gl.uniform1i(P.curl.u.uV, velocity.read.attach(0)); blit(curl);
    gl.useProgram(P.vort.p); gl.uniform2f(P.vort.u.texel, velocity.tx, velocity.ty);
    gl.uniform1i(P.vort.u.uV, velocity.read.attach(0)); gl.uniform1i(P.vort.u.uC, curl.attach(1)); gl.uniform1f(P.vort.u.curl, 20); gl.uniform1f(P.vort.u.dt, dt);
    blit(velocity.write); velocity.swap();
    gl.useProgram(P.div.p); gl.uniform2f(P.div.u.texel, velocity.tx, velocity.ty); gl.uniform1i(P.div.u.uV, velocity.read.attach(0)); blit(divergence);
    gl.useProgram(P.clear.p); gl.uniform2f(P.clear.u.texel, velocity.tx, velocity.ty); gl.uniform1i(P.clear.u.uT, pressure.read.attach(0)); gl.uniform1f(P.clear.u.v, 0.8);
    blit(pressure.write); pressure.swap();
    gl.useProgram(P.press.p); gl.uniform2f(P.press.u.texel, velocity.tx, velocity.ty); gl.uniform1i(P.press.u.uD, divergence.attach(0));
    for (var i = 0; i < ITERS; i++) { gl.uniform1i(P.press.u.uP, pressure.read.attach(1)); blit(pressure.write); pressure.swap(); }
    gl.useProgram(P.grad.p); gl.uniform2f(P.grad.u.texel, velocity.tx, velocity.ty); gl.uniform1i(P.grad.u.uP, pressure.read.attach(0)); gl.uniform1i(P.grad.u.uV, velocity.read.attach(1));
    blit(velocity.write); velocity.swap();
    gl.useProgram(P.advect.p); gl.uniform2f(P.advect.u.texel, velocity.tx, velocity.ty);
    var vid = velocity.read.attach(0); gl.uniform1i(P.advect.u.uV, vid); gl.uniform1i(P.advect.u.uS, vid); gl.uniform1f(P.advect.u.dt, dt); gl.uniform1f(P.advect.u.diss, 0.55);
    blit(velocity.write); velocity.swap();
    gl.uniform1i(P.advect.u.uV, velocity.read.attach(0)); gl.uniform1i(P.advect.u.uS, dye.read.attach(1)); gl.uniform1f(P.advect.u.diss, 1.0);
    blit(dye.write); dye.swap();
  }

  var col = { mid: [0.44, 0.38, 0.65], high: [0.9, 0.86, 1.0], light: [0.8, 0.7, 1.0] };
  var rot = [0, 0], rotT = [0, 0], inside = false, stepsN = qs === 'low' ? 22 : (qs === 'mid' ? 34 : (coarse ? 26 : 44));
  function draw() {
    var pal = window.Smoke && window.Smoke.palette && window.Smoke.palette();
    if (pal) { col.mid = pal.mid; col.high = pal.high; col.light = pal.light; }
    gl.useProgram(P.display.p);
    gl.uniform1i(P.display.u.uDye, dye.read.attach(0)); gl.uniform1i(P.display.u.uVel, velocity.read.attach(1));
    gl.uniform2f(P.display.u.rot, rot[0], rot[1]); gl.uniform1f(P.display.u.time, time); gl.uniform1f(P.display.u.steps, stepsN); gl.uniform1f(P.display.u.frm, (frames % 64));
    gl.uniform3fv(P.display.u.cMid, col.mid); gl.uniform3fv(P.display.u.cHigh, col.high); gl.uniform3fv(P.display.u.cLight, col.light);
    gl.clearColor(0, 0, 0, 0);
    blit(null);
  }

  /* ---- canvas sizing (device pixels), independent of simulation resolution ---- */
  function fit() {
    var d = Math.min(window.devicePixelRatio || 1, coarse ? 1.25 : 1.6);
    var w = Math.max(2, Math.round(canvas.clientWidth * d)), h = Math.max(2, Math.round(canvas.clientHeight * d));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  /* ---- interaction: the pointer tears through the smoke ---- */
  var last = null;
  function uvOf(e) { return [e.offsetX / Math.max(1, canvas.clientWidth), 1 - e.offsetY / Math.max(1, canvas.clientHeight)]; }
  if (!reduce) {
    canvas.addEventListener('pointermove', function (e) {
      var p = uvOf(e);
      if (last) {
        var dx = p[0] - last[0], dy = p[1] - last[1], sp = Math.sqrt(dx * dx + dy * dy);
        if (sp > 1e-5) splat(p[0], p[1], dx * 2600, dy * 2600, Math.min(0.16, sp * 5), 0.0014);
      }
      last = p; inside = true;
      rotT[0] = (p[0] - 0.5) * 2 * 0.62; rotT[1] = -(p[1] - 0.5) * 2 * 0.34;
    });
    canvas.addEventListener('pointerleave', function () { last = null; inside = false; });
    canvas.addEventListener('pointerenter', function () { inside = true; });
    canvas.addEventListener('pointerdown', function (e) {
      var p = uvOf(e);
      for (var i = 0; i < 10; i++) { var a = i / 10 * 6.283; splat(p[0] + Math.cos(a) * 0.012, p[1] + Math.sin(a) * 0.012, Math.cos(a) * 520, Math.sin(a) * 520, 0.05, 0.0016); }
    });
  }

  /* ---- loop (only while the mark is on screen) ---- */
  var active = false, running = false, warmed = false, lastT = 0, frames = 0;
  function warm() { for (var i = 0; i < 110; i++) { time += 0.016; step(0.016); } warmed = true; }
  function frame(now) {
    if (!active) { running = false; return; }
    requestAnimationFrame(frame);
    var dt = Math.min((now - lastT) / 1000, 0.033); lastT = now;
    if (++frames % 45 === 0) fit();
    if (!reduce) { time += dt; step(Math.max(dt, 0.006) * 0.8); }
    if (!inside) { rotT[0] = Math.sin(time * 0.27) * 0.3; rotT[1] = Math.sin(time * 0.19) * 0.1; }
    rot[0] += (rotT[0] - rot[0]) * Math.min(1, dt * 4); rot[1] += (rotT[1] - rot[1]) * Math.min(1, dt * 4);
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
