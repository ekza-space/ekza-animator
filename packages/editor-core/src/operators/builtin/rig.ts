// Rig operators (MVP-SPEC §4.9 `rig.*`): pose-preserving rotate-order change (M1-stretch, §4.11.5), control shape
// size, secondary-control visibility.
import { EkzaError, type RotateOrder } from '@ekza-studio/anim-core';
import type { ControlId, RigId, Tx } from '@ekza-studio/doc';
import { GLOBAL_SCOPE } from '../../types';
import { changeRotateOrder } from '../../workflows/rotateOrder';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord } from './define';
import { pollEditable } from './polls';

const ROTATE_ORDERS: readonly RotateOrder[] = ['xyz', 'yzx', 'zxy', 'xzy', 'yxz', 'zyx'];

const setRotateOrder = defineOperator({
  id: 'rig.setRotateOrder',
  label: 'Rotate Order',
  description:
    "Change a control's rotate order; its rotation keys are converted so the pose stays the same at every key.",
  category: 'rig',
  scope: GLOBAL_SCOPE,
  // Rewrites the rx/ry/rz keys of every clip and layer of the character.
  flags: { undo: true, structural: true, internal: true },
  undoLabel: () => 'Rotate Order',
  poll({ app }, raw) {
    const args: unknown = raw;
    if (
      !isRecord(args) ||
      typeof args['control'] !== 'string' ||
      !ROTATE_ORDERS.includes(args['order'] as RotateOrder)
    ) {
      return fail(`expects { control, order: ${ROTATE_ORDERS.join(' | ')} }`);
    }
    if (app.store.get('controls', args['control'] as ControlId) === undefined)
      return fail('The control does not exist');
    return pollEditable(app);
  },
  async prepare({ app }, args) {
    // Every clip of the character is converted: open their partitions first.
    const control = app.store.get('controls', args.control);
    const character = control === undefined ? undefined : app.store.get('rigs', control.rig)?.character;
    if (character === undefined) return;
    for (const clip of app.store.query.clipsOfCharacter(character)) await app.store.open(`clip:${clip.id}`);
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'rig.setRotateOrder runs in a transaction');
    const control = tx.get('controls', args.control);
    if (control === undefined) throw new EkzaError('invalid-record', `Control ${args.control} does not exist`);
    const changed = control.rotateOrder !== args.order;
    changeRotateOrder(app, tx, control, args.order);
    // The conversion is exact at key times only (§4.11.5): say so when there is motion between keys.
    if (changed && hasRotationMotion(tx, control.rig, control.id)) {
      app.services.notify.toast({
        kind: 'info',
        text:
          `Rotate order ${args.order}: the pose is kept at every key; between keys the motion can differ. ` +
          'Key more frames first for an exact result.',
      });
    }
  },
});

/** The control has a rotation curve with two or more keys in some clip of its character. */
function hasRotationMotion(tx: Tx, rig: RigId, control: ControlId): boolean {
  const character = tx.get('rigs', rig)?.character;
  if (character === undefined) return false;
  for (const clip of tx.query.clipsOfCharacter(character)) {
    for (const curve of tx.query.curvesOfClip(clip.id)) {
      if (curve.control !== control || (curve.channel !== 'rx' && curve.channel !== 'ry' && curve.channel !== 'rz'))
        continue;
      if (tx.query.keysOfCurve(curve.id).length >= 2) return true;
    }
  }
  return false;
}

const setControlSize = defineOperator({
  id: 'rig.setControlSize',
  label: 'Control Size',
  description: "Resize a control's shape (metres).",
  category: 'rig',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  undoLabel: () => 'Control Size',
  poll({ app }, raw) {
    const args: unknown = raw;
    if (!isRecord(args) || typeof args['control'] !== 'string' || !isFiniteNumber(args['size'])) {
      return fail('expects { control, size }');
    }
    if (args['size'] <= 0) return fail('The size must be positive');
    if (app.store.get('controls', args['control'] as ControlId) === undefined)
      return fail('The control does not exist');
    return pollEditable(app);
  },
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'rig.setControlSize runs in a transaction');
    const control = tx.get('controls', args.control);
    if (control === undefined || control.shape.size === args.size) return;
    tx.patch('controls', control.id, { shape: { ...control.shape, size: args.size } });
  },
});

const toggleSecondary = defineOperator({
  id: 'rig.toggleSecondary',
  label: 'Show Secondary Controls',
  description: 'Show or hide the controls of non-humanoid joints (hair, accessories).',
  category: 'rig',
  scope: GLOBAL_SCOPE,
  apply({ app }) {
    app.session.setState({ showSecondary: !app.session.getState().showSecondary });
  },
});

export const RIG_OPERATORS: readonly AnyOperator[] = [setRotateOrder, setControlSize, toggleSecondary];
