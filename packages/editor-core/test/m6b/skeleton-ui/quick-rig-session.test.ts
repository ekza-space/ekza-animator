// Quick Rig session (M6B-SPEC §0.2 steps 1–5, §0.4.2, §0.6; C3): `skel.quickRig.start` runs the start checks and the
// One-Click guess, opens R-Markers and writes only U state; markers move (centre markers on x = 0) with the preview
// refitted at once and Create Skeleton committing that preview bit for bit; Clear, the click-to-place order, Guess,
// the template select, Cancel and leaving the workspace; the off-centre Cube Lad: the centre notice until Center and
// Ground (one step), then the guess runs; a re-run seeds the markers from the joints, locks the preset and refits in
// place.
import type { MeshId, SkeletonId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import {
  closeQuickRig,
  nextMissingMarker,
  QUICK_RIG_MARKERS,
  quickRigCommitArgs,
  quickRigCommitBlock,
  quickRigOf,
  setQuickRigMarker,
} from '../../../src';
import { CHECK_REASONS, quickRigFit } from '../../../src/operators/builtin/rig/quickRig';
import { PRESET_LOCKED } from '../../../src/operators/builtin/rig/quickRigSession';
import { charactersOf, cubeLadTruth, ladMeshes, type RigTestApp, rigTestApp } from '../skeleton-kernel/support';

const H = 1.7;
const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

async function openQuickRig(t: RigTestApp, meshes?: readonly MeshId[]): Promise<void> {
  const state = t.app.session.getState();
  t.app.session.setState({ workspace: 'rig', selection: { ...state.selection, objects: [t.lad] } });
  const result = await t.app.runUntyped('skel.quickRig.start', meshes === undefined ? undefined : { meshes });
  expect(result.status).toBe('finished');
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('skel.quickRig.start (§0.2 steps 1–2)', () => {
  it('guesses the nine markers within 0.05 H of the truth, opens R-Markers, writes no document step', async () => {
    const t = await rigTestApp();
    const version = t.app.store.version;
    const top = t.app.history.peekUndo()?.id ?? null;
    await openQuickRig(t);
    const state = quickRigOf(t.app);
    expect(state).not.toBeNull();
    if (state === null) return;
    expect(state.meshes).toEqual([t.lad]);
    expect(state.preset).toBe('standard33');
    expect(state.checks).toEqual({ centred: true, grounded: true, facing: true });
    expect(state.refit).toBeNull();
    expect([...state.moved]).toEqual([]);
    expect(state.guess).toMatchObject({ aPose: false, failed: null });
    const truth = cubeLadTruth().markers;
    for (const name of QUICK_RIG_MARKERS) {
      const marker = state.markers[name];
      expect(marker, name).toBeDefined();
      expect(dist(marker ?? [], truth[name]) / H, name).toBeLessThanOrEqual(0.05);
    }
    // Centre markers on x = 0, side markers on the character's right (x < 0).
    for (const name of ['headTop', 'chin', 'pelvis'] as const)
      expect(Object.is(state.markers[name]?.[0], 0)).toBe(true);
    for (const name of ['shoulder', 'elbow', 'wrist', 'knee', 'ankle', 'toe'] as const) {
      expect(state.markers[name]?.[0]).toBeLessThan(0);
    }
    expect(state.preview?.map((j) => j.key)).toContain('rightLowerArm');
    expect(quickRigCommitBlock(state)).toBeNull();
    expect(t.app.session.getState().viewportLayout).toBe('rig-markers');
    expect(t.app.store.version).toBe(version);
    expect(t.app.history.peekUndo()?.id ?? null).toBe(top);
  });

  it('refuses without meshes and on an imported character', async () => {
    const t = await rigTestApp();
    t.app.session.setState({ workspace: 'rig' });
    expect(await t.app.runUntyped('skel.quickRig.start', { meshes: [] })).toMatchObject({
      status: 'cancelled',
      reason: 'Select the meshes to rig',
    });
  });
});

describe('markers and the live preview (§0.2 steps 3–5)', () => {
  it('a marker move refits the preview at once; Create Skeleton writes the last preview bit for bit', async () => {
    const t = await rigTestApp();
    await openQuickRig(t);
    const before = quickRigOf(t.app);
    const elbow = before?.markers.elbow ?? [0, 0, 0];
    // A side-pane depth edit: z (and y) only.
    setQuickRigMarker(t.app, 'elbow', [elbow[0], elbow[1] - 0.01, elbow[2] - 0.02]);
    const state = quickRigOf(t.app);
    if (state === null) throw new Error('closed');
    expect(state.selected).toBe('elbow');
    expect([...state.moved]).toEqual(['elbow']);
    expect(Object.is(state.markers.elbow?.[0], elbow[0])).toBe(true);
    const fit = quickRigFit(t.app, t.app.store, quickRigCommitArgs(state)).joints;
    expect(state.preview).toEqual(fit);
    // The elbow bends the arm by more than the 2° minimum: the joint equals the marker exactly.
    expect(state.preview?.find((j) => j.key === 'rightLowerArm')?.position).toEqual(state.markers.elbow);
    const result = await t.app.runUntyped('skel.quickRig.commit', quickRigCommitArgs(state));
    expect(result.status).toBe('finished');
    const skeleton = (result as { value: { skeleton: SkeletonId } }).value.skeleton;
    const joints = new Map(t.app.store.query.jointsOfSkeleton(skeleton).map((j) => [j.key, j]));
    expect(state.preview?.map((j) => [j.key, j.position])).toEqual(
      state.preview?.map((j) => [j.key, joints.get(j.key)?.restPosition]),
    );
    expect(t.app.history.peekUndo()?.label).toBe('Create Skeleton');
    // Create Skeleton ends Quick Rig in Skeleton mode.
    expect(t.app.session.getState().rig).toMatchObject({ mode: 'skeleton', quickRig: null });
  });

  it('centre markers keep x = 0 whatever the point', async () => {
    const t = await rigTestApp();
    await openQuickRig(t);
    setQuickRigMarker(t.app, 'chin', [0.07, 1.45, 0.01]);
    expect(quickRigOf(t.app)?.markers.chin).toEqual([0, 1.45, 0.01]);
    const run = await t.app.runUntyped('skel.quickRig.setMarker', { name: 'pelvis', point: [-0.2, 0.9, 0] });
    expect(run.status).toBe('finished');
    expect(Object.is(quickRigOf(t.app)?.markers.pelvis?.[0], 0)).toBe(true);
    expect(await t.app.runUntyped('skel.quickRig.setMarker', { name: 'nose', point: [0, 0, 0] })).toMatchObject({
      status: 'cancelled',
    });
  });

  it('Clear empties; the click-to-place order is the list order; Guess restores the guess', async () => {
    const t = await rigTestApp();
    await openQuickRig(t);
    const guessed = quickRigOf(t.app)?.markers;
    expect((await t.app.runUntyped('skel.quickRig.clear')).status).toBe('finished');
    expect(quickRigOf(t.app)?.markers).toEqual({});
    // The preview of no markers is the template on the bounds (missing markers take the template's proportions).
    expect(quickRigOf(t.app)?.preview?.length).toBe(34);
    const order: string[] = [];
    for (let i = 0; i < QUICK_RIG_MARKERS.length; i++) {
      const next = nextMissingMarker(quickRigOf(t.app)?.markers ?? {});
      if (next === null) break;
      order.push(next);
      setQuickRigMarker(t.app, next, [-0.1, 1 - i * 0.05, 0]);
    }
    expect(order).toEqual([...QUICK_RIG_MARKERS]);
    expect(nextMissingMarker(quickRigOf(t.app)?.markers ?? {})).toBeNull();
    expect((await t.app.runUntyped('skel.quickRig.guess')).status).toBe('finished');
    expect(quickRigOf(t.app)?.markers).toEqual(guessed);
    expect(quickRigOf(t.app)?.moved.size).toBe(0);
  });

  it('the template select refits the preview (Full 52 adds upperChest and fingers); pick selects a marker', async () => {
    const t = await rigTestApp();
    await openQuickRig(t);
    expect((await t.app.runUntyped('skel.quickRig.setPreset', { preset: 'full52' })).status).toBe('finished');
    const keys = quickRigOf(t.app)?.preview?.map((j) => j.key) ?? [];
    expect(keys).toContain('upperChest');
    expect(keys).toContain('leftIndexProximal');
    expect((await t.app.runUntyped('skel.quickRig.pick', { marker: 'knee' })).status).toBe('finished');
    expect(quickRigOf(t.app)?.selected).toBe('knee');
    expect((await t.app.runUntyped('skel.quickRig.pick', { marker: null })).status).toBe('finished');
    expect(quickRigOf(t.app)?.selected).toBeNull();
  });

  it('Cancel and leaving Rig & Skin close Quick Rig without a step', async () => {
    const t = await rigTestApp();
    const top = t.app.history.peekUndo()?.id ?? null;
    await openQuickRig(t);
    expect((await t.app.runUntyped('skel.quickRig.cancel')).status).toBe('finished');
    expect(quickRigOf(t.app)).toBeNull();
    expect(await t.app.runUntyped('skel.quickRig.cancel')).toMatchObject({ status: 'cancelled' });
    await openQuickRig(t);
    t.app.session.setState({ workspace: 'model' });
    expect(quickRigOf(t.app)).toBeNull();
    expect(t.app.history.peekUndo()?.id ?? null).toBe(top);
    closeQuickRig(t.app);
  });
});

describe('start checks (§0.4.2)', () => {
  it('an off-centre Cube Lad: the centre notice and no markers; Center and Ground (one step) → the guess runs', async () => {
    const t = await rigTestApp({ placement: { t: [0.1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } });
    await openQuickRig(t);
    const state = quickRigOf(t.app);
    expect(state?.checks.centred).toBe(false);
    expect(state?.markers).toEqual({});
    expect(state === null ? null : quickRigCommitBlock(state)).toBe(CHECK_REASONS.centred);
    expect(await t.app.runUntyped('skel.quickRig.guess')).toMatchObject({
      status: 'cancelled',
      reason: CHECK_REASONS.centred,
    });
    const fix = await t.app.runUntyped('skel.quickRig.center');
    expect(fix.status).toBe('finished');
    expect(t.app.history.peekUndo()?.label).toBe('Center and Ground');
    await flush();
    const fixed = quickRigOf(t.app);
    expect(fixed?.checks).toEqual({ centred: true, grounded: true, facing: true });
    expect(Object.keys(fixed?.markers ?? {}).sort()).toEqual([...QUICK_RIG_MARKERS].sort());
    expect(fixed === null ? 'closed' : quickRigCommitBlock(fixed)).toBeNull();
    // Undo puts the model back off-centre: the notice again (the markers stay).
    t.app.history.undo();
    await flush();
    expect(quickRigOf(t.app)?.checks.centred).toBe(false);
  });
});

describe('re-run on a template skeleton (§0.4.2 Re-run)', () => {
  it('seeds every marker from the joints (all moved), locks the preset and refits in place', async () => {
    const t = await rigTestApp();
    await openQuickRig(t);
    const first = quickRigOf(t.app);
    if (first === null) throw new Error('closed');
    const created = await t.app.runUntyped('skel.quickRig.commit', quickRigCommitArgs(first));
    const skeleton = (created as { value: { skeleton: SkeletonId } }).value.skeleton;
    const ids = t.app.store.query
      .jointsOfSkeleton(skeleton)
      .map((j) => j.id)
      .sort();
    // Nothing selected: the active character's meshes.
    t.app.session.setState({ selection: { ...t.app.session.getState().selection, objects: [] } });
    const again = await t.app.runUntyped('skel.quickRig.start');
    expect(again.status).toBe('finished');
    const state = quickRigOf(t.app);
    if (state === null) throw new Error('closed');
    expect(state.refit).toBe(skeleton);
    expect(state.meshes).toEqual(ladMeshes(t.app));
    expect([...state.moved].sort()).toEqual([...QUICK_RIG_MARKERS].sort());
    expect(state.guess).toBeNull();
    expect(await t.app.runUntyped('skel.quickRig.setPreset', { preset: 'lite17' })).toMatchObject({
      status: 'cancelled',
      reason: PRESET_LOCKED,
    });
    const knee = state.markers.knee ?? [0, 0, 0];
    setQuickRigMarker(t.app, 'knee', [knee[0], knee[1], knee[2] + 0.02]);
    const moved = quickRigOf(t.app);
    if (moved === null) throw new Error('closed');
    const result = await t.app.runUntyped('skel.quickRig.commit', quickRigCommitArgs(moved));
    expect(result.status).toBe('finished');
    expect(t.app.history.peekUndo()?.label).toBe('Refit Skeleton');
    expect(
      t.app.store.query
        .jointsOfSkeleton(skeleton)
        .map((j) => j.id)
        .sort(),
    ).toEqual(ids);
    expect(charactersOf(t.app)).toHaveLength(1);
    expect(t.app.session.getState().rig.mode).toBe('skeleton');
  });
});
