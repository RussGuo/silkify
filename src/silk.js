/**
 * silk.js — silkify anything.
 *
 *   import { silkify } from './silk.js';
 *   const silk = silkify(canvas, { image: 'pear.png' });            // shape: 'image' (default)
 *   const moon = silkify(canvas2, { image: 'moon.png', shape: 'sphere' });
 *
 * At rest the object is matte and photographic. Where the pointer touches it, the surface is
 * pressed in, ripples spread, and only there does it turn to silk: an overlay "satin" term and a
 * soft highlight both scale with local ripple energy, so the two materials blend continuously
 * instead of being switched.
 *
 * Pipeline (identical for both shapes):
 *   1. wave simulation  — ping-pong half-float FBOs, r = height, g = velocity, damped wave equation
 *   2. displacement     — sphere: along the normal; image: along the view axis (z)
 *   3. normals          — geometric normal + ripple slope (image: scaled by n.z, exact for a height field)
 *   4. photometry       — albedo × Lommel–Seeliger (flat lit face, crisp terminator, floor on the dark side)
 *   5. silk             — satin overlay + highlight, gated by ripple energy; a fill-light gradient follows
 *                         the pointer on a critically damped spring and sweeps slowly when idle
 *
 * The render loop sleeps: 60 fps while touched or rippling, 12 fps while only the idle sweep runs,
 * stopped when off-screen or with prefers-reduced-motion (one frame is drawn).
 *
 * Peer dependency: three (tested with 0.152.2). Requires WebGL2; otherwise the picture is drawn once.
 */
import * as THREE from 'three';
import { loadPicture, buildShape, paintStill } from './shape.js';

/* ============================================
 * Defaults — the moon's numbers, with the per-shape differences explained
 * ============================================ */
const MOON_SIM = 256;               // the moon's simulation grid; image mode keeps its cell size (π / 256 world units)
const TEXEL = Math.PI / MOON_SIM;
const SATIN_LIGHT = [0.5, 0.6, 0.45];
const FILL_HOME = [-0.55, 0.6, 0.58];
const IDLE_LIGHT_MS = 2500;         // pointer still for this long → hand the fill light back to the idle sweep
const ACTIVE_MS = 8000;             // keep 60 fps this long after the last touch, so ripples can die out
const IDLE_FPS = 12;
const GRAIN = 1024;

export const PUFF = { flat: 0.35, cushion: 0.6, dome: 1 };

const COMMON = {
  shape: 'image',
  interactive: true,
  pressDepth: 0.3,        // dent depth under a hovering pointer
  pressDepthHold: 0.6,    // dent depth while the button / finger is down
  pressRadius: 0.075,     // dent radius in the moon's UV units (≈ 12 % of an image object's width)
  waveSpeed: 1.6,
  damping: 0.996,         // closer to 1 = ripples live longer
  displace: 0.32,         // height field → geometry displacement
  ripple: 62,             // ripple slope → normal perturbation (satin contrast)
  satin: 0.9,             // overlay amount of the satin term at full ripple energy
  exposure: 1,
  gamma: 1,               // albedo = pow(albedo, gamma); < 1 lifts mid-tones
  volume: 0.28,           // fill-light gradient across the object (0 = none)
  fillLight: true,        // the gradient follows the pointer, springs home, sweeps when idle
  idleSweep: true,
  dpr: 2,                 // device-pixel-ratio cap
  reducedMotion: 'auto',  // 'auto' follows prefers-reduced-motion; true / false to force
  onHover: null,
};

const DEFAULTS = {
  // the moon: Lommel–Seeliger with a tight denominator floor, faint highlight (lunar albedo is bright)
  sphere: { light: [0, 0, 1], floor: 0.05, sheen: 0.18, sheenPower: 22, phase: null, bump: null, bumpStrength: 7, spin: true, spinSpeed: 0.006, angle: 0 },
  // any silhouette: floor 0.15 (mesh normals at the outline are not analytic), wider highlight
  image: { light: [-0.35, 0.45, 0.82], floor: 0.55, sheen: 0.3, sheenPower: 16, puff: 'dome', matte: 'auto', corner: 0.06, threshold: 0.5, albedo: null, grain: 0, fit: 1.3 },
};

/* ============================================
 * Shaders — one source, two shapes (#define SPHERE)
 * ============================================ */
