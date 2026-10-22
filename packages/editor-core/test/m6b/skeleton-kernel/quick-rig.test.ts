// Quick Rig v2 operators (M6B-SPEC §0.4.2; C2): Create Skeleton creates the character (through `char.fromModel`)
// and its template skeleton in one undo step with the joints of the last preview bit for bit and the workspace in
// Skeleton mode; a side-view elbow depth survives; the start checks refuse an off-centre or −Z-facing Cube Lad until
// Center and Ground / Rotate to Face +Z (one step each) fix it; a re-run refits the joints in place (same ids, one step
// "Refit Skeleton", one character) and asks for the rebind confirm when a mesh is bound; Skeleton Template places the
// bounds-scaled template, or the CR-2 pre-fit on the generated body.
import type { JointId, MeshId, SkeletonId } from '@ekza-studio/doc';
import { humanoidBodyRig } from '@ekza-studio/mesh-core';
import { DEFAULT_FLEXION, type QuickRigMarkers } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { quickRigFit, quickRigStartInfo } from '../../../src/operators/builtin/rig/quickRig';
import { charactersOf, cubeLadTruth, ladMeshes, rigTestApp, truthMarkers } from './support';

const commitArgs = (meshes: readonly MeshId[], markers: QuickRigMarkers = truthMarkers()) => ({
  preset: 'standard33' as const,
  markers,
  meshes,
  flexion: DEFAULT_FLEXION,
});

