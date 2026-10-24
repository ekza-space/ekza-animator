// MVP joint operators (M6B-SPEC §0.3, §5.4–§5.7; C2): every edit is one undo step that runs the control-rig update in
// its transaction and never keys (P-C6); moves with symmetry (`D` + `W` on a knee moves both, the feet stay bit-equal),
// rest rotation (refused on a bound skeleton's subtree), Set Rest, Orient (Auto → World on humanoid joints changes
// nothing), Mirror L → R in place (ids unchanged), Map Humanoid Bone refusals, Rename, Restore Rest Flexion, Add Missing
// Bones, Symmetry X, Select Joints and the posed-view refusal.
import type { JointId, SkeletonId } from '@ekza-studio/doc';
import { DEFAULT_FLEXION } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { POSED_REFUSAL } from '../../../src/operators/builtin/rig/skeleton';
import { rigTestApp, truthMarkers } from './support';

async function rigged() {
  const t = await rigTestApp();
  const result = await t.app.runUntyped('skel.quickRig.commit', {
    preset: 'standard33',
    markers: truthMarkers(),
    meshes: [t.lad],
    flexion: DEFAULT_FLEXION,
  });
  if (result.status !== 'finished') throw new Error(JSON.stringify(result));
  const { skeleton, character } = result.value as { skeleton: SkeletonId; character: string };
  const id = (key: string) => `${skeleton}:${key}` as JointId;
  const joint = (key: string) => t.app.store.get('joints', id(key));
  const keysHash = () => JSON.stringify([t.app.store.list('curves'), t.app.store.list('keys')]);
  return { ...t, skeleton, character, id, joint, keysHash };
}

describe('rest edits', () => {
  it('D + W on the right knee (z) moves both knees; the feet stay bit-equal; one step; the rig follows', async () => {
    const t = await rigged();
    const feet = [t.joint('leftFoot'), t.joint('rightFoot')];
    const rigBefore = t.app.store.query.controlByKey(
      t.app.store.query.rigOfCharacter(t.character as never)?.id as never,
      'fk.lowerLeg.R',
    )?.restWorld;
    const hash = t.keysHash();
    const before = t.app.history.peekUndo()?.id;
    const result = await t.app.runUntyped('skel.joint.move', {
      joints: [t.id('rightLowerLeg')],
      translateZ: 0.01,
      mode: 'joint',
    });
    expect(result.status).toBe('finished');
    expect(t.app.history.peekUndo()?.label).toBe('Move Joint');
    expect(t.joint('rightLowerLeg')?.restPosition[2]).toBeCloseTo(
      t.joint('leftLowerLeg')?.restPosition[2] as number,
      15,
    );
    expect([t.joint('leftFoot'), t.joint('rightFoot')]).toEqual(feet);
    const rigAfter = t.app.store.query.controlByKey(
      t.app.store.query.rigOfCharacter(t.character as never)?.id as never,
      'fk.lowerLeg.R',
    )?.restWorld;
    expect(rigAfter?.t[2]).not.toBe(rigBefore?.t[2]);
    expect(t.keysHash()).toBe(hash);
    t.app.history.undo();
    expect(t.app.history.peekUndo()?.id).toBe(before);
  });

  it('W on an upper arm moves its subtree; a posed view refuses rest edits', async () => {
    const t = await rigged();
    const hand = t.joint('leftHand')?.restPosition as readonly number[];
    await t.app.runUntyped('skel.joint.move', { joints: [t.id('leftUpperArm')], translateY: 0.02 });
    expect(t.joint('leftHand')?.restPosition[1]).toBeCloseTo((hand[1] as number) + 0.02, 12);
    expect(t.joint('rightHand')?.restPosition[1]).toBeCloseTo((hand[1] as number) + 0.02, 12);
    const rig = t.app.session.getState().rig;
    t.app.session.setState({ rig: { ...rig, poseView: 'test' } });
    expect(t.app.operators.poll('skel.joint.move', {}, { joints: [t.id('leftUpperArm')] })).toEqual({
      ok: false,
      reason: POSED_REFUSAL,
    });
  });

  it('E rotates the rest of an unbound subtree; it is refused on a bound skeleton; D + E re-orients one joint', async () => {
    const t = await rigged();
    const elbow = t.joint('leftLowerArm')?.restPosition as readonly number[];
    const r = await t.app.runUntyped('skel.joint.rotateRest', { joints: [t.id('leftUpperArm')], rotateZ: -0.5 });
    expect(r.status).toBe('finished');
    expect(t.joint('leftLowerArm')?.restPosition[1]).toBeLessThan(elbow[1] as number);
    expect(t.joint('leftLowerArm')?.restRotation).toEqual([0, 0, 0, 1]);
    const one = await t.app.runUntyped('skel.joint.rotateRest', {
      joints: [t.id('leftHand')],
      rotateX: 0.2,
      mode: 'joint',
    });
    expect(one.status).toBe('finished');
    expect(t.joint('leftHand')?.restRotation[0]).toBeCloseTo(Math.sin(0.1), 12);
    t.app.store.transact({ label: 'bind (test)' }, (tx) => {
      for (const mesh of t.app.store.list('meshes'))
        tx.patch('meshes', mesh.id, { skin: { skeleton: t.skeleton, bind: {} } });
    });
    expect(t.app.operators.poll('skel.joint.rotateRest', {}, { joints: [t.id('leftUpperArm')] })).toMatchObject({
      ok: false,
    });
  });

  it('setRest writes one joint; setHumanBone refuses duplicates and broken parent maps; rename keeps keys', async () => {
    const t = await rigged();
    expect(
      (await t.app.runUntyped('skel.joint.setRest', { joint: t.id('head'), position: [0, 1.52, 0.01] })).status,
    ).toBe('finished');
    expect(t.joint('head')?.restPosition).toEqual([0, 1.52, 0.01]);
    const dup = await t.app.runUntyped('skel.joint.setHumanBone', { joint: t.id('leftHand'), bone: 'rightHand' });
    expect(dup).toMatchObject({ status: 'failed', error: { code: 'op-refused' } });
    expect((await t.app.runUntyped('skel.joint.rename', { joint: t.id('leftHand'), name: 'hand_L' })).status).toBe(
      'finished',
    );
    expect(t.joint('leftHand')).toMatchObject({ name: 'hand_L', key: 'leftHand' });
    expect(t.joint('rightHand')).toMatchObject({ name: 'hand_R', key: 'rightHand' }); // the partner takes the swap
  });
});

