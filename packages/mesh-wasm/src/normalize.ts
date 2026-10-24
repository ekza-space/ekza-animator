// `mesh.normalize` (MODELING-PLAN §7.2 G-a, research 15 §5.9 step 2): the model's own frame → Ekza's (+Y up, +Z
// forward, metres), uniformly scaled to a target height, with its origin at the bottom centre of the combined bounds of
// every mesh of the job (the parts of one model keep their relative placement). The world transforms are baked into
// the data with the kernel's `mesh.applyTransform` (positions, morph deltas, custom normals, winding under mirrors),
// so the result needs identity world placements.
import { curveEngine, type Mat4, mat4Multiply } from '@ekza-studio/anim-core';
import type { MeshData, OpContext } from '@ekza-studio/mesh-core';
import { editMeshFrom, isRefusal, MESH_OPS } from '@ekza-studio/mesh-core';
import type { NormalizeArgs, SignedAxis } from './types';

type V3 = readonly [number, number, number];

const AXES: Readonly<Record<SignedAxis, V3>> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};

/** Why the axes cannot be a frame (parallel up and forward), or null. */
export function axesProblem(up: SignedAxis, forward: SignedAxis): string | null {
  return up[1] === forward[1] ? `Up (${up}) and forward (${forward}) must be different axes` : null;
}

/** The rotation (column-major 4×4) taking the source's up to +Y and its forward to +Z. */
export function frameRotation(up: SignedAxis, forward: SignedAxis): Mat4 {
  const u = AXES[up];
  const f = AXES[forward];
  const r: V3 = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
  const rows = [r, u, f];
  const m = new Float64Array(16);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) m[col * 4 + row] = (rows[row] as V3)[col] as number;
  m[15] = 1;
  return m;
}

const scaling = (s: number): Mat4 => {
  const m = new Float64Array(16);
  m[0] = s;
  m[5] = s;
  m[10] = s;
  m[15] = 1;
  return m;
};

const translation = (x: number, y: number, z: number): Mat4 => {
  const m = scaling(1);
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
};

const OP_CONTEXT: OpContext = {
  symmetry: null,
  hidden: null,
  placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
  faceted: false,
  soft: null,
  curves: curveEngine,
  epsilon: 1e-9,
};

const det3 = (m: ArrayLike<number>): number =>
  (m[0] as number) * ((m[5] as number) * (m[10] as number) - (m[9] as number) * (m[6] as number)) -
  (m[4] as number) * ((m[1] as number) * (m[10] as number) - (m[9] as number) * (m[2] as number)) +
  (m[8] as number) * ((m[1] as number) * (m[6] as number) - (m[5] as number) * (m[2] as number));

/**
 * `data` with `matrix` applied, with the Freeze semantics of the kernel's `mesh.applyTransform` (positions through the
 * matrix, morph deltas through its linear part, `normal.custom` through the inverse transpose, renormalized, zero
 * staying zero, −0 stored as +0). A matrix with a positive determinant (every normalize: a rotation and a positive
 * scale) is applied to the arrays directly — no edit links, no write log, 5–10× faster at 500k triangles — and gives
 * the kernel op's bytes; a mirror (negative determinant, faces reversed) goes through the kernel op itself.
 */
export function transformMesh(data: MeshData, matrix: Mat4): MeshData {
  const det = det3(matrix);
  if (det > 0 && Number.isFinite(det)) return transformDirect(data, matrix, det);
  return transformByKernel(data, matrix);
}

