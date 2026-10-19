// UV goldens of the projection ops (M6A-SPEC §5.28, §9 B5 Tests): per-corner `uv0` (rounded to 1e-6, in corner order)
// and the seam edges after each op runs on a primitive. Shared by the Node test (which keeps
// test/goldens/b5-uv.json) and the Chromium test (which compares against it); no Node APIs here.
import { EDGE_SEAM, editMeshFrom, MESH_OPS, type MeshOp, type OpContext, primitive, selectionOf } from '../../../src';
import { rounded } from '../../../src/testing';

export interface UvGolden {
  readonly uv: readonly number[];
  readonly seams: readonly number[];
}

const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

export function uvContext(epsilon = 1e-9): OpContext {
  return {
    symmetry: null,
    hidden: null,
    placement: IDENTITY,
    faceted: true,
    soft: null,
    curves: { compile: () => ({}) as never, evaluate: () => 0 },
    epsilon,
  };
}

/** Runs `opId` on a fresh primitive (all faces, or the listed ones) and records uv0 and the seams. */
export function uvCase(
  opId: string,
  kind: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus',
  params: Readonly<Record<string, number>>,
  args: Readonly<Record<string, unknown>>,
  faces: readonly number[] | null = null,
): UvGolden {
  const m = editMeshFrom(primitive(kind, params));
  const op = MESH_OPS[opId] as MeshOp;
  m.begin(opId);
  const result = op.run(m, faces === null ? null : selectionOf('face', faces, m.counts), args as never, uvContext());
  if ('refused' in result) {
    m.abort();
    throw new Error(`${opId} refused: ${result.reason}`);
  }
  m.end();
  const layer = m.layer('uv0');
  const uv: number[] = [];
  for (let c = 0; c < m.counts.corners; c++) uv.push(layer?.get(c, 0) ?? 0, layer?.get(c, 1) ?? 0);
  const seams: number[] = [];
  for (let e = 0; e < m.counts.edges; e++) if ((m.edgeFlags(e) & EDGE_SEAM) !== 0) seams.push(e);
  return { uv: rounded(uv), seams };
}

export function uvGoldenValues(): Record<string, UvGolden> {
  return {
    'planar-y/cube': uvCase('mesh.uv.planar', 'cube', {}, { axis: 'y' }),
    'planar-x/cube-top-face': uvCase('mesh.uv.planar', 'cube', {}, { axis: 'x' }, [1]),
    'planar-z/plane-raw': uvCase('mesh.uv.planar', 'plane', { subdivisionsWidth: 2 }, { axis: 'z', fit: false }),
    'planar-camera/cube': uvCase(
      'mesh.uv.planar',
      'cube',
      {},
      {
        axis: 'camera',
        camera: { direction: [-1, -1, -1], up: [0, 1, 0] },
      },
    ),
    'box/cube': uvCase('mesh.uv.box', 'cube', { subdivisionsWidth: 2 }, {}),
    'box/cube-raw': uvCase('mesh.uv.box', 'cube', {}, { fit: false }),
    'box/torus': uvCase('mesh.uv.box', 'torus', {}, {}),
    'cylindrical-y/cylinder': uvCase('mesh.uv.cylindrical', 'cylinder', {}, {}),
    'cylindrical-y/sphere': uvCase('mesh.uv.cylindrical', 'sphere', {}, {}),
    'cylindrical-x/cube-raw': uvCase(
      'mesh.uv.cylindrical',
      'cube',
      { subdivisionsHeight: 2 },
      { axis: 'x', fit: false },
    ),
  };
}
