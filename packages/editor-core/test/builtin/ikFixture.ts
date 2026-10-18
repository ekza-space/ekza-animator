// A2 test fixture: the wave document with limb IK records shaped like A1's `limbIkRecords` output (§5.2: IK
// controls with the LIMB_ATTR attributes, poles, `ik2` solvers), and a fake app whose rig programs carry
// `RigProgram.limbs` built from those solver records. The naive rig program evaluates no `ik2` op (A1's math), so
// these tests cover the editor side: visibility, keying, Channel Box rows, key policies and pick-walk.
import type { AttrDef, ControlId, ControlRecord, DocSnapshot, RigId, SolverRecord } from '@ekza-animator/doc';
import { solverId } from '@ekza-animator/doc';
import type { FootRollParams, Ik2Params, LimbDesc, LimbId, RigDefinition, RigProgram } from '@ekza-animator/rig';
import { registerBuiltinOperators } from '../../src';
import { createKernelApp } from '../../src/app/kernel';
import { MAYA_KEYMAP } from '../../src/keymap/maya';
import { createFakeServices, type FakeServices } from '../../src/testing';
import { naiveKernelDeps } from '../../src/testing/deps';
import { createNaiveStore } from '../../src/testing/store/naiveStore';
import type { EditorApp } from '../../src/types';
import { humanoidSkeleton, WAVE, waveDoc } from './support';

const RIG: RigId = WAVE.rig;
export const cid = (key: string): ControlId => `${RIG}:${key}` as ControlId;

const ATTR = {
  ikFk: (dflt: number): AttrDef => ({
    type: 'float',
    default: dflt,
    min: 0,
    max: 1,
    keyable: true,
    keyAll: false,
    stepped: true,
    label: 'IK/FK',
  }),
  soft: { type: 'float', default: 0, min: 0, max: 0.25, keyable: true, keyAll: false } as AttrDef,
  twist: { type: 'float', default: 0, keyable: true, unit: 'angle', mirror: 'negate' } as AttrDef,
  roll: { type: 'float', default: 0, keyable: true, unit: 'angle' } as AttrDef,
  bank: { type: 'float', default: 0, keyable: true, unit: 'angle' } as AttrDef,
  heelTwist: { type: 'float', default: 0, keyable: true, unit: 'angle', mirror: 'negate' } as AttrDef,
  toeTwist: { type: 'float', default: 0, keyable: true, unit: 'angle', mirror: 'negate' } as AttrDef,
};

/** Foot pivots of the fixture legs (§4.3 FootRollParams; the side is set per leg). */
export const FOOT: FootRollParams = {
  side: 1,
  ground: [0, 0, 0],
  yaw: 0,
  heelBack: 0.05,
  ballFront: 0.1,
  toeFront: 0.06,
  innerWidth: 0.04,
  outerWidth: 0.04,
  breakAngle: Math.PI / 6,
};

const AXES_ON = [true, true, true] as const;
const AXES_OFF = [false, false, false] as const;

function ikControl(
  template: ControlRecord,
  key: string,
  name: string,
  side: 'L' | 'R',
  attrs: ControlRecord['attrs'],
  shape: 'cube' | 'diamond',
  keyableR: boolean,
): ControlRecord {
  const mirrorKey = key.endsWith('.L') ? `${key.slice(0, -2)}.R` : `${key.slice(0, -2)}.L`;
  return {
    ...template,
    id: cid(key),
    key,
    name,
    side,
    group: 'body',
    parent: cid('root'),
    order: key.startsWith('pole') ? `b${key}` : `b${key}`,
    rotateOrder: keyableR ? 'zxy' : 'xyz',
    keyable: { t: AXES_ON, r: keyableR ? AXES_ON : AXES_OFF, s: AXES_OFF },
    locked: { t: AXES_OFF, r: AXES_OFF, s: AXES_OFF },
    drives: null,
    mirror: cid(mirrorKey),
    attrs,
    shape: { ...template.shape, kind: shape, custom: null },
    hiddenByDefault: false,
    deleted: null,
  };
}

/** The four limbs: [limb, side, fk upper/mid/end/toes keys, IK control key, pole key, name stem]. */
const LIMBS: readonly (readonly [LimbId, 'L' | 'R', readonly string[], string, string, string, string])[] = [
  [
    'leg.L',
    'L',
    ['fk.upperLeg.L', 'fk.lowerLeg.L', 'fk.foot.L', 'fk.toes.L'],
    'ik.leg.L',
    'pole.leg.L',
    'L Leg IK',
    'L Knee Pole',
  ],
  [
    'leg.R',
    'R',
    ['fk.upperLeg.R', 'fk.lowerLeg.R', 'fk.foot.R', 'fk.toes.R'],
    'ik.leg.R',
    'pole.leg.R',
    'R Leg IK',
    'R Knee Pole',
  ],
  ['arm.L', 'L', ['fk.upperArm.L', 'fk.lowerArm.L', 'fk.hand.L'], 'ik.arm.L', 'pole.arm.L', 'L Arm IK', 'L Elbow Pole'],
  ['arm.R', 'R', ['fk.upperArm.R', 'fk.lowerArm.R', 'fk.hand.R'], 'ik.arm.R', 'pole.arm.R', 'R Arm IK', 'R Elbow Pole'],
];

