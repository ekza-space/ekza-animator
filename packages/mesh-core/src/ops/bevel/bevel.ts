// `mesh.bevel` (M6A-SPEC §5.9, §6.1; research 10 §4.3, 13 §5.3 bounded to M6a). Edge mode bevels the selected edges;
// face mode bevels every edge of the selected faces.
//
// Construction, per bevelled vertex x (an endpoint of a selected edge), from its face fan in counterclockwise order:
// - an unselected edge that shares a face corner at x with a selected edge is a **slide** edge: a new vertex slides
//   along it from x by the width d_x (the edge is split there, so §5.2's split rules give the point and corner layers
//   and H4 the flags); the other unselected edges are **middle** edges;
// - a face whose two edges at x are both selected gets a **miter** point x + d_x·(â + b̂) (along the bisector), or
//   x − d_x·(â + b̂) where the face's corner at x is reflex (the meet of the strips' inward offset lines);
// - walking the fan gives x's cycle: selected edges (strip ends), slide vertices, miter points and runs of middle
//   edges. A run keeps x (one run) or gets its own vertex slid along the run's mean direction (several runs);
// - one selected edge at x (§5.9 "valence 1"): the strip's end runs through the rest of the cycle, so the face
//   opposite the strip gains a corner (cube: quad → pentagon) and x stays only while middle edges still need it;
//   two selected edges whose cycle has two vertices: the strips share their end (miter along the centre); otherwise
//   the cycle's vertices form a corner polygon (`segments` 1, or two selected edges) or a fan around a new centre
//   vertex (`segments` > 1 with three or more selected edges: warning `bevel.fan-corner`).
// Every face with a corner at a bevelled vertex is rebuilt: its corner at x is dropped, replaced by the miter point
// or kept. Strips have `segments` rows between their sides A (in the edge's first face) and B; rows lie on the chord
// A → B (`chamfer`) or on the quadratic Bézier A → C′ → B, C′ = M + 2·roundness·(C − M), C the original vertex.
//
// Width (Maya fraction semantics): d_x = fraction × ½ × L_x with L_x the shortest edge at x, measured along the slide
// edges, so fraction 1 makes bevels from both ends of an edge meet; `offsetAsFraction` off → `offset` metres. With
// `clamp`, a vertex with an edge measured from both of its ends is limited to fraction 0.98 (`bevel.clamped`), and
// when a rebuilt face or a strip would still invert, twist (two new vertices passing each other along an edge, a
// strip's corner triangle turning over: a bow-tie keeps its Newell normal) or thin out below ε, a rebuilt face or a
// strip through an in-line vertex would cross itself (a reflex miter past a thin arm), or two new vertices around a
// bevelled vertex would coincide, every width is scaled down to 0.98 × the largest valid one (same warning); a corner
// polygon or fan thinner than ε at every width refuses. Hardness: strip row edges follow H2; the edges bounding the
// bevel faces are hard with `hardenBorders` (else H2); fan spokes follow H1. Symmetry (§5.14): the op runs on the
// expanded selection, and the new vertices of a region of selected edges that is its own mirror are symmetrized
// afterwards. Refusals: `bevel.no-selection`, `bevel.border-edge`, `bevel.non-manifold`, `bevel.zero-width` (no valid
// width at all, e.g. Roundness 1 with even segments at a corner), `bevel.too-wide` (Clamp off and a width past the
// next vertex or one that folds faces over).
import { coerceArgs, type ParamValues } from '@ekza-animator/anim-core';
import { EDGE_HARD } from '../../constants';
import { kernelError } from '../../kernel';
import {
  copyEdgeAttributes,
  copyPointAttributes,
  interpolatePointAttributes,
  mergePointAttributes,
} from '../../layers/propagate';
import { applySmoothingAngle } from '../../normals/hard';
import { resolveSmoothingAngle } from '../../normals/normals';
import { refuse } from '../../refusal';
import { selectionOf } from '../../selection';
import type { ComponentSelection, EditMesh, OpContext, OpFrame, OpResult, OpWarning, Refusal } from '../../types';
import { blendPointAttributes, CornerValues, FaceValues } from './attributes';
import { BEVEL } from './descriptor';
import { expandForOp, isHidden, mirrorOf, symmetrizeVertices, unmatchedWarning } from './symmetry';

// ---------- arguments ----------

export interface BevelArgs {
  readonly fraction: number;
  readonly offsetAsFraction: boolean;
  readonly offset: number;
  readonly segments: number;
  readonly chamfer: boolean;
  readonly roundness: number;
  readonly clamp: boolean;
  readonly hardenBorders: boolean;
  /** Resolved (radians): null became 0 on faceted meshes and 30° otherwise (§5.3). */
  readonly smoothingAngle: number;
}

/** Coerced args, the smoothing angle resolved; `values` is what LastRun records (`OpResult.resolvedArgs`). */
export function bevelArgs(
  raw: ParamValues,
  faceted: boolean,
): { readonly args: BevelArgs; readonly values: ParamValues } {
  const { args } = coerceArgs(BEVEL.params, raw);
  const angle = resolveSmoothingAngle(args['smoothingAngle'] as number | null, faceted);
  return {
    args: {
      fraction: args['fraction'] as number,
      offsetAsFraction: args['offsetAsFraction'] as boolean,
      offset: args['offset'] as number,
      segments: args['segments'] as number,
      chamfer: args['chamfer'] as boolean,
      roundness: args['roundness'] as number,
      clamp: args['clamp'] as boolean,
      hardenBorders: args['hardenBorders'] as boolean,
      smoothingAngle: angle,
    },
    values: Object.freeze({ ...args, smoothingAngle: angle }),
  };
}

// ---------- geometry helpers (float64) ----------

function distance(m: EditMesh, a: number, b: number): number {
  const p = m.position;
  return Math.hypot(
    (p[3 * b] as number) - (p[3 * a] as number),
    (p[3 * b + 1] as number) - (p[3 * a + 1] as number),
    (p[3 * b + 2] as number) - (p[3 * a + 2] as number),
  );
}

const edgeLength = (m: EditMesh, e: number): number => distance(m, m.edgeVert(e, 0), m.edgeVert(e, 1));

/** Unit direction from x along edge e (zero for a zero-length edge). */
function unitAlong(m: EditMesh, e: number, x: number): readonly [number, number, number] {
  const p = m.position;
  const y = m.edgeOther(e, x);
  const dx = (p[3 * y] as number) - (p[3 * x] as number);
  const dy = (p[3 * y + 1] as number) - (p[3 * x + 1] as number);
  const dz = (p[3 * y + 2] as number) - (p[3 * x + 2] as number);
  const length = Math.hypot(dx, dy, dz);
  return length > 0 ? [dx / length, dy / length, dz / length] : [0, 0, 0];
}

/** Newell normal (not normalized) of `n` points stored flat in `points`, into `out`. */
function newell(points: Float64Array, n: number, out: Float64Array): void {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    const a = 3 * i;
    const b = 3 * ((i + 1) % n);
    const ax = points[a] as number;
    const ay = points[a + 1] as number;
    const az = points[a + 2] as number;
    const bx = points[b] as number;
    const by = points[b + 1] as number;
    const bz = points[b + 2] as number;
    x += (ay - by) * (az + bz);
    y += (az - bz) * (ax + bx);
    z += (ax - bx) * (ay + by);
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

/** Distance from 2D point (px, py) to the segment (ax, ay)–(bx, by). */
function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2)) : 0;
  return Math.hypot(px - ax - t * ex, py - ay - t * ey);
}

/**
 * Whether the closed polygon of `n` points (flat xyz in `points`) projected along axis `drop` keeps every two edges
 * that share no corner (by `ids`) more than `gap` apart: no edge crosses or touches another one.
 */
function simpleIn(points: Float64Array, ids: readonly number[], drop: number, gap: number): boolean {
  const n = ids.length;
  if (n < 4) return true;
  const u = drop === 0 ? 1 : 0;
  const v = drop === 2 ? 1 : 2;
  const x = (i: number): number => points[3 * i + u] as number;
  const y = (i: number): number => points[3 * i + v] as number;
  const side = (a: number, b: number, c: number): number =>
    (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a));
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 1; j < n; j++) {
      const j2 = (j + 1) % n;
      const a = ids[i];
      const b = ids[i2];
      const c = ids[j];
      const d = ids[j2];
      if (a === c || a === d || b === c || b === d) continue;
      const s1 = side(i, i2, j);
      const s2 = side(i, i2, j2);
      const s3 = side(j, j2, i);
      const s4 = side(j, j2, i2);
      if (((s1 > 0 && s2 < 0) || (s1 < 0 && s2 > 0)) && ((s3 > 0 && s4 < 0) || (s3 < 0 && s4 > 0))) return false;
      const near = Math.min(
        pointSegment(x(i), y(i), x(j), y(j), x(j2), y(j2)),
        pointSegment(x(i2), y(i2), x(j), y(j), x(j2), y(j2)),
        pointSegment(x(j), y(j), x(i), y(i), x(i2), y(i2)),
        pointSegment(x(j2), y(j2), x(i), y(i), x(i2), y(i2)),
      );
      if (!(near > gap)) return false;
    }
  }
  return true;
}

