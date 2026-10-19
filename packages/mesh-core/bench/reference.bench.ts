// B0a reference kernel benches (report only; M6A-SPEC §5.27 budgets are B1's: derive edit links at 50k triangles
// ≤ 40 ms incl. caches). Run: pnpm --filter @ekza-animator/mesh-core bench
import { bench, describe } from 'vitest';
import {
  computeNormals,
  editMeshFrom,
  primitive,
  readRevision,
  topologyStats,
  triangulate,
  writeRevision,
} from '../src';

const plane = primitive('plane', { subdivisionsWidth: 158, subdivisionsHeight: 158 }); // 49,928 triangles
const mesh = editMeshFrom(plane);
const revision = writeRevision(plane);
let sink = 0;

describe('reference kernel, 50k triangles', () => {
  bench('editMeshFrom (edit links)', () => {
    sink += editMeshFrom(plane).counts.points;
  });
  bench('triangulate', () => {
    sink += triangulate(mesh).tris.length;
  });
  bench('computeNormals', () => {
    sink += computeNormals(mesh).corner.length;
  });
  bench('topologyStats', () => {
    sink += topologyStats(mesh).triangles;
  });
  bench('writeRevision (full)', () => {
    sink += writeRevision(plane).newChunks.size;
  });
  bench('readRevision', () => {
    sink += readRevision(revision.manifest, (id) => revision.newChunks.get(id) as Uint8Array).counts.faces;
  });
});

export const keep = (): number => sink;
