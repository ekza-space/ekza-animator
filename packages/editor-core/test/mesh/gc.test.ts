// M6A-SPEC §5.20 (B7): GC from derived roots, deferred sweeps, incremental reference counts, the undo byte budget
// (history-only blob bytes + journal bytes + selection-snapshot bytes) with one toast, the journal cap that keeps the
// last op's edge, autosave pins, and the fuzz cases "nothing reachable is freed" and "budget eviction during commit
// never leaves a ref to a missing blob".
import type { MeshId, MeshRecord, MeshRef, UndoEntry } from '@ekza-animator/doc';
import { BitSet, primitive } from '@ekza-animator/mesh-core';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { BUDGET_TOAST, type SelectionSnapshot } from '../../src';
import {
  createMesh,
  flushMicrotasks,
  type MeshTestApp,
  meshTestApp,
  offsetOp,
  paintOp,
  positionsOf,
  resident,
  seamOp,
  testOperator,
} from './support';

/** Every ref a root needs is resident: live records and every doc undo/redo entry (before and after). */
function expectAllRefsResident(t: MeshTestApp): void {
  for (const record of t.app.store.list('meshes')) expect(resident(t, record.data), `live ${record.id}`).toBe(true);
  const { undo, redo } = t.app.store.undo.entries();
  for (const entry of [...undo, ...redo] as UndoEntry[]) {
    for (const change of entry.changes) {
      if (change.table !== 'meshes') continue;
      expect(resident(t, change.before?.data), `${entry.label} before`).toBe(true);
      expect(resident(t, change.after?.data), `${entry.label} after`).toBe(true);
    }
  }
}

function setBudget(t: MeshTestApp, undoBudgetMB: number, journalBudgetMB?: number): void {
  const modeling = t.app.prefs.getState().modeling;
  t.app.prefs.setState({
    modeling: { ...modeling, undoBudgetMB, ...(journalBudgetMB === undefined ? {} : { journalBudgetMB }) },
  });
}

/** A plane big enough that each paint commit writes a fresh face chunk. */
const bigPlane = () => primitive('plane', { subdivisionsWidth: 64, subdivisionsHeight: 64 });