/**
 * Normal of the corner triangle (points[i − 1], points[i], points[i + 1]) of the closed polygon of `n` points (flat
 * xyz), into `out`; returns the product of its two edge lengths (the normal's length when they are perpendicular).
 */
function cornerTurn(points: Float64Array, n: number, i: number, out: Float64Array): number {
  const a = 3 * ((i + n - 1) % n);
  const b = 3 * i;
  const c = 3 * ((i + 1) % n);
  const ux = (points[b] as number) - (points[a] as number);
  const uy = (points[b + 1] as number) - (points[a + 1] as number);
  const uz = (points[b + 2] as number) - (points[a + 2] as number);
  const vx = (points[c] as number) - (points[b] as number);
  const vy = (points[c + 1] as number) - (points[b + 1] as number);
  const vz = (points[c + 2] as number) - (points[b + 2] as number);
  out[0] = uy * vz - uz * vy;
  out[1] = uz * vx - ux * vz;
  out[2] = ux * vy - uy * vx;
  return Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
}

/** The axis a face with Newell normal `n` projects along (its dominant component). */
function dominantAxis(n: Float64Array): number {
  const ax = Math.abs(n[0] as number);
  const ay = Math.abs(n[1] as number);
  const az = Math.abs(n[2] as number);
  return ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
}

function cornersOfFace(m: EditMesh, f: number): number[] {
  const out: number[] = [];
  const start = m.faceCorner(f);
  let c = start;
  let guard = 0;
  do {
    out.push(c);
    c = m.cornerNext(c);
  } while (c !== start && ++guard <= m.counts.corners);
  return out;
}

/** Newell normal (not normalized) of face f, into `out`. */
function faceNewell(m: EditMesh, f: number, out: Float64Array): Float64Array {
  const corners = cornersOfFace(m, f);
  const points = new Float64Array(3 * corners.length);
  const p = m.position;
  corners.forEach((c, i) => {
    const v = m.cornerVert(c);
    points[3 * i] = p[3 * v] as number;
    points[3 * i + 1] = p[3 * v + 1] as number;
    points[3 * i + 2] = p[3 * v + 2] as number;
  });
  newell(points, corners.length, out);
  return out;
}

// ---------- the fan of a bevelled vertex ----------

const SEL = 0;
const SLIDE = 1;
const MID = 2;

interface Fan {
  /** Fan edges counterclockwise (seen from the front): closed n, open n + 1 (border edges first and last). */
  readonly edges: readonly number[];
  /** faces[i] lies between edges[i] (its edge leaving x) and edges[i + 1] (its edge entering x). */
  readonly faces: readonly number[];
}

/** The corners at x (ascending), or why x is not a clean fan vertex (wire or non-manifold edges). */
function cornersAround(m: EditMesh, x: number): number[] | string {
  const corners: number[] = [];
  const start = m.vertEdge(x);
  if (start === -1) return `vertex ${x} has no edges`;
  let e = start;
  let guard = 0;
  do {
    const faces = m.edgeFaceCount(e);
    if (faces === 0) return `vertex ${x} has a wire edge (${e})`;
    if (faces > 2) return `edge ${e} at vertex ${x} has ${faces} faces`;
    const r0 = m.edgeCorner(e);
    let r = r0;
    do {
      if (m.cornerVert(r) === x) corners.push(r);
      r = m.cornerRadialNext(r);
    } while (r !== r0);
    e = m.edgeDiskNext(e, x);
  } while (e !== start && ++guard <= m.counts.edges);
  return corners.sort((a, b) => a - b);
}

/** The ordered face fan of x, or the reason it is not one consistently wound disc or half-disc. */
function fanOf(m: EditMesh, x: number): Fan | string {
  const all = cornersAround(m, x);
  if (typeof all === 'string') return all;
  const start = all[0] as number;
  const notOneFan = `the faces around vertex ${x} do not form one fan`;
  const flipped = `the faces around vertex ${x} have inconsistent winding`;
  // Clockwise neighbour: across the corner's leaving edge; counterclockwise: across its entering edge.
  const cw = (c: number): number | 'border' | 'flip' => {
    const e = m.cornerEdge(c);
    if (m.edgeFaceCount(e) !== 2) return 'border';
    const r = m.cornerRadialNext(c);
    return m.cornerVert(r) === x ? 'flip' : m.cornerNext(r);
  };
  const ccw = (c: number): number | 'border' | 'flip' => {
    const p = m.cornerPrev(c);
    if (m.edgeFaceCount(m.cornerEdge(p)) !== 2) return 'border';
    const r = m.cornerRadialNext(p);
    return m.cornerVert(r) !== x ? 'flip' : r;
  };
  let begin = start;
  let closed = false;
  for (let guard = 0; ; guard++) {
    if (guard > all.length) return notOneFan;
    const next = cw(begin);
    if (next === 'flip') return flipped;
    if (next === 'border') break;
    if (next === start) {
      closed = true;
      begin = start;
      break;
    }
    begin = next;
  }
  const edges: number[] = [];
  const faces: number[] = [];
  let count = 0;
  let c = begin;
  for (let guard = 0; ; guard++) {
    if (guard > all.length) return notOneFan;
    edges.push(m.cornerEdge(c));
    faces.push(m.cornerFace(c));
    count++;
    const next = ccw(c);
    if (next === 'flip') return flipped;
    if (next === 'border') {
      if (closed) return notOneFan;
      edges.push(m.cornerEdge(m.cornerPrev(c)));
      break;
    }
    if (next === begin) {
      if (!closed) return notOneFan;
      break;
    }
    c = next;
  }
  if (count !== all.length) return `the faces around vertex ${x} form more than one fan`;
  if (new Set(faces).size !== faces.length) return `a face passes through vertex ${x} twice`;
  if (new Set(edges).size !== edges.length || edges.length !== m.vertValence(x)) return notOneFan;
  return { edges, faces };
}

// ---------- tokens: the vertices of the result ----------

const T_OLD = 0;
const T_SLIDE = 1;
const T_MITER = 2;
const T_RUN = 3;
const T_PROFILE = 4;
const T_CENTER = 5;

/** A vertex of the result: position = base + λ·delta (the base is the bevelled vertex, or the original vertex). */
interface Token {
  /** The key the token was made under (its source elements: §5.14 maps them to the partner token's). */
  readonly key: string;
  readonly kind: number;
  /** The bevelled vertex the token belongs to (T_OLD: the vertex itself). */
  readonly at: number;
  readonly base: Float64Array;
  readonly delta: Float64Array;
  /** T_MITER: the far ends of the face's two selected edges at `at`. */
  readonly far: readonly [number, number];
  /** T_MITER: the face's corner at `at` is reflex (the miter lies on the far ends' opposite side of `at`). */
  readonly reflex: boolean;
  /** T_RUN: the run's middle edges. */
  readonly run: readonly number[];
  /** T_PROFILE: the chord's end tokens (ascending) and the parameter from the first. */
  readonly chord: readonly [number, number];
  readonly s: number;
  /** Vertex index once created (T_OLD: the original vertex). */
  vertex: number;
}

class Tokens {
  readonly list: Token[] = [];
  readonly #keys = new Map<string, number>();

  constructor(readonly m: EditMesh) {}

  get(key: string): number {
    const id = this.#keys.get(key);
    if (id === undefined) throw kernelError('internal', `bevel: no token ${key}`);
    return id;
  }

  /** The token made under `key`, or −1. */
  find(key: string): number {
    return this.#keys.get(key) ?? -1;
  }

  make(
    key: string,
    kind: number,
    at: number,
    delta: ArrayLike<number>,
    extra?: {
      readonly far?: readonly [number, number];
      readonly reflex?: boolean;
      readonly run?: readonly number[];
      readonly chord?: readonly [number, number];
      readonly s?: number;
    },
  ): number {
    const known = this.#keys.get(key);
    if (known !== undefined) return known;
    const p = this.m.position;
    const id = this.list.length;
    this.list.push({
      key,
      kind,
      at,
      base: Float64Array.of(p[3 * at] as number, p[3 * at + 1] as number, p[3 * at + 2] as number),
      delta: Float64Array.from(delta),
      far: extra?.far ?? [-1, -1],
      reflex: extra?.reflex ?? false,
      run: extra?.run ?? [],
      chord: extra?.chord ?? [-1, -1],
      s: extra?.s ?? 0,
      vertex: kind === T_OLD ? at : -1,
    });
    this.#keys.set(key, id);
    return id;
  }

  old(v: number): number {
    return this.make(`o:${v}`, T_OLD, v, [0, 0, 0]);
  }

  kind(t: number): number {
    return (this.list[t] as Token).kind;
  }

  vertex(t: number): number {
    return (this.list[t] as Token).vertex;
  }

  /** Position of token t at width factor λ, into `out` at `o`. */
  position(t: number, lambda: number, out: Float64Array, o: number): void {
    const token = this.list[t] as Token;
    for (let k = 0; k < 3; k++) out[o + k] = (token.base[k] as number) + lambda * (token.delta[k] as number);
  }
}

/** One cycle entry around a bevelled vertex: a selected edge (a strip end) or a token. */
interface Entry {
  readonly sel: number;
  readonly token: number;
}

