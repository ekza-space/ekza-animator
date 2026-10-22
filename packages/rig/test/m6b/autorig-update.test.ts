// M6B-SPEC §5.16, §9 C1 (rig): `updateAutoRig` keeps control and solver ids when a knee moves, keeps `edited` shape
// fields, rotate orders, visibility, locks and constraint attributes, soft-deletes the controls of removed bones,
// creates visible `sec.*` controls for a new tail chain, `prop.*` and `sock.*` controls for prop and socket joints,
// warns on a kind change and lists stale stored offsets; P-J6 (renaming joints keeps every control id); the ≤ 5 ms
// budget (report-only).
import { readFileSync } from 'node:fs';
import type { ConstraintRecord, ControlId, HumanBoneName } from '@ekza-studio/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { autoRig, type RigDefinition, type SkeletonDesc, type SkeletonNode, updateAutoRig } from '../../src';
import { ikOf } from '../../src/autorig/update';
import { IDS } from '../helpers';

interface TruthJoint {
  readonly position: readonly [number, number, number];
  readonly parent: string | null;
}
const TRUTH = JSON.parse(
  readFileSync(new URL('../../../../fixtures/models/cube-lad-truth.json', import.meta.url), 'utf8'),
) as { readonly joints: Readonly<Record<string, TruthJoint>> };

interface JointSpec {
  readonly key: string;
  readonly name: string;
  readonly parent: string | null;
  readonly position: readonly [number, number, number];
  readonly role: 'bone' | 'helper' | 'prop';
  readonly human: HumanBoneName | null;
}

/** The Cube Lad's Standard 33 template joints (root helper + 33 humanoid bones). */
function truthSpecs(): JointSpec[] {
  return Object.entries(TRUTH.joints).map(([key, joint]) => ({
    key,
    name: key,
    parent: joint.parent,
    position: joint.position,
    role: key === 'root' ? 'helper' : 'bone',
    human: key === 'root' ? null : (key as HumanBoneName),
  }));
}

/** A model-sourced SkeletonDesc (as skeletonFromDoc builds it: identity rests, jointKeys, props, helpers). */
function modelSkeleton(specs: readonly JointSpec[], humanoid = true): SkeletonDesc {
  const index = new Map(specs.map((spec, i) => [spec.key, i]));
  const nodes: SkeletonNode[] = specs.map((spec, i) => {
    const parent = spec.parent === null ? -1 : (index.get(spec.parent) ?? -1);
    const base: readonly [number, number, number] = parent === -1 ? [0, 0, 0] : (specs[parent] as JointSpec).position;
    return {
      index: i,
      gltfIndex: i,
      name: spec.name,
      parent,
      restLocal: {
        t: [spec.position[0] - base[0], spec.position[1] - base[1], spec.position[2] - base[2]],
        q: [0, 0, 0, 1],
        s: [1, 1, 1],
      },
      hasMatrix: false,
      isJoint: true,
      hasMesh: false,
    };
  });
  const map: Partial<Record<HumanBoneName, number>> = {};
  specs.forEach((spec, i) => {
    if (spec.human !== null) map[spec.human] = i;
  });
  return {
    format: humanoid ? 'vrm1' : 'gltf',
    facing: [0, 0, 0, 1],
    nodes,
    humanoid: humanoid ? map : null,
    springJoints: [],
    nodeConstraints: [],
    constrainedNodes: [],
    boneRadii: nodes.map(() => null),
    height: 1.7,
    heightSource: 'joints',
    fingerprint: 'sha256:test',
    ekzaHeightScale: null,
    warnings: [],
    props: specs.flatMap((spec, i) => (spec.role === 'prop' ? [i] : [])),
    helpers: specs.flatMap((spec, i) => (spec.role === 'helper' ? [i] : [])),
    jointKeys: specs.map((spec) => spec.key),
  };
}

const IK = { ik: { legs: true, arms: false } } as const;
const ids = (def: RigDefinition) => def.controls.map((control) => control.id);
const byKey = (def: RigDefinition, key: string) => def.controls.find((control) => control.key === key);

function moved(specs: readonly JointSpec[], key: string, dz: number): JointSpec[] {
  return specs.map((spec) =>
    spec.key === key ? { ...spec, position: [spec.position[0], spec.position[1], spec.position[2] + dz] } : spec,
  );
}

