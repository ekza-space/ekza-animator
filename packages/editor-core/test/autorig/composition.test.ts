// AUTORIG-SPEC §4.5 (D0): the Auto-Rig compositions. Runner rules: a composition runs its inner operators from
// `prepare` — two undoable inner runs leave exactly two history steps and none of its own; a failing second run
// leaves the first in place; an undo (or another document run) between the inner runs stops the composition before
// the second. Registration: every `autorig.*` stub is in `WIZARD_OPERATORS` and `RIG_WORKSPACE_OPERATORS`, routes to
// the rig-workspace chunk (`isRigWorkspaceOperator`, `lazyOperatorChunk`) and poll-fails "Arrives with Auto-Rig"; the
// two `skel.pose.*` stubs moved to `restPose.ts` unchanged.
import type { Tx } from '@ekza-studio/doc';
import { afterEach, describe, expect, it } from 'vitest';
import { ARRIVES_AFTER_MVP, isRigWorkspaceOperator, lazyOperatorChunk, type OperatorDef } from '../../src';
import { RIG_WORKSPACE_OPERATORS } from '../../src/operators/builtin/rig/index';
import { REST_POSE_OPERATORS } from '../../src/operators/builtin/rig/restPose';
import {
  ARRIVES_WITH_AUTORIG,
  COMPOSITION_INTERRUPTED,
  type CompositionOutcome,
  type CompositionStep,
  runComposition,
  WIZARD_OPERATORS,
} from '../../src/operators/builtin/rig/wizard';
import type { EditorApp } from '../../src/types';
import { opsApp, runOk } from '../builtin/support';
import { W } from '../kernel/support';

/** The §4.5 table, in owner order (D3 intake, D4 rig, D5 clip, D6 export, D1 navigate). */
const WIZARD_IDS = [
  'autorig.sample',
  'autorig.intake',
  'autorig.inspect',
  'autorig.fix',
  'autorig.rig',
  'autorig.cancel',
  'autorig.clip.add',
  'autorig.export',
  'autorig.navigate',
] as const;

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

/** An undoable inner operator: renames the wave clip (one transaction, one history step). */
function renameOp(id: `${string}.${string}`, name: string): OperatorDef<unknown, string, unknown> {
  return {
    id,
    label: `Rename ${name}`,
    category: 'test',
    scope: 'global',
    flags: { undo: true },
    apply: (ctx: { readonly tx: Tx | null }) => {
      ctx.tx?.patch('clips', W.clip, { name });
      return name;
    },
  };
}

/** A composition operator in the shape of an `autorig.*` one: inner runs from `prepare`, no undo, apply returns. */
function compositionOp(
  id: `${string}.${string}`,
  steps: () => readonly CompositionStep[],
  alive?: () => boolean,
): OperatorDef<unknown, CompositionOutcome, CompositionOutcome> {
  return {
    id,
    label: 'Composition',
    category: 'test',
    scope: 'global',
    prepare: ({ app }) => runComposition(app, steps(), alive === undefined ? {} : { alive }),
    apply: (_ctx, _args, outcome) => outcome,
  };
}

function setup(): EditorApp {
  const app = opsApp();
  for (const def of [
    renameOp('test.a', 'A'),
    renameOp('test.b', 'B'),
    renameOp('test.other', 'Other'),
    {
      id: 'test.fail',
      label: 'Fail',
      category: 'test',
      scope: 'global',
      flags: { undo: true },
      apply: () => {
        throw new Error('second step broke');
      },
    } satisfies OperatorDef<unknown, unknown, unknown>,
  ]) {
    disposers.push(app.operators.register(def));
  }
  return app;
}

const labels = (app: EditorApp): string[] => {
  const out: string[] = [];
  // walk the undo stack without changing it: undo all, read, redo all
  let step = app.history.peekUndo();
  let n = 0;
  while (step !== null && n < 50) {
    out.unshift(step.label);
    app.history.undo();
    step = app.history.peekUndo();
    n += 1;
  }
  for (let i = 0; i < n; i += 1) app.history.redo();
  return out;
};

