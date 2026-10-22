// Entering and leaving Rig & Skin (M6B-SPEC §5.24, §5.17; C7), run by the rig-workspace chunk once it is loaded:
//
// - Entering (and loading while Rig & Skin is active) sets Pose view Bind and puts every character on the `bind`
//   channel source (`test` once a test pose exists); the active character follows the selection.
// - The first test-pose write while the view is Bind switches the view to Test (a toast the first time per session).
// - Leaving forgets every test pose, drops the test-pose parts from the history (`dropTestPoses`, no empty steps
//   left), cancels channel gestures, closes the Last-op card and puts every character back on `animate`.
// - In Rig & Skin, channel-edit gestures (manipulators, the Channel Box) write the test pose (`beginTestPoseGesture`).
// - A library preview marks checklist step ⑤.
import type { Disposer } from '@ekza-studio/anim-core';
import type { CharacterId, JointId } from '@ekza-studio/doc';
import { cancelChannelEditGestures } from '../../edit/channels';
import { registerChannelEditRedirect } from '../../evaluation/rigSource';
import { ownerOfControl } from '../../session/location';
import type { EditorApp, PoseView, TestPoseService } from '../../types';
import { beginTestPoseGesture } from '../testPose/gesture';
import type { RigValidation } from '../validation';
import { RIG_KEYMAP } from './keymap';

/** Why the Last-op card closed when the user left Rig & Skin. */
export const LEFT_RIG_REASON = 'Left the Rig & Skin workspace';
/** The first test pose of a session says what it is (§5.17). */
export const TEST_POSE_TOAST = 'Test pose: not keyed; Go to Bind Pose to edit joints';

/** The active character (§5.24): of the selected joints, controls or objects; else the only character; else none. */
export function activeCharacter(app: Pick<EditorApp, 'store' | 'session'>): CharacterId | null {
  const { selection } = app.session.getState();
  const store = app.store;
  for (let i = selection.joints.length - 1; i >= 0; i--) {
    const joint = store.get('joints', selection.joints[i] as JointId);
    const skeleton = joint === undefined ? undefined : store.get('skeletons', joint.skeleton);
    if (skeleton !== undefined && store.get('characters', skeleton.character) !== undefined) return skeleton.character;
  }
  for (let i = selection.controls.length - 1; i >= 0; i--) {
    const owner = ownerOfControl(store, selection.controls[i] as never);
    if (owner !== null && store.get('characters', owner) !== undefined) return owner;
  }
  for (let i = selection.objects.length - 1; i >= 0; i--) {
    const mesh = store.get('meshes', selection.objects[i] as never);
    if (
      mesh !== undefined &&
      'character' in mesh.owner &&
      store.get('characters', mesh.owner.character) !== undefined
    ) {
      return mesh.owner.character;
    }
  }
  const characters = store.list('characters');
  if (characters.length === 1) return characters[0]?.id ?? null;
  // Keep the current one while it exists (a selection elsewhere does not drop it).
  const current = app.session.getState().rig.character;
  return current !== null && store.get('characters', current) !== undefined ? current : null;
}

/** Sets the pose view and the channel source of every character for it (`bind` or `test`; Rig & Skin only). */
export function applyPoseView(app: EditorApp, view: PoseView): void {
  const state = app.session.getState();
  if (state.rig.poseView !== view) app.session.setState({ rig: { ...state.rig, poseView: view } });
  if (state.workspace !== 'rig') return;
  const source = view === 'test' ? 'test' : 'bind';
  for (const runtime of app.characters.list()) app.evaluation.setChannelSource(runtime.id, source);
}

/** True when any character has a non-empty test pose. */
function anyTestPose(app: EditorApp, testPose: TestPoseService): boolean {
  return app.characters.list().some((runtime) => testPose.values(runtime.id).size > 0);
}

export function startRigWorkspace(
  app: EditorApp,
  services: { readonly testPose: TestPoseService; readonly validation: RigValidation },
): Disposer {
  const { testPose } = services;
  let toasted = false;
  let inRig = false;

  const syncCharacter = (): void => {
    const state = app.session.getState();
    const character = activeCharacter(app);
    if (state.rig.character !== character) app.session.setState({ rig: { ...state.rig, character } });
  };
  const enter = (): void => {
    inRig = true;
    applyPoseView(app, 'bind');
    syncCharacter();
  };
  const leave = (): void => {
    inRig = false;
    cancelChannelEditGestures(app);
    testPose.forget();
    app.history.dropTestPoses();
    const state = app.session.getState();
    const lastRun =
      state.lastRun !== null && state.lastRun.closed === null ? { ...state.lastRun, closed: LEFT_RIG_REASON } : null;
    app.session.setState({ rig: { ...state.rig, poseView: 'bind' }, ...(lastRun === null ? {} : { lastRun }) });
    for (const runtime of app.characters.list()) app.evaluation.setChannelSource(runtime.id, 'animate');
  };

  const disposers: Disposer[] = [
    app.contribute({ kind: 'keymap', bindings: RIG_KEYMAP }),
    registerChannelEditRedirect((target, label) =>
      target === app && target.session.getState().workspace === 'rig'
        ? beginTestPoseGesture(app, testPose, label)
        : null,
    ),
    app.session.subscribe((state, previous) => {
      if (state.workspace !== previous.workspace) {
        if (state.workspace === 'rig') enter();
        else if (inRig) leave();
        return;
      }
      if (state.workspace === 'rig' && state.selection !== previous.selection) syncCharacter();
    }),
    app.store.subscribe(() => {
      if (inRig) syncCharacter();
    }),
    app.characters.subscribe((event) => {
      if (!inRig || event.type !== 'added') return;
      app.evaluation.setChannelSource(event.id, app.session.getState().rig.poseView === 'test' ? 'test' : 'bind');
    }),
    testPose.subscribe(() => {
      if (!inRig || app.session.getState().rig.poseView !== 'bind' || !anyTestPose(app, testPose)) return;
      applyPoseView(app, 'test');
      if (!toasted) {
        toasted = true;
        app.services.notify.toast({ kind: 'info', text: TEST_POSE_TOAST });
      }
    }),
  ];
  // ⑤: once the clip-library chunk is loaded (never loaded from here: subscribing would load it), a preview marks it.
  let library: Disposer | null = null;
  const watchLibrary = (): void => {
    if (library !== null || !app.library.loaded) return;
    const check = (): void => {
      if (app.library.service.preview !== null) services.validation.markPreviewed();
    };
    library = app.library.service.subscribe(check);
    check();
  };
  // The chunk can load without a session change (a `library.preview` run loads it and starts playing at once): the
  // preview's frames reach the evaluation service, so its notifications attach the watcher while the clip plays (INT).
  disposers.push(app.session.subscribe(watchLibrary), app.evaluation.subscribe(watchLibrary), () => library?.());
  if (app.session.getState().workspace === 'rig') enter();
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
