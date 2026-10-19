// B10 (M6A-SPEC §4.6, §5.6): the component selection service — apply modes and per-mode memory, pick order and the
// active component, hidden components (never selected, left out of reads, the closure), snapshot/restore (skipping
// meshes whose revision changed, never touching mode or hilite, every kind's pick order), remap, set during a commit
// (pending until the runtime follows, whatever the result's sizes; a same-size result keeps the other kinds; rolled-back
// commits), revisions remembered across undo and redo, the mirrored selection, session counts and the runtimes' edit
// links following the hilite. The same-size op through B7's real `commitOp` is gated on READY.b7.
import type { MeshId } from '@ekza-animator/doc';
import {
  BitSet,
  type ComponentSelection,
  type EditMesh,
  editMeshFrom,
  type MeshData,
  type MeshOp,
  type OpResult,
  primitive,
  selectionOf,
} from '@ekza-animator/mesh-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ApplyContext, componentInternals, type EditorApp } from '../../../src';
import { READY } from './ready';
import { addMesh, mirrorMapX, modelApp, selected, withSymmetry, writeRevision } from './support';

let app: EditorApp | null = null;
afterEach(() => {
  app?.dispose();
  app = null;
  vi.restoreAllMocks();
});

async function setup(): Promise<{ readonly app: EditorApp; readonly cube: MeshId; readonly plane: MeshId }> {
  app = await modelApp();
  const cube = addMesh(app, 'msh_Cube', 'cube');
  const plane = addMesh(app, 'msh_Plane', 'plane', { subdivisionsWidth: 2, subdivisionsHeight: 1 });
  return { app, cube, plane };
}

function hilite(a: EditorApp, meshes: readonly MeshId[], mode: 'vertex' | 'edge' | 'face' = 'face'): void {
  const model = a.session.getState().model;
  a.session.setState({ model: { ...model, componentMode: mode, lastComponentMode: mode, hilite: [...meshes] } });
}

describe('apply, per-mode memory, order and active', () => {
  it('replace, add, remove and toggle on one kind; the other kinds keep their sets', async () => {
    const { app: a, cube } = await setup();
    a.components.apply(cube, 'face', [2, 0], 'replace');
    expect(selected(a, cube, 'face')).toEqual([0, 2]);
    expect(a.components.get(cube, 'face').order).toEqual(Uint32Array.from([2, 0]));
    expect(a.components.get(cube, 'face').active).toBe(0);
    a.components.apply(cube, 'face', [5], 'add');
    a.components.apply(cube, 'face', [2], 'remove');
    expect(selected(a, cube, 'face')).toEqual([0, 5]);
    expect(a.components.get(cube, 'face').active).toBe(5);
    a.components.apply(cube, 'face', [5, 1], 'toggle');
    expect(selected(a, cube, 'face')).toEqual([0, 1]);
    expect(a.components.get(cube, 'face').order).toEqual(Uint32Array.from([0, 1]));
    // Per-mode memory: a vertex selection does not touch the face set, and both come back.
    a.components.apply(cube, 'vertex', [7], 'replace');
    expect(selected(a, cube, 'vertex')).toEqual([7]);
    expect(selected(a, cube, 'face')).toEqual([0, 1]);
    const value = a.components.get(cube, 'vertex');
    expect([value.kind, [...value.faces.toArray()]]).toEqual(['vertex', [0, 1]]);
  });

  it('reads the current mode by default, refuses out-of-range indices and returns copies', async () => {
    const { app: a, cube } = await setup();
    hilite(a, [cube], 'edge');
    a.components.apply(cube, 'edge', [3], 'replace');
    expect([...a.components.get(cube).edges.toArray()]).toEqual([3]);
    expect(a.components.get(cube).kind).toBe('edge');
    expect(() => a.components.apply(cube, 'edge', [12], 'add')).toThrow(
      expect.objectContaining({ code: 'out-of-range' }),
    );
    a.components.get(cube, 'edge').edges.add(0); // a copy: the service is unchanged
    expect(selected(a, cube, 'edge')).toEqual([3]);
    // An unknown mesh reads as an empty selection.
    expect(a.components.get('msh_None' as MeshId, 'face').faces.size).toBe(0);
  });

  it('clear(mesh) and clear() empty every kind', async () => {
    const { app: a, cube, plane } = await setup();
    a.components.apply(cube, 'face', [1], 'replace');
    a.components.apply(cube, 'vertex', [1], 'replace');
    a.components.apply(plane, 'edge', [2], 'replace');
    a.components.clear(cube);
    expect([selected(a, cube, 'face'), selected(a, cube, 'vertex'), selected(a, plane, 'edge')]).toEqual([[], [], [2]]);
    a.components.clear();
    expect(selected(a, plane, 'edge')).toEqual([]);
  });
});

