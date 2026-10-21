// M6B-SPEC §5.7, §8.3, §0.4.2 through the DOM (C3): pointer events on real panes reach the Rig & Skin pointer layer
// before the tools. Skeleton mode: a click selects a joint (Shift toggles), `W` drags move the rests with the subtree
// and `D` + `W` the joint only (partners mirrored, the side pane's hidden axis untouched, one undo step), `E` rotates
// the rests (unbound), the Test view refuses rest edits, `R` never scales; the joint overlay draws spheres where the
// test API says and rebuilds in ≤ 2 ms (report). Quick Rig: a front drag keeps z, a side drag keeps x (bit-equal), the
// selected marker wins where the side view stacks shoulder, elbow and wrist, and two clicks on that spot cycle.
import type { CharacterId, JointId, JointRecord, RigId, SkeletonId } from '@ekza-studio/doc';
import {
  MODE_MASKS,
  pickQuickRigMarker,
  type QuickRigState,
  quickRigOf,
  registerBuiltinOperators,
} from '@ekza-studio/editor-core';
import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
import { DEFAULT_FLEXION, type QuickRigMarkers, skeletonTemplate, templateJointRecords } from '@ekza-studio/rig';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY, viewportRigOf } from '../../src';
import { JOINT_POSED_REFUSAL, JOINT_SCALE_REFUSAL } from '../../src/tools/rig/jointTransform/stateTable';
import { createRig, drag, pointer, type Rig } from '../helpers';

const CHARACTER = 'chr_CubeLad00000001' as CharacterId;
const SKELETON = 'skl_CubeLad00000001' as SkeletonId;
const RIG = 'rig_CubeLad00000001' as RigId;
const H = 1.7;
const jid = (key: string): JointId => `${SKELETON}:${key}` as JointId;

let current: Rig | null = null;
afterEach(() => {
  current?.dispose();
  current = null;
  for (const code of ['KeyD', 'KeyX']) window.dispatchEvent(new KeyboardEvent('keyup', { code }));
});

/** A viewport (quad: top │ persp / front │ side) over an app in Rig & Skin with a Standard 33 model character. */
async function rigScene(opts?: { readonly tool?: string }): Promise<Rig> {
  const app = createFakeEditorApp();
  registerBuiltinOperators(app);
  await app.rig.load();
  const joints = templateJointRecords(
    skeletonTemplate('standard33', { height: H, proportions: 'standard', flexion: DEFAULT_FLEXION }),
    SKELETON,
  );
  app.store.transact({ label: 'Character', undoable: false }, (tx) => {
    tx.put('characters', {
      id: CHARACTER,
      name: 'Cube Lad',
      asset: null,
      source: { kind: 'model', skeleton: SKELETON },
      format: 'vrm1',
      rig: RIG,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      order: 'a0',
      deleted: null,
      vrm: null,
    });
    tx.put('skeletons', {
      id: SKELETON,
      character: CHARACTER,
      template: 'vrm-humanoid',
      templateVersion: '1',
      preset: 'standard33',
      symmetry: true,
      deleted: null,
    });
    tx.put('rigs', {
      id: RIG,
      character: CHARACTER,
      format: 'ekza.rig',
      version: 1,
      generator: { name: 'ekza-autorig-humanoid', version: '0.0.0-test' },
      skeleton: { format: 'vrm1', fingerprint: 'sha256:test', facing: [0, 0, 0, 1] },
      deleted: null,
    });
    for (const joint of joints) tx.put('joints', joint);
  });
  const rig = await createRig({ app });
  current = rig;
  rig.layout('quad', { display: { ...DEFAULT_DISPLAY, joints: true, xrayJoints: true, jointAxes: 'selected' } });
  const state = app.session.getState();
  app.session.setState({
    workspace: 'rig',
    rig: { ...state.rig, mode: 'skeleton', character: CHARACTER },
    tools: { ...state.tools, viewport: opts?.tool ?? 'select', selectionMask: MODE_MASKS.skeleton },
  });
  // The rig chunk loads lazily on the first Rig & Skin entry: a cold load under a parallel test run can take seconds.
  const deadline = performance.now() + 15_000;
  while (viewportRigOf(app) === null && performance.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  expect(viewportRigOf(app)).not.toBeNull();
  rig.frame();
  return rig;
}

const joint = (rig: Rig, key: string): JointRecord => rig.app.store.get('joints', jid(key)) as JointRecord;

/** The page point of a joint in a pane (the pane's element offset added). */
function at(rig: Rig, key: string, paneId: string): { x: number; y: number } {
  const local = viewportRigOf(rig.app)?.screenOfJoint(jid(key), paneId) ?? null;
  const element = rig.panes.get(paneId);
  if (local === null || element === undefined) throw new Error(`${key} is not drawn in ${paneId}`);
  const r = element.getBoundingClientRect();
  return { x: r.left + local.x, y: r.top + local.y };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const holdD = (down: boolean): void => {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'KeyD' }));
};

