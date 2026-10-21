// The JSON goldens of B3's ops (M6A-SPEC §5.29: count oracles as JSON goldens in test/goldens/; P6 determinism in
// Node and Chromium): every §5.29 count row of B3's ops plus extra cases over every op and arg family, each recorded as
// V/E/F and the manifest id of the result, and seeded op sequences on primitives. `SPEC_COUNTS` holds the spec's own
// numbers, so regenerating the golden file can never move an oracle. Shared by the Node test (which keeps
// test/goldens/ops-core.json) and the Chromium test (which compares against it); no Node APIs here.
import type { ParamValues } from '@ekza-studio/anim-core';
import fc from 'fast-check';
import {
  type ComponentKind,
  type EditMesh,
  editMeshFrom,
  isRefusal,
  type OpContext,
  primitive,
  writeRevision,
} from '../../src';
import { arbPrimitive } from '../../src/testing';
import {
  combined,
  cylinderData,
  edgesAlong,
  fromFaces,
  openCylinderData,
  planeData,
  topOf,
  vertexNear,
} from './fixtures';
import { arbOpStep, resolveStep } from './steps';
import { counts, ctxOf, cube, faceToward, op, referenceSymmetryMap, sel } from './support';

/** Runs `id` in its own transaction; a refusal aborts (the mesh stays as it was). */
function run(
  m: EditMesh,
  id: string,
  kind: ComponentKind | null,
  indices: readonly number[],
  args: ParamValues = {},
  ctx: OpContext = ctxOf(),
): EditMesh {
  m.begin(id);
  const result = op(id).run(m, kind === null ? null : sel(m, kind, indices), args, ctx);
  if (isRefusal(result)) m.abort();
  else m.end();
  return m;
}

const sym = (m: EditMesh) => ctxOf({ symmetry: referenceSymmetryMap(m, 'x') });

const border = (m: EditMesh) => {
  const out: number[] = [];
  for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) === 1) out.push(e);
  return out;
};

function twoOpenCylinders(): EditMesh {
  const a = editMeshFrom(cylinderData());
  const b = editMeshFrom(cylinderData());
  run(a, 'mesh.delete', 'face', [faceToward(a, [0, 1, 0])]);
  run(b, 'mesh.delete', 'face', [faceToward(b, [0, -1, 0])]);
  return editMeshFrom(combined(a.snapshot(), b.snapshot(), [0, 2, 0]));
}

function halfCubePair(): EditMesh {
  const half = fromFaces(
    [
      0, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0, 0.5,
      -0.5,
    ],
    [
      [0, 1, 2, 3],
      [3, 2, 6, 7],
      [7, 6, 5, 4],
      [4, 5, 1, 0],
      [1, 5, 6, 2],
    ],
  );
  return editMeshFrom(combined(half, half, [0, 0, 0], true));
}

/** The §5.29 rows of B3's ops (V/E/F after), by golden case name. */
export const SPEC_COUNTS: Readonly<Record<string, string>> = {
  'extrude/cube-face': '12/20/10',
  'extrude/cube-face-divisions-2': '16/28/14',
  'extrude/cube-face-divisions-3': '20/36/18',
  'extrude/two-faces-together': '14/24/12',
  'extrude/two-faces-individually': '16/28/14',
  'insertLoop/four-sides': '12/20/10',
  'insertLoop/x-ring-symmetry-0.3': '16/28/14',
  'insertLoop/x-ring-symmetry-0.5': '12/20/10',
  'insertLoop/cylinder-multiple-3': '40/72/34',
  'delete/cube-edge': '8/11/5',
  'deleteEdgeVertex/cube-edge': '6/9/5',
  'delete/cube-corner-refused': '8/12/6',
  'deleteEdgeVertex/cube-corner': '7/9/4',
  'mergeToCenter/cube-top': '5/8/5',
  'collapse/cube-edge': '7/11/6',
  'targetWeld/cube-adjacent': '7/11/6',
  'mergeByDistance/half-cube-mirrored': '12/20/10',
  'fillHole/open-cylinder-twice': '16/24/10',
  'bridge/two-cylinders-divisions-2': '48/88/42',
  'mergeByDistance/two-planes': '6/7/2',
};