const deferred = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('composition runner (AUTORIG-SPEC §4.5)', () => {
  it('two undoable inner runs leave exactly two history steps and none of the composition', async () => {
    const app = setup();
    const before = labels(app);
    disposers.push(app.operators.register(compositionOp('test.compose', () => [{ id: 'test.a' }, { id: 'test.b' }])));
    const outcome = (await runOk(app, 'test.compose')) as CompositionOutcome;
    expect(outcome).toEqual({ status: 'finished', values: ['A', 'B'] });
    expect(labels(app)).toEqual([...before, 'Rename A', 'Rename B']);
    expect(app.store.get('clips', W.clip)?.name).toBe('B');
    // each inner step undoes on its own
    await runOk(app, 'edit.undo');
    expect(app.store.get('clips', W.clip)?.name).toBe('A');
  });

  it('passes the earlier values to a step whose args are a function', async () => {
    const app = setup();
    const seen: unknown[] = [];
    disposers.push(
      app.operators.register({
        id: 'test.echo',
        label: 'Echo',
        category: 'test',
        scope: 'global',
        apply: (_ctx, args: unknown) => {
          seen.push(args);
          return 'echo';
        },
      } satisfies OperatorDef<unknown, string, unknown>),
    );
    const steps: CompositionStep[] = [{ id: 'test.a' }, { id: 'test.echo', args: (v: readonly unknown[]) => ({ v }) }];
    disposers.push(app.operators.register(compositionOp('test.compose', () => steps)));
    expect(await runOk(app, 'test.compose')).toEqual({ status: 'finished', values: ['A', 'echo'] });
    expect(seen).toEqual([{ v: ['A'] }]);
  });

  it('a failure of the second run leaves the first in place and stops', async () => {
    const app = setup();
    const before = labels(app);
    disposers.push(
      app.operators.register(
        compositionOp('test.compose', () => [{ id: 'test.a' }, { id: 'test.fail' }, { id: 'test.b' }]),
      ),
    );
    const outcome = (await runOk(app, 'test.compose')) as CompositionOutcome;
    expect(outcome).toEqual({
      status: 'failed',
      step: 1,
      id: 'test.fail',
      code: 'internal',
      message: 'second step broke',
    });
    expect(labels(app)).toEqual([...before, 'Rename A']);
    expect(app.store.get('clips', W.clip)?.name).toBe('A');
  });

  it('a cancelled inner run (poll) stops with its reason', async () => {
    const app = setup();
    disposers.push(
      app.operators.register(compositionOp('test.compose', () => [{ id: 'test.a' }, { id: 'test.nope' }])),
    );
    expect(await runOk(app, 'test.compose')).toEqual({
      status: 'failed',
      step: 1,
      id: 'test.nope',
      code: 'cancelled',
      message: "unknown operator 'test.nope'",
    });
  });

  it('an edit.undo between the inner runs stops the composition before the second', async () => {
    const app = setup();
    const before = labels(app);
    const gate = deferred();
    disposers.push(
      app.operators.register(
        compositionOp('test.compose', () => [{ id: 'test.a' }, { id: 'test.b', before: () => gate.promise }]),
      ),
    );
    const running = app.runUntyped('test.compose');
    // let the first inner run finish, then undo it while the composition awaits
    await new Promise((done) => setTimeout(done, 0));
    expect(app.store.get('clips', W.clip)?.name).toBe('A');
    await runOk(app, 'edit.undo');
    gate.resolve();
    const result = await running;
    expect(result).toEqual({
      status: 'finished',
      value: { status: 'interrupted', step: 1, message: COMPOSITION_INTERRUPTED },
    });
    expect(COMPOSITION_INTERRUPTED).toBe('Rigging was interrupted by another change');
    // test.b never ran; the undone first step is on the redo stack, nothing else changed
    expect(labels(app)).toEqual(before);
    expect(app.history.peekRedo()?.label).toBe('Rename A');
    expect(app.store.get('clips', W.clip)?.name).not.toBe('B');
  });

  it('another document run between the inner runs (palette, MCP bridge) stops it too', async () => {
    const app = setup();
    const before = labels(app);
    const gate = deferred();
    disposers.push(
      app.operators.register(
        compositionOp('test.compose', () => [{ id: 'test.a' }, { id: 'test.b', before: () => gate.promise }]),
      ),
    );
    const running = app.runUntyped('test.compose');
    await new Promise((done) => setTimeout(done, 0));
    await runOk(app, 'test.other');
    gate.resolve();
    expect((await running).status).toBe('finished');
    expect(((await running) as { value: CompositionOutcome }).value).toMatchObject({ status: 'interrupted', step: 1 });
    expect(labels(app)).toEqual([...before, 'Rename A', 'Rename Other']);
  });

  it('an undo during an inner run stops the composition after that run', async () => {
    const app = setup();
    const gate = deferred();
    disposers.push(
      app.operators.register({
        id: 'test.slow',
        label: 'Slow',
        category: 'test',
        scope: 'global',
        flags: { undo: true },
        prepare: () => gate.promise,
        apply: (ctx: { readonly tx: Tx | null }) => {
          ctx.tx?.patch('clips', W.clip, { name: 'Slow' });
        },
      } satisfies OperatorDef<unknown, void, void>),
    );
    disposers.push(
      app.operators.register(
        compositionOp('test.compose', () => [{ id: 'test.a' }, { id: 'test.slow' }, { id: 'test.b' }]),
      ),
    );
    const running = app.runUntyped('test.compose');
    await new Promise((done) => setTimeout(done, 0));
    await runOk(app, 'edit.undo');
    gate.resolve();
    expect(((await running) as { value: CompositionOutcome }).value).toMatchObject({ status: 'interrupted', step: 2 });
    expect(app.store.get('clips', W.clip)?.name).toBe('Slow');
  });

  it('stops when the subject is gone (alive() false)', async () => {
    const app = setup();
    let alive = true;
    disposers.push(
      app.operators.register(
        compositionOp(
          'test.compose',
          () => [
            {
              id: 'test.a',
            },
            {
              id: 'test.b',
              before: () => {
                alive = false;
              },
            },
          ],
          () => alive,
        ),
      ),
    );
    expect(await runOk(app, 'test.compose')).toEqual({
      status: 'interrupted',
      step: 1,
      message: COMPOSITION_INTERRUPTED,
    });
  });
});

