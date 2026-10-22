// GLSL of the mesh overlays (research 13 §7.1). Three programs: the surface (per-corner layout with a `state` byte,
// palette colours and the soft-selection ramp), instanced screen-space lines with a halo (edges, normals, triangulation,
// the symmetry plane outline), and point glyphs with a halo (vertices, face dots, Mesh Check markers). State bits are
// `STATE` (style.ts); colours are linear-light uniforms from the theme, output through three's colour-space chunk.
import { LIGHT_RIG, STATE } from '../style';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);
const v3 = (v: readonly number[]): string => `vec3(${v.map(f).join(', ')})`;

const BITS = `
const int HIDDEN = ${STATE.hidden};
const int SELECTED = ${STATE.selected};
const int MIRRORED = ${STATE.mirrored};
const int HOVER = ${STATE.hover};
const int HARD = ${STATE.hard};
const int ALT = ${STATE.alt};
bool has(int s, int b) { return (s & b) != 0; }
`;

const SOFT_RAMP = `
uniform vec3 uSoft[4];
vec3 softRamp(float w) {
  // Full weight = --soft-1 (yellow) … no weight = --soft-4 (dark), Maya's ramp.
  float x = clamp(1.0 - w, 0.0, 1.0) * 3.0;
  if (x < 1.0) return mix(uSoft[0], uSoft[1], x);
  if (x < 2.0) return mix(uSoft[1], uSoft[2], x - 1.0);
  return mix(uSoft[2], uSoft[3], x - 2.0);
}
`;

export const SURFACE_VERTEX = `
attribute vec3 paint;
attribute vec4 shade;
attribute float state;
attribute float soft;
attribute vec2 mapUv;
attribute float mapped;
attribute vec3 mapTint;
varying vec2 vMapUv;
varying float vMapped;
varying vec3 vMapTint;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec3 vPaint;
varying vec4 vShade;
varying float vState;
varying float vSoft;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = view.xyz;
  vPaint = paint;
  vMapUv = mapUv;
  vMapped = mapped;
  vMapTint = mapTint;
  vShade = shade;
  vState = state;
  vSoft = soft;
  gl_Position = projectionMatrix * view;
}
`;

export const SURFACE_FRAGMENT = `
${BITS}
${SOFT_RAMP}
uniform bool uPaint;
uniform vec3 uClay;
uniform bool uMapOn;
uniform sampler2D uMap;
varying vec2 vMapUv;
varying float vMapped;
varying vec3 vMapTint;
uniform bool uFlat;
uniform bool uFaceOrientation;
uniform vec3 uFront;
uniform vec3 uBack;
uniform vec3 uSelected;
uniform vec3 uHover;
uniform float uSelectedTint;
uniform float uHoverTint;
uniform float uMirroredMix;
uniform float uSoftTint;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec3 vPaint;
varying vec4 vShade;
varying float vState;
varying float vSoft;
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
// Blinn (SHADING-SPEC §3): the key light's Blinn-Phong highlight. The exponent is the GGX-equivalent of the exported
// roughness r = 1 - glossiness (alpha = r^2, n = 2 / alpha^2 - 2), so the viewport and the GLB agree.
vec3 blinnHighlight(vec3 n, vec3 keyDir, vec4 shade) {
  float gloss = clamp((shade.a * 255.0 - 1.0) / 254.0, 0.0, 1.0);
  float r = max(1.0 - gloss, 0.02);
  float alpha = r * r;
  float shininess = clamp(2.0 / (alpha * alpha) - 2.0, 1.0, 2048.0);
  vec3 v = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-vViewPosition);
  vec3 h = normalize(keyDir + v);
  float nh = max(dot(n, h), 0.0);
  float lit = step(0.0, dot(n, keyDir));
  // (n + 2) / 32 (1 at glossiness 0.5), floored so rough Blinn still reads as shiny next to Lambert, capped for glints.
  float norm = clamp((shininess + 2.0) / 32.0, 0.35, 4.0);
  return srgbToLinear(shade.rgb) * (${f(LIGHT_RIG.specular)} * norm * lit * pow(nh, shininess));
}
void main() {
  // Flat: the plane of the drawn triangle from screen-space derivatives, which faces the viewer on either side.
  vec3 n;
  if (uFlat) {
    n = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  } else {
    n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
  }
  // A soft clay rig in view space: key from the upper left front, a low fill, ambient (Lambert).
  vec3 keyDir = normalize(${v3(LIGHT_RIG.keyDir)});
  float key = max(dot(n, keyDir), 0.0);
  float fill = max(dot(n, normalize(${v3(LIGHT_RIG.fillDir)})), 0.0);
  float light = ${f(LIGHT_RIG.ambient)} + ${f(LIGHT_RIG.key)} * key + ${f(LIGHT_RIG.fill)} * fill;
  // An imported model's materials (AR-D8-1, AR-D9-1): on the faces of its textured material slot the base colour
  // image (sRGB texture: the sample is linear) times the material's base colour factor ("mapped" 1); on the faces of
  // a flat-colour slot that factor alone ("mapped" 0.5). "mapTint" is the face's factor (linear RGB).
  vec3 base = uMapOn && vMapped > 0.25
    ? (vMapped > 0.75 ? texture2D(uMap, vMapUv).rgb : vec3(1.0)) * vMapTint
    : uPaint ? srgbToLinear(vPaint) : uClay;
  vec3 col = base * light;
  // Blinn swatches add the key light's highlight (gloss byte > 0); Lambert swatches and clay have none.
  if (uPaint && vShade.a > 0.0) col += blinnHighlight(n, keyDir, vShade);
  if (uFaceOrientation) col = (gl_FrontFacing ? uFront : uBack) * (${f(LIGHT_RIG.orientationAmbient)} + ${f(LIGHT_RIG.orientationKey)} * key);
  else if (!gl_FrontFacing) col *= ${f(LIGHT_RIG.backFactor)};
  int s = int(vState + 0.5);
  if (has(s, HOVER)) col = mix(col, uHover, uHoverTint);
  else if (has(s, SELECTED)) col = mix(col, uSelected, uSelectedTint);
  else if (has(s, MIRRORED)) col = mix(col, uSelected, uSelectedTint * uMirroredMix);
  if (vSoft > 0.0) col = mix(col, softRamp(vSoft), uSoftTint);
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}
`;

