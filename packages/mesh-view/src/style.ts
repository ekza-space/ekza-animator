// Sizes, strengths and draw order of the mesh overlays (M6A-SPEC §8.9, research 13 §7.1, research 16 §10.3). Colours
// come from the theme (tokens); these are the numbers the tokens do not carry. Sizes are CSS px (scaled by the
// renderer's pixel ratio on the GPU), so glyphs keep their on-screen size at every zoom and DPR.

export const MESH_VIEW_STYLE = {
  /** Every component glyph and overlay line draws this outline in `--comp-halo` (§8.9). */
  haloPx: 1,
  /** Vertex squares: core size, and the size of selected, mirrored and hovered vertices. */
  vertexPx: 5,
  vertexHotPx: 7,
  /** Face-centre dots (face mode). */
  faceDotPx: 5,
  faceDotHotPx: 7,
  /** Edge widths: plain wire, hard edges (`--hard-edge`, 2 px), selected/mirrored/hovered edges. */
  wirePx: 1,
  hardPx: 2,
  edgeHotPx: 3,
  /** Normals and triangulation lines. */
  normalPx: 1,
  triangulationPx: 1,
  triangulationAlpha: 0.6,
  /** Mesh Check markers (◇ n-gon, ✕ error). */
  lintPx: 11,
  /** Mirrored partners: 60 % of the way from the unselected look to `--comp-selected` (§5.6). */
  mirroredMix: 0.6,
  /** Face tints on the surface: selected, hovered, soft-selection ramp. */
  faceSelectedTint: 0.5,
  faceHoverTint: 0.45,
  softTint: 0.65,
  /** Occluded overlay pass in x-ray (`GreaterDepth`), as the control lines (ARCHITECTURE §8). */
  occludedAlpha: 0.35,
  /** Surface opacity in x-ray, and of everything in a dimmed (not hilited, "Dim unhilited") view (Q-MOD-UI-15). */
  xrayOpacity: 0.5,
  dimOpacity: 0.35,
  /** Symmetry plane fill alpha and its margin around the mesh bounds (fraction of the bounds' size). */
  symPlaneAlpha: 0.12,
  symPlaneMargin: 0.15,
  /** Normals display length = this × the mean edge length (mesh-local). */
  normalLength: 0.4,
  /** Glyph depth bias towards the camera (fraction of clip w) against neighbouring faces at silhouettes. */
  glyphDepthBias: 2e-5,
} as const;

/**
 * The soft clay light rig of the surface (view space; §4.7 "a soft clay light rig"): light = ambient + key·max(n·key, 0)
 * + fill·max(n·fill, 0) on the base colour (clay or the palette colour); back faces × `backFactor`. Face orientation
 * draws front/back colour × (orientationAmbient + orientationKey·max(n·key, 0)).
 */
export const LIGHT_RIG = {
  keyDir: [-0.35, 0.6, 0.72],
  fillDir: [0.5, -0.2, 0.84],
  ambient: 0.4,
  key: 0.5,
  fill: 0.15,
  /** Peak of a Blinn swatch's key-light highlight at glossiness 0.5 (SHADING-SPEC §3). */
  specular: 0.6,
  backFactor: 0.7,
  orientationAmbient: 0.6,
  orientationKey: 0.4,
} as const;

/** Render order (three sorts by it first): surfaces, then lines, then glyphs; each overlay's occluded pass first. */
export const ORDER = {
  surface: 0,
  xrayDepth: 1,
  surfaceTransparent: 10,
  triangulation: 11,
  symPlane: 12,
  edgesOccluded: 20,
  edges: 21,
  normalsOccluded: 22,
  normals: 23,
  faceDotsOccluded: 24,
  faceDots: 25,
  vertsOccluded: 26,
  verts: 27,
  lint: 28,
} as const;

/** Element state bits shared by the surface, line and glyph shaders. */
export const STATE = {
  hidden: 1,
  selected: 2,
  mirrored: 4,
  hover: 8,
  hard: 16,
  /** Glyphs: the second shape/colour of a batch (lint: error ✕ instead of n-gon ◇). */
  alt: 32,
} as const;
