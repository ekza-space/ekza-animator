// M6B-SPEC §9.0 C7 (rig shell) DoD in editor-core: CR-4's mode scopes; the §7 MVP rows and their conformance (`S`
// never keys in any Rig scope: keys hash unchanged; `Mod+E` export; `Alt+C` controls / weights; no `Alt+F`,
// `Shift+B`; Animate resolves exactly as before); the modes (`1`, `2`, the digit again, `F8`, Skin needs a bound
// mesh, Shapes after the MVP); entering and leaving (Bind on entry, channel sources, test poses never in the document
// and dropped from the history on leaving, no empty steps); the pose view; the Validation rows per profile, the tab
// glyph and the MVP checklist.
import { sha256Hex } from '@ekza-studio/anim-core';
import type { CharacterId, MeshId, RigId, SkeletonId } from '@ekza-studio/doc';
import {
  makeTestJoint,
  makeTestMesh,
  makeTestRig,
  makeTestSkeleton,
  makeTestThumbnailAsset,
  makeTestVrmMeta,
} from '@ekza-studio/doc/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANIMATE_ONLY_REASON,
  BIND_A_MESH_FIRST,
  beginChannelEditGesture,
  type Chord,
  type EditorApp,
  KEYING_CHORDS,
  keyScopeChain,
  LEFT_RIG_REASON,
  MAYA_KEYMAP,
  MODE_MASKS,
  PANEL,
  RIG_KEYMAP,
  RIG_WORKSPACE,
  registerBuiltins,
  registerChannelSourceProvider,
  resolveChord,
  rigStatus,
  rigValidation,
  TEST_POSE_TOAST,
} from '../../src';
import { ARRIVES_AFTER_MVP } from '../../src/operators/builtin/rig/stub';
import { createFakeServices } from '../../src/testing';
import { opsApp, runOk, runResult } from '../builtin/support';
import { ch } from '../keymap-support';
import { W, waveApp } from '../kernel/support';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

/** sha256 of the curves and keys tables (the test API's `keysHash()`, §3 rule 7). */
function keysHash(app: EditorApp): string {
  return sha256Hex(new TextEncoder().encode(JSON.stringify([app.store.list('curves'), app.store.list('keys')])));
}

/** An app with the built-ins (keymap, workspaces) in Rig & Skin; the rig chunk loaded. */
async function rigApp(opts?: { readonly services?: ReturnType<typeof createFakeServices> }): Promise<EditorApp> {
  const app = waveApp(opts?.services === undefined ? undefined : { services: opts.services });
  disposers.push(registerBuiltins(app));
  await runOk(app, 'workspace.set', { workspace: 'rig' });
  return app;
}

/** The Rig chain over a panel; over the viewport in a mode (CR-4: the mode is the suffix). */
function rigChain(panel: string | null, mode: string = 'object'): string[] {
  return keyScopeChain({
    workspace: 'rig',
    panel,
    viewport: panel === PANEL.viewport,
    mode: 'object',
    modes: mode === 'object' ? [] : [mode],
  });
}

/** Every Rig chain: no panel, each panel, the viewport in each MVP mode. */
function allRigChains(): string[][] {
  const chains = [rigChain(null)];
  for (const panel of Object.values(PANEL)) {
    if (panel !== PANEL.viewport) chains.push(rigChain(panel));
    else for (const mode of ['object', 'skeleton', 'skin']) chains.push(rigChain(panel, mode));
  }
  return chains;
}

const select = (app: EditorApp, controls: readonly string[]): void =>
  app.session.setState({ selection: { ...app.session.getState().selection, controls: controls as never } });

describe('CR-4: the workspace mode scopes (§7)', () => {
  it('puts `rig.viewport.<mode>` in front of `rig.viewport` over the viewport only; Model keeps its rule', () => {
    expect(rigChain(PANEL.viewport, 'skeleton')).toEqual([
      'rig.viewport.skeleton',
      'rig.viewport',
      'viewport',
      'rig',
      'global',
    ]);
    expect(rigChain(PANEL.viewport)).toEqual(['rig.viewport', 'viewport', 'rig', 'global']);
    expect(rigChain(PANEL.outliner, 'skin')).toEqual(['rig.outliner', 'outliner', 'rig', 'global']);
    expect(keyScopeChain({ workspace: 'model', panel: PANEL.viewport, viewport: true, mode: 'edge' })).toEqual([
      'model.viewport.edge',
      'model.viewport.component',
      'model.viewport',
      'viewport',
      'model',
      'global',
    ]);
  });

  it('RIG_WORKSPACE.keyModes reads the mode; layout R-Side', () => {
    const app = opsApp();
    expect(RIG_WORKSPACE.layout).toBe('rig-side');
    expect(RIG_WORKSPACE.keyModes?.(app)).toEqual([]);
    app.session.setState({ rig: { ...app.session.getState().rig, mode: 'skin' } });
    expect(RIG_WORKSPACE.keyModes?.(app)).toEqual(['skin']);
  });
});

