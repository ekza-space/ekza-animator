// SkeletonDesc.boneSupport (M2A-SPEC §4.3, §5.2.3): per node, the horizontal support function of the bind-pose
// vertices whose dominant skin weight is that node, relative to the node's rest position, in canonical character
// space. The rig places the foot-roll pivots (heel, toe tip, inner and outer edge) from it (research 07 §12).

/** Samples of the horizontal support function: θ_k = k · 360° / SUPPORT_SAMPLES. */
export const SUPPORT_SAMPLES = 32;
/** Values per node: the SUPPORT_SAMPLES support values, then min and max of (v − p).y. */
export const SUPPORT_STRIDE = SUPPORT_SAMPLES + 2;

/** One skinned primitive: vertices already placed in canonical bind pose by their dominant joint. */
export interface SupportPrimitive {
  readonly joints: Uint32Array;
  readonly weights: Float32Array;
  /** Skin joint slot → SkeletonDesc node index (−1 when the joint is not a node). */
  readonly skinJoints: readonly number[];
  /** Canonical bind-pose position of every vertex (xyz per vertex). */
  readonly placed: Float32Array;
}

const SIN = Float64Array.from({ length: SUPPORT_SAMPLES }, (_, k) => Math.sin((2 * Math.PI * k) / SUPPORT_SAMPLES));
const COS = Float64Array.from({ length: SUPPORT_SAMPLES }, (_, k) => Math.cos((2 * Math.PI * k) / SUPPORT_SAMPLES));

/**
 * The support function per node: h_k = max over the node's dominant vertices of ((v − p).x·sin θ_k + (v − p).z·cos
 * θ_k), θ_k = k·11.25°, then min (v − p).y and max (v − p).y; `p` is the node's canonical rest position. Nodes that
 * dominate no vertex get null. A vertex belongs to the joint with its largest weight (the first of equal weights);
 * vertices without any weight are skipped.
 */
export function boneSupportOf(
  primitives: readonly SupportPrimitive[],
  nodeCount: number,
  restPositions: readonly (readonly [number, number, number])[],
): (Float32Array | null)[] {
  const values: (Float64Array | null)[] = Array.from({ length: nodeCount }, () => null);
  for (const p of primitives) {
    const count = Math.min(p.placed.length / 3, p.joints.length / 4, p.weights.length / 4);
    for (let v = 0; v < count; v++) {
      let slot = 0;
      for (let k = 1; k < 4; k++) if ((p.weights[v * 4 + k] as number) > (p.weights[v * 4 + slot] as number)) slot = k;
      if (!((p.weights[v * 4 + slot] as number) > 0)) continue;
      const node = p.skinJoints[p.joints[v * 4 + slot] as number];
      if (node === undefined || node < 0 || node >= nodeCount) continue;
      const origin = restPositions[node];
      if (origin === undefined) continue;
      const dx = (p.placed[v * 3] as number) - origin[0];
      const dy = (p.placed[v * 3 + 1] as number) - origin[1];
      const dz = (p.placed[v * 3 + 2] as number) - origin[2];
      let out = values[node];
      if (out === null || out === undefined) {
        out = new Float64Array(SUPPORT_STRIDE).fill(Number.NEGATIVE_INFINITY);
        out[SUPPORT_SAMPLES] = Number.POSITIVE_INFINITY;
        values[node] = out;
      }
      for (let k = 0; k < SUPPORT_SAMPLES; k++) {
        const h = dx * (SIN[k] as number) + dz * (COS[k] as number);
        if (h > (out[k] as number)) out[k] = h;
      }
      if (dy < (out[SUPPORT_SAMPLES] as number)) out[SUPPORT_SAMPLES] = dy;
      if (dy > (out[SUPPORT_SAMPLES + 1] as number)) out[SUPPORT_SAMPLES + 1] = dy;
    }
  }
  return values.map((out) => (out === null ? null : Float32Array.from(out)));
}
