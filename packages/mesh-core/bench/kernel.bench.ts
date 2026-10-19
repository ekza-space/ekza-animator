// B1 kernel benches (report only; M6A-SPEC §5.27, §9 B1 DoD): derive edit links at 50k triangles (budget ≤ 40 ms
// incl. caches), normals, triangulation (full and incremental), revision write (full and incremental) and read,
// Euler operator throughput with its undo, and validation. Run: pnpm --filter @ekza-animator/mesh-core bench
import { bench, describe } from 'vitest';
import {
  computeNormals,
  editMeshFrom,
  type MeshDelta,
  primitive,
  readRevision,
  setKernelDebug,
  topologyStats,
  triangulate,
  validateMesh,
  writeRevision,
} from '../src';

// Production cost: the test setup turns the debug validation on; benches measure without it (validateMesh has its own
// row below).
setKernelDebug(false);

const plane = primitive('plane', { subdivisionsWidth: 158, subdivisionsHeight: 158 }); // 49,928 triangles
const sphere = primitive('sphere', { subdivisionsAxis: 128, subdivisionsHeight: 128 }); // 32,512 triangles
const mesh = editMeshFrom(plane);
const tri = triangulate(mesh);
const normals = computeNormals(mesh);
const revision = writeRevision(plane);
let sink = 0;

// A 100-vertex position edit for the incremental paths.
const edited = editMeshFrom(plane);
edited.begin('nudge');
for (let i = 0; i < 100; i++) {
  const v = (i * 251) % edited.counts.points;
  const p = edited.position;
  edited.setPosition(v, p[3 * v] as number, 0.01 * i, p[3 * v + 2] as number);
}
const nudge: MeshDelta = edited.end();
const dirtyFaces = (() => {
  const set = new Set<number>();
  const moved = new Set(nudge.dirty.points as Uint32Array);
  for (let c = 0; c < edited.counts.corners; c++) if (moved.has(edited.cornerVert(c))) set.add(edited.cornerFace(c));
  return Uint32Array.from([...set].sort((a, b) => a - b));
})();

describe('50k triangles (plane 158 × 158)', () => {
  bench('editMeshFrom (edit links)', () => {
    sink += editMeshFrom(plane).counts.points;
  });
  bench('editMeshFrom + triangulate + computeNormals (enter component mode, kernel part)', () => {
    const m = editMeshFrom(plane);
    sink += triangulate(m).tris.length + computeNormals(m).corner.length;
  });
  bench('triangulate (full)', () => {
    sink += triangulate(mesh).tris.length;
  });
  bench('triangulate (incremental, faces around 100 moved points)', () => {
    sink += triangulate(edited, tri, dirtyFaces).tris.length;
  });
  bench('computeNormals (full)', () => {
    sink += computeNormals(mesh).corner.length;
  });
  bench('computeNormals (incremental, 100 moved points)', () => {
    sink += computeNormals(edited, normals, nudge.dirty).corner.length;
  });
  bench('topologyStats', () => {
    sink += topologyStats(mesh).triangles;
  });
  bench('validateMesh (debug builds, every commit)', () => {
    sink += validateMesh(mesh).length;
  });
  bench('writeRevision (full)', () => {
    sink += writeRevision(plane).newChunks.size;
  });
  bench('writeRevision (incremental, 100 moved points)', () => {
    sink += writeRevision(edited, { previous: revision.manifest, dirty: nudge.dirty }).newChunks.size;
  });
  bench('readRevision', () => {
    sink += readRevision(revision.manifest, (id) => revision.newChunks.get(id) as Uint8Array).counts.faces;
  });
});

describe('Euler operators', () => {
  bench('split 1,000 edges in one transaction, then undo it', () => {
    const m = editMeshFrom(plane);
    m.begin('split');
    for (let i = 0; i < 1000; i++) m.splitEdgeMakeVert((i * 37) % 20_000, 0.5);
    const delta = m.end();
    m.apply(delta, 'backward');
    sink += delta.bytes;
  });
  bench('cut 1,000 quads in one transaction (splitFaceMakeEdge)', () => {
    const m = editMeshFrom(plane);
    m.begin('cut');
    for (let f = 0; f < 1000; f++) {
      const c = m.faceCorner(f);
      m.splitFaceMakeEdge(f, c, m.cornerNext(m.cornerNext(c)));
    }
    sink += m.end().bytes;
  });
  bench('kill 1,000 faces (descending) in one transaction', () => {
    const m = editMeshFrom(plane);
    m.begin('kill');
    for (let f = 1999; f >= 1000; f--) m.killFace(f);
    sink += m.end().bytes;
  });
});

describe('primitives', () => {
  bench('sphere 128 × 128 (32k triangles)', () => {
    sink += primitive('sphere', { subdivisionsAxis: 128, subdivisionsHeight: 128 }).counts.faces;
  });
  bench('editMeshFrom(sphere 128 × 128)', () => {
    sink += editMeshFrom(sphere).counts.points;
  });
});

export const keep = (): number => sink;
