// M6A-SPEC §5.27 (B7 rows, report-only): commit (hash dirty chunks + write the ref) ≤ 3 ms, undo through the journal
// ≤ 5 ms and by rebuild ≤ 40 ms at 50k triangles; memory per edited 50k-tri mesh ≤ 40 MB; undo-retained chunks and
// journals within the 256 MB budget on 50 morph layers × 200 commits of a 10k-vertex mesh (evicted chunks freed).
// Run with `pnpm --filter @ekza-animator/editor-core exec vitest bench --run` (the kernel debug switch is off here:
// `validateMesh` after every commit is a test and development-build cost, not a runtime one).
import type { MeshId } from '@ekza-animator/doc';
import { makeTestMesh } from '@ekza-animator/doc/testing';
import {
  editMeshFrom,
  type MeshData,
  type MeshOp,
  morphLayer,
  primitive,
  selectionOf,
  setKernelDebug,
} from '@ekza-animator/mesh-core';
import { bench, describe } from 'vitest';
import { createEditorApp, createMemoryBlobStore, type KernelMeshRuntimes, loadMeshKernel } from '../src';
import { createFakeServices } from '../src/testing';

await loadMeshKernel();

/** A 50k-triangle cube (6 × 64 × 64 quads). */
const BIG = primitive('cube', { subdivisionsWidth: 64, subdivisionsHeight: 64, subdivisionsDepth: 64 });

function app() {
  const blobs = createMemoryBlobStore();
  // Fake services run the kernel with the debug switch on; the bench measures the production path.
  const services = { ...createFakeServices(), blobs, kernelDebug: false };
  const editor = createEditorApp({ services, builtins: false });
  setKernelDebug(false);
  const meshes = editor.meshes as KernelMeshRuntimes;
  meshes.attach(editor);
  return { editor, meshes, blobs };
}

function create(t: ReturnType<typeof app>, id: string, data: MeshData): MeshId {
  const ref = t.meshes.storeRevision(data);
  t.editor.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', makeTestMesh(id, { data: ref })));
  return id as MeshId;
}

/** Moves `count` vertices from `first` by `dy` (a typical small edit). */
function moveOp(first: number, count: number): MeshOp {
  return {
    id: 'mesh.bench.move',
    label: 'Move',
    kinds: 'object',
    params: [],
    flags: { adjustable: false, repeatable: false, topology: false, manifoldPreserving: true },
    symmetry: 'none',
    poll: () => true,
    run(m, _sel, args) {
      const dy = typeof args['dy'] === 'number' ? args['dy'] : 0.01;
      for (let v = first; v < first + count; v++) {
        m.setPosition(
          v,
          m.position[3 * v] as number,
          (m.position[3 * v + 1] as number) + dy,
          m.position[3 * v + 2] as number,
        );
      }
      return { selection: selectionOf('vertex', [], m.counts), warnings: [], resolvedArgs: { dy } };
    },
  };
}

const commit = (t: ReturnType<typeof app>, id: MeshId, op: MeshOp, dy: number): void => {
  t.editor.store.transact({ label: 'Move' }, (tx) =>
    t.meshes.commitOp(tx, op, [id], { dy }, { seed: 's', kind: null }),
  );
};

describe('B7 runtime at 50k triangles (§5.27: commit ≤ 3 ms, journal undo ≤ 5 ms, rebuild ≤ 40 ms)', () => {
  const t = app();
  const id = create(t, 'msh_Big', BIG);
  t.editor.meshes.open(id);
  const op = moveOp(0, 1000);
  let dy = 0;

  bench('commit: move 1,000 vertices (hash dirty chunks, store, patch the ref)', () => {
    dy += 0.001;
    commit(t, id, op, dy);
  });

  bench('undo + redo through the journal', () => {
    t.editor.store.undo.undo();
    t.editor.store.undo.redo();
  });

  // Rebuild path: a second mesh whose journal is gone (journal budget 0, then an undo past the last op's edge):
  // every undo/redo after that reads the revision from resident chunks and builds new edit links.
  const rebuilt = app();
  const other = create(rebuilt, 'msh_Rebuilt', BIG);
  rebuilt.editor.meshes.open(other);
  commit(rebuilt, other, moveOp(0, 1000), 0.01);
  commit(rebuilt, other, moveOp(0, 1000), 0.02);
  rebuilt.editor.prefs.setState({ modeling: { ...rebuilt.editor.prefs.getState().modeling, journalBudgetMB: 0 } });
  rebuilt.meshes.collect();
  rebuilt.editor.store.undo.undo(); // the pinned edge
  rebuilt.editor.store.undo.undo(); // a rebuild: the old edit links and their edges are gone

  bench('redo + undo by rebuild from resident chunks (two rebuilds, open mesh)', () => {
    rebuilt.editor.store.undo.redo();
    rebuilt.editor.store.undo.undo();
  });
});

