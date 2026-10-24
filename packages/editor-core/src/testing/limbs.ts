// Limb IK fixtures of the shared test kit (M2A-SPEC §5.2, A2): IK control, pole and `ik2` solver records shaped like
// the rig's `limbIkRecords` output, added to a document with a humanoid FK rig, and a fake app whose rig programs
// list `RigProgram.limbs` built from those records. The naive rig program evaluates no `ik2` op (the rig's math):
// these fixtures test the editor side — visibility, keying, Channel Box rows, key policies, pick-walk, pole lines —
// in Node and in browser-mode panel tests. Browser-safe (no Node APIs).
import {
  type AttrDef,
  type ControlId,
  type ControlRecord,
  controlId,
  type DocSnapshot,
  type RigId,
  type SolverRecord,
  solverId,
} from '@ekza-studio/doc';
import type {
  FootRollParams,
  Ik2Params,
  LimbDesc,
  LimbId,
  RigDefinition,
  RigProgram,
  SkeletonDesc,
} from '@ekza-studio/rig';
import { createKernelApp } from '../app/kernel';
import { DCC_KEYMAP } from '../keymap/dcc';
import type { EditorApp, EditorServices } from '../types';
import { naiveKernelDeps } from './deps';
import { createFakeServices } from './services';
import { createNaiveStore } from './store/naiveStore';

/** The limb attributes of §5.2 (legs all seven, arms the first three). */
function limbAttrs(leg: boolean, ikFk: number): Record<string, AttrDef> {
  const angle = (mirror?: 'negate'): AttrDef => ({
    type: 'float',
    default: 0,
    keyable: true,
    unit: 'angle',
    ...(mirror === undefined ? {} : { mirror }),
  });
  const attrs: Record<string, AttrDef> = {
    ikFk: { type: 'float', default: ikFk, min: 0, max: 1, keyable: true, keyAll: false, stepped: true, label: 'IK/FK' },
    soft: { type: 'float', default: 0, min: 0, max: 0.25, keyable: true, keyAll: false },
    twist: angle('negate'),
  };
  if (leg) {
    attrs['roll'] = angle();
    attrs['bank'] = angle();
    attrs['heelTwist'] = angle('negate');
    attrs['toeTwist'] = angle('negate');
  }
  return attrs;
}