describe('updateAutoRig (§5.16)', () => {
  const base = truthSpecs();
  const created = updateAutoRig(null, modelSkeleton(base), IDS, IK).rig;

  it('creates a humanoid rig with legs IK; a model rig equals autoRig except visible secondaries', () => {
    expect(created.rig.generator.name).toBe('ekza-autorig-humanoid');
    expect(ikOf(created)).toEqual({ legs: true, arms: false });
    const plain = autoRig(modelSkeleton(base), IDS, IK);
    expect(ids(created)).toEqual(ids(plain));
    expect(created.controls.every((control) => !control.hiddenByDefault)).toBe(true);
  });

  it('keeps every control and solver id when a knee moves; the knee control follows', () => {
    const update = updateAutoRig(created, modelSkeleton(moved(base, 'rightLowerLeg', 0.02)), IDS, IK);
    expect(ids(update.rig)).toEqual(ids(created));
    expect(update.rig.solvers.map((s) => s.id)).toEqual(created.solvers.map((s) => s.id));
    expect(update.softDeleted).toEqual([]);
    expect(update.warnings).toEqual([]);
    const knee = byKey(update.rig, 'fk.lowerLeg.R');
    expect(knee?.restWorld.t[2]).toBeCloseTo((byKey(created, 'fk.lowerLeg.R')?.restWorld.t[2] ?? 0) + 0.02, 12);
  });

  it('keeps rotate orders, visibility, locks, constraint attributes and edited shape fields', () => {
    const arm = byKey(created, 'fk.upperArm.L');
    expect(arm).toBeDefined();
    if (arm === undefined) return;
    const edited = {
      ...arm,
      rotateOrder: 'zyx' as const,
      hiddenByDefault: true,
      locked: { ...arm.locked, s: [true, true, true] as [boolean, boolean, boolean] },
      attrs: { ...arm.attrs, 'parentC.blend': { type: 'float' as const, default: 1, keyable: true } },
      shape: { ...arm.shape, size: 0.5, color: '#ff00ff' as const, edited: ['color', 'size'] as const },
    };
    const current: RigDefinition = {
      ...created,
      controls: created.controls.map((c) => (c.id === arm.id ? edited : c)),
    };
    const update = updateAutoRig(current, modelSkeleton(moved(base, 'leftUpperArm', 0.01)), IDS, IK);
    const after = update.rig.controls.find((c) => c.id === arm.id);
    expect(after).toMatchObject({
      rotateOrder: 'zyx',
      hiddenByDefault: true,
      locked: edited.locked,
      attrs: { 'parentC.blend': { type: 'float', default: 1, keyable: true } },
    });
    expect(after?.shape).toMatchObject({ size: 0.5, color: '#ff00ff', edited: ['size', 'color'] });
    // The generated fields follow the moved joint.
    expect(after?.shape.offset).toEqual(
      byKey(updateAutoRig(null, modelSkeleton(moved(base, 'leftUpperArm', 0.01)), IDS, IK).rig, 'fk.upperArm.L')?.shape
        .offset,
    );
    expect(after?.restWorld.t[2]).toBeCloseTo(0.01 + arm.restWorld.t[2], 12);
  });

  it('soft-deletes the controls of removed bones with a warning', () => {
    const fewer = base.filter((spec) => !spec.key.startsWith('leftMiddle') && !spec.key.startsWith('leftThumb'));
    const update = updateAutoRig(created, modelSkeleton(fewer), IDS, IK);
    expect(update.softDeleted.length).toBe(6);
    expect(update.softDeleted.every((id) => id.includes('.L'))).toBe(true);
    expect(update.warnings).toHaveLength(6);
    expect(update.warnings[0]).toContain('its bone is gone');
  });

  it('creates visible sec.* controls for a new tail chain; existing secondaries keep their visibility', () => {
    const tail: JointSpec[] = [
      { key: 'tail_01', name: 'tail_01', parent: 'hips', position: [0, 0.9, -0.1], role: 'bone', human: null },
      { key: 'tail_02', name: 'tail_02', parent: 'tail_01', position: [0, 0.85, -0.25], role: 'bone', human: null },
    ];
    const withTail = updateAutoRig(created, modelSkeleton([...base, ...tail]), IDS, IK).rig;
    const first = byKey(withTail, 'sec.tail_01');
    const second = byKey(withTail, 'sec.tail_02');
    expect(first).toMatchObject({ hiddenByDefault: false, group: 'secondary', parent: `${IDS.rig}:fk.hips` });
    expect(second).toMatchObject({ hiddenByDefault: false, parent: first?.id });
    // A hidden secondary stays hidden on the next update (rule 4); the new one is visible.
    const hidden: RigDefinition = {
      ...withTail,
      controls: withTail.controls.map((c) => (c.key === 'sec.tail_01' ? { ...c, hiddenByDefault: true } : c)),
    };
    const ear = {
      key: 'ear',
      name: 'ear',
      parent: 'head',
      position: [0.05, 1.6, 0],
      role: 'bone',
      human: null,
    } as const;
    const next = updateAutoRig(hidden, modelSkeleton([...base, ...tail, ear]), IDS, IK).rig;
    expect(byKey(next, 'sec.tail_01')?.hiddenByDefault).toBe(true);
    expect(byKey(next, 'sec.ear')?.hiddenByDefault).toBe(false);
  });

  it('gives prop joints prop.* and socket helpers sock.* controls; the root helper none', () => {
    const extra: JointSpec[] = [
      { key: 'sword', name: 'sword', parent: 'rightHand', position: [-0.8, 1.33, 0], role: 'prop', human: null },
      { key: 'back', name: 'back', parent: 'chest', position: [0, 1.3, -0.12], role: 'helper', human: null },
    ];
    const rig = updateAutoRig(created, modelSkeleton([...base, ...extra]), IDS, IK).rig;
    const prop = byKey(rig, 'prop.sword');
    const socket = byKey(rig, 'sock.back');
    expect(prop).toMatchObject({
      group: 'body',
      parent: `${IDS.rig}:root`,
      drives: { bone: { name: 'sword', parentName: 'rightHand' }, mode: 'translateRotate' },
      keyable: { t: [true, true, true], r: [true, true, true], s: [false, false, false] },
      rotateOrder: 'xyz',
      hiddenByDefault: false,
    });
    expect(prop?.shape).toMatchObject({ kind: 'diamond', size: 0.04 * 1.7 });
    expect(socket).toMatchObject({ parent: `${IDS.rig}:fk.chest`, drives: { mode: 'translateRotate' } });
    expect(socket?.shape).toMatchObject({ kind: 'diamond', size: 0.03 * 1.7 });
    expect(rig.controls.some((c) => c.key === 'sock.root' || c.key === 'sec.sword' || c.key === 'sec.back')).toBe(
      false,
    );
  });

  it('warns once on a kind change and soft-deletes the old controls (their curves stay)', () => {
    const generic = updateAutoRig(created, modelSkeleton(base, false), IDS, IK);
    expect(generic.rig.rig.generator.name).toBe('ekza-autorig-generic');
    expect(generic.softDeleted.length).toBeGreaterThan(30);
    expect(generic.warnings).toEqual([
      `The control rig became generic; curves of ${generic.softDeleted.length} humanoid controls are kept but unused`,
    ]);
    // Generic keys come from the joint keys.
    expect(byKey(generic.rig, 'fk.rightLowerLeg')).toBeDefined();
  });

  it('lists constraints with stored offsets whose driven or target control moved', () => {
    const arm = byKey(created, 'fk.upperArm.L') as NonNullable<ReturnType<typeof byKey>>;
    const hand = byKey(created, 'fk.hand.R') as NonNullable<ReturnType<typeof byKey>>;
    const constraint: ConstraintRecord = {
      id: 'cns_A' as never,
      rig: IDS.rig,
      type: 'parent',
      driven: { control: arm.id },
      targets: {
        t0: {
          target: { kind: 'control', id: hand.id },
          weight: 1,
          offset: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
        },
      },
      maintainOffset: true,
      params: {},
      enabled: true,
      deleted: null,
    };
    const current: RigDefinition = { ...created, constraints: [constraint] };
    const still = updateAutoRig(current, modelSkeleton(moved(base, 'leftFoot', 0.01)), IDS, IK);
    expect(still.staleOffsets).toEqual([]);
    expect(still.rig.constraints).toEqual([constraint]);
    const stale = updateAutoRig(current, modelSkeleton(moved(base, 'rightHand', 0.01)), IDS, IK);
    expect(stale.staleOffsets).toEqual(['cns_A']);
  });

  it('P-J6: renaming any joints keeps every control id (keys come from JointRecord.key)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: base.length, maxLength: base.length }),
        fc.string(),
        (flags, suffix) => {
          const renamed = base.map((spec, i) =>
            flags[i] === true ? { ...spec, name: `${spec.name}${suffix}x` } : spec,
          );
          const rig = updateAutoRig(created, modelSkeleton(renamed), IDS, IK);
          expect(ids(rig.rig)).toEqual(ids(created));
          expect(rig.softDeleted).toEqual([]);
        },
      ),
      { numRuns: 25 },
    );
    // A generic rig of a non-humanoid model skeleton: the tail keeps `fk.tail_01` through a rename.
    const chain: JointSpec[] = [
      { key: 'root', name: 'root', parent: null, position: [0, 0, 0], role: 'helper', human: null },
      { key: 'tail_01', name: 'tail_01', parent: 'root', position: [0, 0.5, 0], role: 'bone', human: null },
      { key: 'tail_02', name: 'tail_02', parent: 'tail_01', position: [0, 1, 0], role: 'bone', human: null },
    ];
    const generic = updateAutoRig(null, modelSkeleton(chain, false), IDS, IK).rig;
    const renamed = updateAutoRig(
      generic,
      modelSkeleton(
        chain.map((s) => ({ ...s, name: `${s.name}_renamed` })),
        false,
      ),
      IDS,
      IK,
    );
    expect(ids(renamed.rig)).toEqual(ids(generic));
    expect(ids(generic)).toContain(`${IDS.rig}:fk.tail_01` as ControlId);
  });

  it('runs a Standard 33 update in a few milliseconds (budget ≤ 5 ms, report-only)', async ({ annotate }) => {
    const skeleton = modelSkeleton(moved(base, 'rightLowerLeg', 0.01));
    updateAutoRig(created, skeleton, IDS, IK);
    const runs = 20;
    const start = performance.now();
    for (let i = 0; i < runs; i++) updateAutoRig(created, skeleton, IDS, IK);
    const ms = (performance.now() - start) / runs;
    await annotate(`rig.autoRig.update, Standard 33 (34 joints): ${ms.toFixed(2)} ms (budget 5 ms, report-only)`);
    expect(ms).toBeLessThan(250);
  });
});
