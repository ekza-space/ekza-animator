// P-C6 (M6B-SPEC §3 rule 7, §5.26): rig edits never key — the keys-table hash is unchanged by every §6 operator except
// the ones §3 rule 7 lists. C0 lands the table frame with every operator row pending; each owner turns its rows into
// runs (the row's `status` becomes 'checked' and its `args` the fixture run) when it lands the operator.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { MeshId } from '@ekza-studio/doc';
import { makeTestJoint } from '@ekza-studio/doc/testing';
import { describe, expect, it } from 'vitest';
import {
  ANIMATE_ONLY_REASON,
  beginChannelEditGesture,
  type EditorApp,
  loadMeshKernel,
  provideNavigation,
  registerBuiltinWorkspaces,
} from '../../src';
import { opsApp } from '../builtin/support';
import { W } from '../kernel/support';
import { LIBRARY_OPERATORS } from '../../src/operators/builtin/library';
import { RIG_WORKSPACE_OPERATORS } from '../../src/operators/builtin/rig/index';
import { C2_SKELETON, modelCharacter } from './skeleton-kernel/records';

type Row = {
  readonly id: string;
  /** 'pending' until the owner lands the operator; 'checked' = the row runs; 'keys' = a §3 rule 7 exception (it may
   *  change the keys table, so the row never runs). */
  readonly status: 'pending' | 'checked' | 'keys';
  readonly owner: string;
  /** The fixture the run needs (characters, skeletons, bound meshes …) and its args, set by the owner. */
  readonly setup?: (app: EditorApp) => unknown;
  /** A row whose operator refuses by design (`rig.animateOnly` always poll-fails): the expected refusal reason. */
  readonly refuses?: string;
};

const pending = (owner: string, ...ids: readonly string[]): Row[] =>
  ids.map((id) => ({ id, status: 'pending', owner }));
const checked = (owner: string, id: string, setup: (app: EditorApp) => unknown): Row => ({
  id,
  status: 'checked',
  owner,
  setup,
});