describe('hidden components', () => {
  it('are never selected, are left out of reads and come back with the stored picks', async () => {
    const { app: a, cube } = await setup();
    hilite(a, [cube]);
    a.components.apply(cube, 'face', [0, 1], 'replace');
    const faces = new BitSet(6);
    faces.add(1);
    a.components.setHidden(cube, { verts: new BitSet(8), edges: new BitSet(12), faces });
    expect(selected(a, cube, 'face')).toEqual([0]);
    a.components.apply(cube, 'face', [1], 'add'); // hidden: not added
    expect(selected(a, cube, 'face')).toEqual([0]);
    a.components.setHidden(cube, { verts: new BitSet(8), edges: new BitSet(12), faces: new BitSet(6) });
    expect(selected(a, cube, 'face')).toEqual([0, 1]);
  });

  it('the closure hides edges and vertices that only hidden faces use (open meshes)', async () => {
    const { app: a, plane } = await setup();
    hilite(a, [plane]);
    const internals = componentInternals(a.components);
    if (internals === null) throw new Error('internals');
    const left = new BitSet(2);
    left.add(0);
    internals.hide(plane, 'face', left, 'selected');
    const hidden = a.components.hidden(plane);
    expect([...hidden.faces.toArray()]).toEqual([0]);
    // f0 = (0,3,4,1): its border edges e0 (0,3), e1 (3,4), e3 (1,0) go; the shared e2 (4,1) stays with f1.
    expect([...hidden.edges.toArray()]).toEqual([0, 1, 3]);
    expect([...hidden.verts.toArray()]).toEqual([0, 3]);
    // A vertex hide converts to the faces it touches (Maya): vertex 5 touches f1 only.
    const v5 = new BitSet(6);
    v5.add(5);
    internals.hide(plane, 'vertex', v5, 'selected');
    expect([...a.components.hidden(plane).faces.toArray()]).toEqual([0, 1]);
    internals.show(plane);
    expect(a.components.hidden(plane).faces.isEmpty()).toBe(true);
    // Hide unselected: every other face.
    internals.hide(plane, 'face', left, 'unselected');
    expect([...a.components.hidden(plane).faces.toArray()]).toEqual([1]);
  });
});

describe('snapshot and restore', () => {
  it('restores the per-kind sets of the snapshot meshes, never the mode or the hilite', async () => {
    const { app: a, cube, plane } = await setup();
    hilite(a, [cube, plane]);
    a.components.apply(cube, 'face', [3, 1], 'replace');
    a.components.apply(plane, 'vertex', [4], 'replace');
    const snap = a.components.snapshot();
    expect(Object.keys(snap.meshes)).toEqual([cube, plane]);
    expect(snap.componentMode).toBe('face');
    expect(snap.meshes[cube]?.order).toEqual(Uint32Array.from([3, 1]));
    a.components.apply(cube, 'face', [5], 'replace');
    a.components.apply(plane, 'vertex', [], 'replace');
    hilite(a, [cube], 'edge');
    expect(a.components.restore(snap)).toEqual({ skipped: [] });
    expect(selected(a, cube, 'face')).toEqual([1, 3]);
    expect(selected(a, plane, 'vertex')).toEqual([4]);
    expect(a.session.getState().model.componentMode).toBe('edge');
    expect(a.session.getState().model.hilite).toEqual([cube]);
    expect(a.components.get(cube, 'face').active).toBe(1);
  });

  it('skips a mesh whose revision changed since the snapshot (and reports it)', async () => {
    const { app: a, cube } = await setup();
    hilite(a, [cube]);
    a.components.apply(cube, 'face', [2], 'replace');
    const snap = a.components.snapshot();
    writeRevision(a, cube, primitive('cube', { subdivisionsWidth: 2 }));
    expect(a.components.restore(snap)).toEqual({ skipped: [cube] });
    const hidden = a.components.restoreHidden({
      objects: [],
      meshes: { [cube]: { ...snap.meshes[cube], manifest: 'x' } as never },
    });
    expect(hidden).toEqual({ skipped: [cube] });
  });
});