describe('the §7 MVP rows and their conformance', () => {
  it('every rig/skel/skin row names a registered operator; no Alt+F or Shift+B; all scopes are Rig scopes', async () => {
    const app = await rigApp();
    const forbidden = (chord: Chord): boolean =>
      (chord.code === 'KeyF' && chord.alt === true) || (chord.code === 'KeyB' && chord.shift === true);
    expect(RIG_KEYMAP.filter((row) => !row.scope.startsWith('rig')).map((row) => row.scope)).toEqual([]);
    // §7 conformance: every rig.*, skel.*, skin.* binding names a registered operator (view.* rows are the
    // viewport's, registered with the viewport manager in the browser).
    const unknown = RIG_KEYMAP.filter(
      (row) => /^(rig|skel|skin|select)\./.test(row.op) && app.operators.get(row.op) === undefined,
    );
    expect(unknown.map((row) => row.op)).toEqual([]);
    expect(RIG_KEYMAP.filter((row) => forbidden(row.chord))).toEqual([]);
  });

  it('S and every keying chord resolve to rig.animateOnly in every Rig scope that keys in Animate', async () => {
    const app = await rigApp();
    const keying = ['key.set', 'pose.copy', 'pose.paste', 'pose.mirror', 'graph.keys.copy', 'graph.keys.paste'];
    const keys: string[] = [];
    for (const chain of allRigChains()) {
      for (const chord of [...KEYING_CHORDS, ch('KeyS')]) {
        const op = resolveChord(app.keymap, chord, chain)?.op ?? 'none';
        if (keying.includes(op)) keys.push(`${JSON.stringify(chord)} over ${chain[0] ?? ''} → ${op}`);
      }
    }
    expect(keys).toEqual([]);
    expect(resolveChord(app.keymap, ch('KeyS'), rigChain(PANEL.viewport, 'skin'))?.op).toBe('rig.animateOnly');
    expect(resolveChord(app.keymap, ch('KeyS'), rigChain(PANEL.channelBox))?.op).toBe('rig.animateOnly');
  });

  it('S never keys in any Rig scope: running what it resolves to leaves the keys hash unchanged', async () => {
    const app = await rigApp();
    select(app, [W.lowerArmL]);
    const before = keysHash(app);
    const version = app.store.version;
    const finished: string[] = [];
    for (const chain of allRigChains()) {
      const binding = resolveChord(app.keymap, ch('KeyS'), chain);
      if (binding === null) continue;
      const result = await runResult(app, binding.op, binding.args);
      if (result.status === 'finished') finished.push(`${chain[0] ?? ''} → ${binding.op}`);
    }
    expect(finished).toEqual([]);
    expect(keysHash(app)).toBe(before);
    expect(app.store.version).toBe(version);
    const poll = app.operators.poll('rig.animateOnly');
    expect(poll === true ? 'ok' : poll.reason).toBe(ANIMATE_ONLY_REASON);
  });

  it('Mod+E opens Export; Alt+C toggles controls in Object mode and weights in Skin mode; F8 and digits', async () => {
    const app = await rigApp();
    expect(resolveChord(app.keymap, ch('Mod+KeyE'), rigChain(PANEL.viewport))).toMatchObject({
      op: 'ui.open',
      args: { dialog: 'export' },
    });
    expect(resolveChord(app.keymap, ch('Alt+KeyC'), rigChain(PANEL.viewport))?.args).toEqual({ flag: 'controls' });
    expect(resolveChord(app.keymap, ch('Alt+KeyC'), rigChain(PANEL.viewport, 'skin'))?.args).toEqual({
      flag: 'weights',
    });
    expect(resolveChord(app.keymap, ch('F8'), rigChain(PANEL.viewport, 'skeleton'))).toMatchObject({
      op: 'rig.mode',
      args: { mode: 'toggle' },
    });
    expect(resolveChord(app.keymap, ch('Digit2'), rigChain(PANEL.viewport))?.args).toEqual({ mode: 'skin' });
    expect(resolveChord(app.keymap, ch('Digit3'), rigChain(PANEL.viewport))).toBeNull(); // Shapes after the MVP
  });

  it('Animate resolves exactly as before the Rig rows were added', async () => {
    const app = waveApp();
    disposers.push(registerBuiltins(app));
    const chains = [null, ...Object.values(PANEL)].map((panel) =>
      keyScopeChain({ workspace: null, panel, viewport: panel === PANEL.viewport, mode: 'object' }),
    );
    const snapshot = (): string[] =>
      chains.flatMap((chain) =>
        MAYA_KEYMAP.map((row) => JSON.stringify(resolveChord(app.keymap, row.chord, chain) ?? null)),
      );
    const before = snapshot();
    await app.rig.load();
    expect(snapshot()).toEqual(before);
  });
});