/** Every §6 operator (§6.1–§6.4) and the §0.6 additions; `keys` rows may write curves or keys (§3 rule 7). */
export const P_C6_ROWS: readonly Row[] = [
  // C1: the runs happen on the wave fixture (keys present) with a cube made in Model, so the hash is a real check.
  {
    id: 'mesh.importStatic',
    status: 'checked',
    owner: 'C1',
    setup: () => ({ bytes: cubeLadBytes(), name: 'cube-lad.glb' }),
  },
  { id: 'char.fromModel', status: 'checked', owner: 'C1', setup: async (app) => ({ objects: [await sceneCube(app)] }) },
  {
    id: 'char.adopt',
    status: 'checked',
    owner: 'C1',
    setup: async (app) => {
      const made = await app.runUntyped('char.fromModel', { objects: [await sceneCube(app)] });
      const character = (made as { value: { character: string } }).value.character;
      return { character, objects: [await sceneCube(app)] };
    },
  },
  ...pending('C2', 'char.attachProp'),
  ...pending('C11', 'char.makeEditable'),
  // C10: on the wave fixture (keys present) with a character made in Model from a cube.
  {
    id: 'char.setVrmMeta',
    status: 'checked',
    owner: 'C10',
    setup: async (app) => ({ character: await cubeCharacter(app), patch: { authors: ['A'], licensePreset: 'cc0' } }),
  },
  {
    id: 'char.renderThumbnail',
    status: 'checked',
    owner: 'C10',
    setup: async (app) => ({ character: await cubeCharacter(app) }),
  },
  // C2: Skeleton Template, Create Skeleton and the start-check fixes need the mesh kernel (`opsApp` has none); their
  // keys hash is asserted in test/m6b/skeleton-kernel/quick-rig.test.ts.
  ...pending('C2', 'skel.template.create', 'skel.quickRig.commit', 'skel.quickRig.center', 'skel.quickRig.faceForward'),
  checked('C2', 'skel.template.addMissing', (app) => {
    modelCharacter(app);
    return { skeleton: C2_SKELETON };
  }),
  // C3: Start and Guess need the mesh kernel (`opsApp` has none); test/m6b/skeleton-ui/quick-rig-session.test.ts
  // asserts they leave the document (and so the keys) alone. The other Quick Rig operators run on an open Quick Rig.
  ...pending('C3', 'skel.quickRig.start', 'skel.quickRig.guess'),
  checked('C3', 'skel.quickRig.setMarker', (app) => {
    openQuickRig(app);
    return { name: 'knee', point: [-0.1, 0.45, 0.03] };
  }),
  checked('C3', 'skel.quickRig.clear', (app) => openQuickRig(app)),
  checked('C3', 'skel.quickRig.setPreset', (app) => {
    openQuickRig(app);
    return { preset: 'full52' };
  }),
  checked('C3', 'skel.quickRig.cancel', (app) => openQuickRig(app)),
  checked('C3', 'skel.quickRig.pick', (app) => {
    openQuickRig(app);
    return { marker: 'elbow' };
  }),
  ...pending(
    'C2',
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
  ),
  // AUTORIG A0: T-Stance and Straighten to T-Pose need the mesh kernel and a bound mesh (`opsApp` has neither); their
  // keys hash is asserted in test/autorig-a0/rest-pose.test.ts.
  ...pending('A0', 'skel.pose.tStance', 'skel.pose.applyAsRest'),
  checked('C2', 'skel.joint.rename', (app) => ({ joint: modelCharacter(app)('leftHand'), name: 'hand_L' })),
  checked('C2', 'skel.joint.setHumanBone', (app) => ({ joint: modelCharacter(app)('leftHand'), bone: null })),
  checked('C2', 'skel.joint.move', (app) => ({
    joints: [modelCharacter(app)('rightLowerLeg')],
    translateZ: 0.01,
    mode: 'joint',
  })),
  checked('C2', 'skel.joint.rotateRest', (app) => ({ joints: [modelCharacter(app)('leftUpperArm')], rotateZ: -0.3 })),
  checked('C2', 'skel.joint.setRest', (app) => ({ joint: modelCharacter(app)('head'), position: [0, 1.45, 0.01] })),
  checked('C2', 'skel.joint.mirror', (app) => ({ root: modelCharacter(app)('leftUpperArm') })),
  checked('C2', 'skel.joint.flex', (app) => ({ joints: [modelCharacter(app)('leftLowerArm')], angle: 0.05 })),
  checked('C2', 'skel.symmetry.set', (app) => {
    modelCharacter(app);
    return { skeleton: C2_SKELETON, on: false };
  }),
  checked('C2', 'select.joints', (app) => ({ ids: [modelCharacter(app)('hips')], mode: 'replace' })),
  // §3 rule 7: Orient Joint converts rotation keys of bone-aligned controls.
  { id: 'skel.joint.orient', status: 'keys', owner: 'C2' },
  ...pending('C4', 'skin.bind', 'skin.weights.autoForJoints', 'skin.unbind'),
  ...pending(
    'C6',
    'skin.weights.paint',
    'skin.weights.flood',
    'skin.weights.set',
    'skin.weights.assign',
    'skin.weights.rigidIslands',
    'skin.weights.mirror',
    'skin.weights.transfer',
    'skin.weights.smooth',
    'skin.weights.hammer',
    'skin.weights.copyVertex',
    'skin.weights.pasteVertex',
    'skin.weights.prune',
    'skin.weights.normalize',
    'skin.weights.move',
    'skin.palette.compact',
    'skin.influence.setActive',
    'skin.influence.hold',
    'skin.influence.holdAll',
    'skin.influence.releaseAll',
    'skin.influence.walk',
    'skin.influence.pickDominant',
    'skin.paint.mirrorToggle',
    'skin.paint.sample',
    'skin.testRotate.toggle',
  ),
  // C6: the brush settings run without a bound mesh; the weight operators' keys-hash checks need the mesh kernel and a
  // bound character (`opsApp()` has neither), so `skin-ui.test.ts` asserts the hash around a stroke instead.
  { id: 'skin.paint.mode', status: 'checked', owner: 'C6', setup: () => ({ mode: 'paint' }) },
  { id: 'skin.paint.set', status: 'checked', owner: 'C6', setup: () => ({ patch: { radiusPx: 60 } }) },
  ...pending('C11', 'skin.weights.fillMissing', 'skin.review.mark'),
  // C7 (deferred after the MVP: the ROM clip and the Rig Outliner's delete).
  ...pending('C7', 'skin.test.rom', 'rig.outliner.delete'),
  { id: 'rig.mode', status: 'checked', owner: 'C7', setup: async (app) => rigSetup(app, { mode: 'skeleton' }) },
  { id: 'rig.pose.view', status: 'checked', owner: 'C7', setup: async (app) => rigSetup(app, { view: 'bind' }) },
  { id: 'rig.pose.resetTest', status: 'checked', owner: 'C7', setup: async (app) => rigSetup(app, undefined) },
  {
    id: 'rig.animateOnly',
    status: 'checked',
    owner: 'C7',
    setup: async (app) => rigSetup(app, undefined),
    refuses: ANIMATE_ONLY_REASON,
  },
  {
    id: 'rig.validation.profile',
    status: 'checked',
    owner: 'C7',
    setup: async (app) => rigSetup(app, { profile: 'local/generic' }),
  },
  // §3 rule 7: the auto-rig update soft-deletes controls whose bone vanished (their curves stay).
  { id: 'rig.autoRig.update', status: 'keys', owner: 'C1' },
  ...pending(
    'C8b',
    'rig.constraint.create',
    'rig.constraint.edit',
    'rig.constraint.addTarget',
    'rig.constraint.updateOffset',
    'rig.constraint.clearOffset',
    'rig.constraint.mirror',
    'rig.constraint.repairAttrs',
    'rig.constraint.poleVector',
    'rig.space.add',
    'rig.space.switch',
  ),
  // §3 rule 7: removal and delete remove the holder attributes' curves; bake writes keys.
  { id: 'rig.constraint.removeTarget', status: 'keys', owner: 'C8b' },
  { id: 'rig.constraint.delete', status: 'keys', owner: 'C8b' },
  { id: 'rig.constraint.bake', status: 'keys', owner: 'C8b' },
  ...pending(
    'C9',
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
  ),
  {
    id: 'file.exportCharacter',
    status: 'checked',
    owner: 'C10',
    // No profile (this app registers none): a plain GLB with the generic lints.
    setup: async (app) => ({ character: await jointedCharacter(app), profile: null, format: 'glb' }),
  },
  // §0.6: Use Clip writes a clip with keys (an Animate edit, not a rig edit); the others are U state.
  // C12: U state on the naive kit (no humanoid here: the preview's own run on a VRM, keys hash included, is in
  // test/m6b/library.test.ts).
  { id: 'library.open', status: 'checked', owner: 'C12' },
  // INT: on the naive kit both refuse (no character, nothing playing); the refusal is their whole run here.
  {
    id: 'library.preview',
    status: 'checked',
    owner: 'C12',
    setup: () => ({ character: 'chr_none', clip: 'walk' }),
    refuses: 'The character does not exist',
  },
  { id: 'library.stop', status: 'checked', owner: 'C12', refuses: 'No clip preview is playing' },
  { id: 'library.useClip', status: 'keys', owner: 'C12' },
  // AUTORIG-SPEC §4.5 (D0 lands the rows pending; literal update): the Auto-Rig compositions run Studio operators only,
  // so each row's verdict is the one of what it runs. `autorig.clip.add` = Use Clip, a §3 rule 7 exception.
  // D3: the ① compositions import (one step) or move scene meshes (one step) and inspect them (U); never keys.
  checked('D3', 'autorig.sample', () => {
    const original = globalThis.fetch;
    const sampleFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> =>
      (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/cube-lad.glb')
        ? new Response(cubeLadBytes())
        : original(url, init);
    globalThis.fetch = sampleFetch;
    return { sample: 'cube-lad' };
  }),
  checked('D3', 'autorig.intake', () => ({ bytes: cubeLadBytes(), name: 'cube-lad.glb' })),
  checked('D3', 'autorig.inspect', async (app) => ({ meshes: await importedLad(app) })),
  checked('D3', 'autorig.fix', async (app) => ({ fix: 'scale', meshes: await importedLad(app), height: 1 })),
  // D4: Create Skeleton + Bind Skin (+ Straighten) on an open Quick Rig session; cancel refuses without a bind.
  checked('D4', 'autorig.rig', async (app) => {
    const meshes = await importedLad(app);
    await app.runUntyped('workspace.set', { workspace: 'rig' });
    const started = await app.runUntyped('skel.quickRig.start', { meshes });
    if (started.status !== 'finished') throw new Error(`skel.quickRig.start: ${JSON.stringify(started)}`);
    return { straighten: false };
  }),
  { id: 'autorig.cancel', status: 'checked', owner: 'D4', refuses: 'No skinning is running' },
  { id: 'autorig.clip.add', status: 'keys', owner: 'D5' },
  ...pending('D6', 'autorig.export'),
  // D1: the switch runs through a host navigation port (a recording fake here) and never touches the document.
  {
    id: 'autorig.navigate',
    status: 'checked',
    owner: 'D1',
    setup: (app) => {
      provideNavigation(app, { go: async () => {}, takeSubject: () => null });
      return { to: 'autorig', from: 'studio' };
    },
  },
];

/** The Cube Lad fixture (an unskinned GLB). */
function cubeLadBytes(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('../../../../fixtures/models/cube-lad.glb', import.meta.url)));
}

