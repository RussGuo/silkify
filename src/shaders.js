/**
 * shaders.js — the GLSL, and nothing else. core.js owns the pipeline (render targets, uniforms, the loop);
 * this file owns what runs on the GPU. One source serves both shapes: core.js compiles it with `#define SPHERE`
 * for the moon-style sphere and without it for an inflated picture.
 *
 *   SIM_VERT / SIM_FRAG   the wave solver: a full-screen quad over two half-float targets in ping-pong
 *                         (r = height, g = velocity), with the pointer's dent, up to four programmatic touches
 *                         (ripple(), autoplay) and the breeze's drifting noise mixed in
 *   OBJ_VERT / OBJ_FRAG   the object: height field → displacement and normals → albedo × Lommel–Seeliger ×
 *                         light colour → fill-light gradient → satin and sheen gated by ripple energy (or
 *                         silkRest), the sheen optionally anisotropic, iridescent, metallic (tinted by the body)
 *                         and streaked by a fixed thread relief (threads) → Fresnel rim
 *
 * The thread relief and the metallic tint only touch the silk layer (the sheen sees a perturbed normal Ns; the
 * matte photograph and the satin overlay keep N), so a material can read as foil at rest without the picture itself going noisy.
 *
 * Every uniform here is set by core.js (`apply()` for options, `tick()` for per-frame state). Each optional term
 * sits behind `if (uniform > 0.0)`, so with the defaults the output is bit-for-bit the classic look.
 */

export const SIM_VERT = /* glsl */ `
  precision highp float;
  attribute vec3 position; attribute vec2 uv;
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

export const SIM_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPrev, uMask;
  uniform vec2 uSize, uMouse;
  uniform float uMouseActive, uPressDepth, uPressRadius, uPressMix, uWaveSpeed, uDamping;
  uniform vec4 uTouch[4];          // programmatic touches (handle.ripple, autoplay): uv, depth, radius in uv units
  uniform float uTouchCount, uBreeze, uTime;
  varying vec2 vUv;

  // value noise for the breeze: smooth, cheap, no texture
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
  }

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
      data.r = mix(data.r, -uPressDepth, influence * uPressMix);
    }
    // the pointer and programmatic touches never share a slot: each one mixes its own dent in
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uTouchCount) break;
      float influence = smoothstep(uTouch[i].w, 0.0, distance(vUv, uTouch[i].xy));
      data.r = mix(data.r, -uTouch[i].z, influence * uPressMix);
    }
    // breeze: a slow, drifting noise field nudges the height; the wave equation turns it into soft swells
    if (uBreeze > 0.0) {
      vec2 q = vUv * 7.0;
      float n = vnoise(q + vec2(uTime * 0.23, uTime * 0.11)) + 0.5 * vnoise(q * 2.3 - vec2(uTime * 0.17, -uTime * 0.29));
      data.r += (n - 0.75) * uBreeze;
    }
  #ifndef SPHERE
    data.rg *= step(0.5, texture2D(uMask, vUv).a);   // zero outside: waves reflect at the outline, which never moves
  #endif
    gl_FragColor = data;
  }
`;