describe('modes (§5.24)', () => {
  it('1 / 2 / the digit again / F8; Skin needs a bound mesh; Shapes after the MVP; U state only', async () => {
    const app = await rigApp();
    const steps = app.history.peekUndo();
    const mode = (): string => app.session.getState().rig.mode;
    await runOk(app, 'rig.mode', { mode: 'skeleton' });
    expect(mode()).toBe('skeleton');
    expect(app.session.getState().tools.selectionMask).toEqual(MODE_MASKS.skeleton);
    // The active digit again → Object (keyboard runs only); F8 back to the last mode.
    await app.runUntyped('rig.mode', { mode: 'skeleton' }, { source: 'keyboard' });
    expect(mode()).toBe('object');
    expect(app.session.getState().tools.selectionMask).toEqual(MODE_MASKS.object);
    await runOk(app, 'rig.mode', { mode: 'toggle' });
    expect(mode()).toBe('skeleton');
    await runOk(app, 'rig.mode', { mode: 'toggle' });
    expect(mode()).toBe('object');
    // A menu run of the active mode is idempotent.
    await runOk(app, 'rig.mode', { mode: 'skeleton' });
    await runOk(app, 'rig.mode', { mode: 'skeleton' });
    expect(mode()).toBe('skeleton');
    const skin = await runResult(app, 'rig.mode', { mode: 'skin' });
    expect(skin).toMatchObject({ status: 'cancelled', reason: BIND_A_MESH_FIRST });
    const shape = await runResult(app, 'rig.mode', { mode: 'shape' });
    expect(shape).toMatchObject({ status: 'cancelled', reason: ARRIVES_AFTER_MVP });
    expect(app.history.peekUndo()).toBe(steps);
    await runOk(app, 'workspace.set', { workspace: 'animate' });
    expect((await runResult(app, 'rig.mode', { mode: 'object' })).status).toBe('cancelled');
  });
});