describe('skel.quickRig.commit (Create Skeleton)', () => {
  it('one step: the character, 34 template joints equal to the last preview bit for bit, a control rig, Skeleton mode', async () => {
    const t = await rigTestApp();
    const args = commitArgs([t.lad]);
    const preview = quickRigFit(t.app, t.app.store, args).joints;
    const before = t.app.history.peekUndo()?.id ?? null;
    const result = await t.app.runUntyped('skel.quickRig.commit', args);
    expect(result.status).toBe('finished');
    const { character, skeleton } = (result as { value: { character: string; skeleton: SkeletonId } }).value;
    expect(t.app.history.peekUndo()?.label).toBe('Create Skeleton');
    expect(charactersOf(t.app).map((c) => c.id)).toEqual([character]);
    const joints = t.app.store.query.jointsOfSkeleton(skeleton);
    expect(joints).toHaveLength(34);
    expect(joints.find((j) => j.key === 'root')).toMatchObject({ role: 'helper', id: `${skeleton}:root` });
    const byKey = new Map(joints.map((j) => [j.key, j]));
    expect(preview.map((j) => [j.key, j.position])).toEqual(
      preview.map((j) => [j.key, byKey.get(j.key)?.restPosition]),
    );
    expect(t.app.store.get('skeletons', skeleton)?.preset).toBe('standard33');
    const rig = t.app.store.query.rigOfCharacter(character as never);
    const controls = t.app.store.query.controlsOfRig(rig?.id as never).map((c) => c.key);
    expect(controls).toContain('fk.hips');
    expect(controls).toContain('ik.leg.L');
    expect(controls.some((key) => key.startsWith('ik.arm.'))).toBe(false);
    expect(t.app.session.getState().rig).toMatchObject({ mode: 'skeleton', character, quickRig: null });
    // Every humanoid joint within 0.03 H of the Cube Lad truth (§0.7 step 4).
    const truth = cubeLadTruth();
    const off = joints
      .filter((j) => j.humanBone !== null && truth.joints[j.key] !== undefined)
      .map(
        (j) =>
          [
            j.key,
            Math.hypot(
              ...[0, 1, 2].map((k) => (j.restPosition[k] as number) - (truth.joints[j.key]?.position[k] as number)),
            ) / truth.height,
          ] as const,
      )
      .filter(([, e]) => e > 0.03);
    expect(off).toEqual([]);
    // One step: undo restores the scene mesh and removes the character.
    t.app.history.undo();
    expect(t.app.history.peekUndo()?.id ?? null).toBe(before);
    expect(charactersOf(t.app)).toEqual([]);
    expect(t.app.store.get('meshes', t.lad)).toBeDefined();
  });

  it('undo past Create Skeleton in Rig & Skin: Skeleton mode falls back to Object (no character left)', async () => {
    const t = await rigTestApp();
    expect((await t.app.runUntyped('workspace.set', { workspace: 'rig' })).status).toBe('finished');
    expect((await t.app.runUntyped('skel.quickRig.commit', commitArgs([t.lad]))).status).toBe('finished');
    expect(t.app.session.getState().rig.mode).toBe('skeleton');
    expect((await t.app.runUntyped('edit.undo')).status).toBe('finished');
    expect(charactersOf(t.app)).toEqual([]);
    expect(t.app.session.getState().rig).toMatchObject({ mode: 'object', character: null });
    // Redo brings the character back; the mode stays Object until the user picks one (U state).
    expect((await t.app.runUntyped('edit.redo')).status).toBe('finished');
    expect(charactersOf(t.app)).toHaveLength(1);
  });

  it('a side-view elbow depth (bend ≥ θ) survives Create Skeleton bit-equal; the left elbow mirrors it', async () => {
    const t = await rigTestApp();
    const elbow = [-0.48, 1.31, -0.02] as const;
    const result = await t.app.runUntyped('skel.quickRig.commit', commitArgs([t.lad], { ...truthMarkers(), elbow }));
    const skeleton = (result as { value: { skeleton: SkeletonId } }).value.skeleton;
    expect(t.app.store.get('joints', `${skeleton}:rightLowerArm` as JointId)?.restPosition).toEqual(elbow);
    expect(t.app.store.get('joints', `${skeleton}:leftLowerArm` as JointId)?.restPosition).toEqual([0.48, 1.31, -0.02]);
  });

  it('a re-run refits the same joints in place: same ids, one step "Refit Skeleton", one character', async () => {
    const t = await rigTestApp();
    const first = await t.app.runUntyped('skel.quickRig.commit', commitArgs([t.lad]));
    const skeleton = (first as { value: { skeleton: SkeletonId } }).value.skeleton;
    const ids = t.app.store.query
      .jointsOfSkeleton(skeleton)
      .map((j) => j.id)
      .sort();
    const meshes = ladMeshes(t.app);
    const info = quickRigStartInfo(t.app, t.app.store, meshes);
    if (typeof info === 'string') throw new Error(info);
    expect(info.refit).toBe(skeleton);
    expect(info.preset).toBe('standard33');
    expect(info.markers.pelvis).toEqual(truthMarkers().pelvis);
    const knee = [-0.1, 0.46, 0.03] as const;
    const before = t.app.history.peekUndo()?.id ?? null;
    const again = await t.app.runUntyped('skel.quickRig.commit', commitArgs(meshes, { ...info.markers, knee }));
    expect(again.status).toBe('finished');
    expect(t.app.history.peekUndo()?.label).toBe('Refit Skeleton');
    expect(
      t.app.store.query
        .jointsOfSkeleton(skeleton)
        .map((j) => j.id)
        .sort(),
    ).toEqual(ids);
    expect(t.app.store.get('joints', `${skeleton}:rightLowerLeg` as JointId)?.restPosition).toEqual(knee);
    expect(charactersOf(t.app)).toHaveLength(1);
    t.app.history.undo();
    expect(t.app.history.peekUndo()?.id ?? null).toBe(before);
    expect(t.app.store.get('joints', `${skeleton}:rightLowerLeg` as JointId)?.restPosition).not.toEqual(knee);
    t.app.history.redo();
    // Changing the template of an existing skeleton is refused.
    const other = await t.app.runUntyped('skel.quickRig.commit', {
      ...commitArgs(meshes, info.markers),
      preset: 'full52',
    });
    expect(other).toMatchObject({ status: 'failed', error: { code: 'op-refused' } });
  });

  it('a no-op re-run (the seeded markers, nothing moved) keeps every joint bit for bit; bound, it still asks first', async () => {
    const t = await rigTestApp();
    const first = await t.app.runUntyped('skel.quickRig.commit', commitArgs([t.lad]));
    const skeleton = (first as { value: { skeleton: SkeletonId } }).value.skeleton;
    const meshes = ladMeshes(t.app);
    const joints = t.app.store.query.jointsOfSkeleton(skeleton);
    const info = quickRigStartInfo(t.app, t.app.store, meshes);
    if (typeof info === 'string') throw new Error(info);
    // The preview of the seeded markers is the skeleton as it is (fingers and bent hinges included).
    const preview = quickRigFit(t.app, t.app.store, commitArgs(meshes, info.markers)).joints;
    const byKey = new Map(joints.map((j) => [j.key, j]));
    expect(preview.map((j) => [j.key, j.position, j.tail])).toEqual(
      preview.map((j) => [j.key, byKey.get(j.key)?.restPosition, byKey.get(j.key)?.tail]),
    );
    t.app.store.transact({ label: 'bind (test)' }, (tx) => {
      for (const id of meshes) tx.patch('meshes', id, { skin: { skeleton, bind: {} } });
    });
    const again = await t.app.runUntyped('skel.quickRig.commit', commitArgs(meshes, info.markers));
    expect(again).toMatchObject({ status: 'failed', error: { code: 'confirm-required' } });
    t.app.store.transact({ label: 'unbind (test)' }, (tx) => {
      for (const id of meshes) tx.patch('meshes', id, { skin: null });
    });
    expect((await t.app.runUntyped('skel.quickRig.commit', commitArgs(meshes, info.markers))).status).toBe('finished');
    expect(t.app.store.query.jointsOfSkeleton(skeleton)).toEqual(joints);
  });

  it('a re-run on a bound character asks for the rebind confirm first', async () => {
    const t = await rigTestApp();
    const first = await t.app.runUntyped('skel.quickRig.commit', commitArgs([t.lad]));
    const skeleton = (first as { value: { skeleton: SkeletonId } }).value.skeleton;
    const meshes = ladMeshes(t.app);
    t.app.store.transact({ label: 'bind (test)' }, (tx) => {
      for (const id of meshes) tx.patch('meshes', id, { skin: { skeleton, bind: {} } });
    });
    const knee = [-0.1, 0.46, 0.03] as const;
    const result = await t.app.runUntyped('skel.quickRig.commit', commitArgs(meshes, { ...truthMarkers(), knee }));
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'confirm-required', message: 'Rebind replaces painted weights' },
    });
  });
});