describe('revisions (set inside a commit, undo and redo)', () => {
  it('a set during a commit is pending until the runtime follows; undo and redo bring each revision back', async () => {
    const { app: a, cube } = await setup();
    hilite(a, [cube]);
    a.components.apply(cube, 'face', [1], 'replace');
    const bigger = primitive('cube', { subdivisionsWidth: 2 }); // 12/20/10
    a.store.transact({ label: 'Op' }, (tx) => {
      a.meshes.writeData(tx, cube, bigger);
      // The op's result selection indexes the new revision (B7 stores it inside the commit, §5.5).
      a.components.set(cube, selectionOf('face', [9], bigger.counts));
    });
    expect(selected(a, cube, 'face')).toEqual([9]);
    expect(a.components.get(cube, 'face').faces.size).toBe(10);
    a.store.undo.undo();
    expect(selected(a, cube, 'face')).toEqual([1]); // the selection the op read
    a.store.undo.redo();
    expect(selected(a, cube, 'face')).toEqual([9]); // the op's result
  });

  it('a commit that changes the edit mesh and data() before storing its result (B7) still undoes to the read selection', async () => {
    const { app: a, cube } = await setup();
    hilite(a, [cube]);
    a.components.apply(cube, 'face', [1], 'replace');
    const runtime = a.meshes.get(cube);
    if (runtime === undefined) throw new Error('runtime');
    const bigger = primitive('cube', { subdivisionsWidth: 2 });
    a.store.transact({ label: 'Op' }, (tx) => {
      // B7's runtime: the op mutates the open edit mesh and `data()` follows it before the revision lands.
      const edited = editMeshFrom(bigger);
      const own = Object.getOwnPropertyDescriptor(runtime, 'mesh');
      Object.defineProperty(runtime, 'mesh', { configurable: true, get: () => edited });
      const data = vi.spyOn(runtime, 'data').mockReturnValue(bigger);
      expect(selected(a, cube, 'face')).toEqual([1]); // a read during the op (the display) keeps the indices
      a.meshes.writeData(tx, cube, bigger);
      a.components.set(cube, selectionOf('face', [9], bigger.counts));
      data.mockRestore();
      // Back to the runtime's own `mesh` (a field of the stub, a getter of B7's) before the revision lands.
      if (own === undefined) Reflect.deleteProperty(runtime, 'mesh');
      else Object.defineProperty(runtime, 'mesh', own);
    });
    expect(selected(a, cube, 'face')).toEqual([9]);
    a.store.undo.undo();
    expect(selected(a, cube, 'face')).toEqual([1]);
    a.store.undo.redo();
    expect(selected(a, cube, 'face')).toEqual([9]);
  });

  it('a revision it never saw keeps the selection when the sizes match and clears it otherwise', async () => {
    const { app: a, cube } = await setup();
    hilite(a, [cube]);
    a.components.apply(cube, 'face', [4], 'replace');
    writeRevision(a, cube, primitive('cube', { width: 2 })); // same counts, other positions
    expect(selected(a, cube, 'face')).toEqual([4]);
    writeRevision(a, cube, primitive('cube', { subdivisionsHeight: 2 }));
    expect(selected(a, cube, 'face')).toEqual([]);
  });

  it('remap moves selections and hidden sets to the new indices', async () => {
    const { app: a, plane } = await setup();
    hilite(a, [plane]);
    a.components.apply(plane, 'face', [0], 'replace');
    a.components.apply(plane, 'vertex', [5, 0], 'replace');
    const forward = Int32Array.from([5, 4, 3, 2, 1, 0]);
    a.components.remap(plane, {
      point: { forward, createdFrom: 6 },
      edge: { forward: null, createdFrom: 7 },
      face: { forward: Int32Array.from([1, 0]), createdFrom: 2 },
      corner: { forward: null, createdFrom: 8 },
    });
    expect(selected(a, plane, 'face')).toEqual([1]);
    expect(selected(a, plane, 'vertex')).toEqual([0, 5]);
    expect(a.components.get(plane, 'vertex').active).toBe(5);
  });

  it('a deleted mesh leaves the service', async () => {
    const { app: a, cube } = await setup();
    a.components.apply(cube, 'face', [1], 'replace');
    a.store.transact({ label: 'Delete' }, (tx) => tx.patch('meshes', cube, { data: null }));
    expect(a.components.get(cube, 'face').faces.size).toBe(0);
    expect(componentInternals(a.components)?.sizes(cube)).toBeNull();
  });
});

