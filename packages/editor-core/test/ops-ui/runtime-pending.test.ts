// M6A-SPEC §5.27, §5.7, §5.10 (B11): what happens while the B11 runtime chunk is still loading (a script or a fast
// keystroke right at the first Model entry). The eager part records the LastRun at once; the capture window arms once
// the chunk has loaded (unless it was disarmed meanwhile); the tracker, bound late, closes a LastRun that another write
// made stale; Adjust Last waits for the chunk (undo waits for that adjust). (The chunk loads once per module graph,
// so the cases share one load.)
import type { ParamDef } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import {
  type EditorApp,
  LAST_RUN_CLOSED,
  loadOpsRuntime,
  type OperatorDef,
  opsRuntime,
  pendingAdjust,
  switchWorkspace,
} from '../../src';
import { createMesh, type MeshTestApp, meshTestApp } from '../mesh/support';

const DY: ParamDef = {
  name: 'dy',
  label: 'Offset',
  kind: 'distance',
  bound: 'value',
  default: 0.1,
  primary: true,
};

/** `test.offset {dy}`: an adjustable store write (renames the cube with the value). */
function offset(): OperatorDef<unknown, unknown, unknown> {
  return {
    id: 'test.offset',
    label: 'Offset',
    category: 'test',
    scope: 'global',
    flags: { undo: true, adjustable: true, repeatable: true },
    params: [DY],
    apply: (ctx, args) => {
      const dy = (args as { dy?: number }).dy ?? 0.1;
      ctx.tx?.patch('meshes', 'msh_Cube' as MeshId, { name: `dy ${dy}` });
    },
  };
}

async function setup(): Promise<MeshTestApp & { readonly id: MeshId }> {
  const t = await meshTestApp();
  t.app.operators.register(offset());
  const id = createMesh(t, 'msh_Cube');
  t.app.history.clear();
  return { ...t, id };
}

const key = (k: string) => ({
  key: k,
  code: /\d/.test(k) ? `Digit${k}` : k === '.' ? 'Period' : k,
  shift: false,
  mod: false,
  alt: false,
});

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

const undoCount = (app: EditorApp): number =>
  (app.history as unknown as { labels(): { undo: readonly string[] } }).labels().undo.length;

describe('while the B11 runtime chunk loads (§5.27)', () => {
  it('records at once; arms, binds the tracker and adjusts once the chunk is there', async () => {
    const [a, b, c, d] = [await setup(), await setup(), await setup(), await setup()];
    expect(opsRuntime()).toBeNull();
    for (const t of [a, b, c, d]) switchWorkspace(t.app, 'model'); // starts loading the chunk
    // A: a keyboard run. The LastRun is there at once; the window arms when the chunk has loaded.
    void a.app.runUntyped('test.offset', { dy: 0.2 }, { source: 'keyboard' });
    expect(a.app.session.getState().lastRun).toMatchObject({ id: 'test.offset', args: { dy: 0.2 }, closed: null });
    expect(a.app.capture.state.armed).toBeNull();
    expect(a.app.capture.key(key('1'))).toBe(false);
    // B: a menu run, then another write by this user before the tracker is bound.
    void b.app.runUntyped('test.offset', { dy: 0.2 }, { source: 'menu' });
    b.app.store.transact({ label: 'Rename' }, (tx) => tx.patch('meshes', b.id, { name: 'renamed' }));
    expect(b.app.session.getState().lastRun?.closed).toBeNull();
    // C: a keyboard run whose window was disarmed (a click) before the chunk loaded.
    void c.app.runUntyped('test.offset', { dy: 0.2 }, { source: 'keyboard' });
    c.app.capture.disarm();
    // D: Adjust Last before the chunk loaded: undo and redo wait for it.
    void d.app.runUntyped('test.offset', { dy: 0.2 }, { source: 'menu' });
    const steps = undoCount(d.app);
    const adjusting = d.app.run('edit.adjustLast', { args: { dy: 0.3 } });
    expect(pendingAdjust(d.app)).not.toBeNull();
    expect(opsRuntime()).toBeNull();

    await loadOpsRuntime();
    await settle();
    expect(a.app.capture.state).toEqual({ armed: 'keyboard-op', field: 'dy', text: null });
    for (const ch of '0.5') expect(a.app.capture.key(key(ch))).toBe(true);
    expect(a.app.capture.key(key('Enter'))).toBe(true);
    await settle();
    expect(a.app.session.getState().lastRun?.args['dy']).toBe(0.5);
    expect(b.app.session.getState().lastRun?.closed).toBe(LAST_RUN_CLOSED.another);
    expect(c.app.capture.state.armed).toBeNull();
    expect((await adjusting).status).toBe('finished');
    expect(d.app.session.getState().lastRun).toMatchObject({ args: { dy: 0.3 }, closed: null });
    expect(d.app.store.get('meshes', d.id)?.name).toBe('dy 0.3');
    expect(undoCount(d.app)).toBe(steps);
    expect(pendingAdjust(d.app)).toBeNull();
    // Bound now, the tracker follows the next events as usual.
    d.app.store.transact({ label: 'Rename' }, (tx) => tx.patch('meshes', d.id, { name: 'renamed' }));
    expect(d.app.session.getState().lastRun?.closed).toBe(LAST_RUN_CLOSED.another);
  });
});