describe('B7 memory per edited 50k-tri mesh (§5.27: ≤ 40 MB, report)', () => {
  bench(
    'open, edit 20 times and report bytes (MeshData + edit links estimate + journal + resident blobs)',
    () => {
      const t = app();
      const id = create(t, 'msh_Big', BIG);
      t.editor.meshes.open(id);
      for (let i = 0; i < 20; i++) commit(t, id, moveOp(i * 500, 500), 0.01);
      const data = t.editor.meshes.get(id)?.data() as MeshData;
      let dataBytes = data.position.byteLength + data.edgeVerts.byteLength + data.edgeFlags.byteLength;
      dataBytes += data.cornerVert.byteLength + data.cornerNext.byteLength + data.faceCorner.byteLength;
      dataBytes += data.faceMaterial.byteLength + data.faceFlags.byteLength;
      // Edit links (reference kernel): 3 × C (prev, face, edge, radial) + E (corner, disk) + P (vertEdge), Int32.
      const links = 4 * (4 * data.counts.corners + 2 * data.counts.edges + data.counts.points);
      const total = dataBytes * 2 + links + t.meshes.journalBytes + t.blobs.residentBytes;
      console.warn(
        `[B7 bench] memory per edited 50k-tri mesh ≈ ${(total / 1024 / 1024).toFixed(1)} MB ` +
          `(data ${(dataBytes / 1024 / 1024).toFixed(1)} MB ×2, links ${(links / 1024 / 1024).toFixed(1)} MB, ` +
          `journal ${(t.meshes.journalBytes / 1024).toFixed(0)} KB, blobs ${(t.blobs.residentBytes / 1024 / 1024).toFixed(1)} MB)`,
      );
      if (total > 40 * 1024 * 1024) throw new Error(`memory per edited mesh ${total} B > 40 MB`);
    },
    { iterations: 1, time: 0, warmupIterations: 0, warmupTime: 0 },
  );
});

describe('B7 undo budget (§5.20: 50 morph layers × 200 commits on a 10k-vertex mesh within 256 MB)', () => {
  bench(
    '200 commits, one morph layer each, with budget checks; evicted chunks are freed',
    () => {
      const t = app();
      const m = editMeshFrom(primitive('plane', { subdivisionsWidth: 99, subdivisionsHeight: 99 }));
      m.begin('morphs');
      for (let k = 0; k < 50; k++) m.addLayer(morphLayer(`Shape${k}`));
      m.end();
      const id = create(t, 'msh_Morphs', m.snapshot());
      const write = (k: number, value: number): MeshOp => ({
        ...moveOp(0, 0),
        id: 'mesh.bench.morph',
        run(mesh) {
          const layer = mesh.layer(`morph:Shape${k}`);
          if (layer === undefined) throw new Error('no layer');
          for (let v = 0; v < mesh.counts.points; v += 3) layer.set(v, 1, value);
          return { selection: selectionOf('vertex', [], mesh.counts), warnings: [], resolvedArgs: {} };
        },
      });
      let peak = 0;
      for (let i = 0; i < 200; i++) {
        commit(t, id, write(i % 50, i / 100), 0);
        t.meshes.collect();
        peak = Math.max(peak, t.meshes.historyBytes + t.meshes.journalBytes + t.meshes.selectionBytes);
      }
      const budget = 256 * 1024 * 1024;
      // A tight budget then releases older steps and frees their chunks.
      const before = t.blobs.residentBytes;
      t.editor.prefs.setState({ modeling: { ...t.editor.prefs.getState().modeling, undoBudgetMB: 4 } });
      const report = t.meshes.collect();
      console.warn(
        `[B7 bench] 50 morph layers × 200 commits: peak retained ${(peak / 1024 / 1024).toFixed(1)} MB ` +
          `(budget 256 MB); 4 MB budget dropped ${report.dropped} steps, freed ${report.freed} blobs ` +
          `(${((before - t.blobs.residentBytes) / 1024 / 1024).toFixed(1)} MB)`,
      );
      if (peak > budget) throw new Error(`retained ${peak} B > 256 MB`);
      if (report.freed === 0) throw new Error('the budget freed nothing');
    },
    { iterations: 1, time: 0, warmupIterations: 0, warmupTime: 0 },
  );
});
