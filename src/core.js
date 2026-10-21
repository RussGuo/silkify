/**
 * core.js — the renderer, with no DOM. It runs inside a Web Worker on an OffscreenCanvas (the default), or on
 * the main thread when workers cannot render. three.js is passed in, not imported, so the same code works with
 * a worker that loads three from a URL and with a page that has an import map or a bundler.
 *
 * Pipeline: ping-pong wave simulation → displacement + normals → albedo × Lommel–Seeliger → satin and sheen
 * gated by ripple energy → fill-light gradient. The GLSL lives in shaders.js; this file owns the render targets,
 * the uniforms and the loop. See silk.js for the overview and SKILL.md for every option.
 *
 * Sleeping (all times from the last touch of the object):
 *   active  touched, held, touched < 8 s ago, pointer moved < 2.5 s ago, or the fill light still travelling
 *           (judged by distance to its target, not speed: the idle sweep never has zero speed) → every frame
 *   tail    ripples left 8–20 s after the last touch → 12 fps, with the missed solver steps caught up, then cleared
 *   sweep   high tier only: the idle light sweep (and a sphere's spin) for one loop, ≈ 28.6 s, at 12 fps
 *   breeze  `breeze` > 0: the solver keeps stirring → 30 fps while visible (off by default)
 *   rest    nothing → no frames at all; with `autoplay`, one timer for the next drop
 * Programmatic touches (`ripple()`, `autoplay`) count as touches for these rules but never as hovering.
 * Off-screen or hidden tab → stopped. A lifted touch or a pointer that left the window stops counting as hovering.
 * If full-speed frames average > 28 ms, the device-pixel ratio steps down 2 → 1.5 → 1.
 */
import { loadBitmap, buildShape, PUFF } from './shape.js';
import { gridFor } from './tier.js';
import { SIM_VERT, SIM_FRAG, OBJ_VERT, OBJ_FRAG } from './shaders.js';

/* ============================================
 * Constants
 * ============================================ */
const MOON_SIM = 256;               // the moon's simulation grid; one cell = π / 256 world units (the reference)
const TEXEL = Math.PI / MOON_SIM;
const PRESS_MIX = 0.35;             // per step, how far the pressed cells move towards the dent depth
const FILL_HOME = [-0.55, 0.6, 0.58];
const IDLE_LIGHT_MS = 2500;
const RIPPLE_MS = 8000;
const TAIL_MS = 20000;              // by now ripples are ≈ 1 % of their height: clear and stop solving
const IDLE_FPS = 12;
const BREEZE_FPS = 30;
const BREEZE_GAIN = 0.025;          // height nudged per reference step at breeze 1
const TOUCH_MAX = 4;                // programmatic touches held at once (uTouch[4] in SIM_FRAG)
const FIRST_DROP_MS = 800;          // autoplay: the first drop comes soon after the object appears
const SWEEP_RATE = 0.22;            // rad/s → one loop ≈ 28.6 s
const SWEEP_TURN = (2 * Math.PI) / SWEEP_RATE;
const SLOW_FRAME_MS = 28;
const SPHERE_Z = 4.25;
const SPHERE_HALF_FOV = Math.PI / 12; // 30° vertical field of view

/* ============================================
 * Helpers
 * ============================================ */
const hasRaf = typeof requestAnimationFrame === 'function';
const nextFrame = (cb) => (hasRaf ? requestAnimationFrame(cb) : setTimeout(cb, 16));
const cancelFrame = (id) => (hasRaf ? cancelAnimationFrame(id) : clearTimeout(id));
const resolvePuff = (p) => (typeof p === 'string' ? PUFF[p] ?? 1 : p);

function sunFromPhase(f) {
  const t = Math.PI * 2 * f;
  return [Math.sin(t), 0, -Math.cos(t)];
}

/**
 * WebGL2 only (three would quietly fall back to WebGL1). No MSAA, no depth or stencil buffer: the triangles never
 * overlap on screen and the outline is cut per pixel by the alpha, so they would add nothing to the picture while
 * costing (at ratio 2) tens of MB of GPU memory and 4× the write bandwidth. `software` = SwiftShader, llvmpipe…
 */
export function openRenderer(THREE, canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
  } catch {
    return null;
  }
  const gl = renderer.getContext();
  const ok = renderer.capabilities.isWebGL2 && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  if (!ok) {
    renderer.dispose();
    return null;
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  return { renderer, software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) };
}