describe('GC from derived roots (§5.20)', () => {
  it('counts history-only bytes; evicted steps free their chunks; live revisions stay resident', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Plane', bigPlane());
    t.app.operators.register(testOperator(paintOp()));
    const refs: MeshRef[] = [t.app.store.get('meshes', id)?.data as MeshRef];
    for (let slot = 1; slot <= 6; slot++) {
      await t.app.runUntyped('mesh.test.paint', { meshes: [id], slot });
      refs.push(t.app.store.get('meshes', id)?.data as MeshRef);
    }
    t.meshes.collect();
    expect(t.meshes.historyBytes).toBeGreaterThan(0);
    for (const r of refs) expect(resident(t, r)).toBe(true);
    // A budget below the history's bytes drops the oldest steps; their revisions' unshared chunks go.
    setBudget(t, t.meshes.historyBytes / (1024 * 1024) / 3);
    const report = t.meshes.collect();
    expect(report.dropped).toBeGreaterThan(0);
    expect(report.freed).toBeGreaterThan(0);
    expect(t.services.toasts.filter((x) => x.text === BUDGET_TOAST)).toHaveLength(1);
    expect(resident(t, refs[0])).toBe(false);
    expect(resident(t, refs[refs.length - 1])).toBe(true);
    expectAllRefsResident(t);
    // One toast per session.
    setBudget(t, 0);
    t.meshes.collect();
    expect(t.services.toasts.filter((x) => x.text === BUDGET_TOAST)).toHaveLength(1);
    expectAllRefsResident(t);
    expect(t.app.history.canUndo()).toBe(false);
  });

  it('never sweeps inside a commit: sweeps are deferred to a microtask and throttled to one per 5 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const t = await meshTestApp();
      await flushMicrotasks();
      vi.advanceTimersByTime(5000); // past the throttle window of the app's first check
      const sweep = vi.spyOn(t.blobs, 'sweep');
      const id = createMesh(t, 'msh_Plane', bigPlane());
      // The record's batch only scheduled the check: nothing swept synchronously.
      expect(sweep).not.toHaveBeenCalled();
      await flushMicrotasks();
      expect(sweep).toHaveBeenCalledTimes(1);
      t.app.store.transact({ label: 'Paint' }, (tx) => {
        t.meshes.commitOp(tx, paintOp(), [id], { slot: 1 }, { seed: 's', kind: null });
      });
      expect(sweep).toHaveBeenCalledTimes(1); // not inside the commit, nor right after its batch
      await flushMicrotasks();
      expect(sweep).toHaveBeenCalledTimes(1); // throttled: within 5 s of the last sweep
      vi.advanceTimersByTime(4999);
      expect(sweep).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(sweep).toHaveBeenCalledTimes(2);
      expectAllRefsResident(t);
    } finally {
      vi.useRealTimers();
    }
  });

  it('budget eviction during commit never leaves a ref to a missing blob', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Plane', bigPlane());
    t.app.operators.register(testOperator(paintOp()));
    setBudget(t, 0);
    for (let slot = 1; slot <= 4; slot++) {
      let inside: MeshRef | null = null;
      t.app.store.transact({ label: 'Paint' }, (tx) => {
        t.meshes.commitOp(tx, paintOp(), [id], { slot }, { seed: 's', kind: null });
        inside = tx.get('meshes', id)?.data ?? null;
        // Inside the commit: the new revision is resident (fresh) whatever the budget says.
        expect(resident(t, inside)).toBe(true);
      });
      await flushMicrotasks();
      expectAllRefsResident(t);
    }
  });

  it('keeps the blobs of an autosave write in flight (pinned) until the pin is released', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Plane', bigPlane());
    const first = t.app.store.get('meshes', id)?.data as MeshRef;
    const release = t.meshes.pinBlobs(t.blobs.closure([first.manifest]));
    t.app.operators.register(testOperator(paintOp()));
    await t.app.runUntyped('mesh.test.paint', { meshes: [id], slot: 3 });
    // A second op: the last op's edge (a root, §5.20 (3)) no longer starts at the first revision.
    await t.app.runUntyped('mesh.test.paint', { meshes: [id], slot: 4 });
    t.app.history.clear();
    t.app.store.undo.clear();
    t.meshes.collect();
    expect(resident(t, first)).toBe(true);
    release();
    t.meshes.collect();
    expect(t.blobs.has(first.manifest)).toBe(false);
    expectAllRefsResident(t);
  });

  it('caps the journal at journalBudgetMB but keeps the edges of the last op', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Plane', bigPlane());
    t.app.meshes.open(id);
    t.app.operators.register(testOperator(offsetOp()));
    for (let i = 1; i <= 3; i++) await t.app.runUntyped('mesh.test.offset', { meshes: [id], dy: i / 10 });
    const last = t.meshes.lastOpEdges();
    expect(last).toHaveLength(1);
    const before = t.meshes.journalBytes;
    setBudget(t, 256, 0);
    t.meshes.collect();
    expect(t.meshes.journalBytes).toBeLessThan(before);
    expect(t.meshes.journalBytes).toBeGreaterThan(0);
    expect(t.meshes.lastOpEdges()).toEqual(last);
    // A step whose edge was dropped undoes through the chunk rebuild.
    const positions = positionsOf(t, id);
    t.app.history.undo();
    t.app.history.undo();
    t.app.history.redo();
    t.app.history.redo();
    expect(positionsOf(t, id)).toEqual(positions);
  });

  it('counts selection-snapshot bytes of history steps against the budget', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Cube');
    const snapshot = (faces: number[]): SelectionSnapshot => {
      const bits = new BitSet(6);
      for (const f of faces) bits.add(f);
      const empty = new BitSet(0).encode();
      return {
        controls: [],
        objects: [],
        componentMode: 'face',
        hilite: [id],
        meshes: {
          [id]: {
            manifest: null,
            kind: 'face',
            verts: empty,
            edges: empty,
            faces: bits.encode(),
            order: null,
            active: -1,
          },
        },
      };
    };
    const before = t.meshes.selectionBytes;
    const a = snapshot([0]);
    const b = snapshot([0, 1, 2]);
    t.app.history.recordSelection({ kind: 'select', gesture: 'replace', before: a, after: b }, 'Select');
    const bytesOf = (s: SelectionSnapshot) =>
      Object.values(s.meshes).reduce((n, m) => n + m.verts.byteLength + m.edges.byteLength + m.faces.byteLength, 0);
    expect(t.meshes.selectionBytes - before).toBe(bytesOf(a) + bytesOf(b));
  });
});