/** The Cube Lad imported as scene meshes (`mesh.importStatic`), for the Auto-Rig ① rows. */
async function importedLad(app: EditorApp): Promise<string[]> {
  const result = await app.runUntyped('mesh.importStatic', { bytes: cubeLadBytes(), name: 'cube-lad.glb' });
  if (result.status !== 'finished') throw new Error(`mesh.importStatic: ${JSON.stringify(result)}`);
  return (result.value as { meshes: string[] }).meshes;
}

/** A cube made in Model (the mesh kernel loaded first), as the scene mesh to adopt. */
async function sceneCube(app: EditorApp): Promise<string> {
  await loadMeshKernel();
  const result = await app.runUntyped('mesh.create.cube', {});
  if (result.status !== 'finished') throw new Error(`mesh.create.cube: ${JSON.stringify(result)}`);
  return (result.value as { mesh: string }).mesh;
}

/** C3's fixture: Quick Rig open (U state) on a mesh id; the preview stays empty without the mesh kernel. */
function openQuickRig(app: EditorApp): undefined {
  const rig = app.session.getState().rig;
  app.session.setState({
    rig: {
      ...rig,
      quickRig: {
        meshes: ['msh_QuickRig000001' as MeshId],
        preset: 'standard33',
        markers: { pelvis: [0, 0.93, 0], knee: [-0.1, 0.46, 0] },
        moved: new Set(),
        selected: null,
        guess: null,
        preview: null,
        checks: { centred: true, grounded: true, facing: true },
        refit: null,
      },
    },
  });
  return undefined;
}

