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

/** `data` with `matrix` applied by the kernel's `mesh.applyTransform` (the Freeze semantics). */
export function transformMesh(data: MeshData, matrix: Mat4): MeshData {
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
