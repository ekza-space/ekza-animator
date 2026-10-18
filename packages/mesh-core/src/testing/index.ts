// `@ekza-animator/mesh-core/testing` (M6A-SPEC §4.3): fixtures for kernel tests. B0a lands the reference fixtures
// below; B1 owns this directory after B0a and adds the fast-check arbitraries and the golden runner.
import { EDGE_HARD } from '../constants';
import { buildMeshData } from '../reference/build';

export { buildMeshData, emptyMeshData, type MeshBuild } from '../reference/build';
import type { MeshData } from '../types';

/** A unit cube (8/12/6) built from a face list, optionally with smooth (non-hard) edges. */
export function cubeData(opts: { readonly hard?: boolean } = {}): MeshData {
  return buildMeshData({
    positions: [
      -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
      -0.5, 0.5, -0.5,
    ],
    faces: [
      [0, 1, 2, 3],
      [3, 2, 6, 7],
      [7, 6, 5, 4],
      [4, 5, 1, 0],
      [1, 5, 6, 2],
      [4, 0, 3, 7],
    ],
    edgeFlags: opts.hard === false ? 0 : EDGE_HARD,
  });
}

/**
 * Stored forms that break one §5.1 invariant each (validateMesh must report them, editMeshFrom must refuse them):
 * the problem code `validateMesh` reports is the key.
 */
export function brokenMeshes(): Readonly<Record<string, MeshData>> {
  const good = cubeData();
  const with_ = (patch: Partial<MeshData>): MeshData => ({ ...good, ...patch });
  const counts = good.counts;
  const cornerNext = good.cornerNext.slice();
  cornerNext[3] = 1; // face 0 closes early: corner 3 points into its own face's middle
  const repeatedVert = good.cornerVert.slice();
  repeatedVert[1] = repeatedVert[0] as number;
  const edgeVerts = good.edgeVerts.slice();
  edgeVerts[2] = edgeVerts[0] as number;
  edgeVerts[3] = edgeVerts[1] as number;
  const position = good.position.slice();
  position[4] = Number.NaN;
  const loop = good.edgeVerts.slice();
  loop[1] = loop[0] as number;
  return {
    'counts.length': with_({ edgeFlags: new Uint8Array(counts.edges - 1) }),
    'index.range': with_({ cornerVert: Uint32Array.from(good.cornerVert, (v, i) => (i === 0 ? 99 : v)) }),
    'face.shared-corner': with_({ cornerNext }),
    'face.repeated-vertex': with_({ cornerVert: repeatedVert }),
    'edge.duplicate': with_({ edgeVerts }),
    'edge.loop': with_({ edgeVerts: loop }),
    'float.non-finite': with_({ position }),
  };
}
