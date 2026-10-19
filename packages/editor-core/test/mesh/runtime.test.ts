// M6A-SPEC §5.5 (B7): the runtime lifecycle, commits (rev, base, joints, generator), two-phase on an aborting
// transaction, the journal fast path and the rebuild fallback for undo/redo, `close` keeping the journal with
// adjust-last synchronous, `data()` of closed meshes, 'loading' and 'error' with their poll failures, remote changes,
// preview sessions (fast path, re-run, cancel, 'before-last' across the undo of its own step) and atomic refusals.
import type { MeshId, MeshRef, UserId } from '@ekza-animator/doc';
import { makeTestMesh } from '@ekza-animator/doc/testing';
import {
  type MeshData,
  parseManifest,
  primitive,
  readRevision,
  selectionOf,
  setKernelDebug,
  writeRevision,
} from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import { MESH_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';
import { addBlobSource, type MeshRuntimeEvent, meshOperator } from '../../src';
import {
  advanceOp,
  createMesh,
  cube,
  flushMicrotasks,
  invalidOp,
  meshTestApp,
  offsetOp,
  positionsOf,
  refusingOp,
  storeRevision,
  testOperator,
} from './support';

const ref = (
  t: { app: { store: { get: (table: 'meshes', id: MeshId) => { data: MeshRef | null } | undefined } } },
  id: MeshId,
) => t.app.store.get('meshes', id)?.data ?? null;

/** A face selection of face 0 (the cube's first face). */
const face0 = (id: MeshId, data: MeshData = cube()) => new Map([[id, selectionOf('face', [0], data.counts)]]);

function events(t: Awaited<ReturnType<typeof meshTestApp>>, id: MeshId): MeshRuntimeEvent[] {
  const out: MeshRuntimeEvent[] = [];
  t.app.meshes.subscribe((mesh, e) => {
    if (mesh === id) out.push(e);
  });
  return out;
}

describe('runtime lifecycle (§5.5 rule 8)', () => {
  it('keeps one runtime per live record with data: created on insert, disposed on delete, back on undo', async () => {
    const t = await meshTestApp();
    t.app.store.transact({ label: 'Empty' }, (tx) => tx.put('meshes', makeTestMesh('msh_Empty')));
    const id = createMesh(t, 'msh_Cube');
    expect(t.app.meshes.list().map((r) => r.id)).toEqual([id]);
    const runtime = t.app.meshes.get(id);
    expect(runtime).toMatchObject({ state: 'ready', isOpen: false, mesh: null, error: null });
    expect(runtime?.data()?.counts).toEqual(cube().counts);
    t.app.store.transact({ label: 'Delete' }, (tx) => tx.softDelete('meshes', id));
    expect(t.app.meshes.get(id)).toBeUndefined();
    t.app.history.undo();
    expect(t.app.meshes.get(id)?.state).toBe('ready');
    expect(t.app.meshes.get(id)?.data()?.counts).toEqual(cube().counts);
  });

  it('serves data(), triangulation and normals closed; open builds edit links, close drops them', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const runtime = t.app.meshes.get(id);
    expect(runtime?.triangulation().tris.length).toBe(36);
    expect(runtime?.normals().face.length).toBe(18);
    const open = t.app.meshes.open(id);
    expect(open.isOpen).toBe(true);
    expect(open.mesh?.counts).toEqual(cube().counts);
    expect(t.app.meshes.open(id).mesh).toBe(open.mesh); // idempotent
    t.app.meshes.close(id);
    expect(open.mesh).toBeNull();
    expect(open.isOpen).toBe(false);
    expect(open.data()?.counts).toEqual(cube().counts);
  });
});

