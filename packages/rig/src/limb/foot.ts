import type { Quat, ReadonlyVec3, SplineSet, Vec3 } from '@ekza-animator/anim-core';
import { clean } from '../autorig/shapes';
import { allocXfArrays, type XfArrays, xfaMul } from '../math/xfa';
import type { FootRollParams, SkeletonDesc } from '../types';
import { footParamsProblem } from './template';

// Foot roll of a leg's `ik2` op (M2A-SPEC §5.2.3, §5.3.1, research 07 §12): pivots on the foot line from the foot
// mesh (the support function the io skeleton reader stores in SkeletonDesc.boneSupport) with bone-based fallbacks,
// and the pivot transforms Bank · Heel · Toe · Ball in the foot frame Q = R_y(yaw).

/** Samples per turn of `SkeletonDesc.boneSupport` (then min y and max y). */
const SUPPORT_SAMPLES = 32;
/** Default break angle β (§5.2.3). */
export const DEFAULT_BREAK_ANGLE = Math.PI / 6;

/** Pivot positions in the IK control's rest frame (§4.3 FootRollParams). */
export interface FootPivots {
  readonly heel: Vec3;
  /**
   * The ball roll's pivot: on the ground (`ground + f·ballFront`), or, when `footPivots` is given the ball joint's
   * height (legs with a toes bone), at that height above the same ground point, so the foot turns about the toes
   * joint (§5.3.1, acceptance fix round 1).
   */
  readonly ball: Vec3;
  readonly toe: Vec3;
  readonly inner: Vec3;
  readonly outer: Vec3;
}

/** f = R_y(yaw)·(0, 0, 1) and l = side·R_y(yaw)·(1, 0, 0) (outward). */
function footAxes(params: FootRollParams): { readonly f: Vec3; readonly l: Vec3 } {
  const s = Math.sin(params.yaw);
  const c = Math.cos(params.yaw);
  return { f: [s, 0, c], l: [params.side * c, 0, -params.side * s] };
}

/**
 * The pivots of `params` in the IK control's rest frame. `ballJointY` (the toes joint's rest height in that frame,
 * `limbFootRoll`) lifts the ball roll's pivot from the ground to the toes joint; the toe tip and the bank pivots stay
 * on the ground line through the ball.
 */
export function footPivots(params: FootRollParams, ballJointY: number | null = null): FootPivots {
  const { f, l } = footAxes(params);
  const g = params.ground;
  const along = (base: ReadonlyVec3, dir: Vec3, k: number): Vec3 => [
    base[0] + dir[0] * k,
    base[1] + dir[1] * k,
    base[2] + dir[2] * k,
  ];
  const ground = along(g, f, params.ballFront);
  return {
    heel: along(g, f, -params.heelBack),
    ball: ballJointY === null || !Number.isFinite(ballJointY) ? ground : [ground[0], ballJointY, ground[2]],
    toe: along(ground, f, params.toeFront),
    inner: along(ground, l, -params.innerWidth),
    outer: along(ground, l, params.outerWidth),
  };
}

/**
 * The IK control's `custom` footprint (§5.2 table): the quadrilateral through heel and toe tip, each offset inward
 * by l·innerWidth and outward by l·outerWidth, on the ground plane, in metres in the control's frame (the control
 * shape uses size 1 and an identity offset).
 */
export function footprintShape(params: FootRollParams): SplineSet {
  const { l } = footAxes(params);
  const p = footPivots(params);
  const point = (base: Vec3, k: number): [number, number, number] => [
    clean(base[0] + l[0] * k),
    clean(base[1] + l[1] * k),
    clean(base[2] + l[2] * k),
  ];
  return {
    v: 1,
    splines: [
      {
        kind: 'poly',
        closed: true,
        points: [
          point(p.heel, -params.innerWidth),
          point(p.heel, params.outerWidth),
          point(p.toe, params.outerWidth),
          point(p.toe, -params.innerWidth),
        ],
      },
    ],
  };
}

