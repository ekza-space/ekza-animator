// M2A-SPEC §5.5 (A2): controlVisibility rules 2–3 over evaluated ikFk, for ikFk 0, 0.5 and 1, the selected-ghost
// rule, the 'ghost' preference (stretch), and the per-character resolver.
import { describe, expect, it } from 'vitest';
import { controlVisibility, controlVisibilityResolver, limbHiddenControls, limbVisibilityState } from '../../src';
import { cid, ikApp } from '../builtin/ikFixture';
import { WAVE, waveDoc } from '../builtin/support';

function setIkFk(app: ReturnType<typeof ikApp>['app'], key: string, value: number): void {
  const overrides = new Map(app.session.getState().overrides);
  overrides.set(cid(key), { ...overrides.get(cid(key)), '@ikFk': value });
  app.session.setState({ overrides });
}

describe('controlVisibility rules 2–3 (§5.5)', () => {
  it('legs IK (ikFk 1 by default) hide their FK chains; arms FK (0) hide their IK controls and poles', () => {
    const { app } = ikApp();
    expect(app.evaluation.ikFk(WAVE.character, 'leg.L')).toBe(1);
    expect(app.evaluation.ikFk(WAVE.character, 'arm.L')).toBe(0);
    for (const key of ['fk.upperLeg.L', 'fk.lowerLeg.L', 'fk.foot.L']) {
      expect([key, controlVisibility(app, cid(key))]).toEqual([key, 'hidden']);
    }
    // fk.toes and fingers follow rule 1 only.
    expect(controlVisibility(app, cid('fk.toes.L'))).toBe('visible');
    expect(controlVisibility(app, cid('fk.indexProximal.L'))).toBe('visible');
    expect(controlVisibility(app, cid('ik.leg.L'))).toBe('visible');
    expect(controlVisibility(app, cid('pole.leg.L'))).toBe('visible');
    expect(controlVisibility(app, cid('ik.arm.L'))).toBe('hidden');
    expect(controlVisibility(app, cid('pole.arm.L'))).toBe('hidden');
    expect(controlVisibility(app, cid('fk.upperArm.L'))).toBe('visible');
  });

  it('a blend (ikFk 0.5) shows both sets; the thresholds are 0.999 and 0.001', () => {
    const { app } = ikApp();
    setIkFk(app, 'ik.leg.L', 0.5);
    expect(controlVisibility(app, cid('fk.upperLeg.L'))).toBe('visible');
    expect(controlVisibility(app, cid('ik.leg.L'))).toBe('visible');
    setIkFk(app, 'ik.leg.L', 0.9995);
    expect(controlVisibility(app, cid('fk.upperLeg.L'))).toBe('hidden');
    setIkFk(app, 'ik.leg.L', 0.0005);
    expect(controlVisibility(app, cid('ik.leg.L'))).toBe('hidden');
    expect(controlVisibility(app, cid('pole.leg.L'))).toBe('hidden');
    expect(controlVisibility(app, cid('fk.upperLeg.L'))).toBe('visible');
    // ikFk 0 exactly
    setIkFk(app, 'ik.leg.L', 0);
    expect(controlVisibility(app, cid('ik.leg.L'))).toBe('hidden');
  });

  it('a selected control hidden by rule 2 is a ghost and stays selected (rule 3)', () => {
    const { app } = ikApp();
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [cid('fk.upperLeg.L')] } });
    expect(controlVisibility(app, cid('fk.upperLeg.L'))).toBe('ghost');
    expect(controlVisibility(app, cid('fk.lowerLeg.L'))).toBe('hidden');
    expect(app.session.getState().selection.controls).toEqual([cid('fk.upperLeg.L')]);
  });

  it("rule 1 wins over rule 2; the 'ghost' preference draws rule-2 controls as ghosts", () => {
    const { app } = ikApp();
    app.session.setState({ hiddenControls: new Set([cid('ik.leg.L')]) });
    expect(controlVisibility(app, cid('ik.leg.L'))).toBe('hidden');
    app.prefs.setState({ ikFkVisibility: 'ghost' });
    expect(controlVisibility(app, cid('fk.upperLeg.L'))).toBe('ghost');
    expect(controlVisibility(app, cid('ik.leg.L'))).toBe('hidden');
  });

  it('the resolver and limbHiddenControls agree with the single rule; unknown controls are hidden', () => {
    const { app } = ikApp();
    const resolve = controlVisibilityResolver(app);
    for (const control of app.store.query.controlsOfRig(WAVE.rig)) {
      expect([control.key, resolve(control.id)]).toEqual([control.key, controlVisibility(app, control.id)]);
    }
    expect([...limbHiddenControls(app, WAVE.character)].sort()).toEqual(
      [
        cid('fk.upperLeg.L'),
        cid('fk.lowerLeg.L'),
        cid('fk.foot.L'),
        cid('fk.upperLeg.R'),
        cid('fk.lowerLeg.R'),
        cid('fk.foot.R'),
        cid('ik.arm.L'),
        cid('pole.arm.L'),
        cid('ik.arm.R'),
        cid('pole.arm.R'),
      ].sort(),
    );
    expect(controlVisibility(app, 'nope' as never)).toBe('hidden');
  });
});

describe('per-frame cost of the rule (§5.5 rule 5, MVP-SPEC §3 rule 5)', () => {
  it('limbVisibilityState is the rule-2 state: IK at ≥ 0.999, FK at ≤ 0.001, else between', () => {
    expect([1, 0.999, 0.9989, 0.5, 0.0011, 0.001, 0].map(limbVisibilityState)).toEqual([2, 2, 1, 1, 1, 0, 0]);
  });

  it('limbHiddenControls shares one empty set for characters without limbs or with every limb between', () => {
    const { app: plain } = ikApp({ snapshot: waveDoc() });
    const none = limbHiddenControls(plain, WAVE.character);
    expect(none.size).toBe(0);
    expect(limbHiddenControls(plain, WAVE.character)).toBe(none);
    const { app } = ikApp();
    for (const key of ['ik.leg.L', 'ik.leg.R', 'ik.arm.L', 'ik.arm.R']) setIkFk(app, key, 0.5);
    expect(limbHiddenControls(app, WAVE.character)).toBe(none);
    // A character without limbs resolves 'visible' without reading any limb.
    expect(controlVisibilityResolver(plain)(cid('fk.upperLeg.L'))).toBe('visible');
  });
});
