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
import { loadMeshKernel } from '../../src/mesh';
import { NO_NAVIGATION } from '../../src/operators/builtin/rig/wizard/navigate';
import { partsHidden } from '../../src/operators/builtin/rig/wizard/parts';
import { NO_MARKERS, NOTHING_TO_CANCEL } from '../../src/operators/builtin/rig/wizard/rig';
import type { EditorApp } from '../../src/types';
import { opsApp, runOk } from '../builtin/support';
import { W } from '../kernel/support';

/** The §4.5 table, in owner order (D3 intake, D4 rig, D5 clip, D6 export, D1 navigate, D9 controls: AR-D9-8, D10 parts:
 * AR-D10-1). */
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
  'autorig.controls',
  'autorig.parts',
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
    // D4 landed `autorig.rig`: the first run loads the chunk and then refuses with its own poll
    expect(await app.runUntyped('autorig.rig', { straighten: true })).toEqual({
      status: 'cancelled',
      reason: NO_MARKERS,
    });
    expect(app.rig.loaded).toBe(true);
    expect(ARRIVES_WITH_AUTORIG).toBe('Arrives with Auto-Rig');
    const reasons = WIZARD_IDS.map((id) => {
      const poll = app.operators.poll(id);
      return poll === true ? 'ok' : poll.reason;
    });
    // D1 landed `autorig.navigate`: without a host navigation port (Node) it refuses with its own reason. D3 landed
    // the ① compositions: without arguments each refuses with its own argument poll. D4 landed the ③ ones: without a
    // Quick Rig session / a running bind they refuse with their own reasons. D5 landed the ④ one (argument poll).
    const landed: Readonly<Record<string, string>> = {
      'autorig.rig': NO_MARKERS,
      'autorig.cancel': NOTHING_TO_CANCEL,
      'autorig.navigate': NO_NAVIGATION,
      'autorig.controls': 'expects { hidden: boolean }',
      'autorig.parts': 'expects { hidden: mesh ids }',
      'autorig.sample': 'expects { sample: cube-lad | polybot-tpose | polybot-apose | polybot | seed-san }',
      'autorig.intake': 'expects { bytes, name }',
      'autorig.inspect': 'expects { meshes }',
      'autorig.fix': 'expects { fix: center | face | standUp | scale | freeze, meshes }',
      // D5 landed `autorig.clip.add`: without arguments it refuses with its own argument poll.
      'autorig.clip.add': 'expects { character, clip, params, replace? }',
      // D6 landed `autorig.export`: without arguments it refuses with its argument poll
      'autorig.export': "expects { character, target: 'ekza-vrm' | 'glb' | 'vrma' | 'omoba-kit', fileName }",
    };
    expect(reasons).toEqual(WIZARD_IDS.map((id) => landed[id] ?? ARRIVES_WITH_AUTORIG));
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

describe('autorig.controls (AR-D9-8)', () => {
  it('hides every control for this user while held; gives back only the ones it hid; no undo step', async () => {
    const app = opsApp();
    const all = app.store
      .list('controls')
      .filter((control) => control.deleted === null)
      .map((control) => control.id as string)
      .sort();
    expect(all.length).toBeGreaterThan(1);
    const mine = all[0] as string;
    // the user hid one control themselves
    app.session.setState({ hiddenControls: new Set([mine as never]) });
    const undo = app.history.peekUndo();
    await runOk(app, 'autorig.controls', { hidden: true });
    expect([...app.session.getState().hiddenControls].sort()).toEqual(all);
    await runOk(app, 'autorig.controls', { hidden: true });
    expect([...app.session.getState().hiddenControls].sort()).toEqual(all);
    await runOk(app, 'autorig.controls', { hidden: false });
    expect([...app.session.getState().hiddenControls]).toEqual([mine]);
    expect(app.history.peekUndo()).toBe(undo);
  });
});

describe('autorig.parts (AR-D10-1)', () => {
  it('hides the left-out parts for this user; gives back only the ones it hid; no undo step', async () => {
    const app = opsApp();
    await app.rig.load();
    await loadMeshKernel();
    const cubes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const made = await app.runUntyped('mesh.create.cube', {});
      if (made.status !== 'finished') throw new Error(JSON.stringify(made));
      cubes.push((made.value as { mesh: string }).mesh);
    }
    const [a, b, mine] = cubes as [string, string, string];
    // the user hid one mesh themselves
    app.session.setState({ model: { ...app.session.getState().model, hiddenObjects: new Set([mine as never]) } });
    const undo = app.history.peekUndo();
    const hidden = (): string[] => [...app.session.getState().model.hiddenObjects].sort();
    await runOk(app, 'autorig.parts', { hidden: [a, mine] });
    expect(hidden()).toEqual([a, mine].sort());
    expect(partsHidden(app)).toEqual([a]);
    await runOk(app, 'autorig.parts', { hidden: [b] });
    expect(hidden()).toEqual([b, mine].sort());
    await runOk(app, 'autorig.parts', { hidden: [] });
    expect(hidden()).toEqual([mine]);
    expect(partsHidden(app)).toEqual([]);
    expect(app.history.peekUndo()).toBe(undo);
    expect(app.operators.poll('autorig.parts', undefined, { hidden: 'x' })).toEqual({
      ok: false,
      reason: 'expects { hidden: mesh ids }',
    });
  });
});