describe('commits (§5.5 rules 2, 9)', () => {
  it('writes rev + 1, base and joints, sets generator null, records one step and a pinned journal edge', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube', cube(), {
      generator: { kind: 'cube', params: { width: 1 }, version: 1 },
    });
    const before = ref(t, id) as MeshRef;
    const op = offsetOp();
    t.app.operators.register(testOperator(op, { selection: () => face0(id) }));
    const steps = t.app.history.canUndo();
    const result = await t.app.runUntyped(op.id, { meshes: [id], kind: 'face', dy: 0.25 });
    expect(result.status).toBe('finished');
    const after = ref(t, id) as MeshRef;
    expect(after).toMatchObject({ rev: 2, base: before.manifest, joints: [] });
    expect(after.manifest).not.toBe(before.manifest);
    expect(t.app.store.get('meshes', id)?.generator).toBeNull();
    expect(steps).toBe(true);
    expect(t.app.history.peekUndo()?.label).toBe('Offset');
    expect(t.meshes.journalBytes).toBeGreaterThan(0);
    expect(t.meshes.lastOpEdges()).toEqual([{ mesh: id, from: before.manifest, to: after.manifest }]);
    // The runtime's content is the committed revision.
    const stored = readRevision(
      parseManifest(t.blobs.peek(after.manifest) as Uint8Array),
      (c) => t.blobs.peek(c) as Uint8Array,
    );
    expect(positionsOf(t, id)).toEqual([...stored.position]);
    // The op's selection is kept (the component selection service until B10, else the runtime's fallback).
    expect(t.meshes.selectionFor(id, 'face')?.faces.has(0)).toBe(true);
  });

  it('writes nothing for a run that changes nothing (no step)', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const op = offsetOp();
    t.app.operators.register(testOperator(op, { selection: () => face0(id) }));
    const version = t.app.store.version;
    await t.app.runUntyped(op.id, { meshes: [id], kind: 'face', dy: 0 });
    expect(ref(t, id)?.rev).toBe(1);
    expect(t.app.store.version).toBe(version);
    expect(t.app.history.peekUndo()?.label).toBe('Create');
  });

  it('refuses atomically: one target refusing reverts every target, no step, op-refused', async () => {
    const t = await meshTestApp();
    const a = createMesh(t, 'msh_A');
    const b = createMesh(t, 'msh_B');
    const before = { a: positionsOf(t, a), b: positionsOf(t, b) };
    const op = refusingOp();
    t.app.operators.register(testOperator(op));
    const result = await t.app.runUntyped(op.id, { meshes: [a, b] });
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'op-refused', message: 'This op always refuses' },
    });
    expect(positionsOf(t, a)).toEqual(before.a);
    expect(positionsOf(t, b)).toEqual(before.b);
    expect(t.app.history.peekUndo()?.label).toBe('Create');
    // A refusal on the second target reverts the first one's run.
    const plane = createMesh(t, 'msh_Plane', primitive('plane', {}));
    const planeBefore = positionsOf(t, plane);
    const offset = offsetOp();
    const second: typeof offset = {
      ...offset,
      id: 'mesh.test.second',
      run: (m, sel, args, ctx) =>
        m.counts.faces === 1
          ? ({ refused: true, code: 'test.second', reason: 'second refuses' } as never)
          : offset.run(m, sel, args, ctx),
    };
    t.app.operators.register(testOperator(second));
    const failed = await t.app.runUntyped(second.id, { meshes: [a, plane], dy: 1 });
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'op-refused', message: 'second refuses' } });
    expect(offset.runs).toBe(1);
    expect(positionsOf(t, a)).toEqual(before.a);
    expect(positionsOf(t, plane)).toEqual(planeBefore);
    expect(t.app.meshes.get(a)?.isOpen).toBe(false);
    expect(t.app.history.peekUndo()?.label).toBe('Create');
  });

  it('validates every commit under the kernel debug switch: an invalid result fails and leaves the mesh as it was', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const before = positionsOf(t, id);
    const op = invalidOp();
    t.app.operators.register(testOperator(op));
    const result = await t.app.runUntyped(op.id, { meshes: [id] });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'invalid-mesh' } });
    expect(positionsOf(t, id)).toEqual(before);
    expect(ref(t, id)?.rev).toBe(1);
  });
});

