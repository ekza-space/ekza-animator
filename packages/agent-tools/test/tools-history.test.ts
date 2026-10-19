// MCP-SPEC §6.9, §5.13 (P2): history_checkpoint (handles, the step list with who made each step) and history_revert —
// plain undos when this agent's steps are the top of the undo stack, a selective revert step otherwise (the user's
// edit survives), includeUserSteps confirmed, dry runs, already-undone and unreachable steps; and the revision
// tracker's memory (§4.4: older history answers with a warning only).
import type { CurveId } from '@ekza-animator/doc';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRevisionTracker, REVISION_MEMORY } from '../src';
import {
  call,
  controlOf,
  dataOf,
  errorOf,
  foreignEdit,
  keysOf,
  type P2Fixture,
  p2Fixture,
  runtimeOf,
} from './p2-support';

let fx: P2Fixture;
beforeEach(async () => {
  fx = await p2Fixture(81);
});

const key = (frame: number, value: number, control = 'fk.upperArm.L') => ({
  clip: 'agent',
  keys: [{ control, channel: 'rz', frame, value }],
});

describe('history_checkpoint (§6.9 tool 31)', () => {
  it('returns a checkpoint handle and lists recent steps with who made them', async () => {
    const runtime = runtimeOf(fx);
    const first = dataOf<{ checkpoint: string; step: number }>(
      await call(runtime, 'history_checkpoint', { label: 'Raise arm' }),
    );
    expect(first.checkpoint).toMatch(/^cp_[0-9A-Za-z]{12}$/);
    expect(first.step).toBe(fx.app.history.peekUndo()?.id);
    await call(runtime, 'keys_set', key(10, 20));
    const listed = dataOf<{
      steps: { label: string; actor: string; undone: boolean }[];
      checkpoints: { checkpoint: string; label: string | null }[];
    }>(await call(runtime, 'history_checkpoint', { list: true, limit: 3 }));
    expect(listed.steps).toHaveLength(3);
    expect(listed.steps.at(-1)).toMatchObject({
      actor: 'this_agent',
      undone: false,
      label: 'AI: Set keys (1 on 1 curve)',
    });
    expect(listed.steps[0]?.actor).toBe('user');
    expect(listed.checkpoints[0]).toEqual({ checkpoint: first.checkpoint, label: 'Raise arm', step: first.step });
    // a checkpoint is no step
    expect(fx.app.history.peekUndo()?.label).toBe('AI: Set keys (1 on 1 curve)');
  });
});

