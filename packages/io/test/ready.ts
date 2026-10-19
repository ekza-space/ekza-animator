// M6A-SPEC §3 rule 4: which sibling M6a packages io's tests need are merged, probed through mesh-core's public API (a
// stub throws or refuses `not-implemented`). Tests that need one use `describe.skipIf(!READY.<id>)`; the integration
// agent turns them into failures.
import { EkzaError } from '@ekza-animator/anim-core';
import { checkMesh, editMeshFrom, isRefusal, MESH_OPS, selectionOf } from '@ekza-animator/mesh-core';
import { cubeData } from '@ekza-animator/mesh-core/testing';

function notImplemented(probe: () => unknown): boolean {
  try {
    const result = probe();
    return isRefusal(result) && result.code === 'not-implemented';
  } catch (error) {
    return error instanceof EkzaError && error.code === 'not-implemented';
  }
}

export const READY = {
  /** B1: the kernel's Euler operators (topology edits). */
  b1: !notImplemented(() => {
    const mesh = editMeshFrom(cubeData());
    mesh.begin('ready.b1');
    try {
      return mesh.makeVert(0, 0, 0);
    } finally {
      mesh.abort();
    }
  }),
  /** B3: Insert Edge Loop (the loop-and-export part of E2E-MOD-12). */
  b3: !notImplemented(() => {
    const op = MESH_OPS['mesh.insertLoop'];
    const mesh = editMeshFrom(cubeData());
    return op?.run(mesh, selectionOf('edge', [0], mesh.counts), {}, {} as never);
  }),
  /** B5: Mesh Check diagnostics (the mesh.* hygiene lints). */
  b5: !notImplemented(() => checkMesh(cubeData())),
} as const;
