// M6A-SPEC §5.7 "Card drags" (B11): a label drag on the Last-op card of a kernel mesh op previews new values from the
// pre-op mesh (`meshes.beginOp(…, {base: 'before-last'})`, no document writes); the release runs `edit.adjustLast`
// once, which commits the preview's session: one step in place of the original, bit-identical to a fresh run with
// the same values. A re-run above 50 ms switches the card to "update on release" (no more previews). Non-mesh
// operations have no preview (they update on release).
//
// Both kernel modules are mocked so the value-only test op (`mesh.test.advance`, ./support.ts) is a kernel op with a
// descriptor: the B0a reference kernel has no real op yet.
import type { MeshId } from '@ekza-studio/doc';
import * as kernel from '@ekza-studio/mesh-core';
import type * as Descriptors from '@ekza-studio/mesh-core/descriptors';
import { describe, expect, it, vi } from 'vitest';
import {
  beginCardPreview,
  CARD_PREVIEW_BUDGET_MS,
  type ComponentSelectionService,
  type EditorApp,
  LAST_RUN_CLOSED,
} from '../../src';
import type * as ComponentsFactory from '../../src/app/factories/components';
import { createMesh, type MeshTestApp, meshTestApp, positionsOf } from '../mesh/support';
import { enterModel } from './model';
import type { AdvanceOp } from './support';

const advanceOp = (): AdvanceOp => (kernel as unknown as { __advance: AdvanceOp }).__advance;

vi.mock('@ekza-studio/mesh-core', async (importOriginal) => {
  const actual = await importOriginal<typeof kernel>();
  const { makeAdvanceOp } = await import('./support');
  const advance = makeAdvanceOp(actual);
  return { ...actual, MESH_OPS: Object.freeze({ ...actual.MESH_OPS, [advance.id]: advance }), __advance: advance };
});

vi.mock('@ekza-studio/mesh-core/descriptors', async (importOriginal) => {
  const actual = await importOriginal<typeof Descriptors>();
  const { ADVANCE } = await import('./support');
  return { ...actual, MESH_OP_DESCRIPTORS: Object.freeze({ ...actual.MESH_OP_DESCRIPTORS, [ADVANCE.id]: ADVANCE }) };
});

/**
 * The B0a component selection service never publishes; B10's follows the mesh runtimes (a preview re-shows the pre-op
 * mesh, a cancel brings the committed one back) and publishes. Each app's service is wrapped so a test can publish a
 * change (`componentBumps`, one per app, in creation order).
 */
const componentBumps = vi.hoisted(() => [] as (() => void)[]);

vi.mock('../../src/app/factories/components', async (importOriginal) => {
  const actual = await importOriginal<typeof ComponentsFactory>();
  return {
    createComponents(deps: Parameters<typeof actual.createComponents>[0]): ComponentSelectionService {
      const real = actual.createComponents(deps);
      const listeners = new Set<(version: number) => void>();
      let version = real.version;
      componentBumps.push(() => {
        version++;
        for (const listener of Array.from(listeners)) listener(version);
      });
      return Object.create(real, {
        version: { get: () => version },
        subscribe: {
          value: (listener: (version: number) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      }) as ComponentSelectionService;
    },
  };
});

/** A Model app with a cube, face 2 selected, after `mesh.test.advance {dy: 0.2}` from a menu. */
async function advanced(): Promise<MeshTestApp & { readonly id: MeshId }> {
  const t = await meshTestApp();
  await enterModel(t.app);
  const id = createMesh(t, 'msh_Cube');
  t.app.history.clear();
  t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: 'face', hilite: [id] } });
  t.meshes.select(id, kernel.selectionOf('face', [2], kernel.primitive('cube', {}).counts));
  const result = await t.app.runUntyped('mesh.test.advance', { dy: 0.2 }, { source: 'menu' });
  expect(result.status).toBe('finished');
  return { ...t, id };
}

const undoLabels = (app: EditorApp): readonly string[] =>
  (app.history as unknown as { labels(): { undo: readonly string[] } }).labels().undo;