function transformDirect(data: MeshData, m: Mat4, det: number): MeshData {
  const P = data.counts.points;
  const position = new Float32Array(3 * P);
  const src = data.position;
  for (let v = 0; v < P; v++) {
    const x = src[3 * v] as number;
    const y = src[3 * v + 1] as number;
    const z = src[3 * v + 2] as number;
    for (let k = 0; k < 3; k++) {
      position[3 * v + k] =
        (m[k] as number) * x + (m[4 + k] as number) * y + (m[8 + k] as number) * z + (m[12 + k] as number) + 0;
    }
  }
  // Inverse transpose of the 3×3 (column-major), from the cofactors.
  const a = m[0] as number;
  const b = m[4] as number;
  const c = m[8] as number;
  const d = m[1] as number;
  const e = m[5] as number;
  const f = m[9] as number;
  const g = m[2] as number;
  const h = m[6] as number;
  const i = m[10] as number;
  const n = [
    (e * i - f * h) / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    -(d * i - f * g) / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    (d * h - e * g) / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
  const layers = new Map(data.layers);
  for (const [name, layer] of data.layers) {
    const { def } = layer;
    if (!(layer.data instanceof Float32Array) || def.type !== 'f32' || def.comps < 3) continue;
    const vector = def.domain === 'point' && def.mirror === 'negate-axis';
    const normal = def.domain === 'corner' && name === 'normal.custom';
    if (!vector && !normal) continue;
    const comps = def.comps;
    const values = layer.data;
    const out = values.slice();
    const count = values.length / comps;
    for (let j = 0; j < count; j++) {
      const x = values[comps * j] as number;
      const y = values[comps * j + 1] as number;
      const z = values[comps * j + 2] as number;
      let ox: number;
      let oy: number;
      let oz: number;
      if (vector) {
        ox = a * x + b * y + c * z;
        oy = d * x + e * y + f * z;
        oz = g * x + h * y + i * z;
      } else if (x === 0 && y === 0 && z === 0) {
        ox = 0;
        oy = 0;
        oz = 0;
      } else {
        const nx = (n[0] as number) * x + (n[3] as number) * y + (n[6] as number) * z;
        const ny = (n[1] as number) * x + (n[4] as number) * y + (n[7] as number) * z;
        const nz = (n[2] as number) * x + (n[5] as number) * y + (n[8] as number) * z;
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const ok = length > 0 && Number.isFinite(length);
        ox = ok ? nx / length : 0;
        oy = ok ? ny / length : 0;
        oz = ok ? nz / length : 0;
      }
      out[comps * j] = ox + 0;
      out[comps * j + 1] = oy + 0;
      out[comps * j + 2] = oz + 0;
    }
    layers.set(name, { def, data: out });
  }
  return { ...data, position, layers };
}

/** `data` with `matrix` applied by the kernel's `mesh.applyTransform` (the Freeze semantics). */
function transformByKernel(data: MeshData, matrix: Mat4): MeshData {
  const op = MESH_OPS['mesh.applyTransform'];
  if (op === undefined) throw new Error('mesh.applyTransform is missing from the kernel');
  const mesh = editMeshFrom(data);
  mesh.begin('mesh.normalize');
  const result = op.run(mesh, null, { matrix: Array.from(matrix) }, OP_CONTEXT);
  if (isRefusal(result)) {
    mesh.abort();
    throw new Error(result.reason);
  }
  mesh.end();
  return mesh.snapshot();
}

export interface NormalizeOutcome {
  readonly meshes: readonly MeshData[];
  /** The matrix baked into each mesh (world-from-local of the result = identity). */
  readonly matrices: readonly Mat4[];
  readonly facts: {
    readonly scale: number;
    readonly heightBefore: number;
    readonly heightAfter: number;
    readonly width: number;
    readonly depth: number;
  };
}

/**
 * Normalizes the meshes of one model together (see the module comment). `worlds` are their world-from-local matrices
 * (column-major). Throws on parallel axes, a non-positive unit or height, or a model without extent.
 */
export function normalizeMeshes(
  meshes: readonly MeshData[],
  worlds: readonly (readonly number[])[],
  args: NormalizeArgs,
): NormalizeOutcome {
  const problem = axesProblem(args.up, args.forward);
  if (problem !== null) throw new Error(problem);
  if (!(args.unit > 0)) throw new Error('The unit must be positive');
  if (args.height !== null && !(args.height > 0)) throw new Error('The target height must be positive');
  const frame = mat4Multiply(frameRotation(args.up, args.forward), scaling(args.unit));
  const firsts = meshes.map((_, i) => mat4Multiply(frame, Float64Array.from(worlds[i] ?? scaling(1))));
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  meshes.forEach((data, i) => {
    const m = firsts[i] as Mat4;
    for (let p = 0; p < data.counts.points; p++) {
      const x = data.position[3 * p] as number;
      const y = data.position[3 * p + 1] as number;
      const z = data.position[3 * p + 2] as number;
      for (let k = 0; k < 3; k++) {
        const v = (m[k] as number) * x + (m[4 + k] as number) * y + (m[8 + k] as number) * z + (m[12 + k] as number);
        if (v < (lo[k] as number)) lo[k] = v;
        if (v > (hi[k] as number)) hi[k] = v;
      }
    }
  });
  if (!Number.isFinite(lo[0]) || !((hi[1] as number) - (lo[1] as number) >= 0)) {
    throw new Error('The model has no points to normalize');
  }
  const heightBefore = (hi[1] as number) - (lo[1] as number);
  if (args.height !== null && !(heightBefore > 0)) throw new Error('The model is flat: it has no height to scale');
  const s = args.height === null ? 1 : args.height / heightBefore;
  const centre = [0, 1, 2].map((k) => ((lo[k] as number) + (hi[k] as number)) / 2) as [number, number, number];
  const move =
    args.origin === 'keep'
      ? translation(0, 0, 0)
      : args.origin === 'center'
        ? translation(-s * centre[0], -s * centre[1], -s * centre[2])
        : translation(-s * centre[0], -s * (lo[1] as number), -s * centre[2]);
  const finish = mat4Multiply(move, scaling(s));
  const matrices = firsts.map((m) => mat4Multiply(finish, m));
  return {
    meshes: meshes.map((data, i) => transformMesh(data, matrices[i] as Mat4)),
    matrices,
    facts: {
      scale: s * args.unit,
      heightBefore: heightBefore / args.unit,
      heightAfter: heightBefore * s,
      width: ((hi[0] as number) - (lo[0] as number)) * s,
      depth: ((hi[2] as number) - (lo[2] as number)) * s,
    },
  };
}