describe('two-phase (§5.5 rule 3)', () => {
  it("reverts the runtime when the operator's transaction aborts after commitOp", async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const before = { positions: positionsOf(t, id), ref: ref(t, id) };
    const op = offsetOp();
    t.app.operators.register({
      ...testOperator(op),
      id: 'mesh.test.abort',
      apply(ctx) {
        t.meshes.commitOp(ctx.tx as never, op, [id], { dy: 1 }, { seed: 's', kind: null });
        // Read-your-writes: the content changed inside the transaction …
        expect(positionsOf(t, id)).not.toEqual(before.positions);
        throw new Error('abort after the commit');
      },
    });
    const result = await t.app.runUntyped('mesh.test.abort', {});
    expect(result.status).toBe('failed');
    // … and is back after the abort: never diverged from the committed ref.
    expect(ref(t, id)).toEqual(before.ref);
    expect(positionsOf(t, id)).toEqual(before.positions);
    expect(t.meshes.journalBytes).toBe(0);
    expect(t.app.history.peekUndo()?.label).toBe('Create');
  });

  it('reverts a direct store transaction that aborts (verified in a microtask)', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const before = positionsOf(t, id);
    expect(() =>
      t.app.store.transact({ label: 'x' }, (tx) => {
        t.meshes.commitOp(tx, offsetOp(), [id], { dy: 1 }, { seed: 's', kind: null });
        throw new Error('abort');
      }),
    ).toThrow('abort');
    await flushMicrotasks();
    expect(positionsOf(t, id)).toEqual(before);
    expect(t.app.meshes.get(id)?.state).toBe('ready');
  });

  it('reconcile() reverts an aborted transaction at once (the runner calls it after a failed run)', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    t.app.meshes.open(id);
    const before = { positions: positionsOf(t, id), ref: ref(t, id) };
    expect(() =>
      t.app.store.transact({ label: 'x' }, (tx) => {
        t.meshes.commitOp(tx, offsetOp(), [id], { dy: 1 }, { seed: 's', kind: null });
        throw new Error('abort');
      }),
    ).toThrow('abort');
    t.meshes.reconcile(); // no microtask in between
    expect(positionsOf(t, id)).toEqual(before.positions);
    expect(ref(t, id)).toEqual(before.ref);
    expect(t.meshes.journalBytes).toBe(0);
    // A committed transaction is confirmed by it (its edge recorded and pinned), not reverted.
    t.app.store.transact({ label: 'Move' }, (tx) =>
      t.meshes.commitOp(tx, offsetOp(), [id], { dy: 1 }, { seed: 's', kind: null }),
    );
    t.meshes.reconcile();
    expect(ref(t, id)?.rev).toBe(2);
    expect(t.meshes.lastOpEdges()).toHaveLength(1);
  });
});

describe('undo and redo (§5.5 rules 4–5)', () => {
  it('follows undo/redo through the journal edge (no rebuild) and lands on bit-identical revisions', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    t.app.meshes.open(id);
    const original = { positions: positionsOf(t, id), ref: ref(t, id) as MeshRef };
    const op = offsetOp();
    t.app.operators.register(testOperator(op));
    await t.app.runUntyped(op.id, { meshes: [id], dy: 0.5 });
    const edited = { positions: positionsOf(t, id), ref: ref(t, id) as MeshRef };
    const seen = events(t, id);
    t.app.history.undo();
    expect(ref(t, id)).toEqual(original.ref);
    expect(positionsOf(t, id)).toEqual(original.positions);
    t.app.history.redo();
    expect(ref(t, id)).toEqual(edited.ref);
    expect(positionsOf(t, id)).toEqual(edited.positions);
    expect(seen.map((e) => e.type)).toEqual(['changed', 'changed']);
    expect(seen.every((e) => e.type !== 'changed' || !e.preview)).toBe(true);
  });

  it('rebuilds from chunks when the journal no longer holds the edge (journal cap), then keeps working', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    t.app.meshes.open(id);
    const op = offsetOp();
    t.app.operators.register(testOperator(op));
    const r0 = { positions: positionsOf(t, id), ref: ref(t, id) as MeshRef };
    await t.app.runUntyped(op.id, { meshes: [id], dy: 0.5 });
    const r1 = { positions: positionsOf(t, id), ref: ref(t, id) as MeshRef };
    await t.app.runUntyped(op.id, { meshes: [id], dy: 0.25 });
    // The journal budget at 0 drops every edge but the last op's.
    t.app.prefs.setState({ modeling: { ...t.app.prefs.getState().modeling, journalBudgetMB: 0 } });
    t.meshes.collect();
    expect(t.meshes.lastOpEdges()).toHaveLength(1);
    const seen = events(t, id);
    t.app.history.undo(); // r2 → r1: the pinned edge
    expect(positionsOf(t, id)).toEqual(r1.positions);
    t.app.history.undo(); // r1 → r0: no edge, rebuild from resident chunks
    expect(ref(t, id)).toEqual(r0.ref);
    expect(positionsOf(t, id)).toEqual(r0.positions);
    expect(seen.map((e) => e.type)).toEqual(['changed', 'rebuilt']);
    expect(t.app.meshes.get(id)?.mesh?.counts).toEqual(cube().counts); // still open, new edit links
    t.app.history.redo();
    expect(positionsOf(t, id)).toEqual(r1.positions);
    expect(t.app.meshes.get(id)?.state).toBe('ready');
  });

  it('close keeps the journal: undo stays on the edge, adjust-last (undo + re-run) completes synchronously', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    t.app.meshes.open(id);
    const original = positionsOf(t, id);
    const op = offsetOp();
    t.app.operators.register(testOperator(op));
    await t.app.runUntyped(op.id, { meshes: [id], dy: 0.5 });
    t.app.meshes.close(id);
    const bytes = t.meshes.journalBytes;
    expect(bytes).toBeGreaterThan(0);
    expect(t.app.meshes.get(id)?.mesh).toBeNull();
    const seen = events(t, id);
    // Adjust Last: undo, then the re-run — no await in between, and both done before any microtask.
    t.app.history.undo();
    expect(positionsOf(t, id)).toEqual(original);
    void t.app.runUntyped(op.id, { meshes: [id], dy: 0.75 });
    expect(t.app.store.get('meshes', id)?.data?.rev).toBe(2);
    expect(positionsOf(t, id).filter((_, i) => i % 3 === 1)).toEqual(
      original.filter((_, i) => i % 3 === 1).map((y) => Math.fround(y + 0.75)),
    );
    expect(seen.some((e) => e.type === 'state' && e.state === 'loading')).toBe(false);
    expect(seen.some((e) => e.type === 'rebuilt')).toBe(false);
    expect(t.app.meshes.get(id)?.isOpen).toBe(false);
    // Reopening is synchronous and finds the same content.
    expect(t.app.meshes.open(id).mesh).not.toBeNull();
  });
});

