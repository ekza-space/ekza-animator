import {
  type Quat,
  quatInvert,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  type Vec3,
} from '@ekza-animator/anim-core';

// Allocation-free two-bone IK for the `ik2` op (M2A-SPEC §5.3, research 07 §9.2) with the rest-exact amendments.
// The steps are those of the M1 solver (`twoBone.ts`, kept bit-for-bit for Plant Feet), on preallocated scratch:
//
// A (reach)        the upper clamp is hi = max(L − ε, restReach); soft IK eases towards hi instead of L.
// B (bend plane)   step 5 aligns the hinge-implied flexion direction x̂ × k (k = the world hinge after the swing)
//                  with the pole, not the mid-joint offset m. For a rest bend about the hinge both agree (m ∥ x̂ × k
//                  whenever the limb is flexed); they differ near straight (where m is noise: the spec's amendment
//                  B) and for rests that bend off the hinge (Polybot's thighs splay 28.6° in the frontal plane over
//                  vertical shins, so the knee sits 9 cm outside the hip–ankle line and does not bend about its x
//                  hinge at all): there m keeps the rest's sideways part, and aligning it with the pole would swing
//                  the knee sideways as the leg flexes. Falls back to m when x̂ ∥ k.
// C (flexion side) a rest that is hyperextended about its hinge (Seed-san's elbows −1.4°, Polybot's −4.9°) is
//                  reproduced exactly, and the solution stays continuous in the target. Measure the bend by t, the
//                  angle about the hinge from the bend of greatest reach (t > 0 flexion, t < 0 hyperextension; a
//                  reach d has the two solutions t = ±s, s = spread(d)), and let T ≥ 0 be the rest's hyperextension
//                  (t⁰ = −T). M1 takes t = s. With T > 0:
//                    s ≤ T            t = −s                        (targets between the rest reach d⁰ and full
//                                                                    reach: the hyperextended branch, exact; the
//                                                                    rest itself at s = T)
//                    T < s < T + W    t = s − 2T·(1 − x)², x = (s − T)/W   (the transition band, W = min(2T, π − T))
//                    s ≥ T + W        t = s                         (the normal flexion, exact)
//                  The band takes the bend continuously (C¹ at its far end) from the rest's −T through straight to
//                  the flexion branch while the target comes closer than d⁰ by about 8·(R_max − d⁰) (R_max the
//                  greatest reach). Its bends are less than s in size, so inside the band the end overshoots the
//                  target along the reach ray by at most about 2.2·(R_max − d⁰) (Polybot's arms 0.6 mm, Seed-san's
//                  0.03 mm); matching places the IK control so the end lands exactly (`distanceForBend`). Rests that
//                  are not hyperextended (T = 0) keep the M1 rule t = s.
//
// With these, default channels reproduce the rest pose exactly (§5.3 rest exactness) on every fixture limb.

const EPSILON_FACTOR = 1e-5;

/** Scratch and inputs of one solve; reuse one instance per op (no allocation in `solve`). */
export class TwoBoneCore {
  // Inputs (canonical character space).
  /**
   * Parent world of the upper bone: position, unit rotation, scale. Scales compose per axis like the kernel's
   * transforms (`math/xfa.ts`), so the seed reproduces the evaluated FK worlds exactly (glTF float32 scales are
   * rarely exactly uniform; the M1 solver's mean scale would miss the rest reach by ~1e-7).
   */
  readonly parentT: Vec3 = [0, 0, 0];
  readonly parentQ: Quat = [0, 0, 0, 1];
  readonly parentS: Vec3 = [1, 1, 1];
  /** Rest LOCAL transform of the upper bone (relative to its parent). */
  readonly upperT: Vec3 = [0, 0, 0];
  readonly upperQ: Quat = [0, 0, 0, 1];
  readonly upperS: Vec3 = [1, 1, 1];
  /** Mid rest relative to the upper rest world (intermediate nodes rigid at rest). */
  readonly midT: Vec3 = [0, 0, 0];
  readonly midQ: Quat = [0, 0, 0, 1];
  readonly midS: Vec3 = [1, 1, 1];
  /** End rest relative to the mid rest world. */
  readonly endT: Vec3 = [0, 0, 0];
  readonly endQ: Quat = [0, 0, 0, 1];
  /** Unit hinge axis in the mid bone's rest frame, + = flexion. */
  readonly hingeLocal: Vec3 = [1, 0, 0];
  readonly target: Vec3 = [0, 0, 0];
  readonly pole: Vec3 = [0, 0, 0];
  twist = 0;
  /** Metres; 0 = off. */
  soft = 0;
  /** d⁰ = rest |end − upper| (amendment A). */
  restReach = 0;
  /** World rotation of the end bone; ignored when `useEndRotation` is false (rest local under the mid bone). */
  readonly endWorldQ: Quat = [0, 0, 0, 1];
  useEndRotation = true;

