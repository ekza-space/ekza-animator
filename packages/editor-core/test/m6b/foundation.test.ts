// M6B-SPEC §9.0 C0 DoD (editor-core): every §6/§0.6 operator id resolves from the lazy rig-workspace and clip-library
// chunks and poll-fails cleanly (MVP ids "not available yet", deferred ids "Arrives after the MVP" and internal);
// running an id of a chunk loads it first; a fake `preview` provider overrides the `animate` source (Animate) and the
// `bind` source (Rig & Skin) and returning null restores each with no other call; `onBeforeDocumentRun` fires before
// `key.set` and `edit.undo` but not before a U-state operator; the test-pose history parts; the Rig & Skin workspace,
// session and preference defaults.
import type { ChannelValues, CharacterId, ControlId } from '@ekza-studio/doc';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARRIVES_AFTER_MVP,
  type ChannelSourceProvider,
  defaultRigSession,
  NOT_AVAILABLE_YET,
  type OperatorDef,
  registerBuiltinWorkspaces,
  registerChannelSourceProvider,
  RIG_WORKSPACE,
} from '../../src';
import { opsApp, runOk } from '../builtin/support';
import { setFrame, W, waveApp } from '../kernel/support';

/** §6 (every id) and §0.6 (the MVP ids). */
const MVP: readonly string[] = [
  'mesh.importStatic',
  'char.fromModel',
  'char.adopt',
  'char.setVrmMeta',
  'char.renderThumbnail',
  'file.exportCharacter',
  'skel.template.create',
  'skel.template.addMissing',
  'skel.quickRig.start',
  'skel.quickRig.setMarker',
  'skel.quickRig.guess',
  'skel.quickRig.clear',
  'skel.quickRig.setPreset',
  'skel.quickRig.cancel',
  'skel.quickRig.pick',
  'skel.quickRig.center',
  'skel.quickRig.faceForward',
  'skel.quickRig.commit',
  'skel.joint.move',
  'skel.joint.rotateRest',
  'skel.joint.setRest',
  'skel.joint.orient',
  'skel.joint.mirror',
  'skel.joint.setHumanBone',
  'skel.joint.flex',
  'skel.symmetry.set',
  'skel.joint.rename',
  'select.joints',
  'skin.bind',
  'skin.unbind',
  'skin.weights.paint',
  'skin.weights.flood',
  'skin.weights.set',
  'skin.weights.mirror',
  'skin.weights.smooth',
  'skin.weights.prune',
  'skin.weights.normalize',
  'skin.palette.compact',
  'skin.influence.setActive',
  'skin.influence.hold',
  'skin.influence.holdAll',
  'skin.influence.releaseAll',
  'skin.influence.walk',
  'skin.influence.pickDominant',
  'skin.paint.mode',
  'skin.paint.set',
  'skin.paint.mirrorToggle',
  'skin.paint.sample',
  'skin.testRotate.toggle',
  'rig.mode',
  'rig.pose.view',
  'rig.pose.resetTest',
  'rig.animateOnly',
  'rig.validation.profile',
  'rig.autoRig.update',
  'library.open',
  'library.preview',
  'library.stop',
  'library.useClip',
];
const DEFERRED: readonly string[] = [
  'char.attachProp',
  'char.makeEditable',
  'skel.joint.create',
  'skel.joint.duplicate',
  'skel.joint.setRole',
  'skel.socket.create',
  'skel.joint.insert',
  'skel.bone.split',
  'skel.joint.remove',
  'skel.joint.delete',
  'skel.joint.reparent',
  'skel.joint.unparent',
  'skel.joint.setSide',
  'skel.pose.tStance',
  'skel.pose.applyAsRest',
  'skin.weights.autoForJoints',
  'skin.weights.assign',
  'skin.weights.rigidIslands',
  'skin.weights.transfer',
  'skin.weights.hammer',
  'skin.weights.copyVertex',
  'skin.weights.pasteVertex',
  'skin.weights.move',
  'skin.weights.fillMissing',
  'skin.review.mark',
  'skin.test.rom',
  'rig.outliner.delete',
  'rig.constraint.create',
  'rig.constraint.edit',
  'rig.constraint.addTarget',
  'rig.constraint.removeTarget',
  'rig.constraint.updateOffset',
  'rig.constraint.clearOffset',
  'rig.constraint.bake',
  'rig.constraint.mirror',
  'rig.constraint.delete',
  'rig.constraint.repairAttrs',
  'rig.constraint.poleVector',
  'rig.space.add',
  'rig.space.switch',
  'rig.shape.replace',
  'rig.shape.set',
  'rig.shape.transform',
  'rig.shape.editPoints',
  'rig.shape.mirror',
  'rig.shape.copy',
  'rig.shape.paste',
  'rig.shape.reset',
  'rig.shape.sizeFromMesh',
  'rig.shape.cvMode',
];

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

