/* Evanescere — Smoke v3
   A volumetric fog the camera flies through (ray-marched in 3D), lit from the far end, disturbed by a
   small GPU fluid simulation that follows the cursor.
   • Smoothly interpolated 3D noise (C1) at 16-bit precision: no lattice artefacts in the lighting.
   • Temporal accumulation at rest: per-pixel jitter averages out, so the fog stays crisp and clean.
   • Crepuscular light shafts, foreground dust with parallax, cursor light, and fog that clears behind text.
   • Always in slow motion: wind and a gentle camera drift keep it alive even when nothing is touched.
   Exposes window.Smoke. Fails soft: without WebGL2 the CSS fog fallback shows. */
(function () {
  'use strict';

  var canvas = document.getElementById('smoke');
  var root = document.documentElement;
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  var qs = (location.search.match(/[?&]q=(\w+)/) || [])[1]; // ?q=low for slow machines / testing

  var API = { ok: false, setLook: function () {}, setMood: function () {}, splat: function () {}, burst: function () {}, kick: function () {}, scroll: function () {}, setCamera: function () {}, setPulse: function () {}, setZones: function () {}, palette: function () { return null; } };
  window.Smoke = API;
  if (!canvas) return;

  var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) { root.classList.add('no-gl'); return; }
  root.classList.add('has-gl');

  var cfg = {
    simRes: coarse ? 80 : 112,
    dyeRes: coarse ? 160 : 256,
    densityDissipation: 1.35,
    velocityDissipation: 0.9,
    pressure: 0.8,
    pressureIters: coarse ? 12 : 18,
    curl: 10,
    splatRadius: 0.16,
    splatForce: 2200,
    timeScale: 0.42,
    fogScale: coarse ? 0.5 : 0.7,
    steps: coarse ? 20 : 30,
    dust: coarse ? 240 : 520
  };
  if (qs === 'low') { cfg.fogScale = 0.25; cfg.steps = 12; cfg.dust = 120; }
  if (qs === 'hi') { cfg.fogScale = 0.6; cfg.steps = 26; }
  if (qs === 'mid') { cfg.fogScale = 0.4; cfg.steps = 18; cfg.dust = 240; }

  /* ---------- Shaders ---------- */
  var VS = '#version 300 es\nprecision highp float;\nin vec2 aPos;\nout vec2 vUv,vL,vR,vT,vB;\nuniform vec2 texel;\nvoid main(){vUv=aPos*.5+.5;vL=vUv-vec2(texel.x,0.);vR=vUv+vec2(texel.x,0.);vT=vUv+vec2(0.,texel.y);vB=vUv-vec2(0.,texel.y);gl_Position=vec4(aPos,0.,1.);}';
  var HEAD = '#version 300 es\nprecision highp float;precision highp sampler2D;precision highp sampler3D;\nin vec2 vUv,vL,vR,vT,vB;\nout vec4 o;\n';

  var FS = {
    splat: HEAD + 'uniform sampler2D uT;uniform float aspect,radius;uniform vec3 color;uniform vec2 point;\nvoid main(){vec2 p=vUv-point;p.x*=aspect;vec3 s=exp(-dot(p,p)/radius)*color;o=vec4(texture(uT,vUv).xyz+s,1.);}',
    advect: HEAD + 'uniform sampler2D uV,uS;uniform vec2 texel;uniform float dt,diss;\nvoid main(){vec2 c=vUv-dt*texture(uV,vUv).xy*texel;o=texture(uS,c)/(1.+diss*dt);}',
    div: HEAD + 'uniform sampler2D uV;\nvoid main(){float L=texture(uV,vL).x,R=texture(uV,vR).x,T=texture(uV,vT).y,B=texture(uV,vB).y;vec2 C=texture(uV,vUv).xy;if(vL.x<0.)L=-C.x;if(vR.x>1.)R=-C.x;if(vT.y>1.)T=-C.y;if(vB.y<0.)B=-C.y;o=vec4(.5*(R-L+T-B),0.,0.,1.);}',
    curl: HEAD + 'uniform sampler2D uV;\nvoid main(){float L=texture(uV,vL).y,R=texture(uV,vR).y,T=texture(uV,vT).x,B=texture(uV,vB).x;o=vec4(.5*(R-L-T+B),0.,0.,1.);}',
    vort: HEAD + 'uniform sampler2D uV,uC;uniform float curl,dt;\nvoid main(){float L=texture(uC,vL).x,R=texture(uC,vR).x,T=texture(uC,vT).x,B=texture(uC,vB).x,C=texture(uC,vUv).x;vec2 f=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));f/=length(f)+1e-4;f*=curl*C;f.y*=-1.;vec2 v=texture(uV,vUv).xy+f*dt;o=vec4(clamp(v,-1000.,1000.),0.,1.);}',
    press: HEAD + 'uniform sampler2D uP,uD;\nvoid main(){float L=texture(uP,vL).x,R=texture(uP,vR).x,T=texture(uP,vT).x,B=texture(uP,vB).x;o=vec4((L+R+B+T-texture(uD,vUv).x)*.25,0.,0.,1.);}',
    grad: HEAD + 'uniform sampler2D uP,uV;\nvoid main(){float L=texture(uP,vL).x,R=texture(uP,vR).x,T=texture(uP,vT).x,B=texture(uP,vB).x;vec2 v=texture(uV,vUv).xy-vec2(R-L,T-B);o=vec4(v,0.,1.);}',
    clear: HEAD + 'uniform sampler2D uT;uniform float v;\nvoid main(){o=v*texture(uT,vUv);}',

    /* Volumetric fog. The camera travels along +z through a 3D noise field, lit from the far end.
       Noise is sampled with smoothstep-remapped trilinear weights, so the field is C1-continuous:
       no grid-aligned creases in the shadow edges. Result is blended with the previous frame (temporal
       accumulation) so per-pixel jitter averages away instead of reading as speckle. */
    fog: HEAD +
      'uniform sampler3D uNoise;uniform sampler2D uDye,uVel,uPrev;\n' +
      'uniform float time,aspect,camZ,pulse,glow,expo,uDens,blend,frame;uniform vec2 look;uniform int uSteps;\n' +
      'uniform vec3 cDeep,cMid,cHigh,cLight,cBg;\n' +
      'float ign(vec2 p,float f){p+=5.588238*f;return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}\n' +
      'vec2 axis(float z){return vec2(sin(z*.21)*.55+sin(z*.047)*.8,cos(z*.17)*.35);}\n' +
      'vec4 nz(vec3 q){vec3 p=q*64.;vec3 i=floor(p);vec3 f=p-i;f=f*f*(3.-2.*f);return textureLod(uNoise,(i+f+.5)/64.,0.);}\n' +
      'float den(vec3 p){\n' +
      ' p+=vec3(time*.055,time*.022,0.);\n' +                       // wind: the smoke drifts sideways even when nothing moves
      ' vec3 q=p*.075;\n' +
      ' vec3 w=nz(q*.5+vec3(0.,0.,time*.006)).gba-.5;\n' +
      ' q+=w*.3;\n' +
      ' float f=nz(q).r*.62+nz(q*2.1+vec3(.37,.11,.71)).g*.30+nz(q*4.3+vec3(.61,.83,.19)).b*.08;\n' +
      ' return smoothstep(.53,.88,f);}\n' +
      'void main(){\n' +
      ' vec2 p=(vUv-.5)*vec2(aspect,1.);\n' +
      ' vec2 vel=texture(uVel,vUv).xy;float dye=texture(uDye,vUv).x;\n' +
      ' vec3 rd=normalize(vec3(p+vel*.0007+look,1.15));\n' +
      ' vec3 ro=vec3(axis(camZ)+vec2(sin(time*.05)*.25,cos(time*.04)*.15),camZ);\n' +
      ' float st=.15;float t=.2+ign(gl_FragCoord.xy,frame)*st;\n' +
      ' float T=1.;vec3 acc=vec3(0.);\n' +
      ' vec3 L=normalize(vec3(.18,.28,1.));\n' +
      ' for(int i=0;i<44;i++){\n' +
      '  if(i>=uSteps)break;\n' +
      '  vec3 pos=ro+rd*t;\n' +
      '  vec2 ax=axis(pos.z);\n' +
      '  float r=length(pos.xy-ax);\n' +
      '  float d=den(pos)*mix(1.,smoothstep(.25,2.4,r),.8);\n' +
      '  d*=smoothstep(.1,1.,t);\n' +
      '  d+=dye*1.4*smoothstep(3.,.2,t);\n' +
      '  d*=uDens*(1.+pulse*.9);\n' +
      '  if(d>.004){\n' +
      '   float dl=den(pos+L*.6)*mix(1.,smoothstep(.25,2.4,length(pos.xy+L.xy*.6-ax)),.8);\n' +
      '   float sh=exp(-dl*2.4);\n' +
      '   float a=1.-exp(-d*st*2.6);\n' +
      '   vec3 col=cDeep*.5+cMid*(.25+.75*sh)*.9+cHigh*sh*sh*.8;\n' +
      '   acc+=T*a*col*exp(-t*.11);T*=1.-a;\n' +
      '   if(T<.03)break;}\n' +
      '  t+=st;st*=1.07;}\n' +
      ' vec3 c=cBg+acc*expo;\n' +
      ' c+=cLight*exp(-dot(p,p)*2.6)*(.2+.2*glow+.3*pulse)*T;\n' +
      ' o=vec4(mix(texture(uPrev,vUv).rgb,c,blend),1.);}',

    /* Composite at full resolution: unsharp, light shafts, content-aware density, cursor light, grain. */
    display: HEAD +
      'uniform sampler2D uFog;uniform vec2 ptr,look;uniform float time,glow,aspect,rays,pulse;uniform vec3 cLight,cMid;\n' +
      'uniform int nZ;uniform vec4 zr[6];uniform float zs[6];\n' +
      'float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}\n' +
      'void main(){\n' +
      ' vec3 c=texture(uFog,vUv).rgb;\n' +
      ' vec2 tx=1./vec2(textureSize(uFog,0));\n' +
      ' vec3 b=(texture(uFog,vUv+vec2(tx.x,0.)).rgb+texture(uFog,vUv-vec2(tx.x,0.)).rgb+texture(uFog,vUv+vec2(0.,tx.y)).rgb+texture(uFog,vUv-vec2(0.,tx.y)).rgb)*.25;\n' +
      ' c+=(c-b)*.6;\n' +                                              // crisp wisp edges
      // crepuscular rays: the brighter fog is smeared back toward the light at the vanishing point
      ' vec2 cen=vec2(.5)+look*vec2(.45,.55);vec2 dd=(cen-vUv)*(.85/18.);vec2 uv=vUv;vec3 r=vec3(0.);float w=1.;\n' +
      ' for(int i=0;i<18;i++){uv+=dd;vec3 s=texture(uFog,uv).rgb;r+=s*smoothstep(.10,.45,dot(s,vec3(.3333)))*w;w*=.93;}\n' +
      ' c+=cLight*dot(r,vec3(.3333))*.016*rays*(.6+1.2*pulse);\n' +
      // fog clears behind panels (legibility) and gathers just outside them (separation)
      ' float dim=1.,halo=0.;\n' +
      ' for(int i=0;i<6;i++){if(i>=nZ)break;vec4 z=zr[i];vec2 q=(vUv-z.xy)/z.zw;float k=pow(pow(abs(q.x),3.)+pow(abs(q.y),3.),.3333);\n' +
      '  float inside=1.-smoothstep(.6,1.9,k);float ring=smoothstep(1.,1.6,k)*(1.-smoothstep(1.6,2.8,k));\n' +
      '  dim*=1.-.30*inside*zs[i];halo+=ring*zs[i];}\n' +
      ' c*=dim;c+=cMid*halo*.09;\n' +
      // the cursor carries a light: it lights the fog near it
      ' float pd=length((vUv-ptr)*vec2(aspect,1.));\n' +
      ' c+=cLight*exp(-pd*pd*22.)*glow*(.03+1.5*dot(c,vec3(.3333)));\n' +
      ' float vg=smoothstep(1.3,.2,length((vUv-.5)*vec2(1.,.9)));c*=.5+.5*vg;\n' +
      ' float n=h(gl_FragCoord.xy+fract(time)*91.)+h(gl_FragCoord.yx*1.3+fract(time*1.7)*57.)-1.;\n' +
      ' c+=n*(.9/255.);\n' +
      ' o=vec4(max(c,0.),1.);}'
  };

  /* Foreground dust: drifting motes at many depths. They stream past as the camera flies (parallax),
     and keep drifting slowly when it is still. */
  var DUST_VS = '#version 300 es\nprecision highp float;\nuniform float time,camZ,aspect,dpr,pulse;uniform vec2 look;\nout float vA;\n' +
    'float h1(float n){return fract(sin(n*127.1)*43758.5453);}\n' +
    'void main(){\n' +
    ' float id=float(gl_VertexID);vec3 s=vec3(h1(id),h1(id+17.3),h1(id+41.7));\n' +
    ' float R=12.;float z=fract(s.z-camZ/R-time*.004)*R+.05;\n' +
    ' vec2 xy=(s.xy*2.-1.)*vec2(aspect,1.)*(z*.95+.35);\n' +
    ' xy+=vec2(sin(time*.11+s.x*30.),cos(time*.09+s.y*30.))*.25;\n' +
    ' vec2 p=xy/z*1.15+look;\n' +
    ' gl_Position=vec4(p/vec2(aspect,1.)*2.,0.,1.);\n' +
    ' float near=smoothstep(.5,1.6,z),far=1.-smoothstep(6.,11.,z);\n' +
    ' vA=near*far*(.25+.75*h1(id+5.))*(1.+pulse*1.5);\n' +
    ' gl_PointSize=clamp((1.6+3.4*h1(id+9.))*dpr*clamp(2.2/z,.6,3.),1.5,18.*dpr);}';
  var DUST_FS = '#version 300 es\nprecision highp float;\nin float vA;uniform vec3 cLight;out vec4 o;\nvoid main(){vec2 q=gl_PointCoord*2.-1.;float a=exp(-dot(q,q)*3.5)*vA*.5;if(a<.004)discard;o=vec4(cLight*a,a);}';

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  var vs = compile(gl.VERTEX_SHADER, VS);
  function link(vsh, fsrc) {
    var p = gl.createProgram();
    var f = compile(gl.FRAGMENT_SHADER, fsrc);
    if (!vsh || !f) return null;
    gl.attachShader(p, vsh); gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(p)); return null; }
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p: p, u: u };
  }

  var P = {};
  for (var k in FS) { P[k] = link(vs, FS[k]); if (!P[k]) { root.classList.add('no-gl'); root.classList.remove('has-gl'); return; } }
  var dustP = link(compile(gl.VERTEX_SHADER, DUST_VS), DUST_FS);
  var dustVao = gl.createVertexArray();

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
  function free(f) { if (!f) return; gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fbo); }
  function resolution(base) {
    var ar = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (ar < 1) ar = 1 / ar;
    var mn = Math.round(base), mx = Math.round(base * ar);
    return gl.drawingBufferWidth > gl.drawingBufferHeight ? { w: mx, h: mn } : { w: mn, h: mx };
  }

  var velocity, dye, divergence, curl, pressure, fog, framesSinceReset = 0;
  function initTargets() {
    [velocity, dye, pressure, fog].forEach(function (d) { if (d) { free(d.read); free(d.write); } });
    free(divergence); free(curl);
    var s = resolution(cfg.simRes), d = resolution(cfg.dyeRes);
    velocity = makeDouble(s.w, s.h, gl.LINEAR);
    dye = makeDouble(d.w, d.h, gl.LINEAR);
    divergence = makeFBO(s.w, s.h, gl.NEAREST);
    curl = makeFBO(s.w, s.h, gl.NEAREST);
    pressure = makeDouble(s.w, s.h, gl.NEAREST);
    fog = makeDouble(Math.max(2, Math.round(gl.drawingBufferWidth * cfg.fogScale)), Math.max(2, Math.round(gl.drawingBufferHeight * cfg.fogScale)), gl.LINEAR);
    framesSinceReset = 0;
  }

  /* ---------- 3D noise: blurred random fields, 4 decorrelated channels, uploaded at 16-bit precision ---------- */
  function makeNoise(N) {
    var ch = 4, f = new Float32Array(N * N * N * ch), seed = 90210;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    for (var i = 0; i < f.length; i++) f[i] = rnd();
    var tmp = new Float32Array(N);
    function blurAxis(c, stride, o1, o2, r) {
      var w = 2 * r + 1;
      for (var a = 0; a < N; a++) for (var b = 0; b < N; b++) {
        var base = a * o1 + b * o2 + c, j, sum = 0;
        for (j = 0; j < N; j++) tmp[j] = f[base + j * stride];
        for (j = -r; j <= r; j++) sum += tmp[(j + N) % N];
        for (j = 0; j < N; j++) { f[base + j * stride] = sum / w; sum += tmp[(j + r + 1) % N] - tmp[(j - r + N) % N]; }
      }
    }
    var sx = ch, sy = N * ch, sz = N * N * ch;
    for (var c = 0; c < ch; c++) {
      for (var pass = 0; pass < 2; pass++) { blurAxis(c, sx, sy, sz, 3); blurAxis(c, sy, sx, sz, 3); blurAxis(c, sz, sx, sy, 3); }
      var mean = 0, v = 0, n = N * N * N, q;
      for (q = c; q < f.length; q += ch) mean += f[q]; mean /= n;
      for (q = c; q < f.length; q += ch) v += (f[q] - mean) * (f[q] - mean);
      var sd = Math.sqrt(v / n) || 1;
      for (q = c; q < f.length; q += ch) f[q] = Math.max(0, Math.min(1, 0.5 + (f[q] - mean) / sd * 0.16));
    }
    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, N, N, N, 0, gl.RGBA, gl.FLOAT, f);
    return tex;
  }
  var noiseTex = makeNoise(64);

  /* ---------- Canvas sizing ---------- */
  var quality = 1;
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2) * quality;
    var w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    var cap = 3.2e6, px = w * h;
    if (px > cap) { var s = Math.sqrt(cap / px); w = Math.round(w * s); h = Math.round(h * s); }
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
    return false;
  }
  resize();
  initTargets();

  /* ---------- Moods: each room has its own colour story, light and density ---------- */
  function hex(h) { return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; }
  var moods = {
    hero:     { deep: '#0b1330', mid: '#5a78a8', high: '#d9e8ff', light: '#cfe0ff', bg: '#04060a', expo: 0.85, dens: 1.0,  rays: 1.0 },   // cold steel
    deep:     { deep: '#080b22', mid: '#46528f', high: '#c3cff7', light: '#a9b8f0', bg: '#03040a', expo: 0.6,  dens: 0.85, rays: 0.7 },   // ink indigo
    void:     { deep: '#05070f', mid: '#2c3a58', high: '#bcd0ff', light: '#e8f0ff', bg: '#02030a', expo: 0.45, dens: 0.7,  rays: 1.9 },   // black, one hard light
    daylight: { deep: '#16243d', mid: '#7f9bbb', high: '#f1f7ff', light: '#ffffff', bg: '#0a1220', expo: 1.05, dens: 1.1,  rays: 0.9 },   // pale, silver, bright
    teal:     { deep: '#04171a', mid: '#3f8c8a', high: '#c9f6ee', light: '#8ff0d8', bg: '#02080a', expo: 0.85, dens: 1.0,  rays: 1.2 },   // sea green
    dusk:     { deep: '#1a1226', mid: '#80698f', high: '#f4d9e8', light: '#ffc3d6', bg: '#07050b', expo: 0.8,  dens: 0.95, rays: 1.1 },   // rose slate
    ember:    { deep: '#1d1008', mid: '#a5714a', high: '#ffe3c0', light: '#ffb25e', bg: '#080402', expo: 0.9,  dens: 1.0,  rays: 1.5 },   // warm amber
    graphite: { deep: '#0d0f13', mid: '#4a5260', high: '#dfe5ee', light: '#b7c2d4', bg: '#030406', expo: 0.55, dens: 0.75, rays: 0.6 },   // neutral
    violet:   { deep: '#150f33', mid: '#7062a6', high: '#e5dcff', light: '#cbb4ff', bg: '#05050b', expo: 0.5,  dens: 0.85, rays: 0.8 }    // dark violet (frames the logo)
  };
  var keys = ['deep', 'mid', 'high', 'light', 'bg'];
  var cur = {}, tgt = {}, nums = { expo: 0.85, dens: 1, rays: 1 }, numsT = { expo: 0.85, dens: 1, rays: 1 };
  keys.forEach(function (k) { cur[k] = hex(moods.hero[k]); tgt[k] = cur[k].slice(); });
  API.palette = function () { return { mid: cur.mid, high: cur.high, light: cur.light }; };
  API.settle = function () { keys.forEach(function (k) { cur[k] = tgt[k].slice(); }); for (var nk in nums) nums[nk] = numsT[nk]; blend = 1; framesSinceReset = 0; };
  API.setMood = function (name) {
    var m = moods[name]; if (!m) return;
    keys.forEach(function (k) { tgt[k] = hex(m[k]); });
    numsT.expo = m.expo; numsT.dens = m.dens; numsT.rays = m.rays;
  };

  /* ---------- Camera + content zones ---------- */
  var camTarget = 0, camZ = 0, pulse = 0, pulseT = 0, lastCam = 0, camSpeed = 0;
  API.setCamera = function (z) { camTarget = z; };
  API.setPulse = function (p) { pulseT = p; };
  var look = [0, 0], lookT = [0, 0];
  API.setLook = function (x, y) { lookT[0] = x; lookT[1] = y; };
  var zr = new Float32Array(24), zs = new Float32Array(6), nZ = 0;
  // zones: [{x, y, hw, hh, s}] in uv units (y up), strength 0..1
  API.setZones = function (list) {
    nZ = Math.min(6, list.length);
    for (var i = 0; i < nZ; i++) { var z = list[i]; zr[i * 4] = z.x; zr[i * 4 + 1] = z.y; zr[i * 4 + 2] = Math.max(0.001, z.hw); zr[i * 4 + 3] = Math.max(0.001, z.hh); zs[i] = z.s; }
  };

  /* ---------- Splats: the cursor disturbs the fog ---------- */
  var aspect = function () { return canvas.width / canvas.height; };
  function splat(x, y, dx, dy, amount) {
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
    gl.uniform3f(P.splat.u.color, amount, 0, 0);
    gl.uniform1f(P.splat.u.radius, r * 1.2);
    gl.uniform2f(P.splat.u.texel, dye.tx, dye.ty);
    blit(dye.write); dye.swap();
  }
  API.splat = function (x, y, dx, dy, amount) { splat(x, y, dx * cfg.splatForce, dy * cfg.splatForce, amount == null ? 0.2 : amount); };
  API.burst = function (x, y, n, power) {
    n = n || 6; power = power || 1;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, d = Math.random() * 0.02 * power;
      var s = (0.3 + Math.random() * 0.4) * 0.006 * power * cfg.splatForce;
      splat(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.cos(a) * s, Math.sin(a) * s, 0.035 * power);
    }
  };

  var ptr = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, moved: false, glow: 0, has: false, lastMove: 0 };
  function pointerAt(cx, cy) {
    var x = cx / window.innerWidth, y = 1 - cy / window.innerHeight;
    if (!ptr.has) { ptr.px = x; ptr.py = y; ptr.has = true; }
    ptr.px = ptr.x; ptr.py = ptr.y; ptr.x = x; ptr.y = y; ptr.moved = true; ptr.glow = 1; ptr.lastMove = performance.now();
  }
  window.addEventListener('pointermove', function (e) { pointerAt(e.clientX, e.clientY); }, { passive: true });
  window.addEventListener('touchmove', function (e) { var t = e.touches[0]; if (t) pointerAt(t.clientX, t.clientY); }, { passive: true });
  window.addEventListener('pointerdown', function (e) { if (!reduceMotion) API.burst(e.clientX / innerWidth, 1 - e.clientY / innerHeight, 4, 0.8); }, { passive: true });

  function applyPointer() {
    if (!ptr.moved || reduceMotion) { ptr.moved = false; return; }
    ptr.moved = false;
    var dx = ptr.x - ptr.px, dy = ptr.y - ptr.py;
    var a = window.innerWidth / window.innerHeight;
    if (a < 1) dx *= a; else dy /= a;
    var sp = Math.sqrt(dx * dx + dy * dy);
    if (sp < 1e-5) return;
    splat(ptr.x, ptr.y, dx * cfg.splatForce, dy * cfg.splatForce, Math.min(0.14, 0.02 + sp * 4));
  }

  // two slow wandering currents: with no input the smoke still turns over, gently
  function ambient(t) {
    for (var i = 0; i < 2; i++) {
      var ph = t * (0.05 + i * 0.023) + i * 3.1;
      splat(0.5 + 0.38 * Math.sin(ph * 1.3 + i), 0.5 + 0.3 * Math.cos(ph * 0.9), Math.cos(ph * 1.7) * 38, Math.sin(ph * 1.3) * 38, 0.004);
    }
  }

  /* ---------- Fluid step ---------- */
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

  /* ---------- Render ---------- */
  var frameNo = 0, blend = 1, blendT = 1;
  function draw(t) {
    var cz = camZ + (reduceMotion ? 0 : t * 0.07);
    gl.disable(gl.BLEND);
    gl.useProgram(P.fog.p);
    var u = P.fog.u;
    gl.uniform1i(u.uDye, dye.read.attach(0));
    gl.uniform1i(u.uVel, velocity.read.attach(1));
    gl.uniform1i(u.uPrev, fog.read.attach(2));
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_3D, noiseTex);
    gl.uniform1i(u.uNoise, 4);
    gl.uniform1f(u.time, t);
    gl.uniform1f(u.aspect, fog.w / fog.h);
    gl.uniform1f(u.camZ, cz);
    gl.uniform1f(u.pulse, pulse);
    gl.uniform1f(u.glow, ptr.glow);
    gl.uniform1f(u.expo, nums.expo);
    gl.uniform1f(u.uDens, nums.dens);
    gl.uniform1f(u.blend, framesSinceReset < 3 ? 1 : blend);
    gl.uniform1f(u.frame, frameNo & 63);
    gl.uniform2f(u.look, look[0], look[1]);
    gl.uniform1i(u.uSteps, cfg.steps);
    gl.uniform3fv(u.cDeep, cur.deep); gl.uniform3fv(u.cMid, cur.mid); gl.uniform3fv(u.cHigh, cur.high);
    gl.uniform3fv(u.cLight, cur.light); gl.uniform3fv(u.cBg, cur.bg);
    blit(fog.write); fog.swap();
    framesSinceReset++; frameNo++;

    gl.useProgram(P.display.p);
    var d = P.display.u;
    gl.uniform1i(d.uFog, fog.read.attach(0));
    gl.uniform2f(d.ptr, ptr.x, ptr.y);
    gl.uniform2f(d.look, look[0], look[1]);
    gl.uniform1f(d.time, t);
    gl.uniform1f(d.glow, ptr.glow);
    gl.uniform1f(d.aspect, aspect());
    gl.uniform1f(d.rays, nums.rays);
    gl.uniform1f(d.pulse, pulse);
    gl.uniform3fv(d.cLight, cur.light); gl.uniform3fv(d.cMid, cur.mid);
    gl.uniform1i(d.nZ, nZ);
    gl.uniform4fv(d['zr[0]'], zr); gl.uniform1fv(d['zs[0]'], zs);
    blit(null);

    // foreground dust, additive over the finished frame
    if (dustP && cfg.dust > 0) {
      gl.useProgram(dustP.p);
      gl.bindVertexArray(dustVao);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      var du = dustP.u;
      gl.uniform1f(du.time, t); gl.uniform1f(du.camZ, cz); gl.uniform1f(du.aspect, aspect());
      gl.uniform1f(du.dpr, canvas.width / Math.max(1, canvas.clientWidth)); gl.uniform1f(du.pulse, pulse);
      gl.uniform2f(du.look, look[0], look[1]); gl.uniform3fv(du.cLight, cur.light);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.drawArrays(gl.POINTS, 0, cfg.dust);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
  }

  /* ---------- Loop with adaptive quality ---------- */
  var last = performance.now(), time = 0, running = true, ema = 16, slow = 0, tier = 0, frames = 0, still = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) { last = now; return; }
    var raw = Math.min(now - last, 100); last = now;
    var dt = Math.min(raw / 1000, 0.0333);
    time += dt * (reduceMotion ? 0 : 1);
    frames++;

    ema += (raw - ema) * 0.05;
    if (frames > 90 && !qs) {
      if (ema > 28) slow++; else slow = Math.max(0, slow - 1);
      if (slow > 60 && tier < 3) {
        tier++; slow = 0;
        if (tier === 1) { cfg.fogScale *= 0.82; cfg.steps = Math.max(14, cfg.steps - 6); cfg.dust = Math.round(cfg.dust * 0.6); }
        else if (tier === 2) { cfg.fogScale *= 0.82; cfg.steps = Math.max(12, cfg.steps - 4); cfg.simRes = Math.max(64, cfg.simRes * 0.8); }
        else { quality = 0.75; }
        resize(); initTargets();
      }
    }

    for (var i = 0; i < keys.length; i++) { var key = keys[i]; for (var c = 0; c < 3; c++) cur[key][c] += (tgt[key][c] - cur[key][c]) * Math.min(1, dt * 1.4); }
    for (var nk in nums) nums[nk] += (numsT[nk] - nums[nk]) * Math.min(1, dt * 1.4);
    camZ += (camTarget - camZ) * Math.min(1, dt * 6.0);   // the camera object already glides; this only smooths hand-offs
    pulse += (pulseT - pulse) * Math.min(1, dt * 5.0);
    look[0] += (lookT[0] - look[0]) * Math.min(1, dt * 3.0); look[1] += (lookT[1] - look[1]) * Math.min(1, dt * 3.0);

    // temporal accumulation: heavy history at rest (clean), light while anything is moving (no ghosting)
    camSpeed = Math.abs(camTarget - lastCam) / Math.max(dt, 0.001); lastCam = camTarget;
    var active = camSpeed > 8 || pulse > 0.04 || performance.now() - ptr.lastMove < 700 || Math.abs(look[0] - lookT[0]) > 0.002;
    blendT = active ? 0.6 : 0.12;
    blend += (blendT - blend) * Math.min(1, dt * 6.0);

    applyPointer();
    ptr.glow += (0 - ptr.glow) * Math.min(1, dt * 0.9);
    if (!reduceMotion) { ambient(time); step(Math.max(dt, 0.004) * cfg.timeScale * 2.0); }

    if (reduceMotion) { var moving = Math.abs(camTarget - camZ) > 1e-3 || pulse > 0.01; still = moving ? 0 : still + 1; if (still > 40) return; }
    draw(time);
  }

  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (resize()) initTargets(); still = 0; }, 150); });
  document.addEventListener('visibilitychange', function () { running = !document.hidden; last = performance.now(); });
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); running = false; root.classList.add('no-gl'); });

  API.ok = true;
  API.moods = moods;
  requestAnimationFrame(function (t) { last = t; requestAnimationFrame(frame); });
})();