/** Depth-only pass of an x-ray surface (overlays test their occluded pass against it). */
export const DEPTH_VERTEX = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const DEPTH_FRAGMENT = `
void main() {
  gl_FragColor = vec4(0.0);
}
`;

/**
 * Instanced lines: a unit quad per segment (position.x 0/1 = start/end, position.y −1/1 = side), expanded in screen
 * space by the core width plus the halo on both sides and capped by the halo at both ends. The fragment shader
 * measures its distance to the segment from gl_FragCoord (exact under perspective) and picks halo or core colour.
 */
export const LINE_VERTEX = `
${BITS}
attribute vec3 instanceStart;
attribute vec3 instanceEnd;
attribute float instanceState;
uniform vec4 uViewport;
uniform float uPixelRatio;
uniform float uHalo;
uniform float uWidth;
uniform float uWidthHard;
uniform float uWidthHot;
uniform bool uShowHard;
uniform bool uOnlyHard;
uniform bool uShowState;
uniform vec3 uBase;
uniform vec3 uHard;
uniform vec3 uSelected;
uniform vec3 uHover;
uniform vec3 uHaloColour;
uniform float uMirroredMix;
varying vec3 vCore;
varying vec2 vStart;
varying vec2 vDir;
varying float vLength;
varying float vHalfCore;
varying float vHalfHalo;
varying float vCap;
void trimSegment(const in vec4 start, inout vec4 end) {
  // three's LineMaterial: a conservative near plane estimate from the projection matrix.
  float a = projectionMatrix[2][2];
  float b = projectionMatrix[3][2];
  float nearEstimate = -0.5 * b / a;
  float alpha = (nearEstimate - start.z) / (end.z - start.z);
  end.xyz = mix(start.xyz, end.xyz, alpha);
}
void main() {
  int s = int(instanceState + 0.5);
  vec4 a = modelViewMatrix * vec4(instanceStart, 1.0);
  vec4 b = modelViewMatrix * vec4(instanceEnd, 1.0);
  bool behind = !isOrthographic && a.z >= 0.0 && b.z >= 0.0;
  if (has(s, HIDDEN) || behind || (uOnlyHard && !has(s, HARD))) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (!isOrthographic) {
    if (a.z < 0.0 && b.z >= 0.0) trimSegment(a, b);
    else if (b.z < 0.0 && a.z >= 0.0) trimSegment(b, a);
  }
  vec4 ca = projectionMatrix * a;
  vec4 cb = projectionMatrix * b;
  vec2 sa = uViewport.xy + (ca.xy / ca.w * 0.5 + 0.5) * uViewport.zw;
  vec2 sb = uViewport.xy + (cb.xy / cb.w * 0.5 + 0.5) * uViewport.zw;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);

  float width = uWidth;
  vec3 core = uBase;
  if (uShowHard && has(s, HARD)) {
    width = uWidthHard;
    core = uHard;
  }
  if (uShowState) {
    if (has(s, HOVER)) {
      width = uWidthHot;
      core = uHover;
    } else if (has(s, SELECTED)) {
      width = uWidthHot;
      core = uSelected;
    } else if (has(s, MIRRORED)) {
      width = uWidthHot;
      core = mix(core, uSelected, uMirroredMix);
    }
  }
  // No outline around a line drawn in the halo colour itself (the plain wire): it would only widen it.
  float halo = all(lessThan(abs(core - uHaloColour), vec3(1e-4))) ? 0.0 : uHalo;
  float halfCore = 0.5 * width * uPixelRatio;
  float halfHalo = halfCore + halo * uPixelRatio;
  vCore = core;
  vStart = sa;
  vDir = dir;
  vLength = len;
  vHalfCore = halfCore;
  vHalfHalo = halfHalo;
  vCap = halo * uPixelRatio;

  // Half a pixel of raster margin around the quad, so thin lines leave no gaps; the fragment shader trims it.
  float margin = 0.5 * uPixelRatio;
  bool atEnd = position.x > 0.5;
  vec4 c = atEnd ? cb : ca;
  vec2 offset = nrm * position.y * (halfHalo + margin) + dir * (atEnd ? 1.0 : -1.0) * (vCap + margin);
  c.xy += offset / uViewport.zw * 2.0 * c.w;
  gl_Position = c;
}
`;