describe('the lazy rig-workspace and clip-library chunks (§2.1, §0.4.9)', () => {
  it('registers no rig operator eagerly; loading the chunks registers every §6 and §0.6 id once', async () => {
    const app = opsApp();
    expect([...MVP, ...DEFERRED].filter((id) => app.operators.get(id) !== undefined)).toEqual([]);
    expect([app.rig.loaded, app.library.loaded]).toEqual([false, false]);
    await Promise.all([app.rig.load(), app.library.load()]);
    expect([app.rig.loaded, app.library.loaded]).toEqual([true, true]);
    expect([...MVP, ...DEFERRED].filter((id) => app.operators.get(id) === undefined)).toEqual([]);
    await app.rig.load(); // idempotent
    const ids = app.operators.list().map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('MVP ids poll-fail "not available yet"; deferred ids "Arrives after the MVP" and are internal', async () => {
    const app = opsApp();
    await Promise.all([app.rig.load(), app.library.load()]);
    const reasonOf = (id: string) => {
      const poll = app.operators.poll(id);
      return poll === true ? 'ok' : poll.reason;
    };
    expect(MVP.map((id) => [id, reasonOf(id)])).toEqual(
      MVP.map((id) => [id, id === 'rig.animateOnly' ? 'Keys and poses are set in Animate' : NOT_AVAILABLE_YET]),
    );
    expect(DEFERRED.map((id) => [id, reasonOf(id), app.operators.get(id)?.flags?.internal])).toEqual(
      DEFERRED.map((id) => [id, ARRIVES_AFTER_MVP, true]),
    );
    // Labels and metadata are final: the menus and the palette read them from day one.
    const commit = app.operators.get('skel.quickRig.commit') as OperatorDef<unknown, unknown, unknown>;
    expect([commit.label, commit.flags?.undo, commit.workspaces]).toEqual(['Create Skeleton', true, ['rig']]);
    expect(app.operators.get('library.useClip')?.flags?.undo).toBe(true);
    expect(app.operators.get('rig.constraint.create')?.workspaces).toEqual(['rig', 'animate']);
  });

  it('running a chunk id before the chunk loaded loads it and resolves cleanly', async () => {
    const app = opsApp();
    expect(await app.runUntyped('skel.quickRig.commit', {})).toEqual({
      status: 'cancelled',
      reason: NOT_AVAILABLE_YET,
    });
    expect(app.rig.loaded).toBe(true);
    expect(await app.runUntyped('library.stop')).toEqual({ status: 'cancelled', reason: NOT_AVAILABLE_YET });
    expect(app.library.loaded).toBe(true);
    expect(await app.runUntyped('skel.nope.missing')).toEqual({
      status: 'cancelled',
      reason: "unknown operator 'skel.nope.missing'",
    });
  });

  it('enters Rig & Skin (enabled) after loading the chunk', async () => {
    const app = opsApp();
    expect(RIG_WORKSPACE).toMatchObject({ id: 'rig', enabled: true, keyScope: 'rig', order: 1, timeline: true });
    expect(RIG_WORKSPACE.menus).toEqual([
      'file',
      'edit',
      'create',
      'select',
      'modify',
      'display',
      'skeleton',
      'skin',
      'windows',
      'help',
    ]);
    disposers.push(registerBuiltinWorkspaces(app));
    await runOk(app, 'workspace.set', { workspace: 'rig' });
    expect(app.session.getState().workspace).toBe('rig');
    expect(app.rig.loaded).toBe(true);
  });
});

describe('the preview channel source (§0.5 C0 hook)', () => {
  /** A fake preview provider: values for one character while `playing`, a version bumped by `frame()`. */
  function fakeProvider(character: CharacterId, values: ReadonlyMap<ControlId, ChannelValues>) {
    const state = { playing: false, version: 0 };
    const provider: ChannelSourceProvider = {
      values: (id) => (state.playing && id === character ? values : null),
      get version() {
        return state.version;
      },
    };
    disposers.push(registerChannelSourceProvider('preview', provider));
    return {
      play: () => {
        state.playing = true;
        state.version++;
      },
      stop: () => {
        state.playing = false;
        state.version++;
      },
    };
  }
  const poseOf = (app: ReturnType<typeof waveApp>): number[] => [
    ...(app.characters.get(W.character)?.pose.boneWorld ?? []),
  ];

  it('overrides `animate` in Animate; returning null restores it with no other call', () => {
    const app = waveApp();
    setFrame(app, 10);
    app.evaluation.tick();
    const animate = poseOf(app);
    const preview = fakeProvider(W.character, new Map([[W.lowerArmL, { rz: 1.25 }]]));
    expect(app.evaluation.tick()).toBe(false); // registering alone changes nothing visible
    preview.play();
    expect(app.evaluation.tick()).toBe(true);
    expect(poseOf(app)).not.toEqual(animate);
    expect(app.evaluation.channelValues(W.lowerArmL).rz).not.toBe(1.25); // channel reads stay the document's
    const version = app.store.version;
    preview.stop();
    expect(app.evaluation.tick()).toBe(true);
    expect(poseOf(app)).toEqual(animate);
    expect(app.store.version).toBe(version);
  });

  it('overrides `bind` in Rig & Skin; returning null restores the bind pose', () => {
    const app = waveApp();
    setFrame(app, 10);
    app.evaluation.setChannelSource(W.character, 'bind');
    app.evaluation.tick();
    const bind = poseOf(app);
    app.evaluation.setChannelSource(W.character, 'animate');
    app.evaluation.tick();
    expect(poseOf(app)).not.toEqual(bind); // the wave clip moves the arm at frame 10
    app.evaluation.setChannelSource(W.character, 'bind');
    app.evaluation.tick();
    expect(poseOf(app)).toEqual(bind);
    const preview = fakeProvider(W.character, new Map([[W.handL, { rz: -0.8 }]]));
    preview.play();
    app.evaluation.tick();
    expect(poseOf(app)).not.toEqual(bind);
    preview.stop();
    app.evaluation.tick();
    expect(poseOf(app)).toEqual(bind);
  });

  it('the `test` source adds the test pose over the defaults', () => {
    const app = waveApp();
    app.evaluation.setChannelSource(W.character, 'bind');
    app.evaluation.tick();
    const bind = poseOf(app);
    app.evaluation.setChannelSource(W.character, 'test');
    app.rig.testPose.set(W.character, new Map([[W.lowerArmL, { rz: 0.4 }]]), { record: false });
    app.evaluation.tick();
    expect(poseOf(app)).not.toEqual(bind);
    app.rig.testPose.clear(W.character);
    app.evaluation.tick();
    expect(poseOf(app)).toEqual(bind);
  });
});

describe('app.operators.onBeforeDocumentRun (§0.5 C0 hook)', () => {
  it('fires before key.set and edit.undo, not before a U-state operator or a poll-failing run', async () => {
    const app = opsApp();
    const seen: string[] = [];
    let keysAtCall = -1;
    const off = app.operators.onBeforeDocumentRun((id) => {
      seen.push(id);
      if (id === 'key.set') keysAtCall = app.store.list('keys').length;
    });
    const keysBefore = app.store.list('keys').length;
    setFrame(app, 7);
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [W.lowerArmL] } });
    await runOk(app, 'key.set');
    expect(keysAtCall).toBe(keysBefore); // synchronously before the transaction
    await runOk(app, 'time.setFrame', { frame: 3 });
    await runOk(app, 'select.none');
    await runOk(app, 'edit.undo');
    await runOk(app, 'edit.redo');
    expect(seen).toEqual(['key.set', 'edit.undo', 'edit.redo']);
    off();
    await runOk(app, 'edit.undo');
    expect(seen).toHaveLength(3);
  });
});