/** C7's fixture: Rig & Skin entered with a control selected and a test pose on it (a test gesture). */
async function rigSetup<T>(app: EditorApp, args: T): Promise<T> {
  registerBuiltinWorkspaces(app);
  await app.runUntyped('workspace.set', { workspace: 'rig' });
  const control = W.lowerArmL;
  app.session.setState({ selection: { ...app.session.getState().selection, controls: [control] } });
  const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
  gesture.update([{ control, channel: 'rz', value: 0.5 }]);
  gesture.commit();
  return args;
}

/** A model character made from a scene cube (C1's `char.fromModel`): no joints yet. */
async function cubeCharacter(app: EditorApp): Promise<string> {
  const made = await app.runUntyped('char.fromModel', { objects: [await sceneCube(app)] });
  if (made.status !== 'finished') throw new Error(`char.fromModel: ${JSON.stringify(made)}`);
  return (made.value as { character: string }).character;
}

/** A model character with a two-joint skeleton (root → hips), unbound: enough for a plain GLB export. */
async function jointedCharacter(app: EditorApp): Promise<string> {
  const character = await cubeCharacter(app);
  const skeleton = app.store.query.skeletonOfCharacter(character as never);
  if (skeleton === undefined) throw new Error('no skeleton');
  app.store.transact({ label: 'joints (test)' }, (tx) => {
    tx.put(
      'joints',
      makeTestJoint('jnt_root', skeleton.id, { name: 'root', order: 'a0', role: 'helper', key: 'root' }),
    );
    tx.put(
      'joints',
      makeTestJoint('jnt_hips', skeleton.id, {
        name: 'hips',
        parent: 'jnt_root' as never,
        order: 'a1',
        humanBone: 'hips',
        restPosition: [0, 1, 0],
        key: 'hips',
      }),
    );
  });
  return character;
}

describe('P-C6: rig edits never key (table frame, §5.26)', () => {
  it('lists every operator of the rig-workspace and clip-library chunks once', () => {
    const ids = P_C6_ROWS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    const registered = [...RIG_WORKSPACE_OPERATORS, ...LIBRARY_OPERATORS].map((def) => def.id);
    expect([...ids].sort()).toEqual([...registered].sort());
  });
  it.each(P_C6_ROWS.map((row) => [row.id, row] as const))('%s leaves the keys hash unchanged', async (_id, row) => {
    // Pending rows and the §3 rule 7 exceptions do not run (`checked` rows do, once their owner sets them).
    if (row.status !== 'checked') return;
    const app = opsApp();
    const args = await row.setup?.(app);
    const before = keysHash(app);
    const result = await app.runUntyped(row.id, args);
    // A checked row must really run (a refused run would leave the hash unchanged trivially), unless refusing is
    // the operator's whole job (then it must refuse with exactly its reason).
    const expected = row.refuses === undefined ? 'finished' : `cancelled: ${row.refuses}`;
    expect(result.status === 'cancelled' ? `cancelled: ${result.reason}` : result.status).toBe(expected);
    expect(keysHash(app)).toBe(before);
  });
});

/** sha256 of the curves and keys tables (the test API's `keysHash()`, §4.8). */
function keysHash(app: EditorApp): string {
  const snapshot = app.store.snapshot().tables;
  return createHash('sha256')
    .update(JSON.stringify([snapshot['curves'], snapshot['keys']]))
    .digest('hex');
}