describe('entering, leaving and the pose view (§5.17, §5.24)', () => {
  it('entering sets Bind (defaults); a Rig channel gesture writes the test pose, never the document', async () => {
    const services = createFakeServices();
    const app = await rigApp({ services });
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 10 } });
    expect(app.session.getState().rig.poseView).toBe('bind');
    expect(app.evaluation.channelValues(W.lowerArmL).rz).toBe(0); // Bind shows the defaults
    const hash = keysHash(app);
    const version = app.store.version;
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    gesture.update([{ control: W.lowerArmL, channel: 'rz', value: 0.5 }]);
    gesture.update([{ control: W.lowerArmL, channel: 'rz', value: 0.7 }]);
    gesture.commit();
    expect(app.rig.testPose.values(W.character).get(W.lowerArmL)).toEqual({ rz: 0.7 });
    expect(app.session.getState().rig.poseView).toBe('test');
    expect(app.evaluation.channelValues(W.lowerArmL).rz).toBe(0.7); // the Channel Box reads the test pose
    expect(app.history.peekUndo()?.label).toBe('Test Pose');
    expect([keysHash(app), app.store.version, app.session.getState().overrides.size]).toEqual([hash, version, 0]);
    expect(services.toasts.filter((toast) => toast.text === TEST_POSE_TOAST)).toHaveLength(1);
    // A second test edit: no second toast (once per session).
    const again = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    again.update([{ control: W.lowerArmL, channel: 'rz', value: 0.2 }]);
    again.cancel();
    expect(app.rig.testPose.values(W.character).get(W.lowerArmL)).toEqual({ rz: 0.7 });
    await runOk(app, 'rig.pose.view', { view: 'bind' });
    expect(app.evaluation.channelValues(W.lowerArmL).rz).toBe(0);
    await runOk(app, 'rig.pose.view', { view: 'test' });
    expect(app.evaluation.channelValues(W.lowerArmL).rz).toBe(0.7); // Test restores the kept copy
    expect(services.toasts.filter((toast) => toast.text === TEST_POSE_TOAST)).toHaveLength(1);
    expect((await runResult(app, 'rig.pose.view', { view: 'clip' })).status).toBe('cancelled');
    await runOk(app, 'rig.pose.resetTest');
    expect(app.rig.testPose.values(W.character).size).toBe(0);
    expect(app.session.getState().rig.poseView).toBe('bind');
  });

  it('undo inside Rig removes one test value; leaving drops every test-pose step and the pose', async () => {
    const app = await rigApp();
    // A document step first, so "no empty step left" is visible.
    select(app, [W.lowerArmL]);
    await runOk(app, 'workspace.set', { workspace: 'animate' });
    await runOk(app, 'key.set');
    const keyed = app.history.peekUndo();
    await runOk(app, 'workspace.set', { workspace: 'rig' });
    for (const [control, value] of [
      [W.lowerArmL, 0.4],
      [W.handL, 0.3],
    ] as const) {
      const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
      gesture.update([{ control, channel: 'rz', value }]);
      gesture.commit();
    }
    expect(app.rig.testPose.values(W.character).size).toBe(2);
    await runOk(app, 'edit.undo');
    expect(app.rig.testPose.values(W.character).has(W.handL)).toBe(false);
    expect(app.rig.testPose.values(W.character).has(W.lowerArmL)).toBe(true);
    app.session.setState({ lastRun: null });
    await runOk(app, 'workspace.set', { workspace: 'animate' });
    expect(app.rig.testPose.values(W.character).size).toBe(0);
    expect(app.history.peekUndo()).toBe(keyed); // the next undo in Animate undoes the key
    expect(app.history.canRedo()).toBe(false);
    expect(app.session.getState().rig.poseView).toBe('bind');
    // Animate shows the clip again (the source is 'animate').
    expect(app.evaluation.channelValues(W.lowerArmL).rz).not.toBe(0.4);
    expect(LEFT_RIG_REASON).toMatch(/Rig & Skin/);
  });

  it('a preview provider wins over the Rig & Skin source C7 sets; returning null restores the bind pose', async () => {
    const app = await rigApp();
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 10 } });
    app.evaluation.tick();
    const pose = (): number[] => [...(app.characters.get(W.character)?.pose.boneWorld ?? [])];
    const bind = pose();
    const state = { playing: false, version: 0 };
    disposers.push(
      registerChannelSourceProvider('preview', {
        values: (id) => (state.playing && id === W.character ? new Map([[W.lowerArmL, { rz: 1.1 }]]) : null),
        get version() {
          return state.version;
        },
      }),
    );
    state.playing = true;
    state.version++;
    app.evaluation.tick();
    expect(pose()).not.toEqual(bind);
    state.playing = false;
    state.version++;
    app.evaluation.tick();
    expect(pose()).toEqual(bind);
  });

  it('outside Rig & Skin channel gestures keep the shipped path (overrides, keys)', async () => {
    const app = await rigApp();
    await runOk(app, 'workspace.set', { workspace: 'animate' });
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'none' });
    gesture.update([{ control: W.lowerArmL, channel: 'rz', value: 0.9 }]);
    gesture.commit();
    expect(app.session.getState().overrides.get(W.lowerArmL)?.rz).toBe(0.9);
    expect(app.rig.testPose.values(W.character).size).toBe(0);
  });
});

/** A model-sourced character: a skeleton with two joints and one mesh of the character (unbound). */
function addModelCharacter(app: EditorApp, opts?: { readonly vrm?: boolean; readonly bound?: boolean }): CharacterId {
  const character = 'chr_Model0001' as CharacterId;
  const skeleton = 'skl_Model0001' as SkeletonId;
  const rig = 'rig_Model0001' as RigId;
  const thumbnail = makeTestThumbnailAsset('thumb');
  app.store.transact({ label: 'Model character' }, (tx) => {
    if (opts?.vrm === true) tx.put('assets', thumbnail);
    tx.put('rigs', makeTestRig(rig, character));
    tx.put('characters', {
      id: character,
      name: 'Cube Lad',
      asset: null,
      source: { kind: 'model', skeleton },
      format: 'vrm1',
      rig,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      order: 'z0',
      deleted: null,
      vrm:
        opts?.vrm === true
          ? { ...makeTestVrmMeta('Cube Lad', { authors: ['Tester'], licensePreset: 'cc0' }), thumbnail: thumbnail.id }
          : null,
    });
    tx.put('skeletons', makeTestSkeleton(skeleton, character, { preset: 'standard33' }));
    tx.put('joints', makeTestJoint('jnt_Hips0001', skeleton, { name: 'hips', humanBone: 'hips', key: 'hips' }));
    tx.put(
      'joints',
      makeTestJoint('jnt_Spine001', skeleton, {
        name: 'spine',
        humanBone: 'spine',
        key: 'spine',
        parent: 'jnt_Hips0001' as never,
      }),
    );
    tx.put(
      'meshes',
      makeTestMesh('msh_Body0001', {
        name: 'body',
        owner: { character },
        skin: opts?.bound === true ? { skeleton, bind: null } : null,
      }),
    );
  });
  return character;
}