describe('test-pose history parts (§4.6 working baseline)', () => {
  it('records one step per gesture; undo and redo apply the parts; dropTestPoses prunes them', async () => {
    const app = opsApp();
    const pose = new Map([[W.lowerArmL, { rz: 0.5 }]]);
    app.rig.testPose.set(W.character, pose);
    expect(app.history.peekUndo()).toMatchObject({ label: 'Test Pose', docTxId: null, overrides: null });
    expect(app.rig.testPose.values(W.character)).toEqual(pose);
    await runOk(app, 'edit.undo');
    expect(app.rig.testPose.values(W.character).size).toBe(0);
    await runOk(app, 'edit.redo');
    expect(app.rig.testPose.values(W.character)).toEqual(pose);
    app.history.dropTestPoses(W.character);
    expect(app.history.canUndo()).toBe(false);
    expect(app.history.canRedo()).toBe(false);
    // `record: false` (drags record once on release) writes without a step.
    app.rig.testPose.set(W.character, new Map(), { record: false });
    expect(app.history.canUndo()).toBe(false);
  });
});

describe('Rig & Skin defaults (§4.6)', () => {
  it('session, preferences and the selection start empty and documented', () => {
    const app = waveApp();
    expect(app.session.getState().rig).toEqual(defaultRigSession());
    expect(app.session.getState().rig).toMatchObject({
      mode: 'object',
      lastMode: 'skeleton',
      poseView: 'bind',
      quickRig: null,
    });
    expect(app.session.getState().selection).toMatchObject({ joints: [], constraints: [] });
    expect(app.prefs.getState().rigging).toMatchObject({
      jointSize: 1,
      influenceSort: 'hierarchy',
      orientPreset: 'maya',
    });
    expect(app.prefs.getState().modeling.undoSelection).toEqual({ model: true, animate: false, rig: true });
  });
});