export const LINE_FRAGMENT = `
uniform vec3 uHaloColour;
uniform float uAlpha;
uniform float uPixelRatio;
varying vec3 vCore;
varying vec2 vStart;
varying vec2 vDir;
varying float vLength;
varying float vHalfCore;
varying float vHalfHalo;
varying float vCap;
void main() {
  vec2 rel = gl_FragCoord.xy - vStart;
  float along = dot(rel, vDir);
  float across = abs(rel.x * -vDir.y + rel.y * vDir.x);
  float beyond = max(-along, along - vLength);
  if (across > max(vHalfHalo, 0.5) || beyond > vCap) discard;
  bool isHalo = across > max(vHalfCore, 0.5) || beyond > 0.0;
  gl_FragColor = vec4(isHalo ? uHaloColour : vCore, uAlpha);
  #include <colorspace_fragment>
}
`;

/**
 * Point glyphs at constant pixel size: squares (vertices, face dots), ◇ (n-gon markers) or ✕ (error markers). The
 * outer ring of uHalo CSS px is the halo colour.
 */
export const GLYPH_VERTEX = `
${BITS}
attribute float state;
attribute float soft;
uniform float uPixelRatio;
uniform float uHalo;
uniform float uSize;
uniform float uSizeHot;
uniform float uDepthBias;
uniform bool uShowState;
varying float vState;
varying float vSoft;
varying float vSize;
void main() {
  int s = int(state + 0.5);
  vState = state;
  vSoft = soft;
  if (has(s, HIDDEN)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vSize = 0.0;
    return;
  }
  bool hot = uShowState && (has(s, SELECTED) || has(s, MIRRORED) || has(s, HOVER));
  float size = (hot ? uSizeHot : uSize) + 2.0 * uHalo;
  vSize = size;
  gl_PointSize = size * uPixelRatio;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  p.z -= uDepthBias * p.w;
  gl_Position = p;
}
`;

export const GLYPH_FRAGMENT = `
${BITS}
${SOFT_RAMP}
uniform int uShape;
uniform int uAltShape;
uniform bool uShowState;
uniform bool uShowSoft;
uniform vec3 uBase;
uniform vec3 uAltColour;
uniform vec3 uSelected;
uniform vec3 uHover;
uniform vec3 uHaloColour;
uniform float uHalo;
uniform float uMirroredMix;
uniform float uAlpha;
varying float vState;
varying float vSoft;
varying float vSize;
void main() {
  int s = int(vState + 0.5);
  vec2 q = (gl_PointCoord - 0.5) * vSize;
  float r = 0.5 * vSize;
  int shape = has(s, ALT) ? uAltShape : uShape;
  // Distance-like measure from the glyph's outline inwards (CSS px): > 0 inside.
  float inside;
  if (shape == 1) {
    inside = r - (abs(q.x) + abs(q.y));
  } else if (shape == 2) {
    float arm = min(abs(q.x - q.y), abs(q.x + q.y)) * 0.70710678;
    inside = min(r - max(abs(q.x), abs(q.y)), 1.5 + uHalo - arm);
  } else {
    inside = r - max(abs(q.x), abs(q.y));
  }
  if (inside < 0.0) discard;
  vec3 core = has(s, ALT) ? uAltColour : uBase;
  if (uShowSoft && vSoft > 0.0) core = softRamp(vSoft);
  if (uShowState) {
    if (has(s, HOVER)) core = uHover;
    else if (has(s, SELECTED)) core = uSelected;
    else if (has(s, MIRRORED)) core = mix(core, uSelected, uMirroredMix);
  }
  gl_FragColor = vec4(inside <= uHalo ? uHaloColour : core, uAlpha);
  #include <colorspace_fragment>
}
`;