describe("'loading' and 'error' (§5.5 rule 4)", () => {
  it("loads blobs that are not resident through BlobStore.get: 'loading' (polls fail) until ready", async () => {
    // builtins off: the built-in mesh.* rows are B11's stubs until their kernels land.
    const t = await meshTestApp({ builtins: false });
    t.app.operators.register(meshOperator(MESH_OP_DESCRIPTORS['mesh.extrude'] as never));
    const data = primitive('plane', { subdivisionsWidth: 2 });
    const out = writeRevision(data);
    const held = new Map<string, Uint8Array>([[out.manifestId, out.manifestBytes], ...out.newChunks]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    addBlobSource(t.blobs, async (id) => {
      await gate;
      return held.get(id);
    });
    const r: MeshRef = { manifest: out.manifestId, rev: 1, base: null, joints: [] };
    t.app.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', makeTestMesh('msh_Far', { data: r })));
    const id = 'msh_Far' as MeshId;
    expect(t.app.meshes.get(id)?.state).toBe('loading');
    expect(t.app.operators.poll('mesh.extrude', undefined, { meshes: [id], kind: 'face' })).toEqual({
      ok: false,
      reason: 'Mesh is loading',
    });
    expect(() =>
      t.app.store.transact({ label: 'x' }, (tx) => t.meshes.commitOp(tx, offsetOp(), [id], {}, { seed: 's' })),
    ).toThrow(expect.objectContaining({ code: 'mesh-loading' }));
    release();
    await t.meshes.settled();
    expect(t.app.meshes.get(id)?.state).toBe('ready');
    expect(t.app.meshes.get(id)?.data()?.counts).toEqual(data.counts);
    // What was loaded is resident now.
    expect(t.blobs.has(out.manifestId)).toBe(true);
  });

  it("puts a runtime in 'error' for a missing or corrupt blob, with a reason the polls report", async () => {
    // builtins off: the built-in mesh.* rows are B11's stubs until their kernels land.
    const t = await meshTestApp({ builtins: false });
    t.app.operators.register(meshOperator(MESH_OP_DESCRIPTORS['mesh.extrude'] as never));
    const data = cube();
    const out = writeRevision(data);
    // The manifest is resident, one chunk is not and its only source returns other bytes.
    t.blobs.put(out.manifestBytes);
    const chunks = [...out.newChunks];
    for (const [, bytes] of chunks.slice(1)) t.blobs.put(bytes);
    addBlobSource(t.blobs, async (id) => (id === chunks[0]?.[0] ? new Uint8Array([1, 2, 3]) : undefined));
    const r: MeshRef = { manifest: out.manifestId, rev: 1, base: null, joints: [] };
    t.app.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', makeTestMesh('msh_Bad', { data: r })));
    await t.meshes.settled();
    const runtime = t.app.meshes.get('msh_Bad' as MeshId);
    expect(runtime?.state).toBe('error');
    expect(runtime?.error).toMatch(/Mesh data is corrupt \(blob [0-9a-f]{64}\)/);
    expect(runtime?.data()).toBeNull();
    expect(t.app.operators.poll('mesh.extrude', undefined, { meshes: ['msh_Bad'], kind: 'face' })).toEqual({
      ok: false,
      reason: runtime?.error,
    });
  });
});

describe('remote and import changes (§5.5 rule 6)', () => {
  it('follows a remote data change and ends a preview session on that mesh ("Changed by another user")', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    t.app.meshes.open(id);
    const session = t.app.meshes.beginOp(offsetOp(), [id], { dy: 0.3 });
    expect(session.active).toBe(true);
    const plane = primitive('plane', {});
    const remote = storeRevision(t.blobs, plane);
    const record = t.app.store.get('meshes', id);
    if (record === undefined) throw new Error('no record');
    t.app.store.applyChanges(
      [
        {
          table: 'meshes',
          id,
          before: record,
          after: { ...record, data: { ...remote, rev: 2, base: record.data?.manifest ?? null } },
          fields: ['data'],
        },
      ],
      { origin: 'remote', label: 'Remote edit', user: 'peer' as UserId },
    );
    expect(session.active).toBe(false);
    expect((session as unknown as { endedBecause: string }).endedBecause).toBe('Changed by another user');
    expect(t.app.meshes.session).toBeNull();
    expect(t.app.meshes.get(id)?.data()?.counts).toEqual(plane.counts);
  });
});