const SIM_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPrev, uMask;
  uniform vec2 uSize, uMouse;
  uniform float uMouseActive, uPressDepth, uPressRadius, uWaveSpeed, uDamping;
  varying vec2 vUv;
  void main() {
    vec4 data = texture2D(uPrev, vUv);
    vec2 dx = vec2(1.0 / uSize.x, 0.0), dy = vec2(0.0, 1.0 / uSize.y);
    float average = (texture2D(uPrev, vUv - dx).r + texture2D(uPrev, vUv + dx).r
                   + texture2D(uPrev, vUv - dy).r + texture2D(uPrev, vUv + dy).r) * 0.25;
    data.g += (average - data.r) * uWaveSpeed;
    data.g *= uDamping;
    data.r += data.g;
    data.r *= uDamping;
    if (uMouseActive > 0.5) {
      float influence = smoothstep(uPressRadius, 0.0, distance(vUv, uMouse));
      data.r = mix(data.r, -uPressDepth, influence * 0.35);
    }
  #ifndef SPHERE
    data.rg *= step(0.5, texture2D(uMask, vUv).a);   // zero outside: waves reflect at the outline, which never moves
  #endif
    gl_FragColor = data;
  }
`;

const SIM_VERT = /* glsl */ `
  precision highp float;
  attribute vec3 position; attribute vec2 uv;
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

const OBJ_VERT = /* glsl */ `
  precision highp float;
  attribute vec3 position; attribute vec2 uv; attribute vec3 normal;
  uniform mat4 projectionMatrix, modelViewMatrix;
  uniform sampler2D uSim;
  uniform float uDisplace;
  varying vec2 vUv; varying vec3 vViewPos; varying vec3 vViewNormal;
  void main() {
    vUv = uv;
    float h = texture2D(uSim, uv).r * uDisplace;
  #ifdef SPHERE
    vec3 p = position + normal * h;
  #else
    vec3 p = position + vec3(0.0, 0.0, h);   // along the view axis: the outline stays put and never folds
  #endif
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPos = mv.xyz;
    vViewNormal = mat3(modelViewMatrix) * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

const OBJ_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uSim, uAlbedo, uGrain;
  uniform vec2 uSimSize;
  uniform vec3 uSatinDir, uSunDir, uVolDir, uTint;
  uniform float uRipple, uSatin, uFloor, uExposure, uGamma, uVolume, uSheen, uSheenPow, uTintMix, uGrainAmt;
#ifdef SPHERE
  uniform sampler2D uBump;
  uniform float uAngle, uBumpTexel, uBumpStrength;
#endif
  varying vec2 vUv; varying vec3 vViewPos; varying vec3 vViewNormal;

  float blendOverlay(float b, float s) { return b < 0.5 ? (2.0 * b * s) : (1.0 - 2.0 * (1.0 - b) * (1.0 - s)); }
  vec3 blendOverlay(vec3 b, vec3 s) { return vec3(blendOverlay(b.r, s.r), blendOverlay(b.g, s.g), blendOverlay(b.b, s.b)); }

  void main() {
  #ifdef SPHERE
    vec2 auv = vec2(vUv.x + uAngle, vUv.y);
    vec4 base = vec4(texture2D(uAlbedo, auv).rgb, 1.0);
  #else
    vec4 base = texture2D(uAlbedo, vUv);      // rgb = the picture, a = its silhouette (antialiased)
    if (base.a < 0.004) discard;
  #endif

    // ---- ripple height field: slope + energy; energy decides where silk appears (0 at rest) ----
    vec4 data = texture2D(uSim, vUv);
    float hx = texture2D(uSim, vec2(vUv.x + 1.0 / uSimSize.x, vUv.y)).r - data.r;
    float hy = texture2D(uSim, vec2(vUv.x, vUv.y + 1.0 / uSimSize.y)).r - data.r;
    float silk = clamp(abs(data.r) * 5.0 + length(vec2(hx, hy)) * 26.0, 0.0, 1.0);

    vec3 geoN = normalize(vViewNormal + vec3(0.0, 0.0, 1e-4));
    vec3 viewDir = normalize(-vViewPos);
    float muGeo = dot(geoN, uSunDir);

  #ifdef SPHERE
    // relief only near the terminator: face-on, real lunar light is flat (bump everywhere reads as pockmarks)
    vec2 e = vec2(uBumpTexel * 1.5, 0.0);
    float bx = texture2D(uBump, auv + e.xy).r - texture2D(uBump, auv - e.xy).r;
    float by = texture2D(uBump, auv + e.yx).r - texture2D(uBump, auv - e.yx).r;
    float graze = 1.0 - smoothstep(0.02, 0.62, muGeo);
    vec3 N = normalize(geoN + vec3(-bx, -by, 0.0) * uBumpStrength * graze + vec3(-hx, -hy, 0.0) * uRipple);
    const float DEN = 0.02;
  #else
    // n ∝ (−∇(h + δ), 1): scaling the ripple by n.z is the exact sum; it fades to 0 at the outline
    vec3 N = normalize(geoN + vec3(-hx, -hy, 0.0) * uRipple * geoN.z);
    // where the terminator meets the outline μ0 and μ both → 0; mesh normals there are not analytic,
    // and 0.02 would flip pixels between 0 and 1 (black specks). 0.15 darkens that corner smoothly
    const float DEN = 0.15;
  #endif

    // ---- albedo: the picture (or a flat tint), optional grain at one texel per device pixel ----
    vec3 albedo = pow(max(mix(base.rgb, uTint, uTintMix), 0.0), vec3(uGamma));
    albedo *= mix(1.0, texture2D(uGrain, gl_FragCoord.xy / ${GRAIN}.0).r * 2.0, uGrainAmt);

    // ---- Lommel–Seeliger: back-scattering matte (regolith, velvet, ink); lit face nearly flat ----
    float shadow = smoothstep(-0.09, 0.03, muGeo);
    float mu0 = max(dot(N, uSunDir), 0.0) * shadow;
    float mu = max(dot(geoN, viewDir), 0.0);
    float lunar = clamp(2.0 * mu0 / max(mu0 + mu, DEN), 0.0, 1.0);
    float dayT = smoothstep(-0.05, 0.06, muGeo);
    float lum = lunar + uFloor * (1.0 - lunar);           // floor, not a gate: no black groove at the terminator
    vec3 col = albedo * lum * uExposure;
    col *= mix(1.0 - uVolume, 1.0, smoothstep(-1.0, 1.0, dot(geoN, uVolDir)));

    // ---- silk only where touched, and only on the lit side ----
    float silkLit = silk * dayT;
    float satin = mix(0.5, max(dot(N, uSatinDir), 0.0), 0.45);
    col = mix(col, blendOverlay(col, vec3(satin)), silkLit * uSatin);
    float spec = pow(max(dot(viewDir, reflect(-uSatinDir, N)), 0.0), uSheenPow);
    col += uSheen * spec * silkLit * vec3(0.9, 0.95, 1.0);

    gl_FragColor = vec4(col * base.a, base.a);            // premultiplied
  }
`;