describe('card drags (§5.7)', () => {
  it('previews from the pre-op mesh without writes; the release commits that session in one step', async () => {
    const t = await advanced();
    const steps = undoLabels(t.app).length;
    const committed = positionsOf(t, t.id);
    const docBefore = t.app.store.get('meshes', t.id)?.data;
    const preview = beginCardPreview(t.app);
    expect(preview).not.toBeNull();
    preview?.update({ dy: 0.5 });
    preview?.update({ dy: 0.6 });
    expect(preview?.slow).toBe(false);
    // The preview shows dy 0.6 applied once to the pre-op mesh; the document is untouched.
    const f = await advanced();
    await f.app.run('edit.adjustLast', { args: { dy: 0.6 } });
    expect(positionsOf(t, t.id)).toEqual(positionsOf(f, f.id));
    expect(positionsOf(t, t.id)).not.toEqual(committed);
    expect(t.app.store.get('meshes', t.id)?.data).toBe(docBefore);
    expect(t.app.session.getState().lastRun).toMatchObject({ closed: null, args: { dy: 0.2 } });
    // The release: one edit.adjustLast with the dragged value commits the session (the op does not run again).
    const runs = advanceOp().runs;
    const result = await t.app.run('edit.adjustLast', { args: { dy: 0.6 } });
    expect(result.status).toBe('finished');
    expect(advanceOp().runs).toBe(runs);
    expect(t.app.meshes.session).toBeNull();
    expect(undoLabels(t.app)).toHaveLength(steps);
    expect(undoLabels(t.app).at(-1)).toBe('Advance (adjusted)');
    expect(t.app.session.getState().lastRun).toMatchObject({ closed: null, args: { dy: 0.6 } });
    expect(positionsOf(t, t.id)).toEqual(positionsOf(f, f.id));
    // A fresh run with dy 0.6 gives the same mesh; one undo takes the adjusted step back to the pristine cube.
    const g = await advanced();
    g.app.history.undo();
    const pristine = positionsOf(g, g.id);
    await g.app.runUntyped('mesh.test.advance', { dy: 0.6 }, { source: 'menu' });
    expect(positionsOf(t, t.id)).toEqual(positionsOf(g, g.id));
    t.app.history.undo();
    expect(positionsOf(t, t.id)).toEqual(pristine);
  });

  it('a re-run above 50 ms switches to "update on release": later drags do not preview; cancel restores', async () => {
    const t = await advanced();
    const committed = positionsOf(t, t.id);
    let clock = 0;
    // Every re-run "takes" 60 ms on this clock.
    const preview = beginCardPreview(t.app, () => {
      const now = clock;
      clock += CARD_PREVIEW_BUDGET_MS + 10;
      return now;
    });
    preview?.update({ dy: 0.5 });
    expect(preview?.slow).toBe(true);
    const shown = positionsOf(t, t.id);
    preview?.update({ dy: 0.9 });
    expect(positionsOf(t, t.id)).toEqual(shown);
    preview?.cancel();
    expect(positionsOf(t, t.id)).toEqual(committed);
    expect(t.app.session.getState().lastRun).toMatchObject({ closed: null, args: { dy: 0.2 } });
  });

  it("the selection service's publishes during the preview are the preview's: the card stays live", async () => {
    // Released: the adjust commits the preview; a selection change afterwards closes the card.
    const t = await advanced();
    const bump = componentBumps.at(-1);
    const preview = beginCardPreview(t.app);
    expect(preview).not.toBeNull();
    preview?.update({ dy: 0.5 });
    bump?.(); // B10 follows the runtime that re-shows the pre-op mesh
    expect(t.app.session.getState().lastRun?.closed).toBeNull();
    expect((await t.app.run('edit.adjustLast', { args: { dy: 0.5 } })).status).toBe('finished');
    expect(t.app.session.getState().lastRun).toMatchObject({ closed: null, args: { dy: 0.5 } });
    bump?.();
    expect(t.app.session.getState().lastRun?.closed).toBe(LAST_RUN_CLOSED.selection);
    // Cancelled: the committed mesh comes back (B10 publishes it), the card stays; a later change closes it.
    const u = await advanced();
    const bumpU = componentBumps.at(-1);
    const cancelled = beginCardPreview(u.app);
    cancelled?.update({ dy: 0.5 });
    bumpU?.();
    cancelled?.cancel();
    expect(u.app.session.getState().lastRun).toMatchObject({ closed: null, args: { dy: 0.2 } });
    bumpU?.();
    expect(u.app.session.getState().lastRun?.closed).toBe(LAST_RUN_CLOSED.selection);
  });

  it('operations that are not kernel mesh ops have no preview (they update on release)', async () => {
    const t = await advanced();
    t.app.operators.register({
      id: 'test.rename',
      label: 'Rename',
      category: 'test',
      scope: 'global',
      flags: { undo: true, adjustable: true },
      params: [{ name: 'n', label: 'N', kind: 'int', bound: 'value', default: 1, primary: true }],
      apply: (ctx, args) => ctx.tx?.patch('meshes', t.id, { name: `n ${(args as { n?: number }).n ?? 1}` }),
    });
    await t.app.runUntyped('test.rename', { n: 2 });
    expect(beginCardPreview(t.app)).toBeNull();
  });
});