describe('preview sessions (§5.5 rule 1, §5.7 card drags)', () => {
  it('previews in place without document writes; update takes the adjust fast path; cancel reverts', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const original = positionsOf(t, id);
    const version = t.app.store.version;
    const op = offsetOp();
    const seen = events(t, id);
    const session = t.app.meshes.beginOp(op, [id], { dy: 0.1 }, { selection: face0(id) });
    expect(op.runs).toBe(1);
    expect(t.app.meshes.session).toBe(session);
    expect(session.results.get(id)).toMatchObject({ resolvedArgs: { dy: 0.1 } });
    session.update({ dy: 0.4 });
    expect(op.runs).toBe(1);
    expect(op.adjusts).toBe(1);
    const moved = positionsOf(t, id);
    expect(moved).not.toEqual(original);
    expect(t.app.store.version).toBe(version);
    expect(seen.every((e) => e.type !== 'changed' || e.preview)).toBe(true);
    session.cancel();
    expect(session.active).toBe(false);
    expect(positionsOf(t, id)).toEqual(original);
    expect(t.app.store.version).toBe(version);
    expect(t.app.meshes.get(id)?.isOpen).toBe(false); // closed again: it was closed before the session
    expect(t.app.history.peekUndo()?.label).toBe('Create');
  });

  it('re-runs when the op has no fast path; commitOp takes a matching session (one step, one journal edge)', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const original = { positions: positionsOf(t, id), ref: ref(t, id) as MeshRef };
    const op = offsetOp({ fastPath: false });
    t.app.operators.register(testOperator(op));
    const session = t.app.meshes.beginOp(op, [id], { dy: 0.1 });
    session.update({ dy: 0.2 });
    session.update({ dy: 0.3 });
    expect(op.runs).toBe(3);
    const previewed = positionsOf(t, id);
    await t.app.runUntyped(op.id, { meshes: [id], dy: 0.3 });
    expect(op.runs).toBe(3); // committed the session's result, no new run
    expect(session.active).toBe(false);
    expect(positionsOf(t, id)).toEqual(previewed);
    expect(ref(t, id)?.rev).toBe(2);
    t.app.history.undo();
    expect(positionsOf(t, id)).toEqual(original.positions);
    expect(ref(t, id)).toEqual(original.ref);
  });

  it('cancels a session whose args do not match the commit and runs the op instead', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const original = positionsOf(t, id);
    const op = offsetOp();
    t.app.operators.register(testOperator(op));
    const session = t.app.meshes.beginOp(op, [id], { dy: 0.1 });
    await t.app.runUntyped(op.id, { meshes: [id], dy: 0.5 });
    expect(session.active).toBe(false);
    expect(op.runs).toBe(2);
    const ys = positionsOf(t, id).filter((_, i) => i % 3 === 1);
    expect(ys).toEqual(original.filter((_, i) => i % 3 === 1).map((y) => Math.fround(y + 0.5)));
  });

  it("'before-last' previews from the pre-op mesh and survives the undo of its own step (Adjust Last)", async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const original = { positions: positionsOf(t, id), ref: ref(t, id) as MeshRef };
    const op = offsetOp();
    t.app.operators.register(testOperator(op));
    await t.app.runUntyped(op.id, { meshes: [id], dy: 0.1 });
    const edited = positionsOf(t, id);
    const ys = (dy: number) => original.positions.filter((_, i) => i % 3 === 1).map((y) => y + dy);
    const expectYs = (dy: number): void => {
      const actual = positionsOf(t, id).filter((_, i) => i % 3 === 1);
      ys(dy).forEach((y, i) => expect(actual[i]).toBeCloseTo(y, 6));
    };
    const session = t.app.meshes.beginOp(op, [id], { dy: 0.3 }, { base: 'before-last' });
    expectYs(0.3);
    session.update({ dy: 0.6 });
    expectYs(0.6);
    // edit.adjustLast: undo the step (the ref returns to the session's base) …
    t.app.history.undo();
    expect(ref(t, id)).toEqual(original.ref);
    expect(session.active).toBe(true);
    expectYs(0.6);
    const previewed = positionsOf(t, id);
    // … then the re-run commits the session.
    await t.app.runUntyped(op.id, { meshes: [id], dy: 0.6 });
    expect(session.active).toBe(false);
    expect(ref(t, id)).toMatchObject({ rev: 2, base: original.ref.manifest });
    expect(positionsOf(t, id)).toEqual(previewed);
    expect(t.app.history.canRedo()).toBe(false);
    // Cancelling a 'before-last' session without the undo returns to the committed result.
    const again = t.app.meshes.beginOp(op, [id], { dy: 0.9 }, { base: 'before-last' });
    expectYs(0.9);
    again.cancel();
    expect(positionsOf(t, id)).toEqual(previewed);
    expect(edited).not.toEqual(previewed);
  });

  it("refuses a 'before-last' session when there is no last op on the mesh", async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    expect(() => t.app.meshes.beginOp(offsetOp(), [id], {}, { base: 'before-last' })).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
    expect(t.app.meshes.session).toBeNull();
    expect(t.app.meshes.get(id)?.isOpen).toBe(false);
  });
});