const EDITABLE: readonly (keyof FootRollParams)[] = [
  'heelBack',
  'ballFront',
  'toeFront',
  'innerWidth',
  'outerWidth',
  'breakAngle',
  'side',
  'ground',
  'yaw',
];

/**
 * Checks a `rig.setFootParams` patch (§5.2.3): every distance is a finite number ≥ 0 and `breakAngle` lies in
 * [0, π/2] (`side` ±1, `ground` three finite numbers, `yaw` finite when given). Returns the merged parameters or the
 * reason the patch is refused. Unknown keys are refused too.
 */
export function validateFootParams(
  current: FootRollParams,
  patch: Partial<FootRollParams>,
): FootRollParams | { readonly error: string } {
  if (typeof patch !== 'object' || patch === null) return { error: 'The foot parameters must be an object' };
  for (const key of Object.keys(patch)) {
    if (!(EDITABLE as readonly string[]).includes(key)) return { error: `Unknown foot parameter '${key}'` };
  }
  for (const key of ['heelBack', 'ballFront', 'toeFront', 'innerWidth', 'outerWidth'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return { error: `${key} must be a distance ≥ 0 (got ${String(value)})` };
    }
  }
  if (patch.breakAngle !== undefined) {
    const beta = patch.breakAngle;
    if (typeof beta !== 'number' || !Number.isFinite(beta) || beta < 0 || beta > Math.PI / 2) {
      return { error: `breakAngle must lie between 0° and 90° (got ${String(beta)})` };
    }
  }
  const merged = { ...current, ...patch } as FootRollParams;
  const problem = footParamsProblem(merged);
  if (problem !== null) return { error: problem };
  return {
    side: merged.side,
    ground: [merged.ground[0], merged.ground[1], merged.ground[2]],
    yaw: merged.yaw,
    heelBack: merged.heelBack,
    ballFront: merged.ballFront,
    toeFront: merged.toeFront,
    innerWidth: merged.innerWidth,
    outerWidth: merged.outerWidth,
    breakAngle: merged.breakAngle,
  };
}

/** Elements of the FootRoll scratch transforms. */
const BANK = 0;
const HEEL = 1;
const TOE = 2;
const BALL = 3;
/** G = Bank · Heel · Toe (ball roll excluded: the toes' frame). */
export const FOOT_G = 4;
/** F = G · Ball. */
export const FOOT_F = 5;
/** Ball at a scaled roll (the toes rule's blended counter-rotation). */
export const FOOT_BALL_W = 6;
const COUNT = 7;

/**
 * Allocation-free foot-roll transforms (§5.3.1): with Q = R_y(yaw) and P(p, R) = T(p)·Q·R·Q⁻¹·T(−p),
 * Bank = P(bank ≥ 0 ? inner : outer, R_z(side·bank)), Heel = P(heel, R_y(heelTwist)·R_x(min(roll, 0))),
 * Toe = P(toe, R_y(toeTwist)·R_x(max(roll − β, 0))), Ball = P(ball, R_x(clamp(roll, 0, β))), F = Bank·Heel·Toe·Ball.
 * `ballJointY` places the ball pivot at the toes joint's height (`footPivots`): the ik2 op and the match functions
 * build their foot roll through `limbFootRoll`, which passes it for legs with a toes bone.
 */
export class FootRoll {
  readonly xf: XfArrays = allocXfArrays(COUNT);
  readonly params: FootRollParams;
  readonly pivots: FootPivots;
  private readonly q: Quat;
  private readonly qInv: Quat;
  private readonly r: Quat = [0, 0, 0, 1];
  private readonly tmp: Quat = [0, 0, 0, 1];
  /** Angles handed to `pivot` (numbers stay in buffers on the per-frame path) and `compute`'s inputs. */
  private readonly angles = new Float64Array(3);
  private readonly input = new Float64Array(4);
  /** The ball roll of the last `compute` (radians). */
  ballRoll = 0;

