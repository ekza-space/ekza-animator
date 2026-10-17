// Rig operators (MVP-SPEC §4.9 `rig.*`): pose-preserving rotate-order change (M1-stretch, §4.11.5), control shape
// size, secondary-control visibility.
import { EkzaError, type RotateOrder } from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import { GLOBAL_SCOPE } from '../../types';
import { changeRotateOrder } from '../../workflows/rotateOrder';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord } from './define';
import { pollEditable } from './polls';

const ROTATE_ORDERS: readonly RotateOrder[] = ['xyz', 'yzx', 'zxy', 'xzy', 'yxz', 'zyx'];

const setRotateOrder = defineOperator({
  id: 'rig.setRotateOrder',
  label: 'Rotate Order',
  description: "Change a control's rotate order; its curves are converted so the motion stays the same.",
  category: 'rig',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
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
    changeRotateOrder(app, tx, control, args.order);
  },
});

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