  // Outputs: rotations relative to the parent, the upper world and the mid world (chain-relative), and worlds.
  readonly upperLocal: Quat = [0, 0, 0, 1];
  readonly midLocal: Quat = [0, 0, 0, 1];
  readonly endLocal: Quat = [0, 0, 0, 1];
  readonly upperWorldQ: Quat = [0, 0, 0, 1];
  readonly midWorldQ: Quat = [0, 0, 0, 1];
  readonly endWorldOutQ: Quat = [0, 0, 0, 1];
  reached = false;
  // Numbers passed between methods through fields: a double argument or return value of a call the optimizer does
  // not inline is boxed (allocated), and the op runs inside the kernel's large evaluate loop.
  /** Result of `bendAngle`. */
  private gamma = 0;
  /** Reach distance handed to `bendAngle`. */
  private d = 0;
  /** Angle handed to `axisAngle`. */
  private angle = 0;
  /**
   * Hinge geometry of the seeded chain (`seedChain`): the chain bent by t from its greatest reach reaches
   * √(2·(c0 + r·cos t)); the rest lies at t⁰ = −base.
   */
  private gBase = 0;
  private gR = 0;
  private gC0 = 0;
  /** T (the rest's hyperextension about the hinge, ≥ 0) and W (the transition band, amendment C). */
  private gT = 0;
  private gW = 0;
  /** Spread s handed to / bend t returned from `bendFromSpread`. */
  private s = 0;
  private t = 0;

  // Scratch.
  private readonly sU: Vec3 = [1, 1, 1];
  private readonly a: Vec3 = [0, 0, 0];
  private readonly b: Vec3 = [0, 0, 0];
  private readonly c: Vec3 = [0, 0, 0];
  private readonly tM0: Vec3 = [0, 0, 0];
  private readonly tE0: Vec3 = [0, 0, 0];
  private readonly x: Vec3 = [0, 0, 0];
  private readonly k: Vec3 = [0, 0, 0];
  private readonly u: Vec3 = [0, 0, 0];
  private readonly v: Vec3 = [0, 0, 0];
  private readonly w: Vec3 = [0, 0, 0];
  private readonly ref: Vec3 = [0, 0, 0];
  private readonly n: Vec3 = [0, 0, 0];
  private readonly qa: Quat = [0, 0, 0, 1];
  private readonly qb: Quat = [0, 0, 0, 1];
  private readonly qU: Quat = [0, 0, 0, 1];
  private readonly qM: Quat = [0, 0, 0, 1];