describe('Validation (§5.21, §0.4.5)', () => {
  it('rows per profile: skin.unbound and the VRM meta rows; severities follow the profile', async () => {
    const app = await rigApp();
    const character = addModelCharacter(app);
    const validation = rigValidation(app);
    const codes = (profile: string | null) =>
      validation.rows(character, profile).map((row) => [row.code, row.severity, row.fix?.op ?? null]);
    expect(codes('ekza/space-avatar-v1')).toEqual([
      ['skin.unbound', 'error', 'skin.bind'],
      ['vrm.meta-required', 'error', 'ui.open'],
      ['vrm.licence-unset', 'error', 'ui.open'],
      ['vrm.thumbnail-square', 'warning', 'char.renderThumbnail'],
    ]);
    expect(codes('local/generic')).toEqual([['skin.unbound', 'warning', 'skin.bind']]);
    // The panel's profile is the default of `rows(c, null)`; `rig.validation.profile` sets it (U state).
    expect(validation.profile).toBe('ekza/space-avatar-v1');
    await runOk(app, 'rig.validation.profile', { profile: 'local/generic' });
    expect(codes(null)).toEqual(codes('local/generic'));
    expect(validation.rows(character, null)[0]?.fix?.args).toEqual({ meshes: ['msh_Body0001'] });
  });

  it('the tab glyph and the MVP checklist', async () => {
    const app = await rigApp();
    app.session.setState({ rig: { ...app.session.getState().rig, character: null } });
    expect(rigStatus(app)).toEqual({ glyph: 'todo', reasons: ['No skeleton yet'] });
    const empty = rigValidation(app).checklist(null);
    expect(empty.map((step) => [step.step, step.glyph])).toEqual([
      [1, 'attention'],
      [2, 'todo'],
      [3, 'todo'],
      [4, 'todo'],
      [5, 'todo'],
      [6, 'todo'],
    ]);
    const character = addModelCharacter(app, { vrm: true });
    // The model character's mesh is selected: the active character follows the selection.
    app.session.setState({
      selection: { ...app.session.getState().selection, controls: [], objects: ['msh_Body0001' as MeshId] },
    });
    expect(app.session.getState().rig.character).toBe(character);
    expect(rigStatus(app)).toMatchObject({ glyph: 'attention', reasons: ['body has no skin'] });
    const steps = rigValidation(app).checklist(character);
    expect(steps.map((step) => [step.step, step.glyph])).toEqual([
      [1, 'done'],
      [2, 'done'],
      [3, 'attention'],
      [4, 'todo'],
      [5, 'attention'],
      [6, 'attention'],
    ]);
    expect(steps.map((step) => step.button?.op)).toEqual([
      'skel.quickRig.start',
      'rig.mode',
      'skin.bind',
      'rig.mode',
      'library.open',
      'ui.open',
    ]);
    rigValidation(app).markPreviewed();
    expect(rigValidation(app).checklist(character)[4]?.glyph).toBe('done');
  });

  it('a bound character: ③ done, Skin mode allowed, glyph ● with no error row', async () => {
    const app = await rigApp();
    const character = addModelCharacter(app, { vrm: true, bound: true });
    app.session.setState({ rig: { ...app.session.getState().rig, character } });
    expect(rigValidation(app).rows(character, null)).toEqual([]);
    expect(rigStatus(app)).toEqual({ glyph: 'done', reasons: [] });
    expect(rigValidation(app).checklist(character)[2]?.glyph).toBe('done');
    await runOk(app, 'rig.mode', { mode: 'skin' });
    expect(app.session.getState().rig.mode).toBe('skin');
  });
});
