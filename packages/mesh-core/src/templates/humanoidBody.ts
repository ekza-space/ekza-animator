// The humanoid body generator (M6A-SPEC §5.16 `humanoidBody`, §6.3; B13): one low-poly mesh in T-pose, facing +Z,
// grounded at Y = 0, `height` metres tall (0.5…3; the proportions scale uniformly from a 1.6 m base), X-symmetric
// topology with every seam vertex exactly on x = 0 and every other vertex the exact mirror (x negated) of its partner,
// closed and manifold, faceted (every edge hard), `paint` = slot 0.
//
// `smooth` (one shell, box-modelled topology):
// - torso: ten 8-vertex rings (hip, waist, belly, chest/armpit, shoulder, neck base, neck, jaw, head, crown) with the
//   front and back vertices on the seam; the crown closes with one planar 8-gon;
// - arms: the two side quads between the armpit ring and the shoulder ring are removed on each side; the 6-vertex hole
//   is the arm's root loop, followed by seven hexagonal rings along ±X (upper arm ×2, elbow ×2, forearm, wrist, hand)
//   and **one hexagonal cap** at the hand (normal ±X, the arm's side count);
// - legs: the hip ring's front, side and back vertices plus a crotch vertex on the seam form each leg's 6-vertex root
//   loop (the two legs share the crotch's two seam edges), followed by seven hexagonal rings down (thigh, knee ×2,
//   shin, ankle, foot, sole) and **one hexagonal cap** at the sole (normal −Y, on the ground);
// - shoulder ring (the arm root's top) and armpit loop (its bottom), two loops at each elbow and knee.
// `segmented` (rigid-island style): head, neck, chest, pelvis, and per side upper arm, forearm, hand, thigh, shin and
// foot as separate closed shells in the same mesh (8-sided torso parts on the seam, 6-sided limbs, n-gon end caps);
// the hand and the foot shells end in the same hexagonal caps.
//
// Faces are oriented outwards by a per-part hint (radial from the part's axis, or the cap direction) against their
// Newell normal, so the winding never depends on hand-ordered corners (the primitives' rule). Triangles: smooth 494,
// segmented 560 (the §5.16 range is 400–900).
import { EDGE_HARD } from '../constants';
import { buildMeshData } from '../core/build';
import { BUILTIN_LAYERS } from '../layers/builtin';
import type { MeshData } from '../types';

type Vec = readonly [number, number, number];

/** Proportions at the 1.6 m base height (metres). */
const BASE_HEIGHT = 1.6;

/** Torso rings: y, half width, half depth (rounded-box rings: the corner vertices at 0.75 w, 0.85 d). */
const TORSO: readonly (readonly [number, number, number])[] = [
  [0.82, 0.16, 0.1], // 0 hip
  [0.95, 0.14, 0.09], // 1 waist
  [1.05, 0.15, 0.1], // 2 belly
  [1.17, 0.17, 0.11], // 3 chest (armpit loop: the arm root's bottom)
  [1.33, 0.19, 0.1], // 4 shoulder ring (the arm root's top)
  [1.38, 0.08, 0.06], // 5 neck base
  [1.43, 0.05, 0.05], // 6 neck
  [1.46, 0.08, 0.09], // 7 jaw
  [1.55, 0.09, 0.1], // 8 head
  [1.6, 0.07, 0.08], // 9 crown (the top cap)
];
const CORNER_W = 0.75;
const CORNER_D = 0.85;
const ARMPIT = 3;
const SHOULDER = 4;
/** Crotch vertex (on the seam, under the hip ring). */
const CROTCH: Vec = [0, 0.76, 0];
/** Arm rings along +X: x, centre y, radius in y, radius in z. */
const ARM: readonly (readonly [number, number, number, number])[] = [
  [0.26, 1.25, 0.06, 0.06], // upper arm
  [0.36, 1.25, 0.055, 0.055], // upper arm
  [0.45, 1.25, 0.05, 0.05], // elbow
  [0.5, 1.25, 0.05, 0.05], // elbow
  [0.6, 1.25, 0.045, 0.045], // forearm
  [0.7, 1.25, 0.035, 0.035], // wrist
  [0.78, 1.25, 0.025, 0.05], // hand (the cap)
];
/** Leg rings down: y, centre x, centre z, radius in x, radius in z. */
const LEG: readonly (readonly [number, number, number, number, number])[] = [
  [0.66, 0.09, 0, 0.075, 0.075], // thigh
  [0.5, 0.09, 0, 0.055, 0.055], // knee
  [0.44, 0.09, 0, 0.055, 0.055], // knee
  [0.3, 0.09, 0, 0.05, 0.05], // shin
  [0.1, 0.09, 0, 0.035, 0.035], // ankle
  [0.05, 0.09, 0.04, 0.05, 0.09], // foot
  [0, 0.09, 0.04, 0.05, 0.09], // sole (the cap, on the ground)
];