describe("'before-last' reads what the last op read (§4.6, §5.7 card drags)", () => {
  /** Positions after a fresh run of `mesh.test.advance` on face 0 of a new cube (what an adjusted re-run must give). */
  async function freshRun(dy: number): Promise<number[]> {
    const f = await meshTestApp();
    const id = createMesh(f, 'msh_Cube');
    f.app.store.transact({ label: 'Advance' }, (tx) =>
      f.meshes.commitOp(tx, advanceOp(), [id], { dy }, { seed: 's', kind: 'face', selection: face0(id) }),
    );
    const out = positionsOf(f, id);
    f.app.dispose();
    return out;
  }

  /** The committed revision's positions (read from the blobs, not from the runtime). */
  function committedPositions(t: Awaited<ReturnType<typeof meshTestApp>>, id: MeshId): number[] {
    const r = ref(t, id) as MeshRef;
    const data = readRevision(
      parseManifest(t.blobs.peek(r.manifest) as Uint8Array),
      (c) => t.blobs.peek(c) as Uint8Array,
    );
    return [...data.position];
  }

  // The selection an op reads (`selectionFor`: B10's component selection service once it stores selections, else
  // the runtime's fallback). Literal update at the B12b merge of B10 (the fallback no longer holds the selection).
  const faces = (t: Awaited<ReturnType<typeof meshTestApp>>, id: MeshId): number[] => [
    ...(t.meshes.selectionFor(id, 'face')?.faces.toArray() ?? []),
  ];

  const setMode = (t: Awaited<ReturnType<typeof meshTestApp>>, mode: 'object' | 'face', hilite: MeshId[]): void =>
    t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: mode, hilite } });

  /** Face mode, face 0 selected, then `mesh.test.advance {dy: 0.1}` (it reads face 0 and leaves face 1 selected). */
  async function afterAdvance() {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const op = advanceOp();
    t.app.operators.register(testOperator(op));
    setMode(t, 'face', [id]);
    t.meshes.select(id, selectionOf('face', [0], cube().counts));
    expect((await t.app.runUntyped(op.id, { meshes: [id], dy: 0.1, kind: 'face' })).status).toBe('finished');
    expect(op.reads).toEqual([[0]]);
    expect(faces(t, id)).toEqual([1]); // the op's result is the current selection now
    return { t, id, op };
  }

  for (const mode of ['face', 'object'] as const) {
    it(`previews and commits the re-run on the pre-op selection, not the op's result (${mode} mode)`, async () => {
      const { t, id, op } = await afterAdvance();
      const expected = await freshRun(0.3);
      // `3` back to object mode keeps the recorded kind (§5.7: whatever the current mode).
      setMode(t, mode, mode === 'object' ? [] : [id]);
      const session = t.app.meshes.beginOp(op, [id], { dy: 0.3 }, { base: 'before-last' });
      expect(op.reads[1]).toEqual([0]);
      expect(positionsOf(t, id)).toEqual(expected);
      // edit.adjustLast: undo (the fallback restores what the op read, as TxMeta.selectionBefore will) …
      t.app.history.undo();
      expect(session.active).toBe(true);
      expect(faces(t, id)).toEqual([0]);
      // … then the re-run with the recorded kind takes the session.
      await t.app.runUntyped(op.id, { meshes: [id], dy: 0.3, kind: 'face' });
      expect(session.active).toBe(false);
      expect(op.runs).toBe(2);
      expect(positionsOf(t, id)).toEqual(expected);
      expect(committedPositions(t, id)).toEqual(expected);
      expect(faces(t, id)).toEqual([1]);
      expect(t.app.history.canRedo()).toBe(false);
      expect(ref(t, id)?.rev).toBe(2);
    });
  }

  it('the selection fallback follows undo and redo across the op (what it read, what it left)', async () => {
    const { t, id } = await afterAdvance();
    t.app.history.undo();
    expect(faces(t, id)).toEqual([0]);
    t.app.history.redo();
    expect(faces(t, id)).toEqual([1]);
  });

  it('an undo that ends a tool preview restores what the op read (the fallback follows the committed ref)', async () => {
    const { t, id, op } = await afterAdvance();
    const session = t.app.meshes.beginOp(op, [id], { dy: 0.2 }); // a tool preview on the current selection (face 1)
    expect(op.reads[1]).toEqual([1]);
    t.app.history.undo();
    expect(session.active).toBe(false);
    expect((session as unknown as { endedBecause: string }).endedBecause).toBe('The mesh changed');
    expect(faces(t, id)).toEqual([0]);
    t.app.history.redo();
    expect(faces(t, id)).toEqual([1]);
  });

  it('commitOp takes a session only when its run would read the same selection; else it re-runs', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const op = advanceOp();
    t.app.operators.register(testOperator(op));
    setMode(t, 'face', [id]);
    t.meshes.select(id, selectionOf('face', [2], cube().counts));
    // A preview on face 0 (explicit) is not what a run on the current selection (face 2) writes.
    const stale = t.app.meshes.beginOp(op, [id], { dy: 0.2 }, { selection: face0(id) });
    await t.app.runUntyped(op.id, { meshes: [id], dy: 0.2, kind: 'face' });
    expect(stale.active).toBe(false);
    expect((stale as unknown as { endedBecause: string }).endedBecause).toBe('Another operation ran');
    expect(op.reads).toEqual([[0], [2]]);
    t.app.history.undo();
    // A preview on the current selection is: committed without a new run.
    t.meshes.select(id, selectionOf('face', [2], cube().counts));
    const live = t.app.meshes.beginOp(op, [id], { dy: 0.2 });
    const previewed = positionsOf(t, id);
    await t.app.runUntyped(op.id, { meshes: [id], dy: 0.2, kind: 'face' });
    expect(live.active).toBe(false);
    expect(op.reads).toEqual([[0], [2], [2]]);
    expect(positionsOf(t, id)).toEqual(previewed);
  });

  it('keeps a session through batches that do not change data (local or remote rename); remote data ends it', async () => {
    const { t, id, op } = await afterAdvance();
    const session = t.app.meshes.beginOp(op, [id], { dy: 0.3 }, { base: 'before-last' });
    const previewed = positionsOf(t, id);
    t.app.store.transact({ label: 'Rename' }, (tx) => tx.patch('meshes', id, { name: 'Renamed' }));
    expect(session.active).toBe(true);
    const record = t.app.store.get('meshes', id);
    if (record === undefined) throw new Error('no record');
    const remote = (after: typeof record, fields: string[]) =>
      t.app.store.applyChanges([{ table: 'meshes', id, before: record, after, fields }], {
        origin: 'remote',
        label: 'Remote edit',
        user: 'peer' as UserId,
      });
    remote({ ...record, name: 'Peer name' }, ['name']);
    expect(session.active).toBe(true);
    expect(positionsOf(t, id)).toEqual(previewed);
    const plane = storeRevision(t.blobs, primitive('plane', {}));
    const now = t.app.store.get('meshes', id) as typeof record;
    t.app.store.applyChanges(
      [
        {
          table: 'meshes',
          id,
          before: now,
          after: { ...now, data: { ...plane, rev: 3, base: now.data?.manifest ?? null } },
          fields: ['data'],
        },
      ],
      { origin: 'remote', label: 'Remote edit', user: 'peer' as UserId },
    );
    expect(session.active).toBe(false);
    expect((session as unknown as { endedBecause: string }).endedBecause).toBe('Changed by another user');
  });
});