/** Foot pivots of the fixture legs (§4.3 FootRollParams; the side is set per leg). */
export const FIXTURE_FOOT: FootRollParams = {
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

interface LimbTemplate {
  readonly limb: LimbId;
  readonly side: 'L' | 'R';
  readonly fk: readonly string[];
  readonly bones: readonly string[];
  readonly ik: string;
  readonly pole: string;
  readonly ikName: string;
  readonly poleName: string;
}

const LIMBS: readonly LimbTemplate[] = [
  {
    limb: 'leg.L',
    side: 'L',
    fk: ['fk.upperLeg.L', 'fk.lowerLeg.L', 'fk.foot.L', 'fk.toes.L'],
    bones: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'],
    ik: 'ik.leg.L',
    pole: 'pole.leg.L',
    ikName: 'L Leg IK',
    poleName: 'L Knee Pole',
  },
  {
    limb: 'leg.R',
    side: 'R',
    fk: ['fk.upperLeg.R', 'fk.lowerLeg.R', 'fk.foot.R', 'fk.toes.R'],
    bones: ['rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'],
    ik: 'ik.leg.R',
    pole: 'pole.leg.R',
    ikName: 'R Leg IK',
    poleName: 'R Knee Pole',
  },
  {
    limb: 'arm.L',
    side: 'L',
    fk: ['fk.upperArm.L', 'fk.lowerArm.L', 'fk.hand.L'],
    bones: ['leftUpperArm', 'leftLowerArm', 'leftHand'],
    ik: 'ik.arm.L',
    pole: 'pole.arm.L',
    ikName: 'L Arm IK',
    poleName: 'L Elbow Pole',
  },
  {
    limb: 'arm.R',
    side: 'R',
    fk: ['fk.upperArm.R', 'fk.lowerArm.R', 'fk.hand.R'],
    bones: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
    ik: 'ik.arm.R',
    pole: 'pole.arm.R',
    ikName: 'R Arm IK',
    poleName: 'R Elbow Pole',
  },
];

const ON = [true, true, true] as const;
const OFF = [false, false, false] as const;

/**
 * `snapshot` (a document with one humanoid FK rig) plus IK controls, poles and `ik2` solvers for `limbs` (default:
 * all four whose FK chain exists), `ikFk` defaults by limb (legs 1, arms 0) unless `ikFkDefault` is given. The IK
 * controls are cubes under `root`, the poles diamonds, with the §5.2 attributes and fixture foot pivots on legs.
 */
export function withLimbIkRecords(
  snapshot: DocSnapshot,
  opts?: { readonly limbs?: readonly LimbId[]; readonly ikFkDefault?: number },
): DocSnapshot {
  const doc = structuredClone(snapshot) as DocSnapshot & {
    tables: {
      controls: Record<string, ControlRecord>;
      solvers: Record<string, SolverRecord>;
      rigs: Record<string, { id: RigId }>;
    };
  };
  const rig = Object.values(doc.tables.rigs)[0]?.id;
  if (rig === undefined) return doc;
  const controls = doc.tables.controls;
  const byKey = new Map(Object.values(controls).map((control) => [control.key, control]));
  const root = byKey.get('root');
  for (const template of LIMBS) {
    if (opts?.limbs !== undefined && !opts.limbs.includes(template.limb)) continue;
    const fk = template.fk.map((key) => byKey.get(key));
    const [upper, mid, end] = fk;
    if (upper === undefined || mid === undefined || end === undefined || root === undefined) continue;
    const leg = template.limb.startsWith('leg');
    const ikFk = opts?.ikFkDefault ?? (leg ? 1 : 0);
    const other = template.side === 'L' ? 'R' : 'L';
    const base = (key: string, name: string, keyableR: boolean): ControlRecord => ({
      ...end,
      id: controlId(rig, key),
      key,
      name,
      side: template.side,
      group: 'body',
      parent: root.id,
      order: `b${key}`,
      restWorld: end.restWorld,
      rotateOrder: keyableR ? 'zxy' : 'xyz',
      keyable: { t: ON, r: keyableR ? ON : OFF, s: OFF },
      locked: { t: OFF, r: OFF, s: OFF },
      drives: null,
      mirror: controlId(rig, `${key.slice(0, -1)}${other}`),
      attrs: {},
      shape: { ...end.shape, kind: keyableR ? 'cube' : 'diamond', custom: null },
      hiddenByDefault: false,
      deleted: null,
    });
    controls[controlId(rig, template.ik)] = {
      ...base(template.ik, template.ikName, true),
      attrs: limbAttrs(leg, ikFk),
    };
    controls[controlId(rig, template.pole)] = base(template.pole, template.poleName, false);
    const toes = fk[3];
    const params: Ik2Params = {
      v: 1,
      limb: template.limb,
      bones: {
        upper: { humanoid: template.bones[0] as never },
        mid: { humanoid: template.bones[1] as never },
        end: { humanoid: template.bones[2] as never },
        toes: template.bones[3] === undefined ? null : { humanoid: template.bones[3] as never },
      },
      fk: { upper: upper.id, mid: mid.id, end: end.id, toes: toes === undefined ? null : toes.id },
      ikControl: controlId(rig, template.ik),
      pole: controlId(rig, template.pole),
      hinge: [1, 0, 0],
      foot: leg ? { ...FIXTURE_FOOT, side: template.side === 'L' ? 1 : -1 } : null,
    };
    const id = solverId(rig, `ik2.${template.limb}`);
    doc.tables.solvers[id] = {
      id,
      rig,
      type: 'ik2',
      params: params as unknown as Readonly<Record<string, unknown>>,
      enabled: true,
      deleted: null,
    };
  }
  return doc;
}

/**
 * LimbDescs of a rig definition's enabled `ik2` solvers, in solver-id order (what the rig's compiler builds; chain
 * nodes resolved through the skeleton's humanoid map, no rest data).
 */
export function fixtureLimbs(def: RigDefinition, skeleton: SkeletonDesc): readonly LimbDesc[] {
  const node = (ref: unknown): number => {
    const name = (ref as { readonly humanoid?: string } | null)?.humanoid;
    return name === undefined ? -1 : ((skeleton.humanoid as Record<string, number> | null)?.[name] ?? -1);
  };
  const limbs: LimbDesc[] = [];
  for (const solver of [...def.solvers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (solver.type !== 'ik2' || !solver.enabled || solver.deleted !== null) continue;
    const params = solver.params as unknown as Ik2Params;
    limbs.push({
      id: params.limb,
      solver: solver.id,
      params,
      nodes: {
        upper: node(params.bones.upper),
        mid: node(params.bones.mid),
        end: node(params.bones.end),
        toes: node(params.bones.toes),
      },
      attrSlots: { ikFk: -1, soft: -1, twist: -1, roll: -1, bank: -1, heelTwist: -1, toeTwist: -1 },
      lengths: { upper: 0.4, lower: 0.4, restReach: 0.8 },
      fkControls: [params.fk.upper, params.fk.mid, params.fk.end],
      ikControls: [params.ikControl, params.pole],
    });
  }
  return limbs;
}

/**
 * A fake app (the real kernel over the naive kit, like `createFakeEditorApp`) whose rig programs list the limbs of
 * the document's `ik2` solvers (`fixtureLimbs`). No operators are registered; the `dcc` keymap is contributed.
 */
export function createFakeIkEditorApp(opts: {
  readonly snapshot: DocSnapshot;
  readonly skeleton: SkeletonDesc;
  readonly services?: Partial<EditorServices>;
}): EditorApp {
  const store = createNaiveStore();
  store.load(opts.snapshot);
  const base = naiveKernelDeps(opts.skeleton);
  const app = createKernelApp(
    {
      services: { ...createFakeServices(), ...opts.services },
      store,
      platform: 'other',
      builtins: false,
      prefDefaults: { firstRunDone: true },
    },
    {
      ...base,
      rig: {
        ...base.rig,
        compileRig: (def, skeleton): RigProgram => ({
          ...base.rig.compileRig(def, skeleton),
          limbs: fixtureLimbs(def, skeleton),
        }),
      },
    },
  );
  app.contribute({ kind: 'keymap', bindings: DCC_KEYMAP });
  return app;
}

/** The control id of a template key in a fixture rig. */
export function fixtureControl(rig: RigId, key: string): ControlId {
  return controlId(rig, key);
}