  constructor(params: FootRollParams, ballJointY: number | null = null) {
    this.params = params;
    this.pivots = footPivots(params, ballJointY);
    const half = params.yaw / 2;
    this.q = [0, Math.sin(half), 0, Math.cos(half)];
    this.qInv = [0, -Math.sin(half), 0, Math.cos(half)];
  }

  /** Fills Bank, Heel, Toe, Ball, G and F for the given attribute values (non-finite values read 0). */
  compute(roll: number, bank: number, heelTwist: number, toeTwist: number): void {
    const values = this.input;
    values[0] = roll;
    values[1] = bank;
    values[2] = heelTwist;
    values[3] = toeTwist;
    this.computeFrom(values, 0);
  }

  /**
   * `compute` reading roll, bank, heelTwist and toeTwist from `values[offset … offset + 3]` (the op's per-frame
   * path: numbers stay in buffers, so no call boxes them).
   */
  computeFrom(values: Float64Array, offset: number): void {
    const roll = values[offset] as number;
    const bank = values[offset + 1] as number;
    const heelTwist = values[offset + 2] as number;
    const toeTwist = values[offset + 3] as number;
    const r = Number.isFinite(roll) ? roll : 0;
    const b = Number.isFinite(bank) ? bank : 0;
    const beta = this.params.breakAngle;
    const angles = this.angles;
    const p = this.pivots;
    this.ballRoll = Math.min(Math.max(r, 0), beta);
    angles[0] = 0;
    angles[1] = 0;
    angles[2] = this.params.side * b;
    this.pivot(BANK, b >= 0 ? p.inner : p.outer, 0);
    angles[0] = Math.min(r, 0);
    angles[1] = Number.isFinite(heelTwist) ? heelTwist : 0;
    angles[2] = 0;
    this.pivot(HEEL, p.heel, 1);
    angles[0] = Math.max(r - beta, 0);
    angles[1] = Number.isFinite(toeTwist) ? toeTwist : 0;
    this.pivot(TOE, p.toe, 1);
    angles[0] = this.ballRoll;
    angles[1] = 0;
    this.pivot(BALL, p.ball, 0);
    xfaMul(this.xf, BANK, this.xf, HEEL, this.xf, FOOT_G);
    xfaMul(this.xf, FOOT_G, this.xf, TOE, this.xf, FOOT_G);
    xfaMul(this.xf, FOOT_G, this.xf, BALL, this.xf, FOOT_F);
  }

  /** Ball at `values[index]` × the last ball roll into FOOT_BALL_W. */
  computeBall(values: Float64Array, index: number): void {
    const angles = this.angles;
    angles[0] = this.ballRoll * (values[index] as number);
    angles[1] = 0;
    angles[2] = 0;
    this.pivot(FOOT_BALL_W, this.pivots.ball, 0);
  }

  /**
   * Element `i` = T(p)·Q·R·Q⁻¹·T(−p) with the angles in `this.angles` = [rx, twist, rz]: R = R_y(twist)·R_x(rx) when
   * `yFirst` is 1, else R_x(rx)·R_z(rz) (only one of rx, rz is non-zero then).
   */
  private pivot(i: number, p: Vec3, yFirst: number): void {
    const r = this.r;
    const tmp = this.tmp;
    const rx = this.angles[0] as number;
    const twist = this.angles[1] as number;
    const rz = this.angles[2] as number;
    // R_x(rx)
    r[0] = Math.sin(rx / 2);
    r[1] = 0;
    r[2] = 0;
    r[3] = Math.cos(rx / 2);
    if (yFirst === 1 && twist !== 0) {
      // R_y(twist) · R_x(rx)
      const sy = Math.sin(twist / 2);
      const cy = Math.cos(twist / 2);
      const x = r[0];
      const w = r[3];
      r[0] = cy * x;
      r[1] = sy * w;
      r[2] = -sy * x;
      r[3] = cy * w;
    }
    if (rz !== 0) {
      // R_z(rz) (rx is 0 here)
      r[0] = 0;
      r[1] = 0;
      r[2] = Math.sin(rz / 2);
      r[3] = Math.cos(rz / 2);
    }
    // Q · R · Q⁻¹
    quatMul(this.q, r, tmp);
    quatMul(tmp, this.qInv, r);
    const xf = this.xf;
    const o4 = i * 4;
    xf.q[o4] = r[0];
    xf.q[o4 + 1] = r[1];
    xf.q[o4 + 2] = r[2];
    xf.q[o4 + 3] = r[3];
    // t = p − r ⊗ p
    const qx = r[0];
    const qy = r[1];
    const qz = r[2];
    const qw = r[3];
    const tx = 2 * (qy * p[2] - qz * p[1]);
    const ty = 2 * (qz * p[0] - qx * p[2]);
    const tz = 2 * (qx * p[1] - qy * p[0]);
    const o3 = i * 3;
    xf.t[o3] = p[0] - (p[0] + qw * tx + (qy * tz - qz * ty));
    xf.t[o3 + 1] = p[1] - (p[1] + qw * ty + (qz * tx - qx * tz));
    xf.t[o3 + 2] = p[2] - (p[2] + qw * tz + (qx * ty - qy * tx));
    xf.s[o3] = 1;
    xf.s[o3 + 1] = 1;
    xf.s[o3 + 2] = 1;
  }
}

