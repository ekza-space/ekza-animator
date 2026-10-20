// The Mesh Check corpus (M6A-SPEC §9 B5 Tests, §5.25): one small fixture per code, each a valid stored form (the
// kernel represents it; `validateMesh` has nothing to say) that Mesh Check reports. Shared by the check and cleanup
// tests; no Node APIs (the Chromium run imports it too).
import { BUILTIN_LAYERS, type MeshData, primitive } from '../../src';
import { buildMeshData, nonManifoldCorpus } from '../../src/testing';

const corpus = nonManifoldCorpus();
const get = (name: string): MeshData => corpus[name] as MeshData;

/** A cube whose faces are painted with slots 0…5 (face f → slot f). */
export function paintedCube(): MeshData {
  const data = primitive('cube', {});
  const layers = new Map(data.layers);
  layers.set('paint', { def: BUILTIN_LAYERS.paint, data: Uint16Array.from([0, 1, 2, 3, 2, 5]) });
  return { ...data, layers };
}

export const CHECK_CORPUS = {
  /** Three triangles around the edge 0–1 (a fin). */
  'non-manifold-edge': () => get('three-face-edge'),
  /** Two triangles touching at vertex 0 only (a bow-tie). */
  'non-manifold-vertex': () => get('bowtie'),
  /** A quad and the same quad reversed: a closed two-face "card" (every edge has two faces, wound oppositely). */
  lamina: () =>
    buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      faces: [
        [0, 1, 2, 3],
        [3, 2, 1, 0],
      ],
    }),
  /** A quad whose last corner sits on its first: the edge 3–0 has no length (the face still has area). */
  'zero-length-edge': () =>
    buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0],
      faces: [[0, 1, 2, 3]],
    }),
  /** A closed tetrahedron whose apex lies on a base edge: the side over that edge is a sliver with no area. */
  'zero-area-face': () =>
    buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, 0, 0],
      faces: [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ],
    }),
  /** A quad strip whose middle face is wound the other way. */
  'inconsistent-winding': () => get('flipped-face'),
  /** A convex pentagon with one corner lifted out of its plane. */
  'nonplanar-ngon': () =>
    buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 1.5, 0.8, 0, 0.5, 1.4, 0.5, -0.5, 0.8, 0],
      faces: [[0, 1, 2, 3, 4]],
    }),
  /** A planar L-shaped hexagon (a reflex corner at (1, 1)). */
  'concave-ngon': () =>
    buildMeshData({
      positions: [0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0],
      faces: [[0, 1, 2, 3, 4, 5]],
    }),
  /** A non-planar, self-overlapping hexagon earcut cannot triangulate (the fan fallback). */
  'ngon-degenerate': () => get('bad-ngon'),
  /** A triangle drawn as a quad: vertex 1 sits on the straight base between 0 and 2. */
  'stray-vertex': () =>
    buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 1, 1, 0],
      faces: [[0, 1, 2, 3]],
    }),
  /** A triangle, a wire edge from it and a vertex without edges. */
  'loose-geometry': () => get('loose'),
  /** A plane (open): reported only when the caller expects a closed mesh. */
  'open-border': () => primitive('plane', {}),
  /** A painted cube: slot 2 is on faces 2 and 4 (reported when the palette has two live swatches on slot 2). */
  'duplicate-slot': paintedCube,
} as const satisfies Record<string, () => MeshData>;
