// Shared helpers of the B11 tests (M6A-SPEC §9 B11): a value-only kernel op (`mesh.test.advance`) that the module mock
// of `@ekza-animator/mesh-core` adds to `MESH_OPS`, so the B11 registration path (`registeredMeshOperator` over B7's
// `meshOperator`) runs end to end on the B0a reference kernel (no Euler operators). Only types are imported from the
// kernel here: the mock factory passes the real module in.
import type { ParamDef, ParamValues } from '@ekza-animator/anim-core';
import type * as Kernel from '@ekza-animator/mesh-core';
import type {
  ComponentSelection,
  EditMesh,
  MeshOp,
  MeshOpDescriptor,
  OpResult,
  Refusal,
} from '@ekza-animator/mesh-core';

const DY: ParamDef = {
  name: 'dy',
  label: 'Offset Y',
  kind: 'distance',
  bound: 'value',
  default: 0.1,
  step: 0.01,
  primary: true,
};

const STEPS: ParamDef = { name: 'steps', label: 'Steps', kind: 'int', bound: 'value', default: 1, min: 1, max: 4 };

const SEED: ParamDef = {
  name: 'seedFace',
  label: 'Seed Face',
  kind: 'int',
  bound: 'selection',
  default: null,
  nullable: true,
  hidden: true,
};

/** `mesh.test.advance {dy, steps, seedFace}`: a face op with a primary distance, an int and a selection-bound seed. */
export const ADVANCE: MeshOpDescriptor = {
  id: 'mesh.test.advance',
  label: 'Advance',
  kinds: ['face'],
  params: [DY, STEPS, SEED],
  flags: { adjustable: true, repeatable: true, topology: false, manifoldPreserving: true },
  symmetry: 'expand',
};

export interface AdvanceOp extends MeshOp {
  runs: number;
  /** The faces each run read. */
  reads: number[][];
}

function faceVerts(m: EditMesh, faces: readonly number[]): number[] {
  const out = new Set<number>();
  for (const f of faces) {
    const first = m.faceCorner(f);
    let c = first;
    do {
      out.add(m.cornerVert(c));
      c = m.cornerNext(c);
    } while (c !== first);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Moves the selected faces' vertices by `dy × steps` along Y and leaves the same faces selected; resolves the
 * selection-bound `seedFace` to the lowest selected face (recorded in `resolvedArgs`, like a loop seed). `dy` 13 is
 * refused (after a write, like a kernel op that finds a problem late).
 */
export function makeAdvanceOp(kernel: typeof Kernel): AdvanceOp {
  const op: AdvanceOp = {
    ...ADVANCE,
    runs: 0,
    reads: [],
    poll: (_m: EditMesh, sel: ComponentSelection | null) =>
      sel === null || sel.faces.isEmpty() ? kernel.refuse('advance.empty', 'Select faces first') : true,
    run(m: EditMesh, sel: ComponentSelection | null, args: ParamValues): OpResult | Refusal {
      op.runs++;
      const faces = sel === null ? [] : [...sel.faces.toArray()];
      op.reads.push(faces);
      const dy = typeof args['dy'] === 'number' ? args['dy'] : 0.1;
      const steps = typeof args['steps'] === 'number' ? args['steps'] : 1;
      if (dy === 13) return kernel.refuse('advance.unlucky', 'Thirteen is unlucky');
      for (const v of faceVerts(m, faces)) {
        m.setPosition(
          v,
          m.position[3 * v] as number,
          (m.position[3 * v + 1] as number) + dy * steps,
          m.position[3 * v + 2] as number,
        );
      }
      return {
        selection: kernel.selectionOf('face', faces, m.counts),
        warnings: dy > 1 ? [{ code: 'advance.far', message: 'Advanced more than 1 m', count: faces.length }] : [],
        resolvedArgs: { dy, steps, seedFace: faces[0] ?? null },
      };
    },
  };
  return op;
}