describe('fuzz (§5.20 B7 cases)', () => {
  it('nothing reachable is freed; every runtime equals its committed revision', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({ kind: fc.constant('paint' as const), slot: fc.integer({ min: 0, max: 5 }), mesh: fc.nat(1) }),
            fc.record({
              kind: fc.constant('offset' as const),
              dy: fc.double({ min: -1, max: 1, noNaN: true }),
              mesh: fc.nat(1),
            }),
            fc.record({ kind: fc.constant('seam' as const), mesh: fc.nat(1) }),
            fc.record({ kind: fc.constant('undo' as const) }),
            fc.record({ kind: fc.constant('redo' as const) }),
            fc.record({ kind: fc.constant('collect' as const) }),
            fc.record({ kind: fc.constant('budget' as const), mb: fc.constantFrom(0, 0.01, 0.05, 256) }),
            fc.record({ kind: fc.constant('journal' as const), mb: fc.constantFrom(0, 0.001, 64) }),
            fc.record({ kind: fc.constant('toggleOpen' as const), mesh: fc.nat(1) }),
            fc.record({ kind: fc.constant('delete' as const), mesh: fc.nat(1) }),
            fc.record({ kind: fc.constant('regenerate' as const), mesh: fc.nat(1) }),
            fc.record({ kind: fc.constant('abort' as const), mesh: fc.nat(1) }),
          ),
          { minLength: 5, maxLength: 40 },
        ),
        async (steps) => {
          const t = await meshTestApp();
          const ids = [
            createMesh(t, 'msh_A', primitive('plane', { subdivisionsWidth: 40, subdivisionsHeight: 40 })),
            createMesh(t, 'msh_B', primitive('cube', { subdivisionsWidth: 3 })),
          ];
          t.app.operators.register(testOperator(paintOp()));
          t.app.operators.register(testOperator(offsetOp()));
          t.app.operators.register(testOperator(seamOp()));
          for (const step of steps) {
            const live = (n: number): MeshId | null => {
              const id = ids[n] as MeshId;
              return t.app.store.get('meshes', id) === undefined ? null : id;
            };
            switch (step.kind) {
              case 'paint':
              case 'offset':
              case 'seam': {
                const id = live(step.mesh);
                if (id === null) break;
                const args =
                  step.kind === 'paint' ? { slot: step.slot } : step.kind === 'offset' ? { dy: step.dy } : {};
                await t.app.runUntyped(`mesh.test.${step.kind}`, { meshes: [id], ...args });
                break;
              }
              case 'undo':
                t.app.history.undo();
                break;
              case 'redo':
                t.app.history.redo();
                break;
              case 'collect':
                t.meshes.collect();
                break;
              case 'budget':
                setBudget(t, step.mb);
                break;
              case 'journal':
                setBudget(t, t.app.prefs.getState().modeling.undoBudgetMB, step.mb);
                break;
              case 'toggleOpen': {
                const id = live(step.mesh);
                if (id === null) break;
                if (t.app.meshes.get(id)?.isOpen === true) t.app.meshes.close(id);
                else t.app.meshes.open(id);
                break;
              }
              case 'delete': {
                const id = live(step.mesh);
                if (id !== null) t.app.store.transact({ label: 'Delete' }, (tx) => tx.softDelete('meshes', id));
                break;
              }
              case 'regenerate': {
                const id = live(step.mesh);
                if (id === null) break;
                t.app.store.transact({ label: 'Regenerate' }, (tx) =>
                  t.app.meshes.writeData(tx, id, primitive('plane', { subdivisionsWidth: 2 + step.mesh })),
                );
                break;
              }
              case 'abort': {
                const id = live(step.mesh);
                if (id === null) break;
                try {
                  t.app.store.transact({ label: 'x' }, (tx) => {
                    t.meshes.commitOp(tx, offsetOp(), [id], { dy: 0.5 }, { seed: 's', kind: null });
                    throw new Error('abort');
                  });
                } catch {
                  // expected
                }
                break;
              }
            }
            await flushMicrotasks();
            expectAllRefsResident(t);
            const gone = ids.filter((id) => t.app.store.get('meshes', id) === undefined);
            expect(gone.map((id) => t.app.meshes.get(id))).toEqual(gone.map(() => undefined));
            for (const id of ids.filter((x) => !gone.includes(x))) {
              const record = t.app.store.get('meshes', id) as MeshRecord;
              const runtime = t.app.meshes.get(id);
              expect(runtime?.state).toBe('ready');
              expect(runtime?.data()?.counts).toBeDefined();
              // The runtime's content is the committed revision.
              const kernel = await import('@ekza-animator/mesh-core');
              const ref = record.data as MeshRef;
              const stored = kernel.readRevision(
                kernel.parseManifest(t.blobs.peek(ref.manifest) as Uint8Array),
                (c) => t.blobs.peek(c) as Uint8Array,
              );
              expect(positionsOf(t, id)).toEqual([...stored.position]);
              expect([...(runtime?.data()?.edgeFlags ?? [])]).toEqual([...stored.edgeFlags]);
            }
          }
          t.app.dispose();
        },
      ),
      { numRuns: 40, seed: 0xb7 },
    );
  }, 120_000);
});