interface VertexPlan {
  readonly fan: Fan;
  /** Selected edges at x. */
  readonly k: number;
  /** Edge class at x (SEL, SLIDE, MID) by edge index. */
  readonly cls: ReadonlyMap<number, number>;
  /** Width before the clamp factor λ. */
  d: number;
  /** The cycle counterclockwise, starting at the smallest selected edge; middle-edge runs as their keep token. */
  entries: readonly Entry[];
  /** Face → the tokens replacing its corner at x (possibly none). */
  readonly replacement: Map<number, readonly number[]>;
  /** The keep token of each middle-edge run (one run: x itself; several: a moved vertex each). */
  readonly runs: number[];
}

interface StripEnd {
  readonly x: number;
  readonly A: number;
  readonly B: number;
  /** Row boundary tokens P(0…segments). */
  readonly rows: readonly number[];
  /** `segments` 1 with x kept between A and B (the end runs A → x → B); −1 otherwise. */
  readonly insert: number;
}

interface Strip {
  readonly e: number;
  readonly f1: number;
  readonly f2: number;
  readonly v: StripEnd;
  readonly w: StripEnd;
}

const TAG_NONE = 0;
const TAG_BORDER = 1;
const TAG_ROW = 2;
const TAG_SPOKE = 3;

/** A face to create: tokens in winding order and the tag of each edge tokens[i] → tokens[i + 1]. */
interface Poly {
  readonly kind: 'rebuilt' | 'row' | 'patch' | 'fan';
  readonly tokens: readonly number[];
  readonly tags: readonly number[];
  /** rebuilt: the original face; row: the strip's edge; patch, fan: the bevelled vertex. */
  readonly source: number;
  /** The face whose material and face layers the new face takes (an original face, rebuilt too). */
  readonly example: number;
  /** fan: the fan's id (its spokes follow H1 over its boundary); −1 otherwise. */
  readonly fan: number;
}

const LAMBDA_REF = 1e-3;
/** The clamp keeps this share of the largest valid width factor (§5.9's 0.98 for slides from both ends). */
const CLAMP_MARGIN = 0.98;

/** The bevel's input edges (face mode: every edge of the selected faces), ascending; hidden components skipped. */
function inputEdges(m: EditMesh, sel: ComponentSelection, ctx: OpContext): number[] {
  const set = new Set<number>();
  if (sel.kind === 'edge') {
    sel.edges.forEach((e) => {
      if (e < m.counts.edges && !isHidden(ctx.hidden, 'edge', e)) set.add(e);
    });
  } else {
    sel.faces.forEach((f) => {
      if (f >= m.counts.faces || isHidden(ctx.hidden, 'face', f)) return;
      for (const c of cornersOfFace(m, f)) set.add(m.cornerEdge(c));
    });
  }
  return [...set].sort((a, b) => a - b);
}

/** Poll: a visible edge or face selection. */
export function pollBevel(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel === null || (sel.kind !== 'edge' && sel.kind !== 'face') || inputEdges(m, sel, ctx).length === 0) {
    return refuse('bevel.no-selection', 'Select edges or faces to bevel');
  }
  return true;
}

// ---------- the op ----------