/** Every golden case: a mesh after a fixed run. */
const CASES: Readonly<Record<string, () => EditMesh>> = {
  // §5.29 rows.
  'extrude/cube-face': () => {
    const m = cube();
    return run(m, 'mesh.extrude', 'face', [topOf(m)], { localTranslateZ: 0.5 });
  },
  'extrude/cube-face-divisions-2': () => {
    const m = cube();
    return run(m, 'mesh.extrude', 'face', [topOf(m)], { localTranslateZ: 0.5, divisions: 2 });
  },
  'extrude/cube-face-divisions-3': () => {
    const m = cube();
    return run(m, 'mesh.extrude', 'face', [topOf(m)], { localTranslateZ: 0.5, divisions: 3 });
  },
  'extrude/two-faces-together': () => {
    const m = cube();
    return run(m, 'mesh.extrude', 'face', [topOf(m), faceToward(m, [0, 0, 1])], { localTranslateZ: 0.2 });
  },
  'extrude/two-faces-individually': () => {
    const m = cube();
    return run(m, 'mesh.extrude', 'face', [topOf(m), faceToward(m, [0, 0, 1])], {
      localTranslateZ: 0.2,
      keepFacesTogether: false,
    });
  },
  'insertLoop/four-sides': () => {
    const m = cube();
    return run(m, 'mesh.insertLoop', 'edge', [edgesAlong(m, 1)[0] as number], { weight: 0.5 });
  },
  'insertLoop/x-ring-symmetry-0.3': () => {
    const m = cube();
    return run(m, 'mesh.insertLoop', 'edge', [edgesAlong(m, 0)[0] as number], { weight: 0.3 }, sym(m));
  },
  'insertLoop/x-ring-symmetry-0.5': () => {
    const m = cube();
    return run(m, 'mesh.insertLoop', 'edge', [edgesAlong(m, 0)[0] as number], { weight: 0.5 }, sym(m));
  },
  'insertLoop/cylinder-multiple-3': () => {
    const m = editMeshFrom(cylinderData());
    return run(m, 'mesh.insertLoop', 'edge', [edgesAlong(m, 1)[0] as number], { mode: 'multiple', divisions: 3 });
  },
  'delete/cube-edge': () => {
    const m = cube();
    return run(m, 'mesh.delete', 'edge', [edgesAlong(m, 0)[0] as number]);
  },
  'deleteEdgeVertex/cube-edge': () => {
    const m = cube();
    return run(m, 'mesh.deleteEdgeVertex', 'edge', [edgesAlong(m, 0)[0] as number]);
  },
  'delete/cube-corner-refused': () => run(cube(), 'mesh.delete', 'vertex', [0]),
  'deleteEdgeVertex/cube-corner': () => run(cube(), 'mesh.deleteEdgeVertex', 'vertex', [0]),
  'mergeToCenter/cube-top': () => {
    const m = cube();
    return run(m, 'mesh.mergeToCenter', 'face', [topOf(m)]);
  },
  'collapse/cube-edge': () => run(cube(), 'mesh.collapse', 'edge', [0]),
  'targetWeld/cube-adjacent': () => {
    const m = cube();
    return run(m, 'mesh.targetWeld', 'vertex', [], { pairs: [[m.edgeVert(0, 0), m.edgeVert(0, 1)]] });
  },
  'mergeByDistance/half-cube-mirrored': () =>
    run(halfCubePair(), 'mesh.mergeByDistance', null, [], { distance: 0.001 }),
  'fillHole/open-cylinder-twice': () => {
    const m = editMeshFrom(openCylinderData());
    run(m, 'mesh.fillHole', 'vertex', [vertexNear(m, [0.5, 0.5, 0])]);
    return run(m, 'mesh.fillHole', 'vertex', [vertexNear(m, [0.5, -0.5, 0])]);
  },
  'bridge/two-cylinders-divisions-2': () => {
    const m = twoOpenCylinders();
    return run(m, 'mesh.bridge', 'edge', border(m), { divisions: 2 });
  },
  'mergeByDistance/two-planes': () =>
    run(editMeshFrom(combined(planeData(), planeData(), [1, 0, 0])), 'mesh.mergeByDistance', null, [], {
      distance: 0.001,
    }),
  // Every arg family (P6 beyond the counts).
  'extrude/sphere-region-transformed': () => {
    const m = editMeshFrom(primitive('sphere', {}));
    return run(m, 'mesh.extrude', 'face', [0, 1, 2, 12, 13], {
      localTranslateX: 0.1,
      localTranslateZ: 0.4,
      localRotateX: 0.3,
      localRotateY: -0.2,
      localRotateZ: 0.5,
      localScaleX: 0.7,
      localScaleY: 1.2,
      localScaleZ: 0.9,
      offset: 0.02,
      thickness: 0.05,
      divisions: 2,
    });
  },
  'extrude/world-space-placed': () => {
    const m = cube();
    const s = Math.SQRT1_2;
    return run(
      m,
      'mesh.extrude',
      'face',
      [topOf(m)],
      { localTranslateX: 0.3, localRotateZ: 0.4, space: 'world' },
      ctxOf({ placement: { t: [3, 0, 0], q: [0, 0, s, s], s: [1, 1, 1] } }),
    );
  },
  'extrude/border-edges': () => {
    const m = editMeshFrom(planeData({ subdivisionsWidth: 2 }));
    return run(m, 'mesh.extrude', 'edge', border(m).slice(0, 3), {
      localTranslateY: 0.3,
      localRotateX: 0.2,
      divisions: 2,
    });
  },
  'extrude/symmetric-sides': () => {
    const m = cube();
    return run(
      m,
      'mesh.extrude',
      'face',
      [faceToward(m, [1, 0, 0])],
      { localTranslateZ: 0.5, localRotateX: 0.3 },
      sym(m),
    );
  },
  'inset/individual-even-clamped': () => {
    const m = editMeshFrom(primitive('cylinder', {}));
    return run(m, 'mesh.inset', 'face', [0, 1, 2], { offset: 0.2, depth: -0.05, individual: true });
  },
  'insertLoop/equal-torus': () => {
    const m = editMeshFrom(primitive('torus', {}));
    return run(m, 'mesh.insertLoop', 'edge', [5], { mode: 'equal', weight: 0.3 });
  },
  'offsetLoop/tall-cube-middle': () => {
    const m = editMeshFrom(primitive('cube', { subdivisionsHeight: 2 }));
    const loop: number[] = [];
    for (let e = 0; e < m.counts.edges; e++) {
      const p = m.position;
      if (
        Math.abs(p[3 * m.edgeVert(e, 0) + 1] as number) < 1e-9 &&
        Math.abs(p[3 * m.edgeVert(e, 1) + 1] as number) < 1e-9
      ) {
        loop.push(e);
      }
    }
    return run(m, 'mesh.offsetLoop', 'edge', loop, { offset: 0.3 });
  },
  'connect/cube-ring': () => {
    const m = cube();
    return run(m, 'mesh.connect', 'edge', edgesAlong(m, 1), { weight: 0.35 });
  },
  'merge/sphere-pole-cluster': () =>
    run(editMeshFrom(primitive('sphere', {})), 'mesh.merge', 'vertex', [0, 1, 2, 3, 85], { distance: 0.4 }),
  'bridge/two-cylinders-twist-taper': () => {
    const m = twoOpenCylinders();
    return run(m, 'mesh.bridge', 'edge', border(m), { divisions: 3, twist: 1, offset: 2, taper: 1.6 });
  },
  'deleteEdgeVertex/sphere-vertex': () =>
    run(editMeshFrom(primitive('sphere', {})), 'mesh.deleteEdgeVertex', 'vertex', [20]),
};