describe('start checks and their fixes (§0.4.2)', () => {
  it('an off-centre Cube Lad is refused until Center and Ground (one undo step) centres and grounds it', async () => {
    const t = await rigTestApp({ placement: { t: [0.1, 0.05, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } });
    const info = quickRigStartInfo(t.app, t.app.store, [t.lad]);
    expect(typeof info !== 'string' && info.checks).toEqual({ centred: false, grounded: false, facing: true });
    const refused = await t.app.runUntyped('skel.quickRig.commit', commitArgs([t.lad]));
    expect(refused).toMatchObject({ status: 'failed', error: { code: 'op-refused' } });
    const before = t.app.history.peekUndo()?.id ?? null;
    expect((await t.app.runUntyped('skel.quickRig.center', { meshes: [t.lad] })).status).toBe('finished');
    expect(t.app.history.peekUndo()?.label).toBe('Center and Ground');
    const placement = t.app.store.get('meshes', t.lad)?.placement;
    expect(placement?.t[0]).toBeCloseTo(0, 12);
    expect(placement?.t[1]).toBeCloseTo(0, 12);
    const fixed = quickRigStartInfo(t.app, t.app.store, [t.lad]);
    expect(typeof fixed !== 'string' && fixed.checks).toEqual({ centred: true, grounded: true, facing: true });
    expect(typeof fixed !== 'string' && fixed.guess?.failed).toBeNull();
    expect((await t.app.runUntyped('skel.quickRig.commit', commitArgs([t.lad]))).status).toBe('finished');
    t.app.history.undo();
    t.app.history.undo();
    expect(t.app.history.peekUndo()?.id ?? null).toBe(before);
  });

  it('a −Z-facing Cube Lad: Rotate to Face +Z turns it 180° about Y around its centre', async () => {
    const t = await rigTestApp({ placement: { t: [0, 0, 0], q: [0, 1, 0, 0], s: [1, 1, 1] } });
    const info = quickRigStartInfo(t.app, t.app.store, [t.lad]);
    expect(typeof info !== 'string' && info.checks).toEqual({ centred: true, grounded: true, facing: false });
    expect((await t.app.runUntyped('skel.quickRig.faceForward', { meshes: [t.lad] })).status).toBe('finished');
    expect(t.app.history.peekUndo()?.label).toBe('Rotate to Face +Z');
    const fixed = quickRigStartInfo(t.app, t.app.store, [t.lad]);
    expect(typeof fixed !== 'string' && fixed.checks).toEqual({ centred: true, grounded: true, facing: true });
    t.app.history.undo();
    const back = quickRigStartInfo(t.app, t.app.store, [t.lad]);
    expect(typeof back !== 'string' && back.checks.facing).toBe(false);
  });

  it('a model facing ±X (turned 90° about Y): Rotate to Face +Z turns it the quarter turn back; Center; then every check passes', async () => {
    for (const sign of [1, -1]) {
      const h = Math.SQRT1_2;
      const t = await rigTestApp({ placement: { t: [0, 0, 0], q: [0, sign * h, 0, h], s: [1, 1, 1] } });
      const info = quickRigStartInfo(t.app, t.app.store, [t.lad]);
      expect(typeof info !== 'string' && info.checks.facing).toBe(false);
      expect((await t.app.runUntyped('skel.quickRig.faceForward', { meshes: [t.lad] })).status).toBe('finished');
      const turned = quickRigStartInfo(t.app, t.app.store, [t.lad]);
      expect(typeof turned !== 'string' && turned.checks.facing).toBe(true);
      // The turn is about the bounds' centre, so the feet's depth offset may leave it off the centre line: Center.
      expect((await t.app.runUntyped('skel.quickRig.center', { meshes: [t.lad] })).status).toBe('finished');
      const fixed = quickRigStartInfo(t.app, t.app.store, [t.lad]);
      expect(typeof fixed !== 'string' && fixed.checks).toEqual({ centred: true, grounded: true, facing: true });
      // The placement's rotation is the identity again (up to rounding of the quarter turns).
      const q = t.app.store.get('meshes', t.lad)?.placement.q as readonly number[];
      expect(Math.abs(Math.abs(q[3] as number) - 1)).toBeLessThan(1e-12);
    }
  });

  it('the guess of the start info places the Cube Lad markers within 0.05 H, chin included', async () => {
    const t = await rigTestApp();
    const info = quickRigStartInfo(t.app, t.app.store, [t.lad]);
    if (typeof info === 'string') throw new Error(info);
    const truth = truthMarkers();
    const H = cubeLadTruth().height;
    const off = Object.entries(info.markers)
      .map(
        ([name, p]) =>
          [
            name,
            Math.hypot(
              ...[0, 1, 2].map(
                (k) => (p[k] as number) - ((truth as Record<string, readonly number[]>)[name]?.[k] as number),
              ),
            ) / H,
          ] as const,
      )
      .filter(([, e]) => e > 0.05);
    expect(off).toEqual([]);
    expect(Object.keys(info.markers)).toHaveLength(9);
  });
});

describe('skel.template.create', () => {
  it('bounds-scaled Standard 33 on the Cube Lad: one step, the character, the template on the bounds', async () => {
    const t = await rigTestApp();
    const result = await t.app.runUntyped('skel.template.create', { preset: 'standard33', objects: [t.lad] });
    expect(result.status).toBe('finished');
    const { skeleton } = (result as { value: { skeleton: SkeletonId } }).value;
    expect(t.app.history.peekUndo()?.label).toBe('Skeleton Template');
    const hips = t.app.store.get('joints', `${skeleton}:hips` as JointId);
    expect(hips?.restPosition[1]).toBeCloseTo(0.5 * 1.7, 6);
    const again = await t.app.runUntyped('skel.template.create', { preset: 'standard33', objects: ladMeshes(t.app) });
    expect(again).toMatchObject({ status: 'cancelled' });
  });

  it('CR-2 pre-fit on the generated body: the generator’s joint positions', async () => {
    const t = await rigTestApp();
    const created = await t.app.runUntyped('mesh.create.template', { template: 'humanoidBody' });
    expect(created.status).toBe('finished');
    const root = (created as { value: { root: string } }).value.root;
    const result = await t.app.runUntyped('skel.template.create', { preset: 'standard33', objects: [root] });
    expect(result.status).toBe('finished');
    const { skeleton } = (result as { value: { skeleton: SkeletonId } }).value;
    const rig = humanoidBodyRig({ height: 1.6 });
    for (const bone of ['hips', 'neck', 'leftHand', 'rightFoot', 'leftShoulder'] as const) {
      const joint = t.app.store.get('joints', `${skeleton}:${bone}` as JointId);
      const expected = rig[bone] as readonly number[];
      expect([
        bone,
        ...[0, 1, 2].map((k) => Math.abs((joint?.restPosition[k] as number) - (expected[k] as number)) < 1e-6),
      ]).toEqual([bone, true, true, true]);
    }
  });
});

describe('P-C6: Quick Rig and Skeleton Template never key', () => {
  it('center, faceForward, commit (new and refit) and template.create leave the curves and keys tables unchanged', async () => {
    const t = await rigTestApp({ placement: { t: [0.1, 0, 0], q: [0, 1, 0, 0], s: [1, 1, 1] } });
    const hash = () => JSON.stringify([t.app.store.list('curves'), t.app.store.list('keys')]);
    const before = hash();
    expect((await t.app.runUntyped('skel.quickRig.center', { meshes: [t.lad] })).status).toBe('finished');
    expect((await t.app.runUntyped('skel.quickRig.faceForward', { meshes: [t.lad] })).status).toBe('finished');
    expect((await t.app.runUntyped('skel.quickRig.commit', commitArgs([t.lad]))).status).toBe('finished');
    expect((await t.app.runUntyped('skel.quickRig.commit', commitArgs(ladMeshes(t.app)))).status).toBe('finished');
    expect(hash()).toBe(before);
    const u = await rigTestApp();
    const hashU = JSON.stringify([u.app.store.list('curves'), u.app.store.list('keys')]);
    expect((await u.app.runUntyped('skel.template.create', { objects: [u.lad] })).status).toBe('finished');
    expect(JSON.stringify([u.app.store.list('curves'), u.app.store.list('keys')])).toBe(hashU);
  });
});