export function runBevel(
  m: EditMesh,
  input: ComponentSelection | null,
  raw: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const polled = pollBevel(m, input, ctx);
  if (polled !== true) return polled;
  const { args, values: resolvedArgs } = bevelArgs(raw, ctx.faceted);
  let sel = input as ComponentSelection;
  const warnings: OpWarning[] = [];
  if (ctx.symmetry !== null) {
    sel = expandForOp(sel, ctx.symmetry.map);
    const lonely = unmatchedWarning(sel, sel.kind, ctx.symmetry.map);
    if (lonely !== null) warnings.push(lonely);
  }
  const faceMode = sel.kind === 'face';
  const selected = inputEdges(m, sel, ctx);
  const S = new Set(selected);
  const eps = Math.max(ctx.epsilon, 1e-12);
  const segments = args.segments;

  // ----- refusals: edges with two distinct, consistently wound faces; clean fans at their ends -----
  for (const e of selected) {
    const n = m.edgeFaceCount(e);
    if (n === 1) {
      return refuse(
        'bevel.border-edge',
        faceMode
          ? `Bevel needs edges with two faces (a selected face has border edge ${e})`
          : `Bevel needs edges with two faces (edge ${e} is on a border)`,
      );
    }
    if (n !== 2) return refuse('bevel.non-manifold', `Bevel needs edges with two faces (edge ${e} has ${n})`);
    const c1 = m.edgeCorner(e);
    const c2 = m.cornerRadialNext(c1);
    if (m.cornerFace(c1) === m.cornerFace(c2)) {
      return refuse('bevel.non-manifold', `Edge ${e} has the same face on both sides`);
    }
    if (m.cornerVert(c1) === m.cornerVert(c2)) {
      return refuse('bevel.non-manifold', `The faces of edge ${e} have inconsistent winding`);
    }
  }
  const bevelled = [...new Set(selected.flatMap((e) => [m.edgeVert(e, 0), m.edgeVert(e, 1)]))].sort((a, b) => a - b);
  const tokens = new Tokens(m);
  const vp = new Map<number, VertexPlan>();
  for (const x of bevelled) {
    const fan = fanOf(m, x);
    if (typeof fan === 'string') return refuse('bevel.non-manifold', `Bevel needs a manifold mesh (${fan})`);
    const cls = new Map<number, number>();
    for (const e of fan.edges) cls.set(e, S.has(e) ? SEL : MID);
    for (let i = 0; i < fan.faces.length; i++) {
      const out = fan.edges[i] as number;
      const into = fan.edges[(i + 1) % fan.edges.length] as number;
      if (S.has(out) && !S.has(into)) cls.set(into, SLIDE);
      if (S.has(into) && !S.has(out)) cls.set(out, SLIDE);
    }
    const k = fan.edges.filter((e) => S.has(e)).length;
    vp.set(x, { fan, k, cls, d: 0, entries: [], replacement: new Map(), runs: [] });
  }
  const planOf = (x: number): VertexPlan => vp.get(x) as VertexPlan;
  const isSlide = (e: number, x: number): boolean => vp.get(x)?.cls.get(e) === SLIDE;

  // ----- widths -----
  /** Whether a new vertex of x is measured along edge e from x: slides, and selected edges bounding a miter. */
  const measuredAlong = (x: number, e: number): boolean => {
    const plan = vp.get(x);
    if (plan === undefined) return false;
    const c = plan.cls.get(e);
    if (c === SLIDE) return true;
    if (c !== SEL) return false;
    const { fan } = plan;
    for (let i = 0; i < fan.faces.length; i++) {
      const out = fan.edges[i] as number;
      const into = fan.edges[(i + 1) % fan.edges.length] as number;
      if ((out === e || into === e) && S.has(out) && S.has(into)) return true;
    }
    return false;
  };
  let clamped = false;
  for (const x of bevelled) {
    const plan = planOf(x);
    let L = Infinity;
    let bothEnds = false;
    for (const e of plan.fan.edges) {
      L = Math.min(L, edgeLength(m, e));
      if (measuredAlong(x, e) && measuredAlong(m.edgeOther(e, x), e)) bothEnds = true;
    }
    const limit = args.clamp && bothEnds ? 0.98 : 1;
    if (args.offsetAsFraction) {
      const f = Math.min(args.fraction, limit);
      if (f < args.fraction) clamped = true;
      plan.d = f * 0.5 * L;
    } else {
      const max = limit * 0.5 * L;
      if (args.clamp && args.offset > max) clamped = true;
      plan.d = args.clamp ? Math.min(args.offset, max) : args.offset;
    }
    if (!(plan.d > eps)) {
      return refuse('bevel.zero-width', `The bevel has no width at vertex ${x} (zero fraction, offset or edge)`);
    }
  }
  if (!args.clamp) {
    // Without Clamp the widths are the user's, but a slide must stay on its edge.
    for (const x of bevelled) {
      const plan = planOf(x);
      for (const e of plan.fan.edges) {
        if (plan.cls.get(e) !== SLIDE) continue;
        const y = m.edgeOther(e, x);
        const other = isSlide(e, y) ? planOf(y).d : 0;
        if (plan.d + other > edgeLength(m, e) + eps) {
          return refuse('bevel.too-wide', `The bevel is wider than edge ${e} next to it (turn Clamp on)`);
        }
      }
    }
  }

  // ----- tokens per vertex: slides, miters, middle-edge runs, the cycle, corner replacements -----
  const cornerNormal = new Float64Array(3);
  for (const x of bevelled) {
    const plan = planOf(x);
    const { fan, cls, d } = plan;
    const nE = fan.edges.length;
    type Raw = { readonly kind: 'sel' | 'tok' | 'mid'; readonly edge: number; readonly token: number };
    const raw: Raw[] = [];
    for (let i = 0; i < nE; i++) {
      const e = fan.edges[i] as number;
      const c = cls.get(e) as number;
      if (c === SEL) raw.push({ kind: 'sel', edge: e, token: -1 });
      else if (c === SLIDE) {
        const u = unitAlong(m, e, x);
        raw.push({
          kind: 'tok',
          edge: e,
          token: tokens.make(`s:${e}:${x}`, T_SLIDE, x, [d * u[0], d * u[1], d * u[2]]),
        });
      } else raw.push({ kind: 'mid', edge: e, token: -1 });
      if (i < fan.faces.length) {
        const into = fan.edges[(i + 1) % nE] as number;
        if (S.has(e) && S.has(into)) {
          const f = fan.faces[i] as number;
          const a = unitAlong(m, e, x);
          const b = unitAlong(m, into, x);
          // In f, `e` leaves x and `into` enters it, so (â × b̂)·n > 0 at a convex corner. At a reflex corner (interior
          // angle over 180°) â + b̂ points out of the face: the strips' inward offset lines meet at x − d·(â + b̂).
          const n = faceNewell(m, f, cornerNormal);
          const turn =
            (a[1] * b[2] - a[2] * b[1]) * (n[0] as number) +
            (a[2] * b[0] - a[0] * b[2]) * (n[1] as number) +
            (a[0] * b[1] - a[1] * b[0]) * (n[2] as number);
          const reflex = turn < 0;
          const k = reflex ? -d : d;
          const id = tokens.make(`m:${f}:${x}`, T_MITER, x, [k * (a[0] + b[0]), k * (a[1] + b[1]), k * (a[2] + b[2])], {
            far: [m.edgeOther(e, x), m.edgeOther(into, x)],
            reflex,
          });
          raw.push({ kind: 'tok', edge: -1, token: id });
        }
      }
    }
    // Runs: cyclically consecutive middle edges.
    const runOf = new Map<number, number>();
    const runDirs: number[][] = [];
    const runEdges: number[][] = [];
    const first = raw.findIndex((r) => r.kind !== 'mid');
    for (let j = 0; j < raw.length; j++) {
      const i = (first + j) % raw.length;
      const r = raw[i] as Raw;
      if (r.kind !== 'mid') continue;
      const prev = raw[(i + raw.length - 1) % raw.length] as Raw;
      if (prev.kind !== 'mid' || runDirs.length === 0) {
        runDirs.push([0, 0, 0]);
        runEdges.push([]);
      }
      const run = runDirs.length - 1;
      runOf.set(r.edge, run);
      (runEdges[run] as number[]).push(r.edge);
      const u = unitAlong(m, r.edge, x);
      const dir = runDirs[run] as number[];
      for (let k = 0; k < 3; k++) dir[k] = (dir[k] as number) + (u[k] as number);
    }
    for (let r = 0; r < runDirs.length; r++) {
      if (runDirs.length === 1) {
        plan.runs.push(tokens.old(x));
        continue;
      }
      const dir = runDirs[r] as number[];
      const length = Math.hypot(dir[0] as number, dir[1] as number, dir[2] as number);
      const s = length > 0 ? d / length : 0;
      // Keyed by the run's smallest edge, so the partner run is found through the edge map (§5.14).
      const edges = runEdges[r] as number[];
      plan.runs.push(
        tokens.make(
          `r:${x}:${Math.min(...edges)}`,
          T_RUN,
          x,
          dir.map((c) => c * s),
          { run: edges },
        ),
      );
    }
    const entries: Entry[] = [];
    for (let j = 0; j < raw.length; j++) {
      const r = raw[(first + j) % raw.length] as Raw;
      const entry: Entry =
        r.kind === 'sel'
          ? { sel: r.edge, token: -1 }
          : { sel: -1, token: r.kind === 'tok' ? r.token : (plan.runs[runOf.get(r.edge) as number] as number) };
      const last = entries[entries.length - 1];
      if (last !== undefined && last.sel === -1 && entry.sel === -1 && last.token === entry.token) continue;
      entries.push(entry);
    }
    while (entries.length > 1) {
      const head = entries[0] as Entry;
      const tail = entries[entries.length - 1] as Entry;
      if (head.sel === -1 && tail.sel === -1 && head.token === tail.token) entries.pop();
      else break;
    }
    let rot = -1;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] as Entry;
      if (e.sel !== -1 && (rot === -1 || e.sel < (entries[rot] as Entry).sel)) rot = i;
    }
    plan.entries = [...entries.slice(rot), ...entries.slice(0, rot)];
    for (let i = 0; i < fan.faces.length; i++) {
      const f = fan.faces[i] as number;
      const out = fan.edges[i] as number;
      const into = fan.edges[(i + 1) % nE] as number;
      const co = cls.get(out) as number;
      const ci = cls.get(into) as number;
      if (co === SEL && ci === SEL) plan.replacement.set(f, [tokens.get(`m:${f}:${x}`)]);
      else if (co !== MID && ci !== MID) plan.replacement.set(f, []);
      else plan.replacement.set(f, [plan.runs[runOf.get(co === MID ? out : into) as number] as number]);
    }
  }

  // ----- strips: their sides, end chains and profile chords -----
  /** The token on face f's side of selected edge e at x. */
  const sideToken = (x: number, f: number, e: number): number => {
    const plan = planOf(x);
    const i = plan.fan.faces.indexOf(f);
    const out = plan.fan.edges[i] as number;
    const into = plan.fan.edges[(i + 1) % plan.fan.edges.length] as number;
    const other = out === e ? into : out;
    return plan.cls.get(other) === SEL ? tokens.get(`m:${f}:${x}`) : tokens.get(`s:${other}:${x}`);
  };
  /** With one selected edge at x, the end chain from A through the rest of the cycle to B (null: no such chain). */
  const restChain = (x: number, e: number, A: number, B: number): number[] | null => {
    const { entries } = planOf(x);
    const at = entries.findIndex((entry) => entry.sel === e);
    const rest: number[] = [];
    for (let j = 1; j < entries.length; j++) rest.push((entries[(at + j) % entries.length] as Entry).token);
    if (rest[0] !== A) rest.reverse();
    return rest[0] === A && rest[rest.length - 1] === B ? rest : null;
  };
  const chords = new Map<string, number[]>(); // `${lo}:${hi}:${x}` → profile tokens from lo to hi
  const faceChords = new Map<string, string>(); // `${lo}:${hi}` → chord key, for strip ends a rebuilt face shares
  const chordKey = (a: number, b: number, x: number): string => `${Math.min(a, b)}:${Math.max(a, b)}:${x}`;
  const chordOf = (A: number, B: number, x: number): number[] => {
    const key = chordKey(A, B, x);
    const known = chords.get(key);
    if (known !== undefined) return known;
    const lo = Math.min(A, B);
    const hi = Math.max(A, B);
    const da = (tokens.list[lo] as Token).delta;
    const db = (tokens.list[hi] as Token).delta;
    const list: number[] = [];
    for (let i = 1; i < segments; i++) {
      const s = i / segments;
      const delta = new Float64Array(3);
      for (let k = 0; k < 3; k++) {
        const a = da[k] as number;
        const b = db[k] as number;
        if (args.chamfer) delta[k] = (1 - s) * a + s * b;
        else {
          // C − x = 0, so C′ − x = (1 − 2·roundness)·(M − x).
          const c = ((1 - 2 * args.roundness) * (a + b)) / 2;
          delta[k] = (1 - s) * (1 - s) * a + 2 * s * (1 - s) * c + s * s * b;
        }
      }
      list.push(tokens.make(`p:${key}:${i}`, T_PROFILE, x, delta, { chord: [lo, hi], s }));
    }
    chords.set(key, list);
    return list;
  };
  const oriented = (list: readonly number[], from: number, to: number): number[] =>
    from < to ? [...list] : [...list].reverse();

  const strips: Strip[] = [];
  for (const e of selected) {
    const c1 = m.edgeCorner(e);
    const f1 = m.cornerFace(c1);
    const f2 = m.cornerFace(m.cornerRadialNext(c1));
    const v = m.cornerVert(c1);
    const ends: StripEnd[] = [];
    for (const x of [v, m.edgeOther(e, v)]) {
      const A = sideToken(x, f1, e);
      const B = sideToken(x, f2, e);
      const plan = planOf(x);
      const chain = plan.k >= 2 ? [A, B] : restChain(x, e, A, B);
      if (chain === null || chain.length < 1 || chain.length > 3) {
        return refuse('bevel.non-manifold', `Bevel could not order the faces around vertex ${x}`);
      }
      const rows: number[] = [];
      let insert = -1;
      if (chain.length === 1) for (let i = 0; i <= segments; i++) rows.push(A);
      else if (chain.length === 2) {
        rows.push(A, ...oriented(chordOf(A, B, x), A, B), B);
        if (plan.k === 1 && segments > 1) faceChords.set(`${Math.min(A, B)}:${Math.max(A, B)}`, chordKey(A, B, x));
      } else {
        const kept = chain[1] as number;
        rows.push(A);
        for (let i = 1; i < segments; i++) rows.push(kept);
        rows.push(B);
        if (segments === 1) insert = kept;
      }
      ends.push({ x, A, B, rows, insert });
    }
    strips.push({ e, f1, f2, v: ends[0] as StripEnd, w: ends[1] as StripEnd });
  }

  // ----- polygons -----
  const polys: Poly[] = [];
  /** Adds a polygon with consecutive duplicates dropped (cyclically); the surviving edge keeps the stronger tag. */
  const push = (poly: Poly): Poly => {
    const list: number[] = [];
    const tags: number[] = [];
    for (let i = 0; i < poly.tokens.length; i++) {
      const t = poly.tokens[i] as number;
      const tag = poly.tags[i] as number;
      if (list.length > 0 && list[list.length - 1] === t) {
        tags[tags.length - 1] = Math.max(tags[tags.length - 1] as number, tag);
        continue;
      }
      list.push(t);
      tags.push(tag);
    }
    while (list.length > 1 && list[0] === list[list.length - 1]) {
      list.pop();
      const tag = tags.pop() as number;
      tags[tags.length - 1] = Math.max(tags[tags.length - 1] as number, tag);
    }
    const out = { ...poly, tokens: list, tags };
    polys.push(out);
    return out;
  };
  const rebuiltFaces = [...new Set(bevelled.flatMap((x) => planOf(x).fan.faces))].sort((a, b) => a - b);
  for (const f of rebuiltFaces) {
    const list: number[] = [];
    for (const c of cornersOfFace(m, f)) {
      const x = m.cornerVert(c);
      const plan = vp.get(x);
      if (plan === undefined) list.push(tokens.old(x));
      else list.push(...(plan.replacement.get(f) as readonly number[]));
      const u = m.cornerEdge(c);
      const y = m.cornerVert(m.cornerNext(c));
      if (isSlide(u, x)) list.push(tokens.get(`s:${u}:${x}`));
      if (isSlide(u, y)) list.push(tokens.get(`s:${u}:${y}`));
    }
    const withChords: number[] = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as number;
      const b = list[(i + 1) % list.length] as number;
      withChords.push(a);
      const key = faceChords.get(`${Math.min(a, b)}:${Math.max(a, b)}`);
      if (key !== undefined) withChords.push(...oriented(chords.get(key) as number[], a, b));
    }
    push({ kind: 'rebuilt', tokens: withChords, tags: withChords.map(() => TAG_NONE), source: f, example: f, fan: -1 });
  }
  const segmentOf = (end: StripEnd, j: number): number[] =>
    end.insert !== -1 ? [end.A, end.insert, end.B] : [end.rows[j] as number, end.rows[j + 1] as number];
  for (const strip of strips) {
    for (let j = 0; j < segments; j++) {
      const sv = segmentOf(strip.v, j);
      const sw = segmentOf(strip.w, j).reverse();
      const tags: number[] = [];
      // Along the v end, the long side at row j + 1, along the w end, the long side at row j.
      for (let i = 0; i < sv.length - 1; i++) tags.push(TAG_BORDER);
      tags.push(j + 1 === segments ? TAG_BORDER : TAG_ROW);
      for (let i = 0; i < sw.length - 1; i++) tags.push(TAG_BORDER);
      tags.push(j === 0 ? TAG_BORDER : TAG_ROW);
      push({ kind: 'row', tokens: [...sv, ...sw], tags, source: strip.e, example: strip.f1, fan: -1 });
    }
  }
  const fanVertices: number[] = [];
  const faceNormal = new Float64Array(3);
  for (const x of bevelled) {
    const plan = planOf(x);
    if (plan.k < 2) continue;
    const distinct = new Set<number>();
    for (const entry of plan.entries) if (entry.sel === -1) distinct.add(entry.token);
    if (distinct.size < 3) continue;
    const n = plan.entries.length;
    const boundary: number[] = [];
    for (let i = 0; i < n; i++) {
      const entry = plan.entries[i] as Entry;
      if (entry.sel === -1) {
        boundary.push(entry.token);
        continue;
      }
      const before = (plan.entries[(i + n - 1) % n] as Entry).token;
      const after = (plan.entries[(i + 1) % n] as Entry).token;
      boundary.push(...oriented(chords.get(chordKey(before, after, x)) ?? [], before, after));
    }
    const example = Math.min(...plan.fan.faces);
    if (plan.k < 3 || segments === 1) {
      push({ kind: 'patch', tokens: boundary, tags: boundary.map(() => TAG_BORDER), source: x, example, fan: -1 });
      continue;
    }
    // A fan around a centre vertex: the mean of the boundary, pushed along the vertex normal by the profile's mean
    // bulge (roundness · (C − M) per chord; none for a chamfer).
    const ring = [...new Set(boundary)];
    const delta = new Float64Array(3);
    for (const t of ring) {
      const token = tokens.list[t] as Token;
      for (let k = 0; k < 3; k++) delta[k] = (delta[k] as number) + (token.delta[k] as number) / ring.length;
    }
    if (!args.chamfer) {
      const vertexNormal = new Float64Array(3);
      for (const f of plan.fan.faces) {
        faceNewell(m, f, faceNormal);
        const l = Math.hypot(faceNormal[0] as number, faceNormal[1] as number, faceNormal[2] as number);
        if (l > 0)
          for (let k = 0; k < 3; k++) vertexNormal[k] = (vertexNormal[k] as number) + (faceNormal[k] as number) / l;
      }
      const nl = Math.hypot(vertexNormal[0] as number, vertexNormal[1] as number, vertexNormal[2] as number);
      if (nl > 0) {
        let bulge = 0;
        let count = 0;
        for (let i = 0; i < n; i++) {
          if ((plan.entries[i] as Entry).sel === -1) continue;
          const a = (tokens.list[(plan.entries[(i + n - 1) % n] as Entry).token] as Token).delta;
          const b = (tokens.list[(plan.entries[(i + 1) % n] as Entry).token] as Token).delta;
          for (let k = 0; k < 3; k++) {
            bulge -= (args.roundness * (((a[k] as number) + (b[k] as number)) / 2) * (vertexNormal[k] as number)) / nl;
          }
          count++;
        }
        for (let k = 0; k < 3; k++)
          delta[k] = (delta[k] as number) + ((bulge / count) * (vertexNormal[k] as number)) / nl;
      }
    }
    const center = tokens.make(`c:${x}`, T_CENTER, x, delta);
    const fan = fanVertices.length;
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i] as number;
      const b = boundary[(i + 1) % boundary.length] as number;
      if (a === b) continue;
      push({ kind: 'fan', tokens: [center, a, b], tags: [TAG_SPOKE, TAG_BORDER, TAG_SPOKE], source: x, example, fan });
    }
    fanVertices.push(x);
  }
  for (const poly of polys) {
    if (poly.kind !== 'row' && new Set(poly.tokens).size < 3) {
      return refuse(
        'bevel.zero-width',
        `Bevel would collapse ${poly.kind === 'rebuilt' ? `face ${poly.source}` : `the corner at vertex ${poly.source}`}`,
      );
    }
  }
  // A row whose ends both converge on kept vertices has no area: its neighbours share its long edge instead.
  const live = polys.filter((poly) => new Set(poly.tokens).size >= 3);
  // The rows of each strip (by its edge) and the triangles of each fan (by its bevelled vertex).
  const rowsOf = new Map<number, Poly[]>();
  const fanPolys = new Map<number, Poly[]>();
  for (const poly of live) {
    const group = poly.kind === 'row' ? rowsOf : poly.kind === 'fan' ? fanPolys : null;
    if (group === null) continue;
    const list = group.get(poly.source);
    if (list === undefined) group.set(poly.source, [poly]);
    else list.push(poly);
  }

  // ----- the clamp: the largest width factor λ ≤ 1 keeping faces oriented, untwisted and simple, edges forward -----
  const refs = new Map<Poly, Float64Array>();
  // Rebuilt faces whose original is a simple polygon (projected along its dominant axis) must stay simple: a reflex
  // miter or a slide into a notch can otherwise cross the face's far side while its orientation still holds.
  const simple = new Map<Poly, number>();
  // Edges between tokens of two different vertices (the only ones whose direction changes with λ: tokens of one
  // vertex scale about it) must keep their direction at λ → 0, the original edge's: new vertices must not pass each
  // other along an edge. At an acute corner the miters do, and the shrunk face beyond comes out rotated by 180°, which
  // keeps its Newell normal, while every strip along it becomes a bow-tie.
  const forward = new Map<Poly, Float64Array>(); // per poly: (i, x, y, z) for edge tokens[i] → tokens[i + 1]
  // Strip rows of four or more corners: every corner triangle (for a quad, the triangles of both diagonal splits)
  // that mixes two vertices keeps its orientation at λ → 0, so a nonplanar row cannot twist into a bow-tie.
  const turns = new Map<Poly, Float64Array>(); // per row: (i, x, y, z) for the corner triangle at tokens[i]
  const ref3 = new Float64Array(3);
  for (const poly of live) {
    const n = poly.tokens.length;
    const dirs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = tokens.list[poly.tokens[i] as number] as Token;
      const b = tokens.list[poly.tokens[(i + 1) % n] as number] as Token;
      if (a.at === b.at) continue;
      const dx = (b.base[0] as number) - (a.base[0] as number);
      const dy = (b.base[1] as number) - (a.base[1] as number);
      const dz = (b.base[2] as number) - (a.base[2] as number);
      if (Math.hypot(dx, dy, dz) > eps) dirs.push(i, dx, dy, dz);
    }
    if (dirs.length > 0) forward.set(poly, Float64Array.from(dirs));
    if (poly.kind === 'row' && n >= 4) {
      const points = new Float64Array(3 * n);
      poly.tokens.forEach((t, i) => tokens.position(t, LAMBDA_REF, points, 3 * i));
      const list: number[] = [];
      for (let i = 0; i < n; i++) {
        const p = poly.tokens[(i + n - 1) % n] as number;
        const c = poly.tokens[i] as number;
        const q = poly.tokens[(i + 1) % n] as number;
        const at = (tokens.list[c] as Token).at;
        if ((tokens.list[p] as Token).at === at && (tokens.list[q] as Token).at === at) continue;
        const scale = cornerTurn(points, n, i, ref3);
        if (Math.hypot(ref3[0] as number, ref3[1] as number, ref3[2] as number) > 1e-9 * scale) {
          list.push(i, ref3[0] as number, ref3[1] as number, ref3[2] as number);
        }
      }
      if (list.length > 0) turns.set(poly, Float64Array.from(list));
    }
    if (poly.kind === 'rebuilt') {
      const ref = faceNewell(m, poly.source, new Float64Array(3));
      refs.set(poly, ref);
      const corners = cornersOfFace(m, poly.source);
      if (corners.length < 3 || poly.tokens.length < 4) continue;
      const points = new Float64Array(3 * corners.length);
      const ids = corners.map((c, i) => {
        const v = m.cornerVert(c);
        for (let k = 0; k < 3; k++) points[3 * i + k] = m.position[3 * v + k] as number;
        return v;
      });
      const drop = dominantAxis(ref);
      if (simpleIn(points, ids, drop, eps)) simple.set(poly, drop);
    } else if (poly.kind === 'row') {
      const points = new Float64Array(3 * poly.tokens.length);
      poly.tokens.forEach((t, i) => tokens.position(t, LAMBDA_REF, points, 3 * i));
      const ref = new Float64Array(3);
      newell(points, poly.tokens.length, ref);
      refs.set(poly, ref);
      // A row through an in-line vertex (five or six corners) stays simple when it starts simple.
      const drop = dominantAxis(ref);
      if (poly.tokens.length >= 5 && simpleIn(points, poly.tokens, drop, 0)) simple.set(poly, drop);
    }
  }
  // The vertices of the result around each bevelled vertex (every token there is used): no two may coincide (Roundness
  // 1 with an even segment count puts the middle profile point of every strip at the corner).
  const around = new Map<number, number[]>();
  for (const t of [...new Set(live.flatMap((poly) => poly.tokens))].sort((a, b) => a - b)) {
    const x = (tokens.list[t] as Token).at;
    if (!vp.has(x)) continue;
    const list = around.get(x);
    if (list === undefined) around.set(x, [t]);
    else list.push(t);
  }
  const normal = new Float64Array(3);
  const pair = new Float64Array(6);
  const valid = (lambda: number): boolean => {
    for (const list of around.values()) {
      for (let i = 0; i < list.length; i++) {
        tokens.position(list[i] as number, lambda, pair, 0);
        for (let j = i + 1; j < list.length; j++) {
          tokens.position(list[j] as number, lambda, pair, 3);
          const gap = Math.hypot(
            (pair[3] as number) - (pair[0] as number),
            (pair[4] as number) - (pair[1] as number),
            (pair[5] as number) - (pair[2] as number),
          );
          if (!(gap > eps)) return false;
        }
      }
    }
    for (const poly of live) {
      const n = poly.tokens.length;
      const points = new Float64Array(3 * n);
      poly.tokens.forEach((t, i) => tokens.position(t, lambda, points, 3 * i));
      let longest = 0;
      for (let i = 0; i < n; i++) {
        const a = 3 * i;
        const b = 3 * ((i + 1) % n);
        const length = Math.hypot(
          (points[b] as number) - (points[a] as number),
          (points[b + 1] as number) - (points[a + 1] as number),
          (points[b + 2] as number) - (points[a + 2] as number),
        );
        longest = Math.max(longest, length);
        if (!(length > eps)) return false;
      }
      const dirs = forward.get(poly);
      if (dirs !== undefined) {
        for (let j = 0; j < dirs.length; j += 4) {
          const a = 3 * (dirs[j] as number);
          const b = 3 * (((dirs[j] as number) + 1) % n);
          const along =
            ((points[b] as number) - (points[a] as number)) * (dirs[j + 1] as number) +
            ((points[b + 1] as number) - (points[a + 1] as number)) * (dirs[j + 2] as number) +
            ((points[b + 2] as number) - (points[a + 2] as number)) * (dirs[j + 3] as number);
          if (!(along > 0)) return false;
        }
      }
      const corners = turns.get(poly);
      if (corners !== undefined) {
        for (let j = 0; j < corners.length; j += 4) {
          cornerTurn(points, n, corners[j] as number, normal);
          const same =
            (normal[0] as number) * (corners[j + 1] as number) +
            (normal[1] as number) * (corners[j + 2] as number) +
            (normal[2] as number) * (corners[j + 3] as number);
          if (!(same > 0)) return false;
        }
      }
      // A height (2 × area / longest edge, Mesh Check's zero-area measure) above ε: a sliver of a corner polygon or fan
      // at a very acute corner (whose shape does not change with λ) refuses rather than reaching Mesh Check.
      newell(points, n, normal);
      if (!(Math.hypot(normal[0] as number, normal[1] as number, normal[2] as number) > eps * longest)) return false;
      const ref = refs.get(poly);
      const refLength = ref === undefined ? 0 : Math.hypot(ref[0] as number, ref[1] as number, ref[2] as number);
      if (ref === undefined || !(refLength > eps * eps)) continue;
      // Oriented as before, also with that margin: a face that has just collapsed onto a line keeps a float64 sign
      // that float32 positions can flip.
      const dot =
        (normal[0] as number) * (ref[0] as number) +
        (normal[1] as number) * (ref[1] as number) +
        (normal[2] as number) * (ref[2] as number);
      if (!(dot > eps * longest * refLength)) return false;
      const drop = simple.get(poly);
      if (drop !== undefined && !simpleIn(points, poly.tokens, drop, poly.kind === 'row' ? 0 : eps)) return false;
    }
    return true;
  };
  let lambda = 1;
  if (!valid(1)) {
    // The valid factors need not reach down to 0 (a corner polygon or fan thins out with λ): find one by halving,
    // then the largest by bisection.
    let lo = 0;
    let hi = 1;
    for (let k = 0.5; k > 1e-12; k /= 2) {
      if (valid(k)) {
        lo = k;
        break;
      }
      hi = k;
    }
    for (let i = 0; i < 40 && lo > 0; i++) {
      const mid = (lo + hi) / 2;
      if (valid(mid)) lo = mid;
      else hi = mid;
    }
    const room = bevelled.every((x) => planOf(x).d * lo > eps);
    if (!args.clamp && room) {
      return refuse('bevel.too-wide', 'The bevel is so wide that faces would fold over (turn Clamp on)');
    }
    // Stop short of the boundary when that is valid too, as §5.9's 0.98 does for slides from both ends: at the largest
    // valid λ something has just collapsed (a corner triangle of a twisting row, an edge's direction), and float32
    // positions round across it.
    lambda = lo > 0 && valid(CLAMP_MARGIN * lo) ? CLAMP_MARGIN * lo : lo;
    clamped = args.clamp;
  }
  for (const x of bevelled) {
    if (!(planOf(x).d * lambda > eps)) {
      return refuse(
        'bevel.zero-width',
        `There is no room for the bevel at vertex ${x}: its faces would collapse, thin out or turn inside out at any width` +
          (!args.chamfer && args.roundness > 0.999 && segments % 2 === 0 ? ' (Roundness 1 meets at the corner)' : ''),
      );
    }
  }
  if (clamped) warnings.push({ code: 'bevel.clamped', message: 'Bevel width clamped so the faces do not overlap' });
  if (fanVertices.length > 0) {
    const named = fanVertices.slice(0, 5).join(', ') + (fanVertices.length > 5 ? ', …' : '');
    warnings.push({
      code: 'bevel.fan-corner',
      message: `The corner${fanVertices.length > 1 ? 's' : ''} at vertex ${named} ${fanVertices.length > 1 ? 'were' : 'was'} filled with a fan`,
      count: fanVertices.length,
      elements: Uint32Array.from(fanVertices),
    });
  }

  // ===== writes =====
  // 1. Slide vertices: split the slide edges (§5.2 split rules for layers, H4 for flags).
  const slideEdges = [
    ...new Set(bevelled.flatMap((x) => [...planOf(x).cls].filter(([, c]) => c === SLIDE).map(([e]) => e))),
  ];
  slideEdges.sort((a, b) => a - b);
  for (const u of slideEdges) {
    const x0 = m.edgeVert(u, 0);
    const x1 = m.edgeVert(u, 1);
    const length = edgeLength(m, u);
    const d0 = isSlide(u, x0) ? planOf(x0).d * lambda : 0;
    const d1 = isSlide(u, x1) ? planOf(x1).d * lambda : 0;
    if (d0 > 0) {
      (tokens.list[tokens.get(`s:${u}:${x0}`)] as Token).vertex = m.splitEdgeMakeVert(u, Math.min(d0 / length, 1));
      if (d1 > 0) {
        const rest = length - d0;
        const t = rest > 0 ? Math.max(0, (rest - d1) / rest) : 0;
        (tokens.list[tokens.get(`s:${u}:${x1}`)] as Token).vertex = m.splitEdgeMakeVert(m.counts.edges - 1, t);
      }
    } else if (d1 > 0) {
      (tokens.list[tokens.get(`s:${u}:${x1}`)] as Token).vertex = m.splitEdgeMakeVert(u, Math.max(0, 1 - d1 / length));
    }
  }
  // 2. The other new vertices (the sources of each kind exist before it is created).
  const point = new Float64Array(3);
  const create = (t: number): number => {
    tokens.position(t, lambda, point, 0);
    const v = m.makeVert(point[0] as number, point[1] as number, point[2] as number);
    (tokens.list[t] as Token).vertex = v;
    return v;
  };
  /**
   * Weights of a miter point over (x, far end of a, far end of b): the point x ± d·(â + b̂) in those three points'
   * affine frame. A reflex miter lies on the far ends' opposite side of x, so two weights are negative there: corner
   * values (uv0 …) extrapolate the face's affine map, which keeps a projection exact.
   */
  const miterWeights = (token: Token): number[] => {
    const d = planOf(token.at).d * lambda;
    const ta = d / Math.max(distance(m, token.at, token.far[0]), eps);
    const tb = d / Math.max(distance(m, token.at, token.far[1]), eps);
    return token.reflex ? [1 + ta + tb, -ta, -tb] : [Math.max(0, 1 - ta - tb), ta, tb];
  };
  for (let t = 0; t < tokens.list.length; t++) {
    const token = tokens.list[t] as Token;
    if (token.kind === T_MITER && !token.reflex) {
      blendPointAttributes(m, [token.at, token.far[0], token.far[1]], miterWeights(token), create(t));
    } else if (token.kind === T_MITER || token.kind === T_RUN) {
      // A reflex miter takes x's point values: extrapolated skin weights or group weights would leave their range.
      copyPointAttributes(m, token.at, create(t));
    }
  }
  for (let t = 0; t < tokens.list.length; t++) {
    const token = tokens.list[t] as Token;
    if (token.kind !== T_PROFILE) continue;
    interpolatePointAttributes(m, tokens.vertex(token.chord[0]), tokens.vertex(token.chord[1]), token.s, create(t));
  }
  for (let t = 0; t < tokens.list.length; t++) {
    const token = tokens.list[t] as Token;
    if (token.kind !== T_CENTER) continue;
    const ring = new Set<number>();
    for (const poly of fanPolys.get(token.at) ?? [])
      for (const r of poly.tokens) if (r !== t) ring.add(tokens.vertex(r));
    mergePointAttributes(
      m,
      [...ring].sort((a, b) => a - b),
      create(t),
      'average',
    );
  }

  // 2b. Symmetry (§5.14): a region of selected edges that is its own mirror (it holds an edge's partner) was bevelled
  //     once; its new vertices are symmetrized, each with the vertex of its partner token (the token made from the
  //     partner elements). A region whose mirror is another region keeps its positions (both halves ran the same way).
  if (ctx.symmetry !== null) symmetrizeRegions(m, ctx, selected, S, tokens, segments);

  // 3. Corner and face records, captured before the rebuilt faces are killed.
  const cv = new CornerValues(m);
  const fv = new FaceValues(m);
  const captured = new Map<string, Float64Array>(); // `${face}:${vertex}` → the post-split corner's record
  const faceRecord = new Map<number, Float64Array>();
  const faceMeta = new Map<number, readonly [material: number, flags: number]>();
  for (const f of rebuiltFaces) {
    for (const c of cornersOfFace(m, f)) {
      const key = `${f}:${m.cornerVert(c)}`;
      if (!captured.has(key)) captured.set(key, cv.capture(c));
    }
    faceRecord.set(f, fv.capture(f));
    faceMeta.set(f, [m.faceMaterial(f), m.faceFlags(f)]);
  }
  const zero = new Float64Array(cv.stride);
  const at = (f: number, vertex: number): Float64Array => captured.get(`${f}:${vertex}`) ?? zero;
  const records = new Map<Poly, Float64Array[]>();
  const inFace = new Map<string, Float64Array>(); // `${face}:${token}` → record in the rebuilt face
  for (const poly of live) {
    if (poly.kind !== 'rebuilt') continue;
    const f = poly.source;
    records.set(
      poly,
      poly.tokens.map((t) => {
        const token = tokens.list[t] as Token;
        let record: Float64Array;
        if (token.kind === T_MITER) {
          record = cv.blend([at(f, token.at), at(f, token.far[0]), at(f, token.far[1])], miterWeights(token));
        } else if (token.kind === T_RUN) record = at(f, token.at);
        else if (token.kind === T_PROFILE) {
          record = cv.lerp(at(f, tokens.vertex(token.chord[0])), at(f, tokens.vertex(token.chord[1])), token.s);
        } else record = at(f, token.vertex);
        inFace.set(`${f}:${t}`, record);
        return record;
      }),
    );
  }
  const valueIn = (f: number, t: number): Float64Array => inFace.get(`${f}:${t}`) ?? at(f, tokens.vertex(t));
  const stripRecord = new Map<string, Float64Array>(); // `${edge}:${token}` → record in the strip
  const profileRecord = new Map<number, Float64Array>(); // profile token → its record in every strip through it
  for (const strip of strips) {
    const own = new Map<number, Float64Array>();
    for (const end of [strip.v, strip.w]) {
      const a = valueIn(strip.f1, end.A);
      const b = valueIn(strip.f2, end.B);
      end.rows.forEach((t, i) => {
        if (own.has(t)) return;
        const token = tokens.list[t] as Token;
        if (token.kind === T_OLD && token.at === end.x) own.set(t, at(strip.f1, end.x));
        else if (token.kind === T_PROFILE) {
          // The value the rebuilt face across the strip's end has at this point, or the one the first strip through
          // a shared end gave it, else interpolated in the chord's own orientation, exactly as a face would. Where
          // the sides are continuous all three agree; across a UV seam this keeps the jump on the seam.
          let record: Float64Array | undefined = profileRecord.get(t);
          for (const f of planOf(end.x).fan.faces) record ??= inFace.get(`${f}:${t}`);
          const [lo, hi] = token.chord;
          record ??= cv.lerp(lo === end.A ? a : b, hi === end.A ? a : b, token.s);
          profileRecord.set(t, record);
          own.set(t, record);
        } else own.set(t, i === 0 ? a : b);
      });
      if (end.insert !== -1) own.set(end.insert, at(strip.f1, end.x));
    }
    for (const [t, record] of own) stripRecord.set(`${strip.e}:${t}`, record);
    for (const poly of rowsOf.get(strip.e) ?? []) {
      records.set(
        poly,
        poly.tokens.map((t) => own.get(t) ?? zero),
      );
    }
  }
  /** A corner-patch record: profile points from their strip; others from the face around x that has the token. */
  const patchRecord = (x: number, t: number): Float64Array => {
    const plan = planOf(x);
    const token = tokens.list[t] as Token;
    if (token.kind === T_PROFILE) {
      for (const e of plan.fan.edges) {
        const record = stripRecord.get(`${e}:${t}`);
        if (record !== undefined) return record;
      }
    }
    for (const f of plan.fan.faces) {
      const record = inFace.get(`${f}:${t}`);
      if (record !== undefined) return record;
    }
    return at(plan.fan.faces[0] as number, x);
  };
  const centerRecord = new Map<number, Float64Array>();
  for (const poly of live) {
    if (poly.kind === 'patch')
      records.set(
        poly,
        poly.tokens.map((t) => patchRecord(poly.source, t)),
      );
    if (poly.kind !== 'fan') continue;
    const center = poly.tokens[0] as number;
    if (!centerRecord.has(center)) {
      const ring = new Set<number>();
      for (const other of fanPolys.get(poly.source) ?? []) for (const t of other.tokens.slice(1)) ring.add(t);
      const list = [...ring].map((t) => patchRecord(poly.source, t));
      centerRecord.set(
        center,
        cv.blend(
          list,
          list.map(() => 1 / list.length),
        ),
      );
    }
    records.set(
      poly,
      poly.tokens.map((t, i) => (i === 0 ? (centerRecord.get(center) as Float64Array) : patchRecord(poly.source, t))),
    );
  }

  // 4. Kill the faces being rebuilt (descending, so the indices still to kill stay valid).
  for (let i = rebuiltFaces.length - 1; i >= 0; i--) m.killFace(rebuiltFaces[i] as number);

  // 5. Create the faces.
  const edgesBefore = m.counts.edges;
  const created = new Map<Poly, number>();
  for (const poly of live) {
    const verts = poly.tokens.map((t) => tokens.vertex(t));
    const [material, flags] = faceMeta.get(poly.example) as readonly [number, number];
    const f = m.makeFace(verts, { material });
    fv.write(f, faceRecord.get(poly.example) as Float64Array);
    if (poly.kind === 'rebuilt' && flags !== 0) m.setFaceFlags(f, flags);
    const list = records.get(poly) as Float64Array[];
    let c = m.faceCorner(f);
    for (let i = 0; i < verts.length; i++) {
      cv.write(c, list[i] as Float64Array);
      c = m.cornerNext(c);
    }
    created.set(poly, f);
  }

  // 6. Flags of the new edges: bevel borders (hard with hardenBorders, else H2), rows (H2), fan spokes (H1 over the
  //    fan's boundary), and the edges of a moved run vertex (the flags and layers of the edge they replace).
  const edgeOf = (a: number, b: number): number => m.findEdge(tokens.vertex(a), tokens.vertex(b));
  const tagOf = new Map<number, number>();
  const spokes = new Map<number, number[]>();
  const rims = new Map<number, number[]>();
  for (const poly of live) {
    if (poly.kind === 'rebuilt') continue;
    const n = poly.tokens.length;
    for (let i = 0; i < n; i++) {
      const e = edgeOf(poly.tokens[i] as number, poly.tokens[(i + 1) % n] as number);
      const tag = poly.tags[i] as number;
      if (poly.kind === 'fan') {
        const group = tag === TAG_SPOKE ? spokes : rims;
        group.set(poly.fan, [...(group.get(poly.fan) ?? []), e]);
      }
      if (e >= edgesBefore) tagOf.set(e, Math.max(tagOf.get(e) ?? TAG_NONE, tag));
    }
  }
  for (const poly of live) {
    if (poly.kind !== 'rebuilt') continue;
    const n = poly.tokens.length;
    for (let i = 0; i < n; i++) {
      const ta = poly.tokens[i] as number;
      const tb = poly.tokens[(i + 1) % n] as number;
      const e = edgeOf(ta, tb);
      if (e < edgesBefore || tagOf.has(e)) continue;
      const moved = tokens.kind(ta) === T_RUN ? ta : tokens.kind(tb) === T_RUN ? tb : -1;
      const src =
        moved === -1 ? -1 : m.findEdge((tokens.list[moved] as Token).at, tokens.vertex(moved === ta ? tb : ta));
      if (src !== -1) {
        m.setEdgeFlags(e, m.edgeFlags(src));
        copyEdgeAttributes(m, src, e);
        tagOf.set(e, TAG_NONE);
      } else tagOf.set(e, TAG_BORDER);
    }
  }
  const h2: number[] = [];
  for (const [e, tag] of [...tagOf].sort((a, b) => a[0] - b[0])) {
    if (tag === TAG_BORDER && args.hardenBorders) m.setEdgeFlags(e, m.edgeFlags(e) | EDGE_HARD);
    else if (tag === TAG_BORDER || tag === TAG_ROW) h2.push(e);
  }
  applySmoothingAngle(m, h2, args.smoothingAngle);
  for (const [fan, list] of [...spokes].sort((a, b) => a[0] - b[0])) {
    const rim = rims.get(fan) ?? [];
    const hard = rim.length > 0 && rim.every((e) => (m.edgeFlags(e) & EDGE_HARD) !== 0);
    for (const e of list) {
      if (e < edgesBefore) continue;
      const flags = m.edgeFlags(e);
      const next = hard ? flags | EDGE_HARD : flags & ~EDGE_HARD;
      if (next !== flags) m.setEdgeFlags(e, next);
    }
  }

  // 7. The result faces and the handle frame (face indices are final: only edges and vertices are removed below).
  const result: number[] = [];
  for (const [poly, f] of created) {
    if (poly.kind !== 'rebuilt') result.push(f);
    else if (faceMode && sel.faces.has(poly.source) && !isHidden(ctx.hidden, 'face', poly.source)) result.push(f);
  }
  result.sort((a, b) => a - b);
  const frame = frameOf(m, result);

  // 8. Remove what the bevel replaced: wire edges (the bevelled edges, unused halves at kept vertices), then the
  //    bevelled vertices no face uses any more.
  const kill = new Set<number>();
  for (const e of selected) if (m.edgeFaceCount(e) === 0) kill.add(e);
  const removed: number[] = [];
  for (const x of bevelled) {
    const plan = planOf(x);
    if (plan.runs.length === 1 && tokens.kind(plan.runs[0] as number) === T_OLD) {
      const start = m.vertEdge(x);
      let e = start;
      let guard = 0;
      do {
        if (m.edgeFaceCount(e) === 0) kill.add(e);
        e = m.edgeDiskNext(e, x);
      } while (e !== start && ++guard <= m.counts.edges);
    } else removed.push(x);
  }
  for (const e of [...kill].sort((a, b) => b - a)) m.killEdge(e);
  for (let i = removed.length - 1; i >= 0; i--) m.killVert(removed[i] as number);

  return { selection: selectionOf('face', result, m.counts), warnings, frame, resolvedArgs };
}