describe('joint overlay and picking (§8.3)', () => {
  it('draws every joint and picks the sphere under the pointer; the rebuild is fast (report)', async () => {
    const rig = await scene();
    const runtime = viewportRigOf(rig.app);
    expect(runtime?.joints.scene.joints).toHaveLength(34);
    expect(runtime?.joints.scene.joints.find((j) => j.id === jid('root'))?.helper).toBe(true);
    const knee = at(rig, 'rightLowerLeg', 'pane-front');
    const element = rig.panes.get('pane-front') as HTMLElement;
    pointer(element, 'pointerdown', knee.x, knee.y);
    pointer(element, 'pointerup', knee.x, knee.y);
    await settle();
    expect(rig.app.session.getState().selection.joints).toEqual([jid('rightLowerLeg')]);
    // Shift toggles, a click on empty space clears.
    const foot = at(rig, 'rightFoot', 'pane-front');
    pointer(element, 'pointerdown', foot.x, foot.y, { shiftKey: true });
    pointer(element, 'pointerup', foot.x, foot.y, { shiftKey: true });
    await settle();
    expect(rig.app.session.getState().selection.joints).toEqual([jid('rightLowerLeg'), jid('rightFoot')]);
    pointer(element, 'pointerdown', 5, 5);
    pointer(element, 'pointerup', 5, 5);
    await settle();
    expect(rig.app.session.getState().selection.joints).toEqual([]);
    // §5.25 report row: the joint overlay rebuild.
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      rig.app.session.setState({ selection: { ...rig.app.session.getState().selection, joints: [jid('head')] } });
      runtime?.ensure();
      times.push(runtime?.rebuildMs ?? 0);
      rig.app.session.setState({ selection: { ...rig.app.session.getState().selection, joints: [] } });
      runtime?.ensure();
    }
    times.sort((a, b) => a - b);
    console.warn(
      `joint overlay rebuild (34 joints): median ${times[25]?.toFixed(3)} ms, max ${times.at(-1)?.toFixed(3)} ms`,
    );
    expect(times[25]).toBeLessThan(2);
  });

  it('labels the hovered joint; hidden joints are neither drawn nor picked', async () => {
    const rig = await scene();
    const runtime = viewportRigOf(rig.app);
    const head = at(rig, 'head', 'pane-front');
    const local = runtime?.screenOfJoint(jid('head'), 'pane-front') ?? { x: 0, y: 0 };
    pointer(rig.panes.get('pane-front') as HTMLElement, 'pointermove', head.x, head.y, { buttons: 0 });
    expect(runtime?.joints.hovered).toBe(jid('head'));
    const state = rig.app.session.getState();
    rig.app.session.setState({ rig: { ...state.rig, hiddenJoints: new Set([jid('head')]) } });
    expect(runtime?.screenOfJoint(jid('head'), 'pane-front')).toBeNull();
    const pick = runtime?.joints.pick('pane-front', local.x, local.y) ?? null;
    expect(pick?.kind === 'joint' ? pick.joint : null).not.toBe(jid('head'));
  });
});

