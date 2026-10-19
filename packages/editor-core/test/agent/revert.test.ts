// MCP-SPEC §4.10, §5.13 (P1): `edit.revertSteps` reverts older agent steps as one new step, compare-before-restore
// per merge unit (fields the user changed since are kept and reported), newest first; `edit.restoreDocument` makes
// the document equal to a snapshot in one undoable step (user runs only).
import type { CurveId, DocSnapshot, KeyId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import type { EditorApp } from '../../src/types';
import { agentOk, agentRefusal, DEG, docJson, keysOf, opsApp, runOk, WAVE, waveCurve } from './support';

const UPPER = WAVE.upperArmL;
const ARM = WAVE.lowerArmL;

function lastStepId(app: EditorApp): number {
  const id = app.history.peekUndo()?.id;
  if (id === undefined) throw new Error('no step');
  return id;
}

async function agentKey(app: EditorApp, control: typeof UPPER, frame: number, degrees: number): Promise<number> {
  await agentOk(app, 'key.write', {
    clip: WAVE.clip,
    keys: [{ control, channel: 'rz', frame, value: degrees * DEG }],
    label: 'Set keys (1 on 1 curve)',
  });
  return lastStepId(app);
}

describe('edit.revertSteps', () => {
  it("reverts an older agent step around a user step: the user's and later agent keys stay", async () => {
    const app = opsApp();
    const a = await agentKey(app, UPPER, 10, 20);
    // The user keys the arm at 10 (Channel Box + S) — a step of their own.
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 10 } });
    await runOk(app, 'channel.setValues', { edits: [{ control: ARM, channel: 'rz', value: 0.1 }], key: 'force' });
    await agentKey(app, UPPER, 20, 30);
    const value = await runOk(app, 'edit.revertSteps', { steps: [a] });
    // A created the curve; B's key still uses it, so the curve stays (reported) and only A's key goes.
    const curve = waveCurve(app, UPPER, 'rz');
    expect(value).toEqual({
      reverted: [a],
      skipped: [],
      skippedFields: [{ table: 'curves', id: curve, fields: null }],
    });
    expect(keysOf(app, waveCurve(app, UPPER, 'rz')).map(([t]) => t)).toEqual([20]);
    expect(keysOf(app, waveCurve(app, ARM, 'rz')).map(([t]) => t)).toEqual([0, 10, 15, 30]);
    // A user run names the reverted step; the reverted step stays in the history.
    expect(app.history.peekUndo()?.label).toBe('Revert AI step: AI: Set keys (1 on 1 curve)');
    expect(app.history.entries().undo.some((step) => step.id === a)).toBe(true);
    // One undo brings the reverted key back.
    await runOk(app, 'edit.undo');
    expect(keysOf(app, waveCurve(app, UPPER, 'rz')).map(([t]) => t)).toEqual([10, 20]);
  });

  it('keeps a field the user changed since and reports it', async () => {
    const app = opsApp();
    const arm = waveCurve(app, ARM, 'rz') as CurveId;
    const key = app.store.query.keysOfCurve(arm)[2]?.id as KeyId;
    const c = await agentKey(app, ARM, 30, 40);
    // The user types 45 into that key (Graph Editor value field on the selected key).
    app.session.setState({
      selection: { ...app.session.getState().selection, keys: new Map([[key, { key: true, in: false, out: false }]]) },
    });
    await runOk(app, 'graph.keys.setFields', { value: 45 });
    const value = await agentOk(app, 'edit.revertSteps', { steps: [c] });
    expect(value).toEqual({
      reverted: [],
      skipped: [{ step: c, reason: 'changed since' }],
      // Keys merge per record (the whole key is the user's now).
      skippedFields: [{ table: 'keys', id: key, fields: null }],
    });
    expect(app.store.get('keys', key)?.v).toBeCloseTo(45 * DEG, 12);
  });

  it('reverts several steps newest first in one step labelled for agents', async () => {
    const app = opsApp();
    const a = await agentKey(app, UPPER, 10, 20);
    const b = await agentKey(app, UPPER, 10, 30); // patches A's key
    const before = docJson(app);
    await agentOk(app, 'edit.revertSteps', { steps: [a, b] });
    expect(waveCurve(app, UPPER, 'rz') === undefined || keysOf(app, waveCurve(app, UPPER, 'rz')).length === 0).toBe(
      true,
    );
    expect(app.history.peekUndo()?.label).toBe('AI: Revert 2 steps');
    await runOk(app, 'edit.undo');
    expect(docJson(app)).toEqual(before);
  });

  it('counts a step named twice once, in the agent label and in the user label alike', async () => {
    const app = opsApp();
    const a = await agentKey(app, UPPER, 10, 20);
    expect(await agentOk(app, 'edit.revertSteps', { steps: [a, a] })).toMatchObject({ reverted: [a] });
    expect(app.history.peekUndo()?.label).toBe('AI: Revert 1 step');
    await runOk(app, 'edit.undo');
    await runOk(app, 'edit.revertSteps', { steps: [a, a] });
    expect(app.history.peekUndo()?.label).toBe('Revert AI step: AI: Set keys (1 on 1 curve)');
  });

  it('refuses steps that are not in the undo history or have no change record', async () => {
    const app = opsApp();
    await runOk(app, 'channel.setValues', { edits: [{ control: ARM, channel: 'rz', value: 0.1 }], key: 'force' });
    const user = lastStepId(app);
    expect(await agentRefusal(app, 'edit.revertSteps', { steps: [user] })).toMatch(/cannot be reverted on its own/);
    expect(await agentRefusal(app, 'edit.revertSteps', { steps: [9999] })).toMatch(/not in the undo history/);
    expect(await agentRefusal(app, 'edit.revertSteps', { steps: [] })).toBe('steps is empty');
  });
});

describe('edit.restoreDocument', () => {
  it('restores a snapshot in one undoable step (user runs only)', async () => {
    const app = opsApp();
    const snapshot: DocSnapshot = app.store.snapshot();
    const original = docJson(app);
    await agentKey(app, UPPER, 10, 20);
    await agentOk(app, 'key.delete', { clip: WAVE.clip, targets: [{ control: ARM, channel: 'rz' }], frames: [15] });
    await runOk(app, 'channel.setValues', {
      edits: [{ control: WAVE.handL, channel: 'rz', value: 0.1 }],
      key: 'force',
    });
    const edited = docJson(app);
    expect(await agentRefusal(app, 'edit.restoreDocument', { snapshot, label: 'x' })).toMatch(/user’s action/);
    const value = (await runOk(app, 'edit.restoreDocument', {
      snapshot,
      label: 'Restore project before AI (12:04)',
    })) as {
      writes: number;
    };
    expect(value.writes).toBeGreaterThan(0);
    expect(docJson(app)).toEqual(original);
    expect(app.history.peekUndo()?.label).toBe('Restore project before AI (12:04)');
    await runOk(app, 'edit.undo');
    expect(docJson(app)).toEqual(edited);
  });
});
