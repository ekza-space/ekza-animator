// P-C6 (M6B-SPEC §3 rule 7, §5.26): rig edits never key — the keys-table hash is unchanged by every §6 operator except
// the ones §3 rule 7 lists. C0 lands the table frame with every operator row pending; each owner turns its rows into
// runs (the row's `status` becomes 'checked' and its `args` the fixture run) when it lands the operator.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { beginChannelEditGesture, type EditorApp, loadMeshKernel, registerBuiltinWorkspaces } from '../../src';
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
  ...pending('C10', 'char.setVrmMeta', 'char.renderThumbnail'),
  // C2: Skeleton Template, Create Skeleton and the start-check fixes need the mesh kernel (`opsApp` has none); their
  // keys hash is asserted in test/m6b/skeleton-kernel/quick-rig.test.ts.
  ...pending('C2', 'skel.template.create', 'skel.quickRig.commit', 'skel.quickRig.center', 'skel.quickRig.faceForward'),
  checked('C2', 'skel.template.addMissing', (app) => {
    modelCharacter(app);
    return { skeleton: C2_SKELETON };
  }),
  ...pending(
    'C3',
    'skel.quickRig.start',
    'skel.quickRig.setMarker',
    'skel.quickRig.guess',
    'skel.quickRig.clear',
    'skel.quickRig.setPreset',
    'skel.quickRig.cancel',
    'skel.quickRig.pick',
  ),
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
    'skel.pose.tStance',
    'skel.pose.applyAsRest',
  ),
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
    'skin.paint.mode',
    'skin.paint.set',
    'skin.paint.mirrorToggle',
    'skin.paint.sample',
    'skin.testRotate.toggle',
  ),
  ...pending('C11', 'skin.weights.fillMissing', 'skin.review.mark'),
  // C7 (deferred after the MVP: the ROM clip and the Rig Outliner's delete).
  ...pending('C7', 'skin.test.rom', 'rig.outliner.delete'),
  { id: 'rig.mode', status: 'checked', owner: 'C7', setup: async (app) => rigSetup(app, { mode: 'skeleton' }) },
  { id: 'rig.pose.view', status: 'checked', owner: 'C7', setup: async (app) => rigSetup(app, { view: 'bind' }) },
  { id: 'rig.pose.resetTest', status: 'checked', owner: 'C7', setup: async (app) => rigSetup(app, undefined) },
  { id: 'rig.animateOnly', status: 'checked', owner: 'C7', setup: async (app) => rigSetup(app, undefined) },
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
  ...pending('C10', 'file.exportCharacter'),
  // §0.6: Use Clip writes a clip with keys (an Animate edit, not a rig edit); the others are U state.
  // C12: U state on the naive kit (no humanoid here: the preview's own run on a VRM, keys hash included, is in
  // test/m6b/library.test.ts).
  { id: 'library.open', status: 'checked', owner: 'C12' },
  { id: 'library.preview', status: 'checked', owner: 'C12', setup: () => ({ character: 'chr_none', clip: 'walk' }) },
  { id: 'library.stop', status: 'checked', owner: 'C12' },
  { id: 'library.useClip', status: 'keys', owner: 'C12' },
];

/** The Cube Lad fixture (an unskinned GLB). */
function cubeLadBytes(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('../../../../fixtures/models/cube-lad.glb', import.meta.url)));
}

/** A cube made in Model (the mesh kernel loaded first), as the scene mesh to adopt. */
async function sceneCube(app: EditorApp): Promise<string> {
  await loadMeshKernel();
  const result = await app.runUntyped('mesh.create.cube', {});
  if (result.status !== 'finished') throw new Error(`mesh.create.cube: ${JSON.stringify(result)}`);
  return (result.value as { mesh: string }).mesh;
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
    // A checked row must really run (a refused run would leave the hash unchanged trivially).
    expect(result.status).toBe('finished');
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