describe('mirrored selection (§5.6)', () => {
  it('expands the picks by their partners; a removal on either side removes both', async () => {
    const { app: a, plane } = await setup();
    const data = a.meshes.get(plane)?.data();
    if (data === null || data === undefined) throw new Error('data');
    withSymmetry(a, plane, mirrorMapX(data));
    hilite(a, [plane], 'vertex');
    const internals = componentInternals(a.components);
    if (internals === null) throw new Error('internals');
    a.components.apply(plane, 'vertex', [0], 'replace'); // v0 (-0.5, 0, -0.5) ↔ v2
    expect(selected(a, plane, 'vertex')).toEqual([0]);
    expect([...(internals.expanded(plane, 'vertex')?.verts.toArray() ?? [])]).toEqual([0, 2]);
    expect([...(internals.mirrored(plane, 'vertex')?.verts.toArray() ?? [])]).toEqual([2]);
    expect(a.session.getState().model.components.mirrored).toEqual({ vertex: 1, edge: 0, face: 0 });
    // A Shift toggle on the partner turns the pair off; a Mod removal on a partner removes the pick.
    a.components.apply(plane, 'vertex', [2], 'toggle');
    expect(internals.expanded(plane, 'vertex')?.verts.isEmpty()).toBe(true);
    a.components.apply(plane, 'vertex', [3], 'add');
    a.components.apply(plane, 'vertex', [5], 'remove');
    expect(internals.expanded(plane, 'vertex')?.verts.isEmpty()).toBe(true);
    // Seam vertices are their own partners; an unmatched pick stays one-sided.
    a.components.apply(plane, 'vertex', [1], 'replace');
    expect([...(internals.expanded(plane, 'vertex')?.verts.toArray() ?? [])]).toEqual([1]);
    expect(internals.partnerOf(plane, 'face', 0)).toBe(1);
  });
});