describe('writeData and storeRevision', () => {
  it('writes whole revisions without reading chunks back; the runtime is ready synchronously', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const before = ref(t, id) as MeshRef;
    const plane = primitive('plane', { subdivisionsWidth: 3 });
    const written = t.app.store.transact({ label: 'Regenerate' }, (tx) => t.app.meshes.writeData(tx, id, plane));
    expect(written).toMatchObject({ rev: 2, base: before.manifest, joints: [] });
    expect(t.app.meshes.get(id)?.state).toBe('ready');
    expect(t.app.meshes.get(id)?.data()).toBe(plane);
    expect(t.meshes.lastOpEdges()).toEqual([]);
    const fresh = t.meshes.storeRevision(cube(), written);
    expect(fresh).toMatchObject({ rev: 3, base: written.manifest });
    expect(t.blobs.has(fresh.manifest)).toBe(true);
  });

  it('validates whole revisions under the kernel debug switch (§3 rule 8): invalid data is never stored', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const before = ref(t, id);
    const good = cube();
    const bad: MeshData = { ...good, position: Float32Array.from(good.position, (v, i) => (i === 0 ? Number.NaN : v)) };
    const resident = t.blobs.size;
    expect(() => t.app.store.transact({ label: 'Regenerate' }, (tx) => t.app.meshes.writeData(tx, id, bad))).toThrow(
      expect.objectContaining({ code: 'invalid-mesh' }),
    );
    expect(() => t.app.store.transact({ label: 'Regenerate' }, (tx) => t.app.meshes.writeData(tx, id, bad))).toThrow(
      "'writeData' left an invalid mesh",
    );
    expect(ref(t, id)).toEqual(before);
    expect(() => t.meshes.storeRevision(bad)).toThrow(expect.objectContaining({ code: 'invalid-mesh' }));
    expect(t.blobs.size).toBe(resident);
    await flushMicrotasks();
    expect(positionsOf(t, id)).toEqual([...good.position]);
  });
});