describe('WIZARD_OPERATORS in the rig-workspace chunk (AUTORIG-SPEC §4.5, §7.0)', () => {
  it('lists every §4.5 id once, appended to RIG_WORKSPACE_OPERATORS with the moved skel.pose.* stubs', () => {
    expect(WIZARD_OPERATORS.map((def) => def.id)).toEqual(WIZARD_IDS);
    const ids = RIG_WORKSPACE_OPERATORS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(-WIZARD_IDS.length)).toEqual(WIZARD_IDS);
    expect(REST_POSE_OPERATORS.map((def) => def.id)).toEqual(['skel.pose.tStance', 'skel.pose.applyAsRest']);
    for (const def of REST_POSE_OPERATORS) expect(ids).toContain(def.id);
  });

  it('every stub id and the skel.pose.* ids route to the rig-workspace chunk', async () => {
    const app = opsApp();
    for (const id of [...WIZARD_IDS, 'skel.pose.tStance', 'skel.pose.applyAsRest']) {
      expect([id, isRigWorkspaceOperator(id)]).toEqual([id, true]);
      expect(app.operators.get(id)).toBeUndefined();
    }
    // the prefix is `autorig.` — M6b's control-rig generator keeps its own `rig.` id, unrelated names stay eager
    expect(isRigWorkspaceOperator('rig.autoRig.update')).toBe(true);
    expect(['autorig', 'autorigx.rig', 'xautorig.rig', 'library.preview'].map(isRigWorkspaceOperator)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const loading = lazyOperatorChunk(app, 'autorig.rig');
    expect(loading).toBeInstanceOf(Promise);
    await loading;
    expect(app.rig.loaded).toBe(true);
    expect(lazyOperatorChunk(app, 'autorig.rig')).toBeNull();
    for (const id of WIZARD_IDS) expect(app.operators.get(id)?.id).toBe(id);
  });

  it('running an autorig id before the chunk loaded loads it; the stubs poll-fail "Arrives with Auto-Rig"', async () => {
    const app = opsApp();
    expect(app.rig.loaded).toBe(false);
    expect(await app.runUntyped('autorig.rig', { straighten: true })).toEqual({
      status: 'cancelled',
      reason: ARRIVES_WITH_AUTORIG,
    });
    expect(app.rig.loaded).toBe(true);
    expect(ARRIVES_WITH_AUTORIG).toBe('Arrives with Auto-Rig');
    const reasons = WIZARD_IDS.map((id) => {
      const poll = app.operators.poll(id);
      return poll === true ? 'ok' : poll.reason;
    });
    expect(reasons).toEqual(WIZARD_IDS.map(() => ARRIVES_WITH_AUTORIG));
    // A0 replaced the moved M6b stubs: they poll for real (test/autorig-a0/ runs them), one undo step, listed.
    expect(['skel.pose.tStance', 'skel.pose.applyAsRest'].map((id) => app.operators.poll(id))).not.toContainEqual({
      ok: false,
      reason: ARRIVES_AFTER_MVP,
    });
    expect(app.operators.get('skel.pose.applyAsRest')?.flags).toEqual({ undo: true });
  });

  it('stub metadata: category autorig, scope global, every workspace, no undo, listed in the palette', async () => {
    const app = opsApp();
    await app.rig.load();
    for (const id of WIZARD_IDS) {
      const def = app.operators.get(id) as OperatorDef<unknown, unknown, unknown>;
      expect([id, def.category, def.scope, def.workspaces, def.flags]).toEqual([
        id,
        'autorig',
        'global',
        undefined,
        undefined,
      ]);
      expect(def.label.length).toBeGreaterThan(0);
    }
  });
});