describe('session counts and edit links', () => {
  it('publishes selected, mirrored and hidden counts of the hilited meshes with a version', async () => {
    const { app: a, cube, plane } = await setup();
    const versions: number[] = [];
    a.components.subscribe((v) => versions.push(v));
    hilite(a, [cube, plane]);
    a.components.apply(cube, 'face', [0, 1], 'replace');
    a.components.apply(plane, 'face', [1], 'replace');
    const counts = a.session.getState().model.components;
    expect(counts.selected).toEqual({ vertex: 0, edge: 0, face: 3 });
    expect(counts.version).toBe(a.components.version);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions).toEqual([...versions].sort((x, y) => x - y));
  });

  it('a component tool in object mode hilites (and opens) the selected meshes until it ends (§5.6)', async () => {
    const { app: a, cube, plane } = await setup();
    a.session.setState({ selection: { ...a.session.getState().selection, objects: [cube] } });
    const model = a.session.getState().model;
    a.session.setState({ model: { ...model, hilite: [plane] } }); // the last component session's list
    a.session.setState({ tools: { ...a.session.getState().tools, viewport: 'multiCut' } });
    expect(a.session.getState().model.componentMode).toBe('object');
    expect(a.session.getState().model.hilite).toEqual([cube]);
    expect(a.meshes.get(cube)?.isOpen).toBe(true);
    a.session.setState({ tools: { ...a.session.getState().tools, viewport: 'select' } });
    expect(a.session.getState().model.hilite).toEqual([plane]);
    expect(a.meshes.get(cube)?.isOpen).toBe(false);
  });

  it('opens the hilited meshes in a component mode and closes them in object mode or outside Model (§5.5 r8)', async () => {
    const { app: a, cube, plane } = await setup();
    expect(a.meshes.get(cube)?.isOpen).toBe(false);
    hilite(a, [cube]);
    expect(a.meshes.get(cube)?.isOpen).toBe(true);
    expect(a.meshes.get(plane)?.isOpen).toBe(false);
    hilite(a, [cube, plane]);
    expect(a.meshes.get(plane)?.isOpen).toBe(true);
    hilite(a, [plane]);
    expect(a.meshes.get(cube)?.isOpen).toBe(false);
    await a.run('workspace.set', { workspace: 'animate' });
    expect(a.session.getState().model.componentMode).toBe('object');
    expect(a.meshes.get(plane)?.isOpen).toBe(false);
  });
});

/**
 * B7's commit as the stub registry cannot show it: the op's revision is written and the runtime's stored form replaced
 * (B7 caches the new revision's `data()`) before the op's result selection is stored, inside the transaction.
 */
function commitOp(
  a: EditorApp,
  id: MeshId,
  data: MeshData,
  sel: ComponentSelection,
  opts?: { readonly fail?: boolean },
): void {
  const runtime = a.meshes.get(id);
  if (runtime === undefined) throw new Error('runtime');
  a.store.transact({ label: 'Op' }, (tx) => {
    a.meshes.writeData(tx, id, data);
    const stored = vi.spyOn(runtime, 'data').mockReturnValue(data);
    try {
      a.components.set(id, sel);
    } finally {
      stored.mockRestore();
    }
    if (opts?.fail === true) throw new Error('the op failed after storing its selection');
  });
}

