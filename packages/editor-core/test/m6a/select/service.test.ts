// B10 (M6A-SPEC §4.6, §5.6): the component selection service — apply modes and per-mode memory, pick order and the
// active component, hidden components (never selected, left out of reads, the closure), snapshot/restore (skipping
// meshes whose revision changed, never touching mode or hilite), remap, set during a commit (pending until the
// runtime follows), revisions remembered across undo and redo, the mirrored selection, session counts and the
// runtimes' edit links following the hilite.
import type { MeshId } from '@ekza-animator/doc';
import { BitSet, primitive, selectionOf } from '@ekza-animator/mesh-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { componentInternals, type EditorApp } from '../../../src';
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