/**
 * The wave document plus IK controls, poles and `ik2` solvers for the given limbs (default: all four), with
 * `ikFk` defaults by limb (legs 1, arms 0) unless `ikFkDefault` is given.
 */
export function ikWaveDoc(opts?: { readonly limbs?: readonly LimbId[]; readonly ikFkDefault?: number }): DocSnapshot {
  const doc = waveDoc() as unknown as { tables: Record<string, Record<string, unknown>> } & DocSnapshot;
  const controls = doc.tables['controls'] as Record<string, ControlRecord>;
  const solvers = doc.tables['solvers'] as Record<string, SolverRecord>;
  const template = controls[cid('fk.hand.L')] as ControlRecord;
  for (const [limb, side, fk, ik, pole, ikName, poleName] of LIMBS) {
    if (opts?.limbs !== undefined && !opts.limbs.includes(limb)) continue;
    const leg = limb.startsWith('leg');
    const ikFk = opts?.ikFkDefault ?? (leg ? 1 : 0);
    const attrs: Record<string, AttrDef> = { ikFk: ATTR.ikFk(ikFk), soft: ATTR.soft, twist: ATTR.twist };
    if (leg)
      Object.assign(attrs, { roll: ATTR.roll, bank: ATTR.bank, heelTwist: ATTR.heelTwist, toeTwist: ATTR.toeTwist });
    controls[cid(ik)] = ikControl(template, ik, ikName, side, attrs, 'cube', true);
    controls[cid(pole)] = ikControl(template, pole, poleName, side, {}, 'diamond', false);
    const params: Ik2Params = {
      v: 1,
      limb,
      bones: { upper: { humanoid: 'hips' }, mid: { humanoid: 'hips' }, end: { humanoid: 'hips' }, toes: null },
      fk: {
        upper: cid(fk[0] as string),
        mid: cid(fk[1] as string),
        end: cid(fk[2] as string),
        toes: fk[3] === undefined ? null : cid(fk[3]),
      },
      ikControl: cid(ik),
      pole: cid(pole),
      hinge: [1, 0, 0],
      foot: leg ? { ...FOOT, side: side === 'L' ? 1 : -1 } : null,
    };
    const id = solverId(RIG, `ik2.${limb}`);
    solvers[id] = {
      id,
      rig: RIG,
      type: 'ik2',
      params: params as unknown as Record<string, unknown>,
      enabled: true,
      deleted: null,
    };
  }
  return doc;
}

/** LimbDescs of a rig definition's enabled `ik2` solvers (what A1's compiler builds; no rest data). */
export function fakeLimbs(def: RigDefinition): readonly LimbDesc[] {
  const limbs: LimbDesc[] = [];
  for (const solver of [...def.solvers].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (solver.type !== 'ik2' || !solver.enabled || solver.deleted !== null) continue;
    const params = solver.params as unknown as Ik2Params;
    limbs.push({
      id: params.limb,
      solver: solver.id,
      params,
      nodes: { upper: -1, mid: -1, end: -1, toes: -1 },
      attrSlots: { ikFk: -1, soft: -1, twist: -1, roll: -1, bank: -1, heelTwist: -1, toeTwist: -1 },
      lengths: { upper: 0.4, lower: 0.4, restReach: 0.8 },
      fkControls: [params.fk.upper, params.fk.mid, params.fk.end],
      ikControls: [params.ikControl, params.pole],
    });
  }
  return limbs;
}

/** The fake app over `ikWaveDoc` whose programs list the limbs; built-in operators registered. */
export function ikApp(opts?: { readonly snapshot?: DocSnapshot; readonly services?: FakeServices }): {
  readonly app: EditorApp;
  readonly services: FakeServices;
} {
  const services = opts?.services ?? createFakeServices();
  const store = createNaiveStore();
  store.load(opts?.snapshot ?? ikWaveDoc());
  const base = naiveKernelDeps(humanoidSkeleton());
  const app = createKernelApp(
    { services, store, platform: 'other', builtins: false, prefDefaults: { firstRunDone: true } },
    {
      ...base,
      rig: {
        ...base.rig,
        compileRig: (def, skeleton): RigProgram => ({ ...base.rig.compileRig(def, skeleton), limbs: fakeLimbs(def) }),
      },
    },
  );
  app.contribute({ kind: 'keymap', bindings: MAYA_KEYMAP });
  registerBuiltinOperators(app);
  return { app, services };
}