/* ============================================
 * Helpers
 * ============================================ */
let support;
/** WebGL2 + renderable half floats, probed on a throwaway canvas so the real one can still fall back to 2D. */
export function isSupported() {
  if (support !== undefined) return support;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    support = !!gl && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    support = false;
  }
  return support;
}

const vec3 = (a) => new THREE.Vector3().fromArray(a).normalize();
const resolvePuff = (p) => (typeof p === 'string' ? PUFF[p] ?? 1 : p);

/** Lunar phase 0..1 (0 new, 0.25 first quarter lit on the right, 0.5 full, 0.75 last quarter) → view-space sun. */
function sunFromPhase(f) {
  const t = Math.PI * 2 * f;
  return [Math.sin(t), 0, -Math.cos(t)];
}

function grainTexture() {
  const data = new Uint8Array(GRAIN * GRAIN);
  let s = 0x2f6b1d3;   // deterministic seed: the same grain on every load
  for (let i = 0; i < data.length; i++) {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const n = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    data[i] = Math.round(((0.865 + 0.405 * n * n) / 2) * 255);   // sparse bright specks, mean ≈ 1 (stored halved)
  }
  return dataTex(data, GRAIN, THREE.RedFormat, THREE.RepeatWrapping);
}

function dataTex(data, size, format, wrap = THREE.ClampToEdgeWrapping, mips = false) {
  const t = new THREE.DataTexture(data, size, size, format, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = wrap;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips;
  t.needsUpdate = true;
  return t;
}

function loadTexture(src) {
  return loadPicture(src).then((pic) => {
    const t = new THREE.Texture(pic);
    t.needsUpdate = true;
    return t;
  });
}

/* ============================================
 * silkify(canvas, options) → handle
 * ============================================ */
export function silkify(canvas, options = {}) {
  const shapeKind = options.shape === 'sphere' ? 'sphere' : 'image';
  const o = { ...COMMON, ...DEFAULTS[shapeKind], ...options };
  if (!o.image) throw new Error('silkify: options.image is required');

  const reduceMq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => (o.reducedMotion === 'auto' ? !!reduceMq?.matches : !!o.reducedMotion);

  let disposed = false;
  let api = null;   // the live renderer, once mounted
  const handle = {
    canvas,
    mode: 'loading',   // → 'webgl' | 'static' | 'failed'
    ready: null,
    setTheme(t) { Object.assign(o, t); api?.apply(); },
    setPhase(f) { o.phase = f; api?.apply(); },
    wake() { api?.wake(); },
    dispose() { disposed = true; api?.dispose(); },
  };

  handle.ready = (async () => {
    const pic = await loadPicture(o.image);
    if (disposed) return handle;
    if (!isSupported()) {
      paintStill(canvas, o.poster ? await loadPicture(o.poster) : pic, { sphere: shapeKind === 'sphere', dpr: o.dpr });
      handle.mode = 'static';
      return handle;
    }
    const extra = shapeKind === 'sphere' && o.bump ? await loadTexture(o.bump).catch(() => null) : null;
    if (disposed) return handle;
    api = mount(canvas, o, shapeKind, pic, extra, reduced, reduceMq);
    handle.mode = api ? 'webgl' : 'failed';
    return handle;
  })().catch((err) => {
    handle.mode = 'failed';
    throw err;
  });
  return handle;
}

/* ============================================
 * The renderer
 * ============================================ */
function mount(canvas, o, kind, pic, bumpTex, reduced, reduceMq) {
  const SPHERE = kind === 'sphere';
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return null;
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, o.dpr));
  renderer.setClearColor(0x000000, 0);
  const disposables = [];
  const own = (x) => (disposables.push(x), x);

  /* ---- geometry, albedo, simulation size ---- */
  let geometry, albedoTex, simSize, side = 2, aspect = 1, inside = null, sphereBumpTexel = 1 / 1024;
  if (SPHERE) {
    geometry = own(new THREE.SphereGeometry(1, 192, 192));
    albedoTex = own(new THREE.Texture(pic));
    albedoTex.wrapS = THREE.RepeatWrapping;           // u scrolls for the spin
    albedoTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    albedoTex.needsUpdate = true;
    simSize = MOON_SIM;
    if (bumpTex) {
      own(bumpTex);
      bumpTex.wrapS = THREE.RepeatWrapping;
      sphereBumpTexel = 1 / (bumpTex.image.naturalWidth || bumpTex.image.width || 1024);
    }
  } else {
    const shape = buildShape(pic, { matte: o.matte, corner: o.corner, threshold: o.threshold, puff: resolvePuff(o.puff) });
    if (!shape) return null;
    ({ side, aspect, inside } = shape);
    geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(shape.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(shape.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(shape.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(shape.index, 1));
    albedoTex = own(dataTex(shape.domain, shape.domainSize, THREE.RGBAFormat, THREE.ClampToEdgeWrapping, true));
    simSize = Math.min(512, Math.round(side / TEXEL));   // same world size per cell as the moon → same ripple feel
  }
  const grainTex = own(o.grain > 0 ? grainTexture() : dataTex(new Uint8Array([128]), 1, THREE.RedFormat));
  const flat = own(dataTex(new Uint8Array([128]), 1, THREE.RedFormat));

  /* ---- wave simulation: two half-float targets, read one, write the other ---- */
  const rtOpts = {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false,
  };
  let fboA = new THREE.WebGLRenderTarget(simSize, simSize, rtOpts);
  let fboB = new THREE.WebGLRenderTarget(simSize, simSize, rtOpts);
  const defines = SPHERE ? { SPHERE: '' } : {};
  const simMat = own(new THREE.RawShaderMaterial({
    defines,
    uniforms: {
      uPrev: { value: null }, uMask: { value: albedoTex },
      uSize: { value: new THREE.Vector2(simSize, simSize) },
      uMouse: { value: new THREE.Vector2(-10, -10) }, uMouseActive: { value: 0 },
      uPressDepth: { value: o.pressDepth }, uPressRadius: { value: 0 },
      uWaveSpeed: { value: o.waveSpeed }, uDamping: { value: o.damping },
    },
    vertexShader: SIM_VERT,
    fragmentShader: SIM_FRAG,
  }));
  const simScene = new THREE.Scene();
  const simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simQuad = own(new THREE.PlaneGeometry(2, 2));
  simScene.add(new THREE.Mesh(simQuad, simMat));

  /* ---- the object ---- */
  const U = {
    uSim: { value: null }, uAlbedo: { value: albedoTex }, uGrain: { value: grainTex },
    uSimSize: { value: new THREE.Vector2(simSize, simSize) },
    uSatinDir: { value: vec3(SATIN_LIGHT) }, uSunDir: { value: new THREE.Vector3() },
    uVolDir: { value: vec3(FILL_HOME) }, uTint: { value: new THREE.Vector3() },
    uRipple: { value: 0 }, uSatin: { value: 0 }, uFloor: { value: 0 }, uExposure: { value: 1 }, uGamma: { value: 1 },
    uVolume: { value: 0 }, uSheen: { value: 0 }, uSheenPow: { value: 1 }, uTintMix: { value: 0 }, uGrainAmt: { value: 0 },
    uDisplace: { value: o.displace },
    uBump: { value: bumpTex || flat }, uAngle: { value: o.angle || 0 }, uBumpTexel: { value: sphereBumpTexel }, uBumpStrength: { value: 0 },
  };
  const objMat = own(new THREE.RawShaderMaterial({
    defines, uniforms: U, vertexShader: OBJ_VERT, fragmentShader: OBJ_FRAG,
    transparent: !SPHERE, premultipliedAlpha: true,
  }));
  const mesh = new THREE.Mesh(geometry, objMat);
  const scene = new THREE.Scene();
  scene.add(mesh);

  let camera;
  if (SPHERE) {
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0, 0, 4.25);                  // the sphere fills ~91 %; the rest is room for ripple bulge
    mesh.rotation.y = -Math.PI / 2;                   // UV seam to the back
  } else {
    // orthographic: the outline is the picture's alpha pixel for pixel, and the UV under the pointer is the pointer
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    camera.position.set(0, 0, 5);
  }

  /* ---- options → uniforms (also used by setTheme / setPhase) ---- */
  function apply() {
    const sun = SPHERE && o.phase !== null && o.phase !== undefined ? sunFromPhase(o.phase) : o.light;
    U.uSunDir.value.copy(vec3(sun));
    U.uFloor.value = o.floor;
    U.uExposure.value = o.exposure;
    U.uGamma.value = o.gamma;
    U.uVolume.value = o.volume;
    U.uSheen.value = o.sheen;
    U.uSheenPow.value = o.sheenPower;
    U.uSatin.value = o.satin;
    U.uRipple.value = o.ripple;
    U.uDisplace.value = o.displace;
    U.uTintMix.value = o.albedo ? 1 : 0;
    if (o.albedo) U.uTint.value.fromArray(o.albedo);
    U.uGrainAmt.value = o.grain > 0 ? Math.min(1, o.grain) : 0;
    U.uBumpStrength.value = bumpTex ? o.bumpStrength : 0;
    simMat.uniforms.uWaveSpeed.value = o.waveSpeed;
    simMat.uniforms.uDamping.value = o.damping;
    simMat.uniforms.uPressRadius.value = SPHERE ? o.pressRadius : (o.pressRadius * MOON_SIM) / simSize;
    wake();
  }

  /* ---- pointer ---- */
  const ndc = new THREE.Vector2(-10, -10);
  const raycaster = new THREE.Raycaster();
  let pointerDown = false, hovering = false, lastMove = -1e9, lastHit = -1e9;
  const interactive = () => o.interactive && !reduced();
  const onMove = (e) => {
    if (!interactive()) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    lastMove = performance.now();
    wake();
  };
  const onDown = (e) => { pointerDown = true; onMove(e); };
  const onUp = () => { pointerDown = false; };
  const onLeave = () => { lastMove = -1e9; };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);   // a touch that turns into a scroll only sends cancel
  document.addEventListener('pointerleave', onLeave);

  function hitTest() {
    if (!interactive()) return null;
    if (SPHERE) {
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObject(mesh)[0]?.uv || null;
    }
    const u = (ndc.x * camera.right) / side + 0.5, v = (ndc.y * camera.top) / side + 0.5;
    return inside(u, v) ? new THREE.Vector2(u, v) : null;
  }

  /* ---- fill light: target = pointer direction; idle = home + slow sweep; chased by a critically damped spring ---- */
  const home = vec3(FILL_HOME);
  const target = home.clone(), vel = new THREE.Vector3(), tmp = new THREE.Vector3();
  const fill = U.uVolDir.value;

  /* ---- loop ---- */
  const clock = new THREE.Clock();
  let elapsed = 0, rafId = 0, timerId = 0, inView = true, dead = false;

  function tick() {
    rafId = 0;
    timerId = 0;
    if (dead) return;
    const now = performance.now();
    const dt = Math.min(clock.getDelta(), 0.033);
    elapsed += dt;
    const still = reduced();

    const uv = hitTest();
    if (!!uv !== hovering) { hovering = !!uv; o.onHover?.(hovering); }
    if (uv) { lastHit = now; simMat.uniforms.uMouse.value.copy(uv); }
    simMat.uniforms.uMouseActive.value = uv ? 1 : 0;
    simMat.uniforms.uPressDepth.value = pointerDown ? o.pressDepthHold : o.pressDepth;

    if (o.fillLight) {
      if (interactive() && now - lastMove < IDLE_LIGHT_MS) {
        const x = Math.max(-1.6, Math.min(1.6, ndc.x)), y = Math.max(-1.6, Math.min(1.6, ndc.y));
        target.set(x * 0.9, y * 0.9, 0.55).normalize();
      } else if (o.idleSweep && !still) {
        const a = elapsed * 0.22;   // ≈ 28 s per loop, a small orbit around home
        target.set(home.x + 0.32 * Math.cos(a), home.y + 0.18 * Math.sin(a), home.z).normalize();
      } else {
        target.copy(home);
      }
      const k = 60, c = 2 * Math.sqrt(k);   // critically damped spring
      tmp.copy(target).sub(fill);
      vel.addScaledVector(tmp, k * dt).addScaledVector(vel, -c * dt);
      fill.addScaledVector(vel, dt).normalize();
    }

    simMat.uniforms.uPrev.value = fboA.texture;
    renderer.setRenderTarget(fboB);
    renderer.render(simScene, simCam);
    renderer.setRenderTarget(null);
    [fboA, fboB] = [fboB, fboA];

    U.uSim.value = fboA.texture;
    if (SPHERE && o.spin && !still) U.uAngle.value += dt * o.spinSpeed;
    renderer.render(scene, camera);
    schedule(now, still);
  }

  // active (touched, held, touched in the last 8 s, pointer moved in the last 2.5 s, spring moving) → 60 fps;
  // idle → 12 fps if the sweep or spin still needs it, else stop. Off-screen → stop, keep the last frame
  function schedule(now, still) {
    if (dead || !inView) return;
    const active = hovering || pointerDown || now - lastHit < ACTIVE_MS || now - lastMove < IDLE_LIGHT_MS || vel.lengthSq() > 1e-5;
    if (active) { rafId = requestAnimationFrame(tick); return; }
    const idleWork = !still && ((o.fillLight && o.idleSweep) || (SPHERE && o.spin));
    if (idleWork) timerId = setTimeout(() => { timerId = 0; rafId = requestAnimationFrame(tick); }, 1000 / IDLE_FPS);
  }
  function wake() {
    if (dead || rafId || timerId) return;
    clock.getDelta();   // drop the time slept
    rafId = requestAnimationFrame(tick);
  }

  const io = new IntersectionObserver((es) => { inView = es[es.length - 1].isIntersecting; if (inView) wake(); });
  io.observe(canvas);
  const onVisible = () => { if (!document.hidden) wake(); };
  document.addEventListener('visibilitychange', onVisible);
  reduceMq?.addEventListener?.('change', wake);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const A = w / h;
    if (SPHERE) {
      camera.aspect = A;
      camera.position.z = 4.25 / Math.min(1, A);   // a portrait canvas backs off so the sphere still fits
    } else {
      // contain-fit: the silhouette (2 wide, 2·aspect tall) plus a margin of `fit`
      const halfH = Math.max(o.fit * aspect, o.fit / A);
      camera.left = -halfH * A; camera.right = halfH * A; camera.top = halfH; camera.bottom = -halfH;
    }
    camera.updateProjectionMatrix();
    wake();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  apply();
  resize();
  tick();

  return {
    apply,
    wake,
    dispose() {
      dead = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisible);
      reduceMq?.removeEventListener?.('change', wake);
      io.disconnect();
      ro.disconnect();
      [...disposables, fboA, fboB].forEach((r) => r.dispose());
      renderer.dispose();
    },
  };
}

export default silkify;