describe('budgets at 50k triangles (§5.27; the bench reports the full table)', () => {
  // The best of 10 samples: what the path costs, not what a busy machine's scheduler adds (the gates run in parallel).
  it('undo through the journal ≤ 5 ms and by rebuild ≤ 40 ms (best of 10)', async () => {
    const t = await meshTestApp({ builtins: false });
    setKernelDebug(false);
    try {
      const big = primitive('cube', { subdivisionsWidth: 64, subdivisionsHeight: 64, subdivisionsDepth: 64 });
      const id = createMesh(t, 'msh_Big', big);
      t.app.meshes.open(id);
      expect(t.app.meshes.get(id)?.triangulation().tris.length).toBe(3 * 49_152);
      const op = offsetOp();
      const commit = (dy: number) =>
        t.app.store.transact({ label: 'Move' }, (tx) =>
          t.meshes.commitOp(tx, op, [id], { dy }, { seed: 's', kind: 'vertex', selection: firstThousand }),
        );
      const firstThousand = new Map([
        [
          id,
          selectionOf(
            'vertex',
            Array.from({ length: 1000 }, (_, i) => i),
            big.counts,
          ),
        ],
      ]);
      const best = (samples: number[]) => Math.min(...samples);
      const time = (fn: () => void): number => {
        const t0 = performance.now();
        fn();
        return performance.now() - t0;
      };
      commit(0.01);
      const journal: number[] = [];
      for (let i = 0; i < 5; i++) {
        journal.push(time(() => t.app.store.undo.undo()));
        journal.push(time(() => t.app.store.undo.redo()));
      }
      expect(best(journal)).toBeLessThanOrEqual(5);
      // Rebuild: past the last op's edge with the journal capped to nothing.
      commit(0.02);
      t.app.prefs.setState({ modeling: { ...t.app.prefs.getState().modeling, journalBudgetMB: 0 } });
      t.meshes.collect();
      t.app.store.undo.undo();
      const rebuild: number[] = [];
      const seen = events(t, id);
      for (let i = 0; i < 5; i++) {
        rebuild.push(time(() => t.app.store.undo.undo()));
        rebuild.push(time(() => t.app.store.undo.redo()));
      }
      expect(seen.filter((e) => e.type === 'rebuilt')).toHaveLength(10);
      expect(best(rebuild)).toBeLessThanOrEqual(40);
    } finally {
      setKernelDebug(true);
    }
  }, 60_000);
});