export const OBJ_VERT = /* glsl */ `
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

export const OBJ_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uSim, uAlbedo, uGrain;
  uniform vec2 uSimSize;
  uniform vec3 uSatinDir, uSunDir, uVolDir, uTint, uLightColor, uSheenColor, uRimColor;
  uniform vec2 uAnisoDir;          // (cos, sin) of the thread direction in the tangent plane
  uniform float uRipple, uSlope, uSatin, uFloor, uExposure, uGamma, uVolume, uSheen, uSheenPow, uTintMix, uGrainAmt, uGrainSize;
  uniform float uAnisotropy, uRim, uRimPower, uRimSelf, uIridescence, uSilkRest, uSilkSpread, uThreads, uMetallic;
#ifdef SPHERE
  uniform sampler2D uBump;
  uniform float uAngle, uBumpTexel, uBumpStrength;
#endif
  varying vec2 vUv; varying vec3 vViewPos; varying vec3 vViewNormal;

  float blendOverlay(float b, float s) { return b < 0.5 ? (2.0 * b * s) : (1.0 - 2.0 * (1.0 - b) * (1.0 - s)); }
  vec3 blendOverlay(vec3 b, vec3 s) { return vec3(blendOverlay(b.r, s.r), blendOverlay(b.g, s.g), blendOverlay(b.b, s.b)); }
  vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
  }

  void main() {
  #ifdef SPHERE
    vec2 auv = vec2(vUv.x + uAngle, vUv.y);
    vec4 base = vec4(texture2D(uAlbedo, auv).rgb, 1.0);
  #else
    vec4 base = texture2D(uAlbedo, vUv);      // rgb = the picture, a = its silhouette (antialiased)
    if (base.a < 0.004) discard;
  #endif

    // ---- ripple height field: slope (rescaled to reference cells) + energy; energy decides where silk appears ----
    vec4 data = texture2D(uSim, vUv);
    float hx = (texture2D(uSim, vec2(vUv.x + 1.0 / uSimSize.x, vUv.y)).r - data.r) * uSlope;
    float hy = (texture2D(uSim, vec2(vUv.x, vUv.y + 1.0 / uSimSize.y)).r - data.r) * uSlope;
    float silk = clamp((abs(data.r) * 5.0 + length(vec2(hx, hy)) * 26.0) * uSilkSpread, 0.0, 1.0);
    silk = max(silk, uSilkRest);                         // silkRest 1: silk everywhere, touched or not

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
    albedo *= mix(1.0, texture2D(uGrain, gl_FragCoord.xy / uGrainSize).r * 2.0, uGrainAmt);

    // ---- Lommel–Seeliger: back-scattering matte (regolith, velvet, ink); lit face nearly flat ----
    float shadow = smoothstep(-0.09, 0.03, muGeo);
    float mu0 = max(dot(N, uSunDir), 0.0) * shadow;
    float mu = max(dot(geoN, viewDir), 0.0);
    float lunar = clamp(2.0 * mu0 / max(mu0 + mu, DEN), 0.0, 1.0);
    float dayT = smoothstep(-0.05, 0.06, muGeo);
    float lum = lunar + uFloor * (1.0 - lunar);           // floor, not a gate: no black groove at the terminator
    vec3 col = albedo * lum * uExposure * uLightColor;
    col *= mix(1.0 - uVolume, 1.0, smoothstep(-1.0, 1.0, dot(geoN, uVolDir)));

    // ---- silk only where touched, and only on the lit side ----
    float silkLit = silk * dayT;
    float satin = mix(0.5, max(dot(N, uSatinDir), 0.0), 0.45);
    col = mix(col, blendOverlay(col, vec3(satin)), silkLit * uSatin);
    // the thread direction in view space. Image: the tangent plane is xy. Sphere: the texture's u direction,
    // (n.z, 0, −n.x) for a sphere about the view-space y axis
  #ifdef SPHERE
    vec3 tu = normalize(vec3(geoN.z, 0.0, -geoN.x) + vec3(1e-4, 0.0, 0.0));
    vec3 t0 = tu * uAnisoDir.x + cross(geoN, tu) * uAnisoDir.y;
    vec2 tuv = vec2(auv.x * 2.0, auv.y);                 // the map is 2:1, so its threads are square on the sphere
  #else
    vec3 t0 = vec3(uAnisoDir, 0.0);
    vec2 tuv = vUv;
  #endif
    // the normal the silk layer sees; threads give it a fixed relief of fine striations running along the
    // thread direction, so the highlight breaks into streaks along them even where nothing ripples (brushed foil)
    vec3 Ns = N;
    if (uThreads > 0.0) {
      vec2 st = vec2(dot(tuv, vec2(-uAnisoDir.y, uAnisoDir.x)) * 300.0, dot(tuv, uAnisoDir) * 10.0);
      float n0 = vnoise(st) + 0.5 * vnoise(st * vec2(2.7, 1.9) + 17.0);
      float n1 = vnoise(st + vec2(0.35, 0.0)) + 0.5 * vnoise((st + vec2(0.35, 0.0)) * vec2(2.7, 1.9) + 17.0);
      Ns = normalize(N + cross(geoN, t0) * (n1 - n0) * 1.8 * uThreads);
    }
    float spec = pow(max(dot(viewDir, reflect(-uSatinDir, Ns)), 0.0), uSheenPow);
    if (uAnisotropy > 0.0) {
      // Kajiya–Kay: the highlight stretches across the threads
      vec3 T = normalize(t0 - Ns * dot(Ns, t0) + vec3(0.0, 0.0, 1e-5));
      float th = dot(T, normalize(uSatinDir + viewDir));
      spec = mix(spec, pow(sqrt(max(1.0 - th * th, 0.0)), uSheenPow), uAnisotropy);
    }
    vec3 sheenColor = uSheenColor;
    if (uIridescence > 0.0) {
      // the highlight's hue turns with the viewing angle and the ripple height, like shot silk
      float nv = max(dot(Ns, viewDir), 0.0);
      sheenColor = mix(sheenColor, 0.35 + 0.65 * hue(0.55 + 1.3 * (1.0 - nv) + 2.5 * data.r), uIridescence);
    }
    if (uMetallic > 0.0) {
      // metal: the highlight takes the body's own hue, and the silk part of the body gives up its diffuse light
      vec3 own = albedo / max(max(albedo.r, max(albedo.g, albedo.b)), 0.04);
      sheenColor = mix(sheenColor, sheenColor * own, uMetallic);
      col *= 1.0 - 0.55 * uMetallic * silkLit;
    }
    col += uSheen * spec * silkLit * sheenColor;
    if (uRim > 0.0) {
      // Fresnel edge: a coloured light (rimColor), or the picture's own colour lifted, like the pile of velvet
      vec3 rimColor = mix(uRimColor, min(albedo * 1.8 + 0.08, 1.0), uRimSelf);
      col += uRim * pow(1.0 - max(dot(N, viewDir), 0.0), uRimPower) * rimColor;
    }

    gl_FragColor = vec4(col * base.a, base.a);            // premultiplied
  }
`;