/** A seeded op sequence (fast-check samples are engine-independent) on a seeded primitive; refusals skipped. */
function script(seed: number, steps: number): EditMesh {
  const [prim] = fc.sample(arbPrimitive(), { numRuns: 1, seed });
  const [list] = fc.sample(fc.array(arbOpStep(), { minLength: steps, maxLength: steps }), {
    numRuns: 1,
    seed: seed + 1,
  });
  const m = editMeshFrom(primitive(prim?.kind ?? 'cube', prim?.params ?? {}));
  for (const step of list ?? []) {
    if (m.counts.faces > 600) break;
    const resolved = resolveStep(m, step);
    if (resolved === null) continue;
    m.begin(step.id);
    const result = op(step.id).run(m, resolved.selection, resolved.args, ctxOf());
    if (isRefusal(result)) m.abort();
    else m.end();
  }
  return m;
}

export interface GoldenValue {
  readonly counts: string;
  readonly manifest: string;
}

export function opsCoreValues(): Record<string, GoldenValue> {
  const out: Record<string, GoldenValue> = {};
  const record = (name: string, m: EditMesh) => {
    out[name] = { counts: counts(m), manifest: writeRevision(m).manifestId };
  };
  for (const [name, make] of Object.entries(CASES)) record(name, make());
  for (const seed of [22, 33, 44, 55]) record(`script/${seed}`, script(seed, 40));
  return out;
}
