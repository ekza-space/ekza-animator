// B13's operators never fail or throw on junk arguments (M6A-SPEC §3 rule 1, the foundation case for landed
// operators): each run cancels with a non-empty reason or finishes, and the document stays valid.
import { describe, expect, it } from 'vitest';
import { meshTestApp } from './support';

const B13_OPERATORS = [
  'mesh.create.template',
  'mesh.primitive.set',
  'mesh.setAttributes',
  'palette.ensureDefault',
  'palette.create',
  'palette.duplicate',
  'palette.rename',
  'palette.addSwatch',
  'palette.setSwatch',
  'palette.removeSwatch',
  'palette.assign',
  'palette.replaceSwatch',
  'palette.setActive',
  'select.mesh.bySwatch',
  'imagePlane.import',
  'imagePlane.set',
  'imagePlane.delete',
  'scene.group',
  'scene.parent',
  'scene.unparent',
  'scene.duplicate',
  'scene.delete',
  'scene.rename',
] as const;

describe('B13 operators with junk arguments', () => {
  it('cancel with a reason or finish; never fail or throw', async () => {
    const t = await meshTestApp();
    t.app.session.setState({ workspace: 'model' });
    for (const id of B13_OPERATORS) {
      expect([id, t.app.operators.get(id) !== undefined]).toEqual([id, true]);
      for (const args of [undefined, {}, { meshes: ['msh_X'], kind: 'face' }, 42, { id: 'msh_X', patch: 3 }]) {
        const result = await t.app.runUntyped(id, args);
        expect([id, args, result.status]).not.toEqual([id, args, 'failed']);
        const reasonOk = result.status !== 'cancelled' || result.reason.length > 0;
        expect([id, args, reasonOk]).toEqual([id, args, true]);
      }
    }
  });
});
