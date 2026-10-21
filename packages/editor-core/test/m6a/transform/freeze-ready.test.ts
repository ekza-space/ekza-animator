// B12a (M6A-SPEC §5.13, §5.15): Freeze Transformations and Bake Pivot run through B4's `mesh.applyTransform`
// (READY.b4). This file has no module mock (operators.test.ts substitutes a stand-in op): with the B0a stub in the
// kernel both poll-fail with the shared "not available yet" reason, so the Modify menu shows them disabled instead of
// failing with an error toast; with B4 merged the same runs finish.
import * as kernel from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import { type EditorApp, NOT_AVAILABLE_YET } from '../../../src';
import { addMesh, modelApp, selectObjects } from '../select/support';

/** B4 landed: the kernel's `mesh.applyTransform` runs on a cube without the stub's refusal. */
function b4(): boolean {
  const op = kernel.MESH_OPS['mesh.applyTransform'];
  if (op === undefined) return false;
  const cube = kernel.editMeshFrom(kernel.primitive('cube', {}));
  cube.begin('probe');
  try {
    const out = op.run(
      cube,
      null,
      {},
      {
        symmetry: null,
        hidden: null,
        placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
        faceted: true,
        soft: null,
        curves: { compile: () => ({}) as never, evaluate: () => 0 },
        epsilon: 1e-9,
      },
    );
    return !(kernel.isRefusal(out) && out.code === 'not-implemented');
  } finally {
    cube.abort();
  }
}

async function outcome(app: EditorApp, op: string, args?: unknown): Promise<string> {
  const result = await app.runUntyped(op, args);
  if (result.status === 'cancelled') return result.reason;
  return result.status === 'failed' ? `failed: ${result.error.message}` : 'finished';
}

describe('Freeze and Bake Pivot follow READY.b4 (§5.13)', () => {
  it('poll-fail "not available yet" with the B0a stub, and run once B4 has landed', async () => {
    const app = await modelApp();
    const cube = addMesh(app, 'msh_Cube', 'cube');
    app.store.transact({ label: 'Place' }, (tx) =>
      tx.patch('meshes', cube, { placement: { t: [1, 0, 0], q: [0, 0, 0, 1], s: [2, 2, 2] }, pivot: [0, 0.5, 0] }),
    );
    selectObjects(app, [cube]);
    const expected = b4() ? 'finished' : NOT_AVAILABLE_YET;
    expect(await outcome(app, 'mesh.freezeTransforms', { ids: [cube] })).toBe(expected);
    expect(await outcome(app, 'mesh.pivot.bake', { ids: [cube] })).toBe(expected);
    // Bake Pivot on a mesh whose pivot is the origin moves no geometry: it never needs B4's op.
    const plain = addMesh(app, 'msh_Plain', 'cube');
    expect(await outcome(app, 'mesh.pivot.bake', { ids: [plain] })).toBe('finished');
  });
});