function grainTexture(THREE, size) {
  const data = new Uint8Array(size * size);
  let s = 0x2f6b1d3;   // deterministic seed: the same grain on every load
  for (let i = 0; i < data.length; i++) {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const n = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    data[i] = Math.round(((0.865 + 0.405 * n * n) / 2) * 255);   // sparse bright specks, mean ≈ 1 (stored halved)
  }
  return dataTex(THREE, data, size, THREE.RedFormat, THREE.RepeatWrapping);
}

function dataTex(THREE, data, size, format, wrap = THREE.ClampToEdgeWrapping, mips = false) {
  const t = new THREE.DataTexture(data, size, size, format, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = wrap;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips;
  t.needsUpdate = true;
  return t;
}

function bitmapTex(THREE, bitmap, wrapS) {
  const t = new THREE.Texture(bitmap);
  t.flipY = false;   // bitmaps arrive already flipped (createImageBitmap's imageOrientation): flipY does not apply to them
  t.wrapS = wrapS;
  t.needsUpdate = true;
  return t;
}

/* ============================================
 * createSilk(THREE, canvas, assets, o, tier, init) → controller
 *   assets: { picture: ImageBitmap (sphere: flipped), bump?: ImageBitmap (flipped) }
 *   o:      the merged options (plain data)
 *   tier:   TIERS.high | TIERS.low (tier.js)
 *   init:   { view: { w, h, dpr }, visible, still, onFirstFrame?, onHover? }
 * ============================================ */
export function createSilk(THREE, opened, assets, o, tier, init) {
  const { renderer } = opened;
  const SPHERE = o.shape === 'sphere';
  renderer.setClearColor(0x000000, 0);
  const disposables = [];
  const own = (x) => (disposables.push(x), x);

  let view = init.view, visible = init.visible, still = init.still;
  let ratioCap = Math.min(tier.dprCap, o.dpr ?? Infinity);

  /* ---- geometry and the simulation grid, sized to the object on screen ---- */
  let geometry, albedoTex, side = 2, aspect = 1, inside = null, SIM_REF, grid, bumpTexel = 1 / 1024;
  if (SPHERE) {
    SIM_REF = MOON_SIM;
    const radiusCss = (view.h / 2) / (SPHERE_Z * Math.tan(SPHERE_HALF_FOV));   // sphere radius on screen (CSS px)
    grid = gridFor(tier, SIM_REF, Math.PI * radiusCss);
    const seg = Math.max(48, Math.min(tier.sphereSegments, Math.round((2 * Math.PI * radiusCss) / 2.8)));
    geometry = own(new THREE.SphereGeometry(1, seg, seg));
    albedoTex = own(bitmapTex(THREE, assets.picture, THREE.RepeatWrapping));
    albedoTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    grid.mesh = seg;
  } else {
    const A = view.w / view.h;
    const shape = buildShape(assets.picture, {
      matte: o.matte, corner: o.corner, threshold: o.threshold, puff: resolvePuff(o.puff),
      meshFor: (s, asp) => {
        const pxPerUnit = view.h / (2 * Math.max(o.fit * asp, o.fit / A));
        grid = gridFor(tier, Math.min(512, Math.round(s / TEXEL)), s * pxPerUnit);
        grid.domainPx = s * pxPerUnit * Math.min(view.dpr || 1, ratioCap);   // the domain's size in device pixels
        return grid.mesh;
      },
      domainFor: () => grid.domainPx,
    });
    if (!shape) return null;
    ({ side, aspect, inside } = shape);
    SIM_REF = Math.min(512, Math.round(side / TEXEL));
    geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(shape.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(shape.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(shape.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(shape.index, 1));
    albedoTex = own(dataTex(THREE, shape.domain, shape.domainSize, THREE.RGBAFormat, THREE.ClampToEdgeWrapping, true));
    grid.domain = shape.domainSize;
  }
  let bumpTex = null;
  if (SPHERE && assets.bump) {
    bumpTex = own(bitmapTex(THREE, assets.bump, THREE.RepeatWrapping));
    bumpTexel = 1 / (assets.bump.width || 1024);
  }
  const flat = own(dataTex(THREE, new Uint8Array([128]), 1, THREE.RedFormat));   // neutral grain, no bump
  let grainTex = null;                                                             // made on first grain > 0

  /* ---- wave simulation, possibly coarser than the reference grid ----
   * cells r = SIM_REF / SIM times larger → STEPS sub-steps per frame, wave speed × (r / STEPS)² (a discrete
   * wave moves ≈ √(c/4) cells per step, stable for c < 2), damping and press spread over the sub-steps, slopes
   * × 1/r back to reference cells. Dents and waves keep their size, speed and decay on the object; identity at r = 1 */
  const SIM = Math.min(grid.sim, SIM_REF);
  const ratio = SIM_REF / SIM;
  const STEPS = ratio <= 1.1 ? 1 : Math.ceil(ratio);
  const rtOpts = {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: SPHERE ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false,
  };
  let fboA = new THREE.WebGLRenderTarget(SIM, SIM, rtOpts);
  let fboB = new THREE.WebGLRenderTarget(SIM, SIM, rtOpts);
  const defines = SPHERE ? { SPHERE: '' } : {};
  const simMat = own(new THREE.RawShaderMaterial({
    defines,
    uniforms: {
      uPrev: { value: null }, uMask: { value: albedoTex },
      uSize: { value: new THREE.Vector2(SIM, SIM) },
      uMouse: { value: new THREE.Vector2(-10, -10) }, uMouseActive: { value: 0 },
      uPressDepth: { value: o.pressDepth }, uPressRadius: { value: 0 }, uPressMix: { value: 1 - (1 - PRESS_MIX) ** (1 / STEPS) },
      uWaveSpeed: { value: 0 }, uDamping: { value: 0 },
      uTouch: { value: Array.from({ length: TOUCH_MAX }, () => new THREE.Vector4()) }, uTouchCount: { value: 0 },
      uBreeze: { value: 0 }, uTime: { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_FRAG, depthTest: false, depthWrite: false,
  }));
  const simScene = new THREE.Scene();
  const simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simQuad = own(new THREE.PlaneGeometry(2, 2));
  simScene.add(new THREE.Mesh(simQuad, simMat));

  /* ---- the object ---- */
  const vec3 = (a) => new THREE.Vector3().fromArray(a).normalize();
  const U = {
    uSim: { value: null }, uAlbedo: { value: albedoTex }, uGrain: { value: flat }, uGrainSize: { value: 1 },
    uSimSize: { value: new THREE.Vector2(SIM, SIM) }, uSlope: { value: SIM / SIM_REF },
    uSatinDir: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3() },
    uVolDir: { value: vec3(FILL_HOME) }, uTint: { value: new THREE.Vector3() },
    uRipple: { value: 0 }, uSatin: { value: 0 }, uFloor: { value: 0 }, uExposure: { value: 1 }, uGamma: { value: 1 },
    uVolume: { value: 0 }, uSheen: { value: 0 }, uSheenPow: { value: 1 }, uTintMix: { value: 0 }, uGrainAmt: { value: 0 },
    uDisplace: { value: o.displace },
    uLightColor: { value: new THREE.Vector3(1, 1, 1) }, uSheenColor: { value: new THREE.Vector3() }, uRimColor: { value: new THREE.Vector3() },
    uAnisoDir: { value: new THREE.Vector2(1, 0) }, uAnisotropy: { value: 0 }, uRim: { value: 0 }, uRimPower: { value: 3 }, uRimSelf: { value: 0 },
    uIridescence: { value: 0 }, uSilkRest: { value: 0 }, uSilkSpread: { value: 1 }, uThreads: { value: 0 }, uMetallic: { value: 0 },
    uBump: { value: bumpTex || flat }, uAngle: { value: o.angle || 0 }, uBumpTexel: { value: bumpTexel }, uBumpStrength: { value: 0 },
  };
  const objMat = own(new THREE.RawShaderMaterial({
    defines, uniforms: U, vertexShader: OBJ_VERT, fragmentShader: OBJ_FRAG,
    transparent: !SPHERE, premultipliedAlpha: true, depthTest: false, depthWrite: false,
  }));
  const mesh = new THREE.Mesh(geometry, objMat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);

  let camera;
  if (SPHERE) {
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0, 0, SPHERE_Z);
    mesh.rotation.y = -Math.PI / 2;                   // UV seam to the back
  } else {
    // orthographic: the outline is the picture's alpha pixel for pixel, and the UV under the pointer is the pointer
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    camera.position.set(0, 0, 5);
  }

  /* ---- options → uniforms ---- */
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
    U.uGrainAmt.value = o.grain > 0 ? Math.min(2, o.grain) : 0;        // above 1 the specks only gain contrast
    if (o.grain > 0 && !grainTex) {
      grainTex = own(grainTexture(THREE, tier.grain));
      U.uGrain.value = grainTex;
    }
    if (grainTex) U.uGrainSize.value = tier.grain * Math.max(1, o.grainScale);   // grainScale device px per speck
    U.uLightColor.value.fromArray(o.lightColor);
    U.uSheenColor.value.fromArray(o.sheenColor);
    U.uSatinDir.value.copy(vec3(o.satinLight));
    U.uAnisotropy.value = o.anisotropy;
    U.uAnisoDir.value.set(Math.cos(o.anisotropyAngle), Math.sin(o.anisotropyAngle));
    U.uRim.value = o.rim;
    U.uRimPower.value = o.rimPower;
    U.uRimSelf.value = o.rimColor ? 0 : 1;                // null: the picture's own colour
    if (o.rimColor) U.uRimColor.value.fromArray(o.rimColor);
    U.uIridescence.value = o.iridescence;
    U.uSilkRest.value = o.silkRest;
    U.uSilkSpread.value = o.silkSpread;
    U.uThreads.value = o.threads;
    U.uMetallic.value = o.metallic;
    U.uBumpStrength.value = bumpTex ? o.bumpStrength : 0;
    const su = simMat.uniforms;
    su.uWaveSpeed.value = o.waveSpeed * (ratio / STEPS) ** 2;
    su.uDamping.value = o.damping ** (1 / STEPS);
    su.uPressRadius.value = toUv(o.pressRadius);
  }
  const toUv = (radius) => (SPHERE ? radius : (radius * MOON_SIM) / SIM_REF);   // pressRadius is in the moon's uv units

  /* ---- pointer and fill light ---- */
  const ndc = new THREE.Vector2(-10, -10);
  const raycaster = new THREE.Raycaster();
  let pointerDown = false, hovering = false, lifted = true, lastMove = -1e9, lastHit = -1e9;
  const home = vec3(FILL_HOME);
  const target = home.clone(), vel = new THREE.Vector3(), tmp = new THREE.Vector3();
  const fill = U.uVolDir.value;
  let sweepUsed = 0;
  const interactive = () => o.interactive && !still;

  /** The uv on the object under a point in normalised device coordinates, or null. */
  function uvAt(p) {
    if (SPHERE) {
      raycaster.setFromCamera(p, camera);
      return raycaster.intersectObject(mesh)[0]?.uv || null;
    }
    const u = (p.x * camera.right) / side + 0.5, v = (p.y * camera.top) / side + 0.5;
    return inside(u, v) ? new THREE.Vector2(u, v) : null;
  }
  const hitTest = () => (!interactive() || lifted ? null : uvAt(ndc));

  /* ---- programmatic touches (handle.ripple, autoplay): their own dents, never the pointer's, never hovering ---- */
  const touches = [];   // { uv, depth, radius (uv units), left: 60 fps frames still to press }
  let nextDrop = 0;     // autoplay: when the next drop falls (0 = off)
  const autoplay = () => (o.autoplay && !still ? { interval: 2500, depth: 0.3, ...(o.autoplay === true ? {} : o.autoplay) } : null);
  const breezing = () => o.breeze > 0 && !still;

  function addTouch(uv, { depth = o.pressDepth, radius = o.pressRadius, hold = 120 } = {}) {
    if (touches.length >= TOUCH_MAX) touches.shift();
    // the hold is counted in solver frames, not wall time, so a slow device presses as deep as a fast one
    touches.push({ uv, depth, radius: toUv(radius), left: Math.max(1, Math.round(hold / (1000 / 60))) });
  }
  /** One drop at a random point well inside the outline (a sphere: its visible face). */
  function drop(a) {
    for (let k = 0; k < 32; k++) {
      let uv = null;
      if (SPHERE) {
        const r = 0.6 * Math.sqrt(Math.random()), t = Math.random() * 2 * Math.PI;
        uv = uvAt(new THREE.Vector2(r * Math.cos(t), r * Math.sin(t)));
      } else {
        const u = 0.1 + 0.8 * Math.random(), v = 0.1 + 0.8 * Math.random(), m = 0.04;
        if (inside(u, v) && inside(u - m, v) && inside(u + m, v) && inside(u, v - m) && inside(u, v + m)) uv = new THREE.Vector2(u, v);
      }
      if (uv) return addTouch(uv, { depth: a.depth, radius: a.radius });
    }
  }

  /* ---- loop ---- */
  let elapsed = 0, frameId = 0, timerId = 0, lastTick = 0, dead = false, drawn = false;
  let simDirty = false, frameMs = 1000 / 60, slowRun = 0, slowSum = 0, lastStir = -1e9, drawCount = 0;
  const sweeping = () => tier.idleSweep && o.idleSweep && !still && sweepUsed < SWEEP_TURN;
  const chasing = () => tmp.copy(target).sub(fill).lengthSq() > 0.0016 || vel.lengthSq() > 0.02;
  function modeAt(now) {
    if (hovering || pointerDown || touches.length || now - lastHit < RIPPLE_MS || (interactive() && now - lastMove < IDLE_LIGHT_MS) || (o.fillLight && chasing())) return 'active';
    if (breezing()) return 'breeze';
    if (simDirty && now - lastStir < TAIL_MS) return 'tail';
    return sweeping() ? 'sweep' : 'rest';
  }

  function stepSim(n) {
    for (let s = 0; s < n; s++) {
      simMat.uniforms.uPrev.value = fboA.texture;
      renderer.setRenderTarget(fboB);
      renderer.render(simScene, simCam);
      [fboA, fboB] = [fboB, fboA];
    }
    renderer.setRenderTarget(null);
  }
  function clearSim() {
    for (const f of [fboA, fboB]) {
      renderer.setRenderTarget(f);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(null);
  }

  function tick() {
    frameId = 0;
    timerId = 0;
    if (dead) return;
    const now = performance.now();
    const raw = lastTick ? (now - lastTick) / 1000 : 0;
    lastTick = now;

    // autoplay: a drop every `interval` ms while visible, skipped while someone is touching the object
    const a = autoplay();
    if (!a) nextDrop = 0;
    else if (!nextDrop) nextDrop = now + Math.min(a.interval, FIRST_DROP_MS);
    else if (now >= nextDrop) {
      if (!hovering && !pointerDown && !(interactive() && now - lastMove < IDLE_LIGHT_MS)) drop(a);
      nextDrop = now + a.interval;
    }

    const su = simMat.uniforms;
    const uv = hitTest();
    if (!!uv !== hovering) { hovering = !!uv; init.onHover?.(hovering); }
    if (uv) { lastHit = lastStir = now; simDirty = true; su.uMouse.value.copy(uv); }
    su.uMouseActive.value = uv ? 1 : 0;
    su.uPressDepth.value = pointerDown ? o.pressDepthHold : o.pressDepth;
    touches.forEach((t, i) => su.uTouch.value[i].set(t.uv.x, t.uv.y, t.depth, t.radius));
    su.uTouchCount.value = touches.length;
    if (touches.length) { lastHit = lastStir = now; simDirty = true; }
    const breeze = breezing();
    su.uBreeze.value = breeze ? (o.breeze * BREEZE_GAIN) / STEPS : 0;
    if (breeze) { lastStir = now; simDirty = true; }

    const mode = modeAt(now);
    const active = mode === 'active';
    const dt = Math.min(raw, active ? 0.033 : 0.25);
    elapsed += dt;

    // the GPU cannot keep up → step the pixel ratio down (2 → 1.5 → 1)
    if (active && raw > 0 && raw < 0.1) {
      frameMs += (raw * 1000 - frameMs) * 0.1;
      slowSum += raw * 1000;
      if (++slowRun >= 30) {
        if (slowSum / slowRun > SLOW_FRAME_MS && ratioCap > 1) { ratioCap = Math.max(1, ratioCap - 0.5); applyView(); }
        slowRun = slowSum = 0;
      }
    } else if (!active) {
      slowRun = slowSum = 0;
    }

    // fill light: the pointer's direction; idle → home plus a slow loop; chased by a critically damped spring
    if (o.fillLight) {
      if (interactive() && now - lastMove < IDLE_LIGHT_MS) {
        const x = Math.max(-1.6, Math.min(1.6, ndc.x)), y = Math.max(-1.6, Math.min(1.6, ndc.y));
        target.set(x * 0.9, y * 0.9, 0.55).normalize();
      } else if (sweeping()) {
        const a = elapsed * SWEEP_RATE;
        target.set(home.x + 0.32 * Math.cos(a), home.y + 0.18 * Math.sin(a), home.z).normalize();
        sweepUsed += dt;
      } else if (!tier.idleSweep || !o.idleSweep || still) {
        target.copy(home);
      } // after one loop the target simply stays where it is
      const k = 60, c = 2 * Math.sqrt(k);
      const sub = Math.max(1, Math.ceil(dt * 60 - 0.01)), h = dt / sub;   // idle frames span 1/12 s: integrate at 1/60
      for (let i = 0; i < sub; i++) {
        tmp.copy(target).sub(fill);
        vel.addScaledVector(tmp, k * h).addScaledVector(vel, -c * h);
        fill.addScaledVector(vel, h).normalize();
      }
    }

    // waves: one frame's worth of steps while active; in the tail, catch up the steps missed between 12 fps frames
    su.uTime.value = elapsed;
    if (hovering || touches.length || breeze || (simDirty && now - lastStir < TAIL_MS)) {
      const frames = active ? 1 : Math.min(12, Math.max(1, Math.round((raw * 1000) / frameMs)));
      stepSim(frames * STEPS);
      for (let i = touches.length - 1; i >= 0; i--) if ((touches[i].left -= frames) <= 0) touches.splice(i, 1);
    } else if (simDirty) {
      clearSim();
      simDirty = false;
    }

    U.uSim.value = fboA.texture;
    if (SPHERE && o.spin && !still && (active || mode === 'sweep')) U.uAngle.value += dt * o.spinSpeed;
    renderer.render(scene, camera);
    drawCount++;
    if (!drawn) { drawn = true; init.onFirstFrame?.(); }
    schedule(now);
  }

  function schedule(now) {
    if (dead || !visible || frameId || timerId) return;
    const mode = modeAt(now);
    if (mode === 'active') frameId = nextFrame(tick);
    else if (mode !== 'rest') timerId = setTimeout(later, 1000 / (mode === 'breeze' ? BREEZE_FPS : IDLE_FPS));
    else if (nextDrop) timerId = setTimeout(later, Math.max(0, nextDrop - now));   // autoplay: wait for the next drop
  }
  function later() { timerId = 0; frameId = nextFrame(tick); }
  function wake() {
    if (dead || !visible || frameId) return;
    if (timerId) { clearTimeout(timerId); timerId = 0; }
    lastTick = performance.now();
    frameId = nextFrame(tick);
  }
  function halt() {
    if (frameId) cancelFrame(frameId);
    if (timerId) clearTimeout(timerId);
    frameId = timerId = 0;
  }

  function applyView() {
    const { w, h } = view;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(view.dpr || 1, ratioCap));
    renderer.setSize(w, h, false);
    const A = w / h;
    if (SPHERE) {
      camera.aspect = A;
      camera.position.z = SPHERE_Z / Math.min(1, A);
    } else {
      const halfH = Math.max(o.fit * aspect, o.fit / A);
      camera.left = -halfH * A; camera.right = halfH * A; camera.top = halfH; camera.bottom = -halfH;
    }
    camera.updateProjectionMatrix();
    wake();
  }

  apply();
  applyView();
  halt();
  tick();   // the first frame, synchronously: textures are uploaded (the caller may then close its bitmaps) and
            // the canvas is never empty, even when it is not visible yet

  return {
    info: { sim: SIM, steps: STEPS, mesh: grid.mesh, texture: SPHERE ? assets.picture.width : grid.domain, ratioCap },
    pointer(x, y) {
      if (!interactive()) return;
      ndc.set(x, y);
      lifted = false;
      lastMove = performance.now();
      sweepUsed = 0;
      wake();
    },
    press(down) { pointerDown = down && interactive(); wake(); },
    lift() { lifted = true; pointerDown = false; wake(); },
    resize(v) { view = v; applyView(); },
    setVisible(v) { visible = v; if (v) wake(); else halt(); },
    setStill(s) {
      still = s;
      if (still) { lifted = true; pointerDown = false; touches.length = 0; }
      wake();
    },
    setOptions(patch) { Object.assign(o, patch); apply(); wake(); },
    /** A programmatic touch at canvas coordinates (0–1, top-left origin). False if it misses the object. */
    touch(x, y, opts) {
      if (still || dead) return false;
      const uv = uvAt(new THREE.Vector2(x * 2 - 1, 1 - y * 2));
      if (uv) { addTouch(uv, opts); wake(); }
      return !!uv;
    },
    stats: () => ({ frames: drawCount, mode: modeAt(performance.now()) }),
    wake,
    dispose() {
      dead = true;
      halt();
      [...disposables, fboA, fboB].forEach((r) => r.dispose());
      renderer.dispose();
    },
  };
}

/* ============================================
 * serve(post, loadThree) — the message endpoint. The worker wires it to postMessage; the main-thread
 * fallback calls it directly. Messages in: init, pointer, press, lift, touch, view, visible, still, options, wake,
 * stats, dispose. Messages out: ready { tier, sim, steps, mesh, software }, hover { on }, stats { frames, mode },
 * fail { reason, fatal, svg }. `fatal` means another thread would fail the same way (the picture cannot be
 * loaded or decoded, or nothing in it is opaque); `svg` means the picture is an SVG the page must rasterise.
 * ============================================ */
export function serve(post, loadThree) {
  let silk = null, dead = false;
  // messages that arrive before the scene exists: the newest view / visibility / stillness, every option patch
  // merged in order, and every programmatic touch, replayed once the scene is up
  const latest = { options: {}, touches: [] };

  async function init(m) {
    Object.assign(latest, { view: m.view, visible: m.visible, still: m.still });
    latest.touches.unshift(...(m.touches || []));
    const THREE = await loadThree(m.threeUrl);
    const opened = openRenderer(THREE, m.canvas);
    if (!opened) return post({ t: 'fail', reason: 'no WebGL2 with renderable half floats' });
    // a software rasteriser cannot afford the high tier, unless the caller forced it
    const tier = opened.software && m.tier.tier === 'high' && !m.forced ? m.lowTier : m.tier;
    const sphere = m.options.shape === 'sphere';
    let picture, bump;
    try {
      [picture, bump] = await Promise.all([
        loadBitmap(m.picture, { flipY: sphere }),
        sphere && m.bump ? loadBitmap(m.bump, { flipY: true }).catch(() => null) : null,
      ]);
    } catch (e) {
      opened.renderer.dispose();
      return post({ t: 'fail', reason: e.svg ? 'svg' : `could not load the picture (${e?.message || e})`, fatal: !e.svg, svg: !!e.svg });
    }
    if (dead) return opened.renderer.dispose();
    silk = createSilk(THREE, opened, { picture, bump }, { ...m.options, ...latest.options }, tier, {
      view: latest.view, visible: latest.visible, still: latest.still,
      onHover: (on) => post({ t: 'hover', on }),
    });
    picture.close?.();
    bump?.close?.();
    if (!silk) {
      opened.renderer.dispose();
      return post({ t: 'fail', reason: `the picture has nothing opaque in it (no pixel above threshold ${m.options.threshold}): use a PNG whose subject is visible`, fatal: true });
    }
    for (const t of latest.touches.splice(0)) silk.touch(t.x, t.y, t);
    post({ t: 'ready', tier: tier.tier, software: opened.software, ...silk.info });   // the first frame is already drawn
  }

  return (m) => {
    switch (m.t) {
      case 'init': init(m).catch((e) => post({ t: 'fail', reason: String(e?.message || e) })); break;
      case 'pointer': silk?.pointer(m.x, m.y); break;
      case 'press': silk?.press(m.down); break;
      case 'lift': silk?.lift(); break;
      case 'touch': if (silk) silk.touch(m.x, m.y, m); else latest.touches.push(m); break;
      case 'stats': post({ t: 'stats', id: m.id, ...(silk ? silk.stats() : { frames: 0, mode: 'loading' }) }); break;
      case 'view': latest.view = m.view; silk?.resize(m.view); break;
      case 'visible': latest.visible = m.visible; silk?.setVisible(m.visible); break;
      case 'still': latest.still = m.still; silk?.setStill(m.still); break;
      case 'options': if (silk) silk.setOptions(m.patch); else Object.assign(latest.options, m.patch); break;
      case 'wake': silk?.wake(); break;
      case 'dispose': dead = true; silk?.dispose(); silk = null; break;
    }
  };
}