  solve(): void {
    const { a, b, c, tM0, tE0, x, k, w, ref, n, qa, qb, qU, qM } = this;

    // 1. Seed from rest under the current parent; the hinge geometry of the seeded chain.
    this.seedChain();
    const l1 = Math.sqrt(tM0[0] * tM0[0] + tM0[1] * tM0[1] + tM0[2] * tM0[2]);
    const l2 = Math.sqrt(tE0[0] * tE0[0] + tE0[1] * tE0[1] + tE0[2] * tE0[2]);
    const total = l1 + l2;

    // 2. Reach distance (amendment A), optionally softened, clamped into the reachable band.
    subInto(this.target, a, w);
    const dRaw = Math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);
    if (dRaw > 1e-9) {
      x[0] = w[0] / dRaw;
      x[1] = w[1] / dRaw;
      x[2] = w[2] / dRaw;
    } else {
      subInto(c, a, x);
      normalizeOr(x, 0, -1, 0);
    }
    const epsilon = EPSILON_FACTOR * total;
    const hi = Math.max(total - epsilon, this.restReach);
    const lo = Math.abs(l1 - l2) + epsilon;
    let d = dRaw;
    const soft = Math.max(0, this.soft);
    if (soft > 0 && dRaw > hi - soft) d = hi - soft + soft * (1 - Math.exp(-(dRaw - (hi - soft)) / soft));
    const reachable = dRaw >= lo - 1e-12 && dRaw <= hi + 1e-12;
    d = Math.min(Math.max(d, lo), hi);

    // 3. Bend the mid bone about its hinge only, on the branch of amendment C.
    this.d = d;
    this.bendAngle();
    this.angle = this.gamma;
    this.axisAngle(k, qa);
    quatMultiply(qa, qM, qM);
    quatRotateVec3(qM, tE0, w);
    addInto(b, w, c);

    // 4. Swing the chain so the end lies on the target ray.
    subInto(c, a, w);
    swingInto(w, x, k, qa);
    quatMultiply(qa, qU, qU);
    quatMultiply(qa, qM, qM);
    quatRotateVec3(qU, tM0, w);
    addInto(a, w, b);

    // 5. Twist about the chain axis so the hinge-implied bend direction points at the pole (amendment B).
    quatRotateVec3(qM, this.hingeLocal, k);
    normalizeOr(k, 1, 0, 0);
    cross(x, k, ref);
    if (ref[0] * ref[0] + ref[1] * ref[1] + ref[2] * ref[2] <= 1e-12) {
      subInto(b, a, ref);
      const along = ref[0] * x[0] + ref[1] * x[1] + ref[2] * x[2];
      ref[0] -= along * x[0];
      ref[1] -= along * x[1];
      ref[2] -= along * x[2];
    }
    subInto(this.pole, a, n);
    const alongPole = n[0] * x[0] + n[1] * x[1] + n[2] * x[2];
    n[0] -= alongPole * x[0];
    n[1] -= alongPole * x[1];
    n[2] -= alongPole * x[2];
    let phi = 0;
    const refSq = ref[0] * ref[0] + ref[1] * ref[1] + ref[2] * ref[2];
    const nSq = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
    if (refSq > 1e-18 && nSq > 1e-18) {
      cross(ref, n, w);
      phi = Math.atan2(x[0] * w[0] + x[1] * w[1] + x[2] * w[2], ref[0] * n[0] + ref[1] * n[1] + ref[2] * n[2]);
    }
    this.angle = phi + this.twist;
    this.axisAngle(x, qa);
    quatMultiply(qa, qU, qU);
    quatMultiply(qa, qM, qM);

    // 6. End orientation.
    if (this.useEndRotation) quatNormalize(this.endWorldQ, qb);
    else {
      quatNormalize(this.endQ, qa);
      quatMultiply(qM, qa, qb);
    }

