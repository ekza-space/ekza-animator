// P-C6 (M6B-SPEC §3 rule 7, §5.26): rig edits never key — the keys-table hash is unchanged by every §6 operator except
// the ones §3 rule 7 lists. C0 lands the table frame with every operator row pending; each owner turns its rows into
// runs (the row's `status` becomes 'checked' and its `args` the fixture run) when it lands the operator.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EditorApp } from '../../src';
import { opsApp } from '../builtin/support';
import { LIBRARY_OPERATORS } from '../../src/operators/builtin/library';
import { RIG_WORKSPACE_OPERATORS } from '../../src/operators/builtin/rig/index';

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

/** Every §6 operator (§6.1–§6.4) and the §0.6 additions; `keys` rows may write curves or keys (§3 rule 7). */
export const P_C6_ROWS: readonly Row[] = [
  ...pending('C1', 'mesh.importStatic', 'char.fromModel', 'char.adopt'),
  ...pending('C2', 'char.attachProp'),
  ...pending('C11', 'char.makeEditable'),
  ...pending('C10', 'char.setVrmMeta', 'char.renderThumbnail'),
  ...pending(
    'C2',
    'skel.template.create',
    'skel.template.addMissing',
    'skel.quickRig.commit',
    'skel.quickRig.center',
    'skel.quickRig.faceForward',
  ),
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
    'skel.joint.rename',
    'skel.joint.setHumanBone',
    'skel.joint.setSide',
    'skel.joint.move',
    'skel.joint.rotateRest',
    'skel.joint.setRest',
    'skel.joint.mirror',
    'skel.joint.flex',
    'skel.symmetry.set',
    'skel.pose.tStance',
    'skel.pose.applyAsRest',
    'select.joints',
  ),
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
  ...pending(
    'C7',
    'skin.test.rom',
    'rig.mode',
    'rig.pose.view',
    'rig.pose.resetTest',
    'rig.animateOnly',
    'rig.validation.profile',
    'rig.outliner.delete',
  ),
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
    await app.runUntyped(row.id, args);
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