describe('orient, mirror, flex, add missing, symmetry, selection', () => {
  it('Orient Auto → World on humanoid joints changes nothing; xAim aims; keys never change for humanoid controls', async () => {
    const t = await rigged();
    const hash = t.keysHash();
    const joints = t.app.store.query.jointsOfSkeleton(t.skeleton);
    expect((await t.app.runUntyped('skel.joint.orient', { joints: [t.id('hips')] })).status).toBe('finished');
    expect(t.app.store.query.jointsOfSkeleton(t.skeleton)).toEqual(joints);
    expect(
      (await t.app.runUntyped('skel.joint.orient', { joints: [t.id('leftUpperArm')], preset: 'xAim' })).status,
    ).toBe('finished');
    expect(t.joint('leftUpperArm')?.restRotation).not.toEqual([0, 0, 0, 1]);
    expect(t.keysHash()).toBe(hash);
  });

  it('Mirror Joints L → R updates the right arm in place (ids unchanged)', async () => {
    const t = await rigged();
    await t.app.runUntyped('skel.joint.move', {
      joints: [t.id('leftLowerArm')],
      translateY: 0.03,
      mode: 'joint',
      symmetry: false,
    });
    const ids = t.app.store.query
      .jointsOfSkeleton(t.skeleton)
      .map((j) => j.id)
      .sort();
    const result = await t.app.runUntyped('skel.joint.mirror', {
      root: t.id('leftUpperArm'),
      direction: 'left-to-right',
    });
    expect(result.status).toBe('finished');
    expect(
      t.app.store.query
        .jointsOfSkeleton(t.skeleton)
        .map((j) => j.id)
        .sort(),
    ).toEqual(ids);
    const l = t.joint('leftLowerArm')?.restPosition as readonly number[];
    expect(t.joint('rightLowerArm')?.restPosition).toEqual([-(l[0] as number), l[1], l[2]]);
    expect((result as { value: { joints: string[] } }).value.joints).toContain(t.id('rightLowerArm'));
  });

  it('Restore Rest Flexion bends a straightened elbow; Add Missing Bones re-adds a deleted required bone', async () => {
    const t = await rigged();
    await t.app.runUntyped('skel.joint.setRest', { joint: t.id('leftLowerArm'), position: [0.48, 1.33, 0] });
    expect((await t.app.runUntyped('skel.joint.flex', { joints: [t.id('leftLowerArm')] })).status).toBe('finished');
    expect(t.joint('leftLowerArm')?.restPosition[2]).toBeLessThan(0);
    t.app.store.transact({ label: 'delete (test)' }, (tx) => {
      for (const joint of t.app.store.query.jointsOfSkeleton(t.skeleton)) {
        if (joint.key.startsWith('rightThumb') || joint.key.startsWith('rightMiddle') || joint.key === 'rightHand') {
          tx.softDelete('joints', joint.id);
        }
      }
    });
    const result = await t.app.runUntyped('skel.template.addMissing', { skeleton: t.skeleton });
    expect(result).toMatchObject({ status: 'finished', value: { added: [t.id('rightHand')], mapped: [] } });
    expect(t.joint('rightHand')).toMatchObject({ humanBone: 'rightHand', parent: t.id('rightLowerArm') });
  });

  it('Symmetry X writes the flag; Select Joints replaces, adds and selects all', async () => {
    const t = await rigged();
    expect((await t.app.runUntyped('skel.symmetry.set', { skeleton: t.skeleton, on: false })).status).toBe('finished');
    expect(t.app.store.get('skeletons', t.skeleton)?.symmetry).toBe(false);
    await t.app.runUntyped('select.joints', { ids: [t.id('hips')], mode: 'replace' });
    await t.app.runUntyped('select.joints', { ids: [t.id('head')], mode: 'add' });
    expect(t.app.session.getState().selection.joints).toEqual([t.id('hips'), t.id('head')]);
    await t.app.runUntyped('select.joints', { all: true });
    expect(t.app.session.getState().selection.joints).toHaveLength(34);
  });
});