function quatMul(a: Quat, b: Quat, out: Quat): void {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const aw = a[3];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const bw = b[3];
  out[0] = ax * bw + aw * bx + ay * bz - az * by;
  out[1] = ay * bw + aw * by + az * bx - ax * bz;
  out[2] = az * bw + aw * bz + ax * by - ay * bx;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Support of the union of `nodes` in horizontal direction θ (d = (sin θ, 0, cos θ)), absolute; −∞ without data. */
function supportAt(
  support: readonly (Float32Array | null)[],
  nodes: readonly number[],
  origin: (node: number) => ReadonlyVec3,
  theta: number,
): number {
  const turn = 2 * Math.PI;
  const step = turn / SUPPORT_SAMPLES;
  const wrapped = ((theta % turn) + turn) % turn;
  const k0 = Math.floor(wrapped / step) % SUPPORT_SAMPLES;
  const k1 = (k0 + 1) % SUPPORT_SAMPLES;
  const frac = wrapped / step - Math.floor(wrapped / step);
  const dx = Math.sin(theta);
  const dz = Math.cos(theta);
  let best = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const values = support[node];
    if (values === null || values === undefined || values.length < SUPPORT_SAMPLES + 2) continue;
    const h = (1 - frac) * (values[k0] as number) + frac * (values[k1] as number);
    const p = origin(node);
    const s = h + p[0] * dx + p[2] * dz;
    if (s > best) best = s;
  }
  return best;
}

export interface FootMeasureInput {
  readonly skeleton: SkeletonDesc;
  /** Canonical rest position of a node. */
  readonly position: (node: number) => ReadonlyVec3;
  readonly foot: number;
  /** The humanoid toes node, −1 when absent. */
  readonly toes: number;
  readonly side: 1 | -1;
  /** r_f: the `fk.foot` control's shape size (metres). */
  readonly footSize: number;
  /** 'L Leg' etc. for warnings. */
  readonly label: string;
}

/**
 * Foot-roll parameters of a leg (§5.2.3) in the IK control's rest frame (origin = the ankle). From the mesh when
 * `SkeletonDesc.boneSupport` has data for the foot or a node below it: the support function of the union of the
 * foot node and its whole subtree (the toes, and helper joints such as a heel bone that carry part of the sole);
 * values outside [0.2·r_f, 6·r_f] fall back to the bone guesses (heelBack r_f, toeFront 1.2·r_f, inner and outer
 * width r_f) and warn.
 */