/** §5.14 for the bevel: symmetrizes the new vertices of every region of selected edges that is its own mirror. */
function symmetrizeRegions(
  m: EditMesh,
  ctx: OpContext,
  selected: readonly number[],
  S: ReadonlySet<number>,
  tokens: Tokens,
  segments: number,
): void {
  const symmetry = ctx.symmetry;
  if (symmetry === null) return;
  const { map } = symmetry;
  const at = (list: Int32Array, i: number): number => (i >= 0 && i < list.length ? (list[i] as number) : -1);
  // Regions: selected edges joined through shared vertices.
  const parent = new Map<number, number>();
  const find = (v: number): number => {
    let r = v;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) as number;
    parent.set(v, r);
    return r;
  };
  for (const e of selected) {
    const a = find(m.edgeVert(e, 0));
    const b = find(m.edgeVert(e, 1));
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }
  const selfMirror = new Set<number>();
  for (const e of selected) {
    const pe = at(map.edge, e);
    if (pe >= 0 && S.has(pe) && find(m.edgeVert(pe, 0)) === find(m.edgeVert(e, 0)))
      selfMirror.add(find(m.edgeVert(e, 0)));
  }
  if (selfMirror.size === 0) return;
  // The partner of a token: the token made from the partner elements (−1 when one has none).
  const memo = new Map<number, number>();
  const mirrorToken = (t: number): number => {
    const known = memo.get(t);
    if (known !== undefined) return known;
    const token = tokens.list[t] as Token;
    const parts = token.key.split(':').map(Number);
    const x = at(map.vertex, token.at);
    let key: string | null = null;
    if (x >= 0) {
      switch (token.kind) {
        case T_OLD:
          key = `o:${x}`;
          break;
        case T_SLIDE: {
          const e = at(map.edge, parts[1] as number);
          if (e >= 0) key = `s:${e}:${x}`;
          break;
        }
        case T_MITER: {
          const f = at(map.face, parts[1] as number);
          if (f >= 0) key = `m:${f}:${x}`;
          break;
        }
        case T_RUN: {
          const edges = token.run.map((e) => at(map.edge, e));
          if (!edges.includes(-1)) key = `r:${x}:${Math.min(...edges)}`;
          break;
        }
        case T_CENTER:
          key = `c:${x}`;
          break;
        case T_PROFILE: {
          const lo = mirrorToken(token.chord[0]);
          const hi = mirrorToken(token.chord[1]);
          const i = Math.round(token.s * segments);
          if (lo >= 0 && hi >= 0) key = `p:${Math.min(lo, hi)}:${Math.max(lo, hi)}:${x}:${lo < hi ? i : segments - i}`;
          break;
        }
        default:
          key = null;
      }
    }
    const partner = key === null ? -1 : tokens.find(key);
    memo.set(t, partner);
    return partner;
  };
  const verts: number[] = [];
  const partnerOf = new Map<number, number>();
  for (let t = 0; t < tokens.list.length; t++) {
    const token = tokens.list[t] as Token;
    if (token.kind === T_OLD || token.vertex < 0 || !selfMirror.has(find(token.at))) continue;
    const u = mirrorToken(t);
    const vertex = u >= 0 ? tokens.vertex(u) : -1;
    verts.push(token.vertex);
    partnerOf.set(token.vertex, vertex);
  }
  symmetrizeVertices(m, verts, (v) => partnerOf.get(v) ?? -1, mirrorOf(map, ctx.placement));
}