describe('history_revert (§6.9 tool 32, §5.13)', () => {
  it('undoes this agent’s steps when they are the top of the undo stack (redo keeps them)', async () => {
    const runtime = runtimeOf(fx);
    const cp = dataOf<{ checkpoint: string }>(
      await call(runtime, 'history_checkpoint', { label: 'Two keys' }),
    ).checkpoint;
    await call(runtime, 'keys_set', key(10, 20));
    await call(runtime, 'keys_set', key(20, 30));
    const ids = fx.app.history
      .entries()
      .undo.slice(-2)
      .map((step) => step.id);
    const result = dataOf(await call(runtime, 'history_revert', { to: cp }));
    expect(result).toEqual({
      mode: 'undo',
      reverted: [...ids].reverse(),
      alreadyUndone: [],
      unreachable: [],
      skippedFields: [],
      dryRun: false,
    });
    expect(keysOf(fx.app, fx.agentClip, controlOf(fx.app, fx.character, 'fk.upperArm.L'), 'rz')).toEqual([]);
    expect(fx.app.history.canRedo()).toBe(true);
  });

  it('reverts selectively when the user edited in between: the user’s edit survives', async () => {
    const runtime = runtimeOf(fx);
    const cp = dataOf<{ checkpoint: string }>(await call(runtime, 'history_checkpoint', { label: 'Mixed' })).checkpoint;
    await call(runtime, 'keys_set', key(10, 20));
    const cog = controlOf(fx.app, fx.character, 'cog');
    expect(
      (
        await fx.app.runUntyped('channel.setValues', {
          edits: [{ control: cog, channel: 'ty', value: 0.03 }],
          key: 'force',
        })
      ).status,
    ).toBe('finished');
    const result = await call(runtime, 'history_revert', { to: cp });
    expect(dataOf(result)).toMatchObject({ mode: 'revert', dryRun: false });
    expect(result.ok && result.undo?.label.startsWith('AI: ')).toBe(true);
    expect(keysOf(fx.app, fx.agentClip, controlOf(fx.app, fx.character, 'fk.upperArm.L'), 'rz')).toEqual([]);
    expect(
      fx.app.history
        .entries()
        .undo.some((step) => step.label.includes('Set Values') || step.actor === null || step.actor === undefined),
    ).toBe(true);
    const user = fx.app.store.query.clipsOfCharacter(fx.character).find((clip) => clip.name === 'user');
    expect(keysOf(fx.app, user?.id as never, cog, 'ty')).toHaveLength(1);
  });

  it('refuses another actor’s or the user’s steps, and unknown checkpoints', async () => {
    const runtime = runtimeOf(fx);
    const userStep = fx.app.history.peekUndo()?.id as number;
    expect(errorOf(await call(runtime, 'history_revert', { steps: [userStep] }))).toMatchObject({
      code: 'invalid_args',
      detail: { path: 'steps' },
    });
    expect(errorOf(await call(runtime, 'history_revert', { to: 'cp_000000000000' })).code).toBe('expired_handle');
  });

  it('needs confirm: true headless to undo the user’s steps too; a dry run changes nothing', async () => {
    const runtime = runtimeOf(fx);
    const cp = dataOf<{ checkpoint: string }>(await call(runtime, 'history_checkpoint', {})).checkpoint;
    await call(runtime, 'keys_set', key(10, 20));
    const cog = controlOf(fx.app, fx.character, 'cog');
    await fx.app.runUntyped('channel.setValues', {
      edits: [{ control: cog, channel: 'ty', value: 0.03 }],
      key: 'force',
    });
    const top = fx.app.history.peekUndo()?.id;
    const dry = dataOf(await call(runtime, 'history_revert', { to: cp, includeUserSteps: true, dryRun: true }));
    expect(dry).toMatchObject({ mode: 'undo', dryRun: true });
    expect(fx.app.history.peekUndo()?.id).toBe(top);
    expect(errorOf(await call(runtime, 'history_revert', { to: cp, includeUserSteps: true })).code).toBe(
      'confirm_required',
    );
    const done = dataOf<{ mode: string; reverted: number[] }>(
      await call(runtime, 'history_revert', { to: cp, includeUserSteps: true, confirm: true }),
    );
    expect(done.mode).toBe('undo');
    expect(done.reverted).toHaveLength(2);
    expect(fx.app.history.entries().redo).toHaveLength(2);
  });

  it('reports steps the user already undid and steps that left the history', async () => {
    const runtime = runtimeOf(fx);
    const cp = dataOf<{ checkpoint: string }>(await call(runtime, 'history_checkpoint', {})).checkpoint;
    await call(runtime, 'keys_set', key(10, 20));
    const mine = fx.app.history.peekUndo()?.id as number;
    fx.app.history.undo();
    expect(dataOf(await call(runtime, 'history_revert', { to: cp }))).toMatchObject({
      mode: 'none',
      alreadyUndone: [mine],
    });
    fx.app.history.clear();
    const gone = await call(runtime, 'history_revert', { steps: [mine] });
    expect(dataOf(gone)).toMatchObject({ mode: 'none', unreachable: [mine] });
    expect(gone.ok && gone.next).toContain('Restore the project as it was before the agent');
  });
});

describe('the revision tracker’s memory (§4.4)', () => {
  it('fails a write over a remembered foreign change, and only warns about one older than its memory', () => {
    const tracker = createRevisionTracker(fx.app);
    tracker.markSeen(fx.agentClip);
    const forearm = controlOf(fx.app, fx.character, 'fk.lowerArm.L');
    const layer = fx.app.store.query.baseLayer(fx.agentClip);
    const curve = fx.app.store.query.curveFor(fx.agentClip, layer?.id as never, forearm, 'rz')?.id as CurveId;
    const touches = { curves: [curve], clipRecord: false };
    foreignEdit(fx.app, fx.keys[0] as never, 0.1);
    expect(() => tracker.check(fx.agentClip, undefined, touches)).toThrow(/changed/);
    // the actor's own writes push the foreign change out of the remembered batches
    for (let i = 0; i <= REVISION_MEMORY; i++)
      tracker.runOwn(() => foreignEdit(fx.app, fx.keys[2] as never, i / 1_000));
    expect(tracker.check(fx.agentClip, undefined, touches)).toMatch(/changed since you last read it/);
    tracker.dispose();
  });
});
