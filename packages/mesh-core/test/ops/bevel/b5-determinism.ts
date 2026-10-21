// P6 for B5 (M6A-SPEC §5.29): the values Node and Chromium must agree on — the manifest after bevels (the count
// oracles, profiles, face mode, symmetric runs and seeded random selections on every primitive), after each cleanup
// fix on its Mesh Check fixture and after each projection, and digests of Mesh Check's reports on the corpus. Shared
// by the Node test (which keeps test/goldens/b5-determinism.json) and the Chromium test; no Node APIs here.
import { sha256Hex } from '@ekza-studio/anim-core';
import fc from 'fast-check';
import {
  checkMesh,
  type ComponentSelection,
  type EditMesh,
  editMeshFrom,
  MESH_OPS,
  type MeshData,
  type MeshOp,
  type OpContext,
  primitive,
  selectionOf,
  writeRevision,
} from '../../../src';
import { CHECK_CORPUS } from '../../check/corpus';
import { standInSymmetryMap } from './symmetry-map';

const KINDS = ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] as const;
const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

function context(patch: Partial<OpContext> = {}): OpContext {
  return {
    symmetry: null,
    hidden: null,
    placement: IDENTITY,
    faceted: true,
    soft: null,
    curves: { compile: () => ({}) as never, evaluate: () => 0 },
    epsilon: 1e-6,
    ...patch,
  };
}

/** Runs one op; the manifest id after it, or `refused:<code>`. */
function run(
  m: EditMesh,
  opId: string,
  sel: ComponentSelection | null,
  args: Readonly<Record<string, unknown>>,
  patch: Partial<OpContext> = {},
): string {
  const op = MESH_OPS[opId] as MeshOp;
  m.begin(opId);
  const result = op.run(m, sel, args as never, context(patch));
  if ('refused' in result) {
    m.abort();
    return `refused:${result.code}`;
  }
  m.end();
  return writeRevision(m).manifestId;
}

const edges = (m: EditMesh, list: readonly number[]) => selectionOf('edge', list, m.counts);
const all = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

export function b5DeterminismValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const segments of [1, 2, 3]) {
    const m = editMeshFrom(primitive('cube', {}));
    out[`bevel/cube/one-edge/${segments}`] = run(m, 'mesh.bevel', edges(m, [0]), { segments });
  }
  for (const [name, args] of [
    ['default', {}],
    ['fraction-1', { fraction: 1 }],
    ['fan', { segments: 3 }],
    ['round', { segments: 3, chamfer: false, roundness: 0.7 }],
    ['absolute', { offsetAsFraction: false, offset: 0.12, segments: 2 }],
  ] as const) {
    const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 2 }));
    out[`bevel/cube/all-edges/${name}`] = run(m, 'mesh.bevel', edges(m, all(m.counts.edges)), args);
  }
  {
    const m = editMeshFrom(primitive('cube', {}));
    out['bevel/cube/face-mode'] = run(m, 'mesh.bevel', selectionOf('face', [1], m.counts), { fraction: 0.4 });
  }
  {
    const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 2 }));
    const map = standInSymmetryMap(m, 'x');
    out['bevel/cube/symmetric'] = run(
      m,
      'mesh.bevel',
      edges(m, [1, 5, 9]),
      { segments: 2 },
      {
        symmetry: { map, preserveSeam: true },
      },
    );
  }
  // Seeded random edge and face sets on every primitive (fast-check samples are the same in every engine).
  for (const kind of KINDS) {
    const [sample] = fc.sample(
      fc.record({
        seeds: fc.array(fc.nat(), { minLength: 1, maxLength: 8 }),
        faceMode: fc.boolean(),
        fraction: fc.double({ min: 0.05, max: 1, noNaN: true }),
        segments: fc.integer({ min: 1, max: 3 }),
        chamfer: fc.boolean(),
      }),
      { numRuns: 1, seed: KINDS.indexOf(kind) + 100 },
    );
    if (sample === undefined) continue;
    const m = editMeshFrom(primitive(kind, {}));
    const n = sample.faceMode ? m.counts.faces : m.counts.edges;
    const sel = selectionOf(
      sample.faceMode ? 'face' : 'edge',
      sample.seeds.map((s) => s % n),
      m.counts,
    );
    out[`bevel/${kind}/sampled`] = run(m, 'mesh.bevel', sel, {
      fraction: sample.fraction,
      segments: sample.segments,
      chamfer: sample.chamfer,
    });
  }
  for (const [code, make] of Object.entries(CHECK_CORPUS) as [string, () => MeshData][]) {
    const problems = checkMesh(make(), {
      closedExpected: code === 'open-border',
      ...(code === 'duplicate-slot' ? { duplicateSlots: new Set([2]) } : {}),
    }).map((p) => [p.code, p.domain, Array.from(p.elements ?? [])]);
    out[`check/${code}`] = sha256Hex(new TextEncoder().encode(JSON.stringify(problems)));
  }
  for (const [fix, code] of [
    ['deleteLamina', 'lamina'],
    ['collapse', 'zero-length-edge'],
    ['collapse', 'zero-area-face'],
    ['conform', 'inconsistent-winding'],
    ['triangulate', 'concave-ngon'],
    ['triangulate', 'nonplanar-ngon'],
    ['dissolve', 'stray-vertex'],
    ['deleteLoose', 'loose-geometry'],
  ] as const) {
    const m = editMeshFrom(CHECK_CORPUS[code]());
    out[`cleanup/${fix}/${code}`] = run(m, 'mesh.cleanup', null, { fix, selectOnly: false });
  }
  for (const kind of KINDS) {
    for (const [opId, args] of [
      ['mesh.uv.planar', { axis: 'y' }],
      ['mesh.uv.box', {}],
      ['mesh.uv.cylindrical', { axis: 'y' }],
    ] as const) {
      const m = editMeshFrom(primitive(kind, {}));
      out[`${opId}/${kind}`] = run(m, opId, null, args);
    }
  }
  return out;
}