/** The rig scene in Skeleton mode with a tool. */
function scene(tool?: string): Promise<Rig> {
  return rigScene(tool === undefined ? undefined : { tool });
}

describe('Skeleton mode display (§5.24)', () => {
  it('x-rays the mesh and hides the controls in Skeleton mode; Object mode gets them back and small joints', async () => {
    const rig = await scene();
    const runtime = viewportRigOf(rig.app);
    const display = () => rig.vm.paneState('pane-front')?.display;
    expect(display()).toMatchObject({ xray: true, controls: false });
    const full = runtime?.joints.joint(jid('head'))?.radius ?? 0;
    const state = rig.app.session.getState();
    rig.app.session.setState({ rig: { ...state.rig, mode: 'object' } });
    expect(display()).toMatchObject({ xray: false, controls: true });
    runtime?.ensure();
    expect(runtime?.joints.joint(jid('head'))?.radius).toBeCloseTo(full * 0.6, 12);
    rig.app.session.setState({ rig: { ...rig.app.session.getState().rig, mode: 'skeleton' } });
    expect(display()).toMatchObject({ xray: true, controls: false });
  });
});

describe('§5.7 state table through the DOM', () => {
  it('D + W in the side pane moves the knees only (feet bit-equal, x untouched), one step', async () => {
    const rig = await scene('move');
    const kneeR = joint(rig, 'rightLowerLeg').restPosition;
    const kneeL = joint(rig, 'leftLowerLeg').restPosition;
    const footR = joint(rig, 'rightFoot').restPosition;
    const from = at(rig, 'rightLowerLeg', 'pane-side');
    holdD(true);
    drag(rig.panes.get('pane-side') as HTMLElement, from, { x: from.x + 12, y: from.y });
    holdD(false);
    await settle();
    await settle();
    expect(rig.app.history.peekUndo()?.label).toBe('Move Joint');
    const kneeR2 = joint(rig, 'rightLowerLeg').restPosition;
    const kneeL2 = joint(rig, 'leftLowerLeg').restPosition;
    expect(kneeR2[2]).not.toBe(kneeR[2]);
    expect(Object.is(kneeR2[0], kneeR[0])).toBe(true);
    expect(Object.is(kneeR2[1], kneeR[1])).toBe(true);
    // Symmetry: the partner takes the mirrored delta; the feet stay.
    expect(kneeL2[2]).toBeCloseTo(kneeR2[2], 12);
    expect(kneeL2[0]).toBe(kneeL[0]);
    expect(joint(rig, 'rightFoot').restPosition).toEqual(footR);
  });

  it('W moves the subtree; E rotates the rests (unbound); each a step', async () => {
    const rig = await scene('move');
    const hand = joint(rig, 'rightHand').restPosition;
    const from = at(rig, 'rightLowerArm', 'pane-front');
    drag(rig.panes.get('pane-front') as HTMLElement, from, { x: from.x, y: from.y + 10 });
    await settle();
    await settle();
    expect(rig.app.history.peekUndo()?.label).toBe('Move Joints');
    expect(joint(rig, 'rightHand').restPosition[1]).toBeLessThan(hand[1]);
    expect(Object.is(joint(rig, 'rightHand').restPosition[2], hand[2])).toBe(true);
    const state = rig.app.session.getState();
    rig.app.session.setState({ tools: { ...state.tools, viewport: 'rotate' } });
    rig.frame();
    const elbow = at(rig, 'rightLowerArm', 'pane-front');
    const wrist = joint(rig, 'rightHand').restPosition;
    drag(
      rig.panes.get('pane-front') as HTMLElement,
      { x: elbow.x - 30, y: elbow.y },
      { x: elbow.x - 30, y: elbow.y + 20 },
    );
    await settle();
    // The press must start on a joint: the elbow itself.
    drag(rig.panes.get('pane-front') as HTMLElement, elbow, { x: elbow.x + 4, y: elbow.y + 20 });
    await settle();
    await settle();
    expect(rig.app.history.peekUndo()?.label).toBe('Rotate Joints');
    expect(joint(rig, 'rightHand').restPosition).not.toEqual(wrist);
  });

  it('X held snaps the moved joint to the grid (the hidden axis untouched)', async () => {
    const rig = await scene('move');
    const step = rig.app.prefs.getState().modeling.gridStep;
    const before = joint(rig, 'rightLowerLeg').restPosition;
    const from = at(rig, 'rightLowerLeg', 'pane-front');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
    holdD(true);
    drag(rig.panes.get('pane-front') as HTMLElement, from, { x: from.x + 17, y: from.y + 9 });
    holdD(false);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyX' }));
    await settle();
    await settle();
    const after = joint(rig, 'rightLowerLeg').restPosition;
    expect(Math.abs(after[0] / step - Math.round(after[0] / step))).toBeLessThan(1e-9);
    expect(Math.abs(after[1] / step - Math.round(after[1] / step))).toBeLessThan(1e-9);
    expect(Object.is(after[2], before[2])).toBe(true);
  });

  it('the Test view refuses rest edits; R never scales joints', async () => {
    const rig = await scene('move');
    const toasts = (rig.app.services as unknown as { toasts: readonly { text: string }[] }).toasts;
    const top = rig.app.history.peekUndo()?.id ?? null;
    // A bound skeleton in the Test view.
    rig.app.store.transact({ label: 'Bound', undoable: false }, (tx) => {
      tx.put('meshes', {
        id: 'msh_Body00000001' as never,
        name: 'body',
        owner: { character: CHARACTER },
        parent: null,
        order: 'a0',
        placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
        pivot: [0, 0, 0],
        source: null,
        data: null,
        faceted: true,
        generator: null,
        palette: null,
        material: { preset: 'unlit' },
        colourOutput: 'palette-texture',
        skin: { skeleton: SKELETON, bind: null },
        budget: null,
        handheld: null,
        deleted: null,
      });
    });
    const state = rig.app.session.getState();
    rig.app.session.setState({ rig: { ...state.rig, poseView: 'test' } });
    rig.frame();
    const knee = joint(rig, 'rightLowerLeg').restPosition;
    const from = at(rig, 'rightLowerLeg', 'pane-front');
    drag(rig.panes.get('pane-front') as HTMLElement, from, { x: from.x + 10, y: from.y });
    await settle();
    expect(joint(rig, 'rightLowerLeg').restPosition).toEqual(knee);
    expect(rig.app.history.peekUndo()?.id ?? null).toBe(top);
    expect(toasts.at(-1)?.text).toBe(JOINT_POSED_REFUSAL);
    rig.app.session.setState({ tools: { ...rig.app.session.getState().tools, viewport: 'scale' } });
    drag(rig.panes.get('pane-front') as HTMLElement, from, { x: from.x + 10, y: from.y });
    await settle();
    expect(joint(rig, 'rightLowerLeg').restPosition).toEqual(knee);
    expect(toasts.at(-1)?.text).toBe(JOINT_SCALE_REFUSAL);
  });
});