    // 7. Locals and worlds.
    quatInvert(this.parentQ, qa);
    quatMultiply(qa, qU, this.upperLocal);
    quatNormalize(this.upperLocal, this.upperLocal);
    quatInvert(qU, qa);
    quatMultiply(qa, qM, this.midLocal);
    quatNormalize(this.midLocal, this.midLocal);
    quatInvert(qM, qa);
    quatMultiply(qa, qb, this.endLocal);
    quatNormalize(this.endLocal, this.endLocal);
    copyQuat(qU, this.upperWorldQ);
    copyQuat(qM, this.midWorldQ);
    copyQuat(qb, this.endWorldOutQ);
    quatRotateVec3(qU, tM0, w);
    addInto(a, w, c);
    quatRotateVec3(qM, tE0, w);
    addInto(c, w, c);
    subInto(c, this.target, w);
    const missSq = w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
    const allowed = 1e-6 * Math.max(total, 1e-9);
    this.reached = reachable && missSq <= allowed * allowed;
  }

  /**
   * Step 1 of `solve`: the chain at rest under the current parent (a, b, c, qU, qM), the seeded world hinge k, the
   * bone vectors u = b − a and v = c − b, and the hinge geometry of amendment C (base, r, c0, T, W).
   */
  private seedChain(): void {
    const { a, b, c, tM0, tE0, k, u, v, w, n, qa, qU, qM, sU } = this;
    const sPa = this.parentS;
    mulInto(sPa, this.upperS, sU);
    mulInto(sU, this.midT, tM0);
    mulInto(sU, this.midS, w);
    mulInto(w, this.endT, tE0);
    quatNormalize(this.upperQ, qa);
    quatMultiply(this.parentQ, qa, qU);
    mulInto(sPa, this.upperT, w);
    quatRotateVec3(this.parentQ, w, w);
    addInto(this.parentT, w, a);
    quatNormalize(this.midQ, qa);
    quatMultiply(qU, qa, qM);
    quatRotateVec3(qU, tM0, w);
    addInto(a, w, b);
    quatRotateVec3(qM, tE0, w);
    addInto(b, w, c);
    quatRotateVec3(qM, this.hingeLocal, k);
    normalizeOr(k, 1, 0, 0);
    subInto(b, a, u);
    subInto(c, b, v);

    // Rotating v about k by γ gives |u + v'|² = uu + vv + 2·(uk·vk + r·cos(γ − base)), with r = |u⊥|·|v⊥| and base
    // the γ of greatest reach. The rest is γ = 0, so its bend from greatest reach is t⁰ = −base.
    const vk = v[0] * k[0] + v[1] * k[1] + v[2] * k[2];
    w[0] = v[0] - vk * k[0];
    w[1] = v[1] - vk * k[1];
    w[2] = v[2] - vk * k[2];
    cross(k, w, n);
    const pa = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
    const pb = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
    const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const uk = u[0] * k[0] + u[1] * k[1] + u[2] * k[2];
    this.gR = Math.sqrt(pa * pa + pb * pb);
    this.gBase = this.gR < 1e-15 ? 0 : Math.atan2(pb, pa);
    this.gC0 = (uu + vv) / 2 + uk * vk;
    const hyper = this.gBase > 0 ? this.gBase : 0;
    this.gT = hyper;
    this.gW = Math.min(2 * hyper, Math.PI - hyper);
  }

  /** Rotation by `this.angle` about the unit `axis` (anim-core's quatFromAxisAngle normalizes with Math.hypot). */
  private axisAngle(axis: Vec3, out: Quat): void {
    const half = this.angle * 0.5;
    const s = Math.sin(half);
    out[0] = axis[0] * s;
    out[1] = axis[1] * s;
    out[2] = axis[2] * s;
    out[3] = Math.cos(half);
  }

  /** s = spread(this.d): the size of the bend from greatest reach that reaches `this.d`, into `this.s`. */
  private spreadOf(): void {
    const r = this.gR;
    if (r < 1e-15) {
      this.s = 0;
      return;
    }
    const cosine = (this.d * this.d) / 2 - this.gC0;
    this.s = Math.acos(Math.min(1, Math.max(-1, cosine / r)));
  }

  /** Amendment C: the bend t (from greatest reach) taken for the spread `this.s`, into `this.t`. */
  private bendFromSpread(): void {
    const s = this.s;
    const hyper = this.gT;
    const band = this.gW;
    if (!(hyper > 0)) this.t = s;
    else if (s <= hyper) this.t = -s;
    else if (band > 1e-12 && s < hyper + band) {
      const left = 1 - (s - hyper) / band;
      this.t = s - 2 * hyper * left * left;
    } else this.t = s;
  }

  /**
   * Angle γ about k (from the seeded rest) that bends the chain to the reach `this.d`, on the branch of amendment C,
   * into `this.gamma` (a returned double would be boxed by a call the optimizer does not inline).
   */
  private bendAngle(): void {
    if (this.gR < 1e-15) {
      this.gamma = 0;
      return;
    }
    this.spreadOf();
    this.bendFromSpread();
    const gamma = this.gBase + this.t;
    this.gamma = Math.atan2(Math.sin(gamma), Math.cos(gamma));
  }

  // Matching helpers (M2A-SPEC §5.6; user actions and imports, not per frame). Each seeds the chain from the
  // current inputs (parent and rest data), so set those first.

  /** The upper bone's position under the current parent (the chain's root `a`), into `out`. */
  upperPosition(out: Vec3): Vec3 {
    this.seedChain();
    out[0] = this.a[0];
    out[1] = this.a[1];
    out[2] = this.a[2];
    return out;
  }

  /**
   * The rest's hyperextension T about the hinge (rad, ≥ 0; 0 for a rest bent the normal way or straight) and the
   * width W of the amendment C band: the solver takes the bends from −T to T + W at distances other than their reach.
   */
  transitionBand(): { readonly hyper: number; readonly width: number; readonly base: number } {
    this.seedChain();
    return { hyper: this.gT, width: this.gT > 0 ? this.gW : 0, base: this.gBase };
  }

  /**
   * The bend t (from greatest reach; > 0 flexion) that `solve` takes for a reach distance `distance` (after soft IK
   * and the clamps), and its two exact candidates ±s.
   */
  bendAt(distance: number): { readonly t: number; readonly spread: number } {
    this.seedChain();
    this.d = distance;
    this.spreadOf();
    this.bendFromSpread();
    return { t: this.t, spread: this.s };
  }

  /**
   * The reach distance (before soft IK) for which `solve` bends the chain by `t` (from greatest reach). Bends the
   * solver takes for some distance are t ≥ −T; a smaller t is answered for −T (the rest reach). Inside the
   * amendment C band a bend is taken at a distance other than its own reach: the end then lands at the reach of t,
   * past the target.
   */
  distanceForBend(t: number): number {
    this.seedChain();
    const hyper = this.gT;
    const band = this.gW;
    let s: number;
    if (!(hyper > 0)) s = Math.abs(t);
    else if (t <= -hyper) s = hyper;
    else if (band > 1e-12 && t < hyper + band) {
      // t = s − 2T·(1 − y)² with s = T + W·y, solved for y ∈ [0, 1): 2T·y² − (W + 4T)·y + (t + T) = 0, the root in
      // [0, 1] (written without cancellation).
      const p = band + 4 * hyper;
      const y = (2 * (t + hyper)) / (p + Math.sqrt(Math.max(0, p * p - 8 * hyper * (t + hyper))));
      s = hyper + band * y;
    } else s = Math.abs(t);
    return Math.sqrt(Math.max(0, 2 * (this.gR * Math.cos(s) + this.gC0)));
  }

  /** The reach |c − a| of the chain bent by t (from greatest reach). */
  reachOfBend(t: number): number {
    this.seedChain();
    return Math.sqrt(Math.max(0, 2 * (this.gR * Math.cos(t) + this.gC0)));
  }

  /**
   * The direction of the mid joint's offset from the upper → end line, for the chain bent by t, measured about that
   * line from the hinge-implied bend direction x̂ × k (the direction `solve` turns towards the pole): 0 when the
   * offset lies along it (a rest bent about its hinge, flexed), π when opposite (hyperextended), other values when
   * the rest bend leaves the hinge plane. 0 for a chain without offset.
   */
  offsetAngleAt(t: number): number {
    this.seedChain();
    const { u, v, k, w, n, x, qa } = this;
    this.angle = this.gBase + t;
    this.axisAngle(k, qa);
    quatRotateVec3(qa, v, w);
    addInto(u, w, x);
    normalizeOr(x, 0, -1, 0);
    const along = u[0] * x[0] + u[1] * x[1] + u[2] * x[2];
    w[0] = u[0] - along * x[0];
    w[1] = u[1] - along * x[1];
    w[2] = u[2] - along * x[2];
    cross(x, k, n);
    if (n[0] * n[0] + n[1] * n[1] + n[2] * n[2] < 1e-24 || w[0] * w[0] + w[1] * w[1] + w[2] * w[2] < 1e-24) return 0;
    const cx = n[1] * w[2] - n[2] * w[1];
    const cy = n[2] * w[0] - n[0] * w[2];
    const cz = n[0] * w[1] - n[1] * w[0];
    return Math.atan2(x[0] * cx + x[1] * cy + x[2] * cz, n[0] * w[0] + n[1] * w[1] + n[2] * w[2]);
  }
}