/** Arm ring vertex k at angle −30° − 60°k around +X, measured from +Z towards +Y (matches the arm root loop). */
const ARM_ANGLES = [0, 1, 2, 3, 4, 5].map((k) => ((-30 - 60 * k) * Math.PI) / 180);
/** Leg ring vertex k at angle 120° − 60°k around +Y, measured from +X towards +Z (matches the leg root loop). */
const LEG_ANGLES = [0, 1, 2, 3, 4, 5].map((k) => ((120 - 60 * k) * Math.PI) / 180);

class Body {
  readonly positions: number[] = [];
  readonly faces: number[][] = [];
  constructor(private readonly scale: number) {}

  vertex(x: number, y: number, z: number): number {
    // Seam vertices exactly on x = 0; the mirror of a vertex is built from the same numbers (exact in float32).
    this.positions.push(x === 0 ? 0 : x * this.scale, y * this.scale, z * this.scale);
    return this.positions.length / 3 - 1;
  }

  point(v: number): Vec {
    const p = this.positions;
    return [p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number];
  }

  /** Adds a face, reversed when its Newell normal points against `outward(centroid)`. */
  face(corners: readonly number[], outward: (c: Vec) => Vec): void {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const c = [0, 0, 0];
    for (let i = 0; i < corners.length; i++) {
      const a = this.point(corners[i] as number);
      const b = this.point(corners[(i + 1) % corners.length] as number);
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      c[0] = (c[0] as number) + a[0] / corners.length;
      c[1] = (c[1] as number) + a[1] / corners.length;
      c[2] = (c[2] as number) + a[2] / corners.length;
    }
    const hint = outward(c as unknown as Vec);
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
    this.faces.push(flip ? [...corners].reverse() : [...corners]);
  }

  /** Quads between two rings of the same length (ring a[k], a[k+1], b[k+1], b[k]); `closed` wraps around. */
  band(a: readonly number[], b: readonly number[], outward: (c: Vec) => Vec, skip?: (k: number) => boolean): void {
    for (let k = 0; k < a.length; k++) {
      if (skip?.(k) === true) continue;
      const k1 = (k + 1) % a.length;
      this.face([a[k] as number, a[k1] as number, b[k1] as number, b[k] as number], outward);
    }
  }

  build(): MeshData {
    return buildMeshData({
      positions: this.positions,
      faces: this.faces,
      edgeFlags: EDGE_HARD,
      layers: [{ def: BUILTIN_LAYERS.paint }],
    });
  }
}

/** An 8-vertex torso ring (F, FL, L, BL, B, BR, R, FR) at proportions `[y, w, d]`. */
function torsoRing(body: Body, [y, w, d]: readonly [number, number, number]): number[] {
  return [
    body.vertex(0, y, d),
    body.vertex(CORNER_W * w, y, CORNER_D * d),
    body.vertex(w, y, 0),
    body.vertex(CORNER_W * w, y, -CORNER_D * d),
    body.vertex(0, y, -d),
    body.vertex(-CORNER_W * w, y, -CORNER_D * d),
    body.vertex(-w, y, 0),
    body.vertex(-CORNER_W * w, y, CORNER_D * d),
  ];
}

/** A hexagonal arm ring on side `sx` (+1 left, −1 right): the right ring is the exact mirror of the left one. */
function armRing(body: Body, sx: 1 | -1, [x, cy, ry, rz]: readonly [number, number, number, number]): number[] {
  return ARM_ANGLES.map((a) => body.vertex(sx * x, cy + ry * Math.sin(a), rz * Math.cos(a)));
}

function legRing(
  body: Body,
  sx: 1 | -1,
  [y, cx, cz, rx, rz]: readonly [number, number, number, number, number],
): number[] {
  return LEG_ANGLES.map((a) => body.vertex(sx * (cx + rx * Math.cos(a)), y, cz + rz * Math.sin(a)));
}

// ---------- outward hints ----------
const torsoOut = (c: Vec): Vec => [c[0], 0, c[2]];
const up: Vec = [0, 1, 0];
const down: Vec = [0, -1, 0];
const armOut =
  (cy: number) =>
  (c: Vec): Vec => [0, c[1] - cy, c[2]];
const legOut =
  (cx: number, cz: number) =>
  (c: Vec): Vec => [c[0] - cx, 0, c[2] - cz];