describe('same-size ops (a result that differs from what the op read, §5.6 undo, §5.7 Adjust Last)', () => {
  /** Vertex 3 and face 0 selected in face mode, then an op that keeps the counts and leaves face 1 selected. */
  async function afterOp() {
    const { app: a, cube } = await setup();
    hilite(a, [cube]);
    a.components.apply(cube, 'vertex', [3], 'replace');
    a.components.apply(cube, 'face', [0], 'replace');
    const moved = primitive('cube', { width: 2 }); // same counts, other positions
    commitOp(a, cube, moved, selectionOf('face', [1], moved.counts));
    return { a, cube };
  }

  it('the result is the new revision’s; undo restores what the op read, redo the result; vertex picks stay', async () => {
    const { a, cube } = await afterOp();
    expect([selected(a, cube, 'face'), selected(a, cube, 'vertex')]).toEqual([[1], [3]]);
    await Promise.resolve(); // the end of the task settles nothing else
    expect([selected(a, cube, 'face'), selected(a, cube, 'vertex')]).toEqual([[1], [3]]);
    a.store.undo.undo();
    expect([selected(a, cube, 'face'), selected(a, cube, 'vertex')]).toEqual([[0], [3]]);
    a.store.undo.redo();
    expect([selected(a, cube, 'face'), selected(a, cube, 'vertex')]).toEqual([[1], [3]]);
    a.store.undo.undo();
    expect(selected(a, cube, 'face')).toEqual([0]);
  });

  it('undo right after the commit (no read in between) still restores what the op read', async () => {
    const { a, cube } = await afterOp();
    a.store.undo.undo();
    expect([selected(a, cube, 'face'), selected(a, cube, 'vertex')]).toEqual([[0], [3]]);
  });

  it('a selection stored outside a commit, then an op in the same task: undo restores that selection', async () => {
    const { app: a, cube } = await setup();
    hilite(a, [cube]);
    // A store outside a commit (B7's `select`, B13's swatch selection) changes the current revision's state.
    a.components.set(cube, selectionOf('face', [4], cube6()));
    const moved = primitive('cube', { width: 2 });
    commitOp(a, cube, moved, selectionOf('face', [5], moved.counts));
    expect(selected(a, cube, 'face')).toEqual([5]);
    a.store.undo.undo();
    expect(selected(a, cube, 'face')).toEqual([4]);
  });

  it('a rolled-back same-size commit (content changed under the same revision) restores what the op read', async () => {
    const { app: a, cube } = await setup();
    hilite(a, [cube]);
    a.components.apply(cube, 'vertex', [3], 'replace');
    a.components.apply(cube, 'face', [0], 'replace');
    const moved = primitive('cube', { width: 2 });
    expect(() => commitOp(a, cube, moved, selectionOf('face', [1], moved.counts), { fail: true })).toThrow(
      'the op failed after storing its selection',
    );
    // B7 applies the op's delta backward in its verify microtask (a content change, §5.5 rule 3): the runtime's
    // version moves while its revision stays.
    const runtime = a.meshes.get(cube);
    if (runtime === undefined) throw new Error('runtime');
    const version = runtime.version;
    Object.defineProperty(runtime, 'version', { configurable: true, get: () => version + 1 });
    await Promise.resolve();
    expect([selected(a, cube, 'face'), selected(a, cube, 'vertex')]).toEqual([[0], [3]]);
  });
});

/** The cube primitive's counts (8/12/6). */
function cube6(): { points: number; edges: number; faces: number; corners: number } {
  return primitive('cube', {}).counts;
}

describe('snapshots keep every kind’s pick order (§5.6 per-mode memory)', () => {
  it('a snapshot taken in edge mode restores the face pick order and active face', async () => {
    const { app: a, cube } = await setup();
    hilite(a, [cube], 'face');
    a.components.apply(cube, 'face', [5], 'replace');
    a.components.apply(cube, 'face', [2], 'add');
    hilite(a, [cube], 'edge');
    a.components.apply(cube, 'edge', [1], 'replace');
    const snap = a.components.snapshot();
    expect(snap.meshes[cube]?.kind).toBe('edge');
    a.components.apply(cube, 'face', [1], 'replace');
    a.components.restore(snap);
    const face = a.components.get(cube, 'face');
    expect([[...(face.order ?? [])], face.active]).toEqual([[5, 2], 2]);
  });

  it('a copied snapshot (no per-kind orders) keeps the other kinds’ order for the picks still selected', async () => {
    const { app: a, cube } = await setup();
    hilite(a, [cube], 'face');
    a.components.apply(cube, 'face', [5], 'replace');
    a.components.apply(cube, 'face', [2], 'add');
    hilite(a, [cube], 'edge');
    const snap = structuredClone(a.components.snapshot());
    a.components.apply(cube, 'edge', [3], 'replace');
    a.components.restore(snap);
    const face = a.components.get(cube, 'face');
    expect([[...(face.order ?? [])], face.active]).toEqual([[5, 2], 2]);
  });
});

