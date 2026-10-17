// View and rig operators owned by WP-7b (MVP-SPEC §4.9): tools, manipulator size and space, navigation profile,
// control size, secondary controls. The pane, camera and framing operators belong to the viewport (WP-5).
import { EkzaError } from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import { GLOBAL_SCOPE, type ManipSpace, type NavProfile, PANEL } from '../../types';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord, OK } from './define';
import { pollEditable } from './polls';

/** Manipulator size limits in CSS px (§4.9 `view.manipulatorSize`). */
export const MANIPULATOR_SIZE = { min: 40, max: 200 } as const;
const NAV_PROFILES: readonly NavProfile[] = ['maya', 'trackpad', 'mayaOneButton'];
const SPACES: readonly ManipSpace[] = ['object', 'world', 'gimbal'];

const viewTool = defineOperator({
  id: 'view.tool',
  label: 'Tool',
  description: 'Choose the viewport tool (Q select, W move, E rotate) or the Graph Editor tool (Q, W, I insert).',
  category: 'view',
  scope: GLOBAL_SCOPE,
  poll({ app }, args) {
    if (!isRecord(args) || typeof args['panel'] !== 'string' || typeof args['tool'] !== 'string') {
      return fail('expects { panel, tool }');
    }
    const { panel, tool } = args;
    if (panel !== PANEL.viewport && panel !== PANEL.graph) return fail(`The ${panel} panel has no tools`);
    // Tools register with their panels; before that (headless) any id is accepted.
    const tools = app.tools.list(panel);
    return tools.length === 0 || app.tools.get(panel, tool) !== undefined
      ? OK
      : fail(`Unknown ${panel} tool '${tool}'`);
  },
  apply({ app }, args) {
    const tools = app.session.getState().tools;
    const key = args.panel === PANEL.graph ? 'graph' : 'viewport';
    if (tools[key] !== args.tool) app.session.setState({ tools: { ...tools, [key]: args.tool } });
  },
});

const manipulatorSize = defineOperator({
  id: 'view.manipulatorSize',
  label: 'Manipulator Size',
  description: 'Grow or shrink the manipulators (40–200 px).',
  category: 'view',
  scope: GLOBAL_SCOPE,
  poll: (_ctx, args) => (isRecord(args) && isFiniteNumber(args['delta']) ? OK : fail('expects { delta }')),
  apply({ app }, args) {
    const tools = app.session.getState().tools;
    const size = Math.min(MANIPULATOR_SIZE.max, Math.max(MANIPULATOR_SIZE.min, tools.manipulatorSize + args.delta));
    if (size !== tools.manipulatorSize) app.session.setState({ tools: { ...tools, manipulatorSize: size } });
  },
});

const setManipSpace = defineOperator({
  id: 'view.setManipSpace',
  label: 'Manipulator Space',
  description: 'Object or world space for the move tool; object, world or gimbal for the rotate tool.',
  category: 'view',
  scope: GLOBAL_SCOPE,
  poll(_ctx, raw) {
    const args: unknown = raw;
    if (!isRecord(args) || (args['tool'] !== 'move' && args['tool'] !== 'rotate'))
      return fail('expects { tool, space }');
    if (!SPACES.includes(args['space'] as ManipSpace)) return fail("space is 'object', 'world' or 'gimbal'");
    return args['tool'] === 'move' && args['space'] === 'gimbal' ? fail('Gimbal space is for the rotate tool') : OK;
  },
  apply({ app }, args) {
    if (args.tool === 'move') {
      if (args.space === 'gimbal') throw new EkzaError('unsupported', 'Gimbal space is for the rotate tool');
      app.prefs.setState({ moveSpace: args.space });
    } else {
      app.prefs.setState({ rotateSpace: args.space });
    }
  },
});

const setNavProfile = defineOperator({
  id: 'view.setNavProfile',
  label: 'Navigation',
  description: 'Maya (three-button mouse) or trackpad navigation.',
  category: 'view',
  scope: GLOBAL_SCOPE,
  poll(_ctx, raw) {
    const args: unknown = raw;
    return isRecord(args) && NAV_PROFILES.includes(args['profile'] as NavProfile)
      ? OK
      : fail(`expects { profile: ${NAV_PROFILES.join(' | ')} }`);
  },
  apply({ app }, args) {
    app.prefs.setState({ navProfile: args.profile });
  },
});

const setRotateOrder = defineOperator({
  id: 'rig.setRotateOrder',
  label: 'Rotate Order',
  description: "Change a control's rotate order keeping its pose (M1-stretch).",
  category: 'rig',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  poll: () => fail('not available yet'),
  apply() {
    throw new EkzaError('not-implemented', 'rig.setRotateOrder is an M1-stretch item');
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

export const VIEW_OPERATORS: readonly AnyOperator[] = [
  viewTool,
  manipulatorSize,
  setManipSpace,
  setNavProfile,
  setRotateOrder,
  setControlSize,
  toggleSecondary,
];