function smooth(body: Body, s: number): void {
  const rings = TORSO.map((ring) => torsoRing(body, ring));
  // Torso bands; the arm holes are the side quads (FL–L, L–BL and their mirrors) between armpit and shoulder.
  for (let r = 0; r + 1 < rings.length; r++) {
    const hole = r === ARMPIT;
    body.band(
      rings[r] as number[],
      rings[r + 1] as number[],
      torsoOut,
      (k) => hole && (k === 1 || k === 2 || k === 5 || k === 6),
    );
  }
  body.face(rings[rings.length - 1] as number[], () => up);
  const crotch = body.vertex(CROTCH[0], CROTCH[1], CROTCH[2]);
  const hip = rings[0] as number[];
  const armpit = rings[ARMPIT] as number[];
  const shoulder = rings[SHOULDER] as number[];
  for (const sx of [1, -1] as const) {
    // Arm root loop: armpit FL, L, BL then shoulder BL, L, FL (left); the mirrored ring indices on the right.
    const [f, l, b] = sx === 1 ? [1, 2, 3] : [7, 6, 5];
    let previous = [armpit[f], armpit[l], armpit[b], shoulder[b], shoulder[l], shoulder[f]] as number[];
    const armAxis = ARM[0]?.[1] as number;
    for (const ring of ARM) {
      const next = armRing(body, sx, ring);
      body.band(previous, next, armOut(armAxis * s));
      previous = next;
    }
    body.face(previous, () => [sx, 0, 0]);
    // Leg root loop: hip F, FL, L, BL, B and the crotch (left); F, FR, R, BR, B and the crotch (right).
    const side = sx === 1 ? [0, 1, 2, 3, 4] : [0, 7, 6, 5, 4];
    let legPrevious = [...side.map((i) => hip[i] as number), crotch];
    const legCentre = sx * (LEG[0]?.[1] as number) * s;
    for (const ring of LEG) {
      const next = legRing(body, sx, ring);
      body.band(legPrevious, next, legOut(legCentre, (ring[2] as number) * s));
      legPrevious = next;
    }
    body.face(legPrevious, () => down);
  }
}

/** A closed tube: bands between consecutive rings and an n-gon cap at each end (`first`/`last` outward). */
function shell(
  body: Body,
  rings: readonly (readonly number[])[],
  outward: (c: Vec) => Vec,
  first: Vec,
  last: Vec,
): void {
  for (let r = 0; r + 1 < rings.length; r++) body.band(rings[r] as number[], rings[r + 1] as number[], outward);
  body.face(rings[0] as number[], () => first);
  body.face(rings[rings.length - 1] as number[], () => last);
}

function segmented(body: Body, s: number): void {
  const torso = (rows: readonly (readonly [number, number, number])[]): void =>
    shell(
      body,
      rows.map((row) => torsoRing(body, row)),
      torsoOut,
      down,
      up,
    );
  torso([
    [0.74, 0.12, 0.08],
    [0.82, 0.16, 0.1],
    [0.93, 0.14, 0.09],
  ]); // pelvis
  torso([
    [0.97, 0.14, 0.09],
    [1.17, 0.17, 0.11],
    [1.33, 0.19, 0.1],
    [1.37, 0.1, 0.07],
  ]); // chest
  torso([
    [1.38, 0.05, 0.05],
    [1.44, 0.05, 0.05],
  ]); // neck
  torso([
    [1.45, 0.08, 0.09],
    [1.55, 0.09, 0.1],
    [1.6, 0.07, 0.08],
  ]); // head
  for (const sx of [1, -1] as const) {
    const arm = (rows: readonly (readonly [number, number, number, number])[]): void =>
      shell(
        body,
        rows.map((row) => armRing(body, sx, row)),
        armOut(1.25 * s),
        [-sx, 0, 0],
        [sx, 0, 0],
      );
    arm([
      [0.21, 1.25, 0.06, 0.06],
      [0.33, 1.25, 0.055, 0.055],
      [0.44, 1.25, 0.05, 0.05],
    ]); // upper arm
    arm([
      [0.46, 1.25, 0.05, 0.05],
      [0.58, 1.25, 0.045, 0.045],
      [0.68, 1.25, 0.035, 0.035],
    ]); // forearm
    arm([
      [0.7, 1.25, 0.03, 0.045],
      [0.74, 1.25, 0.03, 0.05],
      [0.78, 1.25, 0.025, 0.05],
    ]); // hand (its +X cap is the hand cap)
    const leg = (rows: readonly (readonly [number, number, number, number, number])[]): void =>
      shell(
        body,
        rows.map((row) => legRing(body, sx, row)),
        legOut(sx * 0.09 * s, (rows[0]?.[2] as number) * s),
        up,
        down,
      );
    leg([
      [0.72, 0.09, 0, 0.075, 0.075],
      [0.6, 0.09, 0, 0.065, 0.065],
      [0.48, 0.09, 0, 0.055, 0.055],
    ]); // thigh
    leg([
      [0.46, 0.09, 0, 0.055, 0.055],
      [0.3, 0.09, 0, 0.05, 0.05],
      [0.12, 0.09, 0, 0.035, 0.035],
    ]); // shin
    leg([
      [0.1, 0.09, 0, 0.04, 0.04],
      [0.05, 0.09, 0.03, 0.05, 0.08],
      [0, 0.09, 0.03, 0.05, 0.09],
    ]); // foot (its −Y cap is the sole)
  }
}

/** §5.16: the humanoid body template mesh. */
export function humanoidBody(params: { readonly style: 'smooth' | 'segmented'; readonly height: number }): MeshData {
  const height = Number.isFinite(params.height) ? Math.min(3, Math.max(0.5, params.height)) : BASE_HEIGHT;
  const s = height / BASE_HEIGHT;
  const body = new Body(s);
  if (params.style === 'segmented') segmented(body, s);
  else smooth(body, s);
  return body.build();
}