describe('Quick Rig markers through the DOM (§0.4.2)', () => {
  const truth: QuickRigMarkers = {
    headTop: [0, 1.7, 0],
    chin: [0, 1.48, 0.01],
    pelvis: [0, 0.9, 0],
    shoulder: [-0.2, 1.36, 0],
    elbow: [-0.45, 1.36, 0.004],
    wrist: [-0.68, 1.36, 0.008],
    knee: [-0.1, 0.46, 0.02],
    ankle: [-0.1, 0.08, 0],
    toe: [-0.1, 0.02, 0.12],
  };

  async function quickScene(): Promise<Rig> {
    const rig = await scene();
    const state = rig.app.session.getState();
    const quickRig: QuickRigState = {
      meshes: [],
      preset: 'standard33',
      markers: truth,
      moved: new Set(),
      selected: null,
      guess: { armAngle: 0, aPose: false, failed: null },
      preview: null,
      checks: { centred: true, grounded: true, facing: true },
      refit: null,
    };
    rig.app.session.setState({ rig: { ...state.rig, mode: 'object', quickRig } });
    rig.frame();
    return rig;
  }

  const markerAt = (rig: Rig, name: string, side: 'R' | 'L', paneId: string) => {
    const local = viewportRigOf(rig.app)?.screenOfMarker(name as never, side, paneId) ?? null;
    if (local === null) throw new Error(`${name} not drawn in ${paneId}`);
    const r = (rig.panes.get(paneId) as HTMLElement).getBoundingClientRect();
    return { x: r.left + local.x, y: r.top + local.y };
  };

  it('a front drag keeps z bit-equal; a side drag keeps x bit-equal; ghosts mirror; the persp pane never drags', async () => {
    const rig = await quickScene();
    const elbow = markerAt(rig, 'elbow', 'R', 'pane-front');
    drag(rig.panes.get('pane-front') as HTMLElement, elbow, { x: elbow.x + 3, y: elbow.y + 9 });
    const after = quickRigOf(rig.app)?.markers.elbow ?? [0, 0, 0];
    expect(Object.is(after[2], truth.elbow?.[2])).toBe(true);
    expect(after[1]).toBeLessThan(truth.elbow?.[1] ?? 0);
    expect(quickRigOf(rig.app)?.selected).toBe('elbow');
    rig.frame();
    const ghost = viewportRigOf(rig.app)?.markers.pointOf('elbow', 'L');
    expect(ghost).toEqual([-after[0], after[1], after[2]]);
    const knee = markerAt(rig, 'knee', 'R', 'pane-side');
    drag(rig.panes.get('pane-side') as HTMLElement, knee, { x: knee.x + 8, y: knee.y });
    const kneeAfter = quickRigOf(rig.app)?.markers.knee ?? [0, 0, 0];
    expect(Object.is(kneeAfter[0], truth.knee?.[0])).toBe(true);
    expect(kneeAfter[2]).not.toBe(truth.knee?.[2]);
    // Perspective: read-only.
    rig.frame();
    const before = quickRigOf(rig.app)?.markers;
    const head = markerAt(rig, 'headTop', 'R', 'pane-persp');
    drag(rig.panes.get('pane-persp') as HTMLElement, head, { x: head.x + 20, y: head.y + 20 });
    expect(quickRigOf(rig.app)?.markers).toEqual(before);
  });

  it('the selected marker wins where the side view stacks shoulder, elbow and wrist; two clicks cycle', async () => {
    const rig = await quickScene();
    pickQuickRigMarker(rig.app, 'elbow');
    rig.frame();
    const spot = markerAt(rig, 'elbow', 'R', 'pane-side');
    const side = rig.panes.get('pane-side') as HTMLElement;
    drag(side, spot, { x: spot.x - 10, y: spot.y });
    const markers = quickRigOf(rig.app)?.markers ?? {};
    expect(markers.elbow?.[2]).not.toBe(truth.elbow?.[2]);
    expect(Object.is(markers.elbow?.[0], truth.elbow?.[0])).toBe(true);
    expect(markers.shoulder).toEqual(truth.shoulder);
    expect(markers.wrist).toEqual(truth.wrist);
    // Back on the stack (shoulder and wrist): click, click → the selection cycles in list order.
    const now = markerAt(rig, 'shoulder', 'R', 'pane-side');
    pickQuickRigMarker(rig.app, null);
    pointer(side, 'pointerdown', now.x, now.y);
    pointer(side, 'pointerup', now.x, now.y);
    const first = quickRigOf(rig.app)?.selected;
    pointer(side, 'pointerdown', now.x, now.y);
    pointer(side, 'pointerup', now.x, now.y);
    const second = quickRigOf(rig.app)?.selected;
    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect(['shoulder', 'wrist']).toContain(second);
  });
});