export function measureFootParams(input: FootMeasureInput): {
  readonly params: FootRollParams;
  readonly warnings: readonly string[];
} {
  const { skeleton, position, foot, toes, side, footSize: rf, label } = input;
  const warnings: string[] = [];
  const ankle = position(foot);
  const subtree: number[] = [];
  const stack = [foot];
  while (stack.length > 0) {
    const node = stack.pop() as number;
    subtree.push(node);
    skeleton.nodes.forEach((candidate, index) => {
      if (candidate.parent === node && index > node) stack.push(index);
    });
  }
  const support = skeleton.boneSupport;
  const meshNodes =
    support === undefined
      ? []
      : subtree.filter((node) => {
          const values = support[node];
          return values !== null && values !== undefined && values.length >= SUPPORT_SAMPLES + 2;
        });

  // Ground: y = 0, or half a foot size below a low ankle; the lowest foot vertex when it lies below the ankle.
  let groundY = ankle[1] < 0.5 * rf ? ankle[1] - 0.5 * rf : 0;
  if (support !== undefined && meshNodes.length > 0) {
    let lowest = Number.POSITIVE_INFINITY;
    for (const node of meshNodes) {
      const values = support[node] as Float32Array;
      lowest = Math.min(lowest, position(node)[1] + (values[SUPPORT_SAMPLES] as number));
    }
    if (lowest < ankle[1]) groundY = lowest;
  }
  const ag: Vec3 = [ankle[0], groundY, ankle[2]];

  // Forward direction and ball from the toes bone.
  let f: Vec3 = [0, 0, 1];
  let ballFront = 1.5 * rf;
  if (toes >= 0) {
    const t = position(toes);
    const hx = t[0] - ankle[0];
    const hz = t[2] - ankle[2];
    const len = Math.hypot(hx, hz);
    if (len > 1e-6) f = [hx / len, 0, hz / len];
    const along = (t[0] - ag[0]) * f[0] + (t[2] - ag[2]) * f[2];
    if (Number.isFinite(along) && along > 0) ballFront = along;
    else warnings.push(`${label}: the toes are not in front of the ankle; the ball pivot uses the default`);
  }
  const yaw = Math.atan2(f[0], f[2]);
  const l: Vec3 = [side * Math.cos(yaw), 0, -side * Math.sin(yaw)];
  const ball: Vec3 = [ag[0] + f[0] * ballFront, ag[1], ag[2] + f[2] * ballFront];
  const agF = ag[0] * f[0] + ag[2] * f[2];
  const ballL = ball[0] * l[0] + ball[2] * l[2];

  const guesses = { heelBack: rf, toeFront: 1.2 * rf, innerWidth: rf, outerWidth: rf };
  const values = { ...guesses };
  if (support !== undefined && meshNodes.length > 0) {
    const s = (dx: number, dz: number): number => supportAt(support, meshNodes, position, Math.atan2(dx, dz));
    const measured = {
      heelBack: s(-f[0], -f[2]) + agF,
      toeFront: s(f[0], f[2]) - agF - ballFront,
      outerWidth: s(l[0], l[2]) - ballL,
      innerWidth: s(-l[0], -l[2]) + ballL,
    };
    for (const key of ['heelBack', 'toeFront', 'innerWidth', 'outerWidth'] as const) {
      const value = measured[key];
      if (Number.isFinite(value) && value >= 0.2 * rf && value <= 6 * rf) values[key] = value;
      else {
        warnings.push(
          `${label}: the foot mesh gives ${key} ${Number.isFinite(value) ? `${(value * 100).toFixed(1)} cm` : 'nothing'}, outside ${(0.2 * rf * 100).toFixed(1)}…${(6 * rf * 100).toFixed(1)} cm; the bone guess ${(guesses[key] * 100).toFixed(1)} cm is used`,
        );
      }
    }
  }
  return {
    params: {
      side,
      ground: [0, clean(groundY - ankle[1]), 0],
      yaw: clean(yaw),
      heelBack: clean(values.heelBack),
      ballFront: clean(ballFront),
      toeFront: clean(values.toeFront),
      innerWidth: clean(values.innerWidth),
      outerWidth: clean(values.outerWidth),
      breakAngle: DEFAULT_BREAK_ANGLE,
    },
    warnings,
  };
}
