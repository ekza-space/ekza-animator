// M6B-SPEC §4.3 (C0): the rig contract's working baselines — `parseConstraintParams` (defaults, per-field repair,
// unknown `v` → null, Maya aim defaults), `withoutConstraints`, the `updateAutoRig` baseline (ids kept, vanished bones
// soft-deleted, ik limbs as requested) — the Quick Rig v2 marker lists, and every stub failing `not-implemented`.
import type { ConstraintRecord, ControlId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import {
  autoRig,
  bakeConstraints,
  CONSTRAINT_OPS,
  chainParent,
  deleteJoints,
  duplicateJoints,
  editShapePoints,
  generatedShape,
  insertJoint,
  mirrorConstraint,
  mirrorShape,
  parseConstraintParams,
  QUICK_RIG_CENTRE_MARKERS,
  QUICK_RIG_SIDE_MARKERS,
  type RigDefinition,
  removeJoints,
  reparentJoints,
  socketPlacement,
  splitBone,
  transformShape,
  updateAutoRig,
  withoutConstraints,
} from '../../src';
import { IDS, richHumanoid } from '../helpers';

function constraint(fields: Partial<ConstraintRecord> = {}): ConstraintRecord {
  return {
    id: 'cns_A' as never,
    rig: IDS.rig,
    type: 'parent',
    driven: { control: `${IDS.rig}:fk.hand.R` as ControlId },
    targets: {},
    maintainOffset: true,
    params: {},
    enabled: true,
    deleted: null,
    ...fields,
  };
}

describe('parseConstraintParams (C0 baseline)', () => {
  it('reads missing params as the defaults (aim: Maya defaults; others: null)', () => {
    expect(parseConstraintParams(constraint())).toEqual({
      v: 1,
      key: 'parent',
      holder: null,
      weights: { mode: 'static' },
      blend: false,
      skip: { t: [false, false, false], r: [false, false, false] },
      interp: 'average',
      aim: null,
    });
    expect(parseConstraintParams(constraint({ type: 'aim' }))?.aim).toEqual({
      aimAxis: [1, 0, 0],
      upAxis: [0, 1, 0],
      worldUp: { type: 'vector', vector: [0, 1, 0] },
    });
  });

  it('keeps well-formed fields and repairs each malformed one on its own; never throws', () => {
    const params = {
      v: 1,
      key: 'grip',
      holder: `${IDS.rig}:fk.hand.R`,
      weights: { mode: 'select', order: ['a', 'b'] },
      blend: true,
      skip: { t: [true, false, false], r: 'no' },
      interp: 'shortest',
      aim: { aimAxis: [0, 0, 1], upAxis: [0, 0, 0], worldUp: { type: 'object', target: { kind: 'world' } } },
      extra: { kept: true },
    };
    expect(parseConstraintParams(constraint({ type: 'aim', params }))).toEqual({
      v: 1,
      key: 'grip',
      holder: `${IDS.rig}:fk.hand.R`,
      weights: { mode: 'select', order: ['a', 'b'] },
      blend: true,
      skip: { t: [true, false, false], r: [false, false, false] },
      interp: 'shortest',
      aim: { aimAxis: [0, 0, 1], upAxis: [0, 1, 0], worldUp: { type: 'object', target: { kind: 'world' } } },
    });
    expect(parseConstraintParams(constraint({ params: { key: '9bad', weights: 'x', interp: 7 } }))).toMatchObject({
      key: 'parent',
      weights: { mode: 'static' },
      interp: 'average',
    });
    expect(parseConstraintParams(constraint({ params: null as never }))?.key).toBe('parent');
  });

  it('returns null for an unknown params version', () => {
    expect(parseConstraintParams(constraint({ params: { v: 2 } }))).toBeNull();
  });
});

describe('withoutConstraints (C0 baseline)', () => {
  it('disables every constraint and returns the same definition when none is enabled', () => {
    const def = autoRig(richHumanoid(), IDS);
    expect(withoutConstraints(def)).toBe(def);
    const withOne: RigDefinition = {
      ...def,
      constraints: [constraint(), constraint({ id: 'cns_B' as never, enabled: false })],
    };
    const off = withoutConstraints(withOne);
    expect(off.constraints.map((c) => c.enabled)).toEqual([false, false]);
    expect(off.constraints[1]).toBe(withOne.constraints[1]);
    expect(off.controls).toBe(withOne.controls);
    expect(withOne.constraints[0]?.enabled).toBe(true);
  });
});

describe('updateAutoRig (C0 baseline)', () => {
  it('creates the rig, keeps control ids on an update and soft-deletes controls whose bone vanished', () => {
    const skeleton = richHumanoid();
    const created = updateAutoRig(null, skeleton, IDS, { ik: { legs: true, arms: false } });
    expect(created).toMatchObject({ softDeleted: [], staleOffsets: [], warnings: [] });
    expect(created.rig.solvers.length).toBeGreaterThan(0);
    expect(created.rig).toEqual(autoRig(skeleton, IDS, { ik: { legs: true, arms: false } }));
    const extra = { ...created.rig.controls[0], id: `${IDS.rig}:fk.gone` as ControlId, key: 'fk.gone' } as never;
    const current: RigDefinition = { ...created.rig, controls: [...created.rig.controls, extra] };
    const updated = updateAutoRig(current, skeleton, IDS, { ik: { legs: true, arms: false } });
    expect(updated.softDeleted).toEqual([`${IDS.rig}:fk.gone`]);
    expect(updated.warnings).toHaveLength(1);
    expect(updated.rig.controls.map((c) => c.id)).toEqual(created.rig.controls.map((c) => c.id));
  });
});

describe('Quick Rig v2 marker lists (§0.5)', () => {
  it('lists the centre and the right-side markers in pick order', () => {
    expect(QUICK_RIG_CENTRE_MARKERS).toEqual(['headTop', 'chin', 'pelvis']);
    expect(QUICK_RIG_SIDE_MARKERS).toEqual(['shoulder', 'elbow', 'wrist', 'knee', 'ankle', 'toe']);
    expect(Object.isFrozen(QUICK_RIG_CENTRE_MARKERS) && Object.isFrozen(QUICK_RIG_SIDE_MARKERS)).toBe(true);
  });
});

// C2 landed skeletonTemplate, fitTemplate, guessMarkers, projectedCenter, orientJoints, mirrorJoints, moveJoints and
// checkSkeleton (tested in test/m6b-skeleton/), AUTORIG A0 applyPoseAsRest (test/autorig-a0/); the deferred symbols
// keep their stubs.
describe('stubs fail not-implemented with their symbol (§3 rule 1)', () => {
  const any = null as never;
  it.each([
    ['insertJoint', () => insertJoint([], any, 0.5, any)],
    ['splitBone', () => splitBone([], any, any, 2, any)],
    ['removeJoints', () => removeJoints([], [])],
    ['deleteJoints', () => deleteJoints([], [])],
    ['reparentJoints', () => reparentJoints([], [], null)],
    ['duplicateJoints', () => duplicateJoints([], [], { mirror: false }, any)],
    ['chainParent', () => chainParent([], [0, 0, 0], { selected: null, preset: null, newRoot: false })],
    ['socketPlacement', () => socketPlacement([], 'back', any, 1.7)],
    ['bakeConstraints', () => bakeConstraints(any, any, [], any)],
    ['mirrorConstraint', () => mirrorConstraint(any, any, any)],
    ['transformShape', () => transformShape(any, {}, [0, 0, 0])],
    ['editShapePoints', () => editShapePoints(any, [])],
    ['mirrorShape', () => mirrorShape(any, [], [])],
    ['generatedShape', () => generatedShape(any, any, any)],
    ['CONSTRAINT_OPS.point', () => CONSTRAINT_OPS.point.reads(constraint(), any)],
  ] as const)('%s', (symbol, call) => {
    expect(call).toThrow(expect.objectContaining({ code: 'not-implemented', message: `rig.${symbol}` }));
  });
});