describe.skipIf(!READY.b7)('a same-size op through the real runtime (B7 commitOp)', () => {
  /** `mesh.test.b10advance`: lifts every vertex and leaves the next face selected (its result differs from its read). */
  function advance(a: EditorApp, cube: MeshId, opts?: { readonly fail?: boolean }): { readonly reads: number[][] } {
    (a.meshes as unknown as { attach?(app: EditorApp): void }).attach?.(a);
    const reads: number[][] = [];
    const op: MeshOp = {
      id: 'mesh.test.b10advance',
      label: 'Advance',
      kinds: ['face'],
      params: [],
      flags: { adjustable: true, repeatable: true, topology: false, manifoldPreserving: true },
      symmetry: 'expand',
      poll: () => true,
      run(m: EditMesh, sel: ComponentSelection | null): OpResult {
        const faces = sel === null ? [] : [...sel.faces.toArray()];
        reads.push(faces);
        for (let v = 0; v < m.counts.points; v++) {
          const p = m.position;
          m.setPosition(v, p[3 * v] as number, (p[3 * v + 1] as number) + 0.1, p[3 * v + 2] as number);
        }
        const next = faces.map((f) => (f + 1) % m.counts.faces);
        return { selection: selectionOf('face', next, m.counts), warnings: [], resolvedArgs: {} };
      },
    };
    a.operators.register({
      id: op.id,
      label: op.label,
      category: 'mesh',
      scope: 'model',
      flags: { undo: true },
      extraArgs: ['meshes'],
      apply(ctx: ApplyContext) {
        const result = ctx.app.meshes.commitOp(ctx.tx as never, op, [cube], {}, { seed: 'seed' });
        // The transaction aborts after the op stored its result (§5.5 rule 3: two-phase, reverted).
        if (opts?.fail === true) throw new Error('the operator failed after the commit');
        return result;
      },
    });
    return { reads };
  }

  /** Vertex 3, then face 0 (face mode). */
  async function picked(): Promise<{ readonly a: EditorApp; readonly cube: MeshId }> {
    const { app: a, cube } = await setup();
    hilite(a, [cube], 'vertex');
    a.components.apply(cube, 'vertex', [3], 'replace');
    hilite(a, [cube], 'face');
    a.components.apply(cube, 'face', [0], 'replace');
    return { a, cube };
  }

  it('undo restores what the op read and redo its result; the vertex picks survive', async () => {
    const { a, cube } = await picked();
    const { reads } = advance(a, cube);
    expect((await a.runUntyped('mesh.test.b10advance', { meshes: [cube] })).status).toBe('finished');
    expect(reads).toEqual([[0]]);
    expect([selected(a, cube, 'face'), selected(a, cube, 'vertex')]).toEqual([[1], [3]]);
    a.history.undo();
    expect([selected(a, cube, 'face'), selected(a, cube, 'vertex')]).toEqual([[0], [3]]);
    a.history.redo();
    expect([selected(a, cube, 'face'), selected(a, cube, 'vertex')]).toEqual([[1], [3]]);
  });

  it('an aborted transaction after the commit brings back what the op read', async () => {
    const { a, cube } = await picked();
    advance(a, cube, { fail: true });
    expect((await a.runUntyped('mesh.test.b10advance', { meshes: [cube] })).status).toBe('failed');
    await Promise.resolve();
    expect([selected(a, cube, 'face'), selected(a, cube, 'vertex')]).toEqual([[0], [3]]);
  });
});

describe('a rolled-back commit', () => {
  it('drops a pending result when the runtime reports the committed revision again', async () => {
    const { app: a, cube } = await setup();
    hilite(a, [cube]);
    a.components.apply(cube, 'face', [2], 'replace');
    const bigger = primitive('cube', { subdivisionsWidth: 2 });
    expect(() =>
      a.store.transact({ label: 'Op' }, (tx) => {
        a.meshes.writeData(tx, cube, bigger);
        a.components.set(cube, selectionOf('face', [9], bigger.counts));
        throw new Error('the op failed after storing its selection');
      }),
    ).toThrow('the op failed');
    // B7 reverts the edit mesh and reports a change (§5.5 rule 3); the stub's runtime emits one when it reloads.
    const runtime = a.meshes.get(cube);
    if (runtime === undefined) throw new Error('runtime');
    (runtime as unknown as { emit(e: unknown): void }).emit({ type: 'rebuilt' });
    expect(selected(a, cube, 'face')).toEqual([2]);
    expect(a.components.get(cube, 'face').faces.size).toBe(6);
  });
});
