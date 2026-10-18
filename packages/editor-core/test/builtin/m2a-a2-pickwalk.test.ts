// M2A-SPEC §5.17 (A2, FR-OUT-05): select.pickWalk over the control hierarchy, skipping controls that are not
// visible (§5.5); the lead stays the lead; `add`; not a history step; the prefs.arrowKeys 'frames' dispatch.
import { describe, expect, it } from 'vitest';
import { cid, ikApp } from './ikFixture';
import { opsApp, runOk, runResult, setSceneFrame, WAVE } from './support';

function select(app: ReturnType<typeof opsApp>, keys: readonly string[]): void {
  app.session.setState({ selection: { ...app.session.getState().selection, controls: keys.map(cid) } });
}
const selected = (app: ReturnType<typeof opsApp>): readonly string[] =>
  app.session.getState().selection.controls.map((id) => id.slice(WAVE.rig.length + 1));

describe('select.pickWalk (§5.17)', () => {
  it('up / down / left / right on the arm chain (E2E-M2A-18 order)', async () => {
    const app = opsApp();
    select(app, ['fk.lowerArm.L']);
    await runOk(app, 'select.pickWalk', { direction: 'up' });
    expect(selected(app)).toEqual(['fk.upperArm.L']);
    await runOk(app, 'select.pickWalk', { direction: 'down' });
    expect(selected(app)).toEqual(['fk.lowerArm.L']);
    // No sibling: the visible mirror counterpart.
    await runOk(app, 'select.pickWalk', { direction: 'right' });
    expect(selected(app)).toEqual(['fk.lowerArm.R']);
    expect(app.history.canUndo()).toBe(false);
  });

  it('siblings by order, then the mirror; up from the top stays; down without children stays', async () => {
    const app = opsApp();
    select(app, ['fk.hips']);
    await runOk(app, 'select.pickWalk', { direction: 'right' });
    expect(selected(app)).toEqual(['fk.spine']);
    await runOk(app, 'select.pickWalk', { direction: 'right' });
    // fk.spine is the last child of cog and centred (no mirror): it stays.
    expect(selected(app)).toEqual(['fk.spine']);
    await runOk(app, 'select.pickWalk', { direction: 'left' });
    expect(selected(app)).toEqual(['fk.hips']);
    select(app, ['fk.upperLeg.L']);
    await runOk(app, 'select.pickWalk', { direction: 'right' });
    expect(selected(app)).toEqual(['fk.upperLeg.R']);
    await runOk(app, 'select.pickWalk', { direction: 'left' });
    expect(selected(app)).toEqual(['fk.upperLeg.L']);
    select(app, ['root']);
    await runOk(app, 'select.pickWalk', { direction: 'up' });
    expect(selected(app)).toEqual(['root']);
    select(app, ['fk.toes.L']);
    await runOk(app, 'select.pickWalk', { direction: 'down' });
    expect(selected(app)).toEqual(['fk.toes.L']);
  });

  it('every selected control walks; duplicates collapse; the lead result stays the lead; add keeps the rest', async () => {
    const app = opsApp();
    select(app, ['fk.hand.L', 'fk.lowerArm.R', 'fk.indexProximal.L']);
    await runOk(app, 'select.pickWalk', { direction: 'up' });
    // fk.hand.L → fk.lowerArm.L, fk.lowerArm.R → fk.upperArm.R, and the lead fk.indexProximal.L → fk.hand.L (last).
    expect(selected(app)).toEqual(['fk.lowerArm.L', 'fk.upperArm.R', 'fk.hand.L']);
    select(app, ['fk.hand.L', 'fk.indexProximal.L']);
    await runOk(app, 'select.pickWalk', { direction: 'up', add: false });
    expect(selected(app)).toEqual(['fk.lowerArm.L', 'fk.hand.L']);
    select(app, ['fk.lowerArm.L', 'fk.indexProximal.L']);
    await runOk(app, 'select.pickWalk', { direction: 'up' });
    // Both reach fk.upperArm.L / fk.hand.L; the lead's result (fk.hand.L) is last.
    expect(selected(app)).toEqual(['fk.upperArm.L', 'fk.hand.L']);
    select(app, ['fk.upperArm.L', 'fk.hand.L']);
    await runOk(app, 'select.pickWalk', { direction: 'up' });
    expect(selected(app)).toEqual(['fk.shoulder.L', 'fk.lowerArm.L']);
    select(app, ['fk.lowerArm.L']);
    await runOk(app, 'select.pickWalk', { direction: 'up', add: true });
    expect(selected(app)).toEqual(['fk.lowerArm.L', 'fk.upperArm.L']);
  });

  it('skips controls hidden by the IK/FK rule (legs IK): up from the IK foot is root; down passes hidden FK legs', async () => {
    const { app } = ikApp();
    select(app as never, ['fk.toes.L']);
    // fk.foot.L, fk.lowerLeg.L, fk.upperLeg.L are hidden (ikFk 1): up goes to fk.hips.
    await runOk(app, 'select.pickWalk', { direction: 'up' });
    expect(selected(app as never)).toEqual(['fk.hips']);
    await runOk(app, 'select.pickWalk', { direction: 'down' });
    // fk.hips' first child fk.upperLeg.L is hidden: its first visible descendant is fk.toes.L.
    expect(selected(app as never)).toEqual(['fk.toes.L']);
    select(app as never, ['ik.leg.L']);
    await runOk(app, 'select.pickWalk', { direction: 'up' });
    expect(selected(app as never)).toEqual(['root']);
    select(app as never, ['ik.leg.L']);
    await runOk(app, 'select.pickWalk', { direction: 'right' });
    // Siblings under root by order: cog (a0) < ik.arm… (hidden) < ik.leg.L < ik.leg.R < pole…
    expect(selected(app as never)).toEqual(['ik.leg.R']);
  });

  it('nothing selected poll-fails; bad args poll-fail', async () => {
    const app = opsApp();
    expect(await runResult(app, 'select.pickWalk', { direction: 'up' })).toEqual({
      status: 'cancelled',
      reason: 'Nothing is selected',
    });
    expect((await runResult(app, 'select.pickWalk', { direction: 'north' })).status).toBe('cancelled');
    expect((await runResult(app, 'select.pickWalk', { direction: 'up', add: 1 })).status).toBe('cancelled');
  });

  it("prefs.arrowKeys 'frames': ←/→ step frames, ↑/↓ next/previous key; the selection is untouched", async () => {
    const app = opsApp();
    app.prefs.setState({ arrowKeys: 'frames' });
    select(app, ['fk.lowerArm.L']);
    setSceneFrame(app, 5);
    await runOk(app, 'select.pickWalk', { direction: 'right' });
    expect(app.evaluation.clipFrame(WAVE.character)).toBe(6);
    await runOk(app, 'select.pickWalk', { direction: 'left', add: true });
    expect(app.evaluation.clipFrame(WAVE.character)).toBe(5);
    await runOk(app, 'select.pickWalk', { direction: 'up' });
    expect(app.evaluation.clipFrame(WAVE.character)).toBe(15);
    await runOk(app, 'select.pickWalk', { direction: 'down' });
    expect(app.evaluation.clipFrame(WAVE.character)).toBe(0);
    expect(selected(app)).toEqual(['fk.lowerArm.L']);
    expect(app.calls.map((call) => call.id)).toEqual(
      expect.arrayContaining(['time.step', 'time.nextKey', 'time.prevKey']),
    );
  });

  it('the arrow keys run select.pickWalk in the viewport and Channel Box scopes', () => {
    const app = opsApp();
    const input = (code: string, shiftKey = false) => ({
      code,
      ctrlKey: false,
      metaKey: false,
      shiftKey,
      altKey: false,
      repeat: false,
    });
    for (const scope of ['viewport', 'channelBox']) {
      expect(app.keymap.resolve(input('ArrowUp'), [scope, 'global'], 'press')).toMatchObject({
        op: 'select.pickWalk',
        args: { direction: 'up' },
      });
      expect(app.keymap.resolve(input('ArrowLeft', true), [scope, 'global'], 'press')).toMatchObject({
        op: 'select.pickWalk',
        args: { direction: 'left', add: true },
      });
    }
  });
});