/** Signed bend from u to v about k: atan2(k·(u × v), u·v). `scratch` receives u × v. */
export function bendOf(u: Vec3, v: Vec3, k: Vec3, scratch: Vec3): number {
  cross(u, v, scratch);
  return Math.atan2(dot(k, scratch), dot(u, v));
}

/** Rotation taking direction `from` onto `to`; antiparallel inputs rotate by π about `fallbackAxis` (M1 `swing`). */
function swingInto(from: Vec3, to: Vec3, fallbackAxis: Vec3, out: Quat): void {
  const lf = Math.sqrt(from[0] * from[0] + from[1] * from[1] + from[2] * from[2]);
  const lt = Math.sqrt(to[0] * to[0] + to[1] * to[1] + to[2] * to[2]);
  if (lf < 1e-12 || lt < 1e-12) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return;
  }
  const fd = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  const cosine = fd / (lf * lt);
  if (cosine < -1 + 1e-12) {
    const fx = from[0] / lf;
    const fy = from[1] / lf;
    const fz = from[2] / lf;
    const along = fallbackAxis[0] * fx + fallbackAxis[1] * fy + fallbackAxis[2] * fz;
    let ax = fallbackAxis[0] - fx * along;
    let ay = fallbackAxis[1] - fy * along;
    let az = fallbackAxis[2] - fz * along;
    if (ax * ax + ay * ay + az * az < 1e-18) {
      if (Math.abs(fx) < 0.9) {
        ax = 0;
        ay = fz;
        az = -fy;
      } else {
        ax = -fz;
        ay = 0;
        az = fx;
      }
    }
    const len = Math.sqrt(ax * ax + ay * ay + az * az);
    out[0] = ax / len;
    out[1] = ay / len;
    out[2] = az / len;
    out[3] = 0;
    return;
  }
  const ax = from[1] * to[2] - from[2] * to[1];
  const ay = from[2] * to[0] - from[0] * to[2];
  const az = from[0] * to[1] - from[1] * to[0];
  out[0] = ax;
  out[1] = ay;
  out[2] = az;
  out[3] = lf * lt + fd;
  quatNormalize(out, out);
}

function copyQuat(q: Quat, out: Quat): void {
  out[0] = q[0];
  out[1] = q[1];
  out[2] = q[2];
  out[3] = q[3];
}

function mulInto(a: Vec3, b: Vec3, out: Vec3): void {
  out[0] = a[0] * b[0];
  out[1] = a[1] * b[1];
  out[2] = a[2] * b[2];
}

function addInto(a: Vec3, b: Vec3, out: Vec3): void {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
}

function subInto(a: Vec3, b: Vec3, out: Vec3): void {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3, out: Vec3): void {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

function normalizeOr(v: Vec3, fx: number, fy: number, fz: number): void {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len > 1e-12) {
    v[0] /= len;
    v[1] /= len;
    v[2] /= len;
  } else {
    v[0] = fx;
    v[1] = fy;
    v[2] = fz;
  }
}