/**
 * The bevel handle frame (mesh-local): the pivot at the mean centroid of the bevel faces, Z along their mean normal,
 * X the world axis least aligned with Z made orthogonal to it, Y = Z × X.
 */
function frameOf(m: EditMesh, faces: readonly number[]): OpFrame {
  const pivot: [number, number, number] = [0, 0, 0];
  const z: [number, number, number] = [0, 0, 0];
  const n = new Float64Array(3);
  const p = m.position;
  let count = 0;
  for (const f of faces) {
    const corners = cornersOfFace(m, f);
    for (const c of corners) {
      const v = m.cornerVert(c);
      for (let k = 0; k < 3; k++) pivot[k] = (pivot[k] as number) + (p[3 * v + k] as number) / corners.length;
    }
    faceNewell(m, f, n);
    const l = Math.hypot(n[0] as number, n[1] as number, n[2] as number);
    if (l > 0) for (let k = 0; k < 3; k++) z[k] = (z[k] as number) + (n[k] as number) / l;
    count++;
  }
  if (count > 0) for (let k = 0; k < 3; k++) pivot[k] = (pivot[k] as number) / count;
  let zl = Math.hypot(...z);
  if (!(zl > 0)) {
    z[0] = 0;
    z[1] = 1;
    z[2] = 0;
    zl = 1;
  }
  for (let k = 0; k < 3; k++) z[k] = (z[k] as number) / zl;
  // X: the world axis least aligned with Z, made orthogonal to it.
  const ax = Math.abs(z[0]);
  const ay = Math.abs(z[1]);
  const az = Math.abs(z[2]);
  const seed: [number, number, number] = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const dot = seed[0] * z[0] + seed[1] * z[1] + seed[2] * z[2];
  const x: [number, number, number] = [seed[0] - dot * z[0], seed[1] - dot * z[1], seed[2] - dot * z[2]];
  const xl = Math.hypot(...x);
  for (let k = 0; k < 3; k++) x[k] = (x[k] as number) / xl;
  const y: [number, number, number] = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return { pivot, axes: [x, y, z] };
}
