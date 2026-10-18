// View operators owned by WP-7b (MVP-SPEC §4.9): tools, manipulator size and space, navigation profile, and camera
// settings (WP-9 R-3). The pane, camera navigation and framing operators belong to the viewport (WP-5).
import { EkzaError } from '@ekza-animator/anim-core';
import type { CameraId } from '@ekza-animator/doc';
import { type EditorApp, GLOBAL_SCOPE, type ManipSpace, type NavProfile, PANEL } from '../../types';
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

function cameraSettingsProblem(app: EditorApp, args: unknown): string | null {
  if (!isRecord(args) || typeof args['camera'] !== 'string') return 'expects { camera, fovY?, near?, far?, aspect? }';
  const camera = app.store.get('cameras', args['camera'] as CameraId);
  if (camera === undefined) return 'The camera does not exist';
  const { fovY, near, far, aspect } = args;
  if (fovY !== undefined && (!isFiniteNumber(fovY) || fovY <= 0 || fovY >= Math.PI)) {
    return 'fovY is an angle between 0 and π radians';
  }
  if (near !== undefined && (!isFiniteNumber(near) || near <= 0)) return 'near must be positive';
  if (far !== undefined && !isFiniteNumber(far)) return 'far must be a number';
  const nextNear = near ?? camera.near;
  const nextFar = far ?? camera.far;
  if (nextFar <= nextNear) return 'far must be beyond near';
  if (aspect !== undefined && aspect !== null && (!isFiniteNumber(aspect) || aspect <= 0)) {
    return 'aspect is a positive width/height ratio or null';
  }
  return null;
}

const cameraSettings = defineOperator({
  id: 'view.camera.setSettings',
  label: 'Camera Settings',
  description: 'Field of view, clip planes and safe-frame aspect of a shot camera.',
  category: 'view',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  undoLabel: () => 'Camera Settings',
  poll({ app }, raw) {
    const problem = cameraSettingsProblem(app, raw);
    return problem === null ? pollEditable(app) : fail(problem);
  },
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'view.camera.setSettings runs in a transaction');
    const camera = tx.get('cameras', args.camera);
    if (camera === undefined) throw new EkzaError('invalid-record', `Camera ${args.camera} does not exist`);
    const patch: { fovY?: number; near?: number; far?: number; aspect?: number | null } = {};
    if (args.fovY !== undefined && args.fovY !== camera.fovY) patch.fovY = args.fovY;
    if (args.near !== undefined && args.near !== camera.near) patch.near = args.near;
    if (args.far !== undefined && args.far !== camera.far) patch.far = args.far;
    if (args.aspect !== undefined && args.aspect !== camera.aspect) patch.aspect = args.aspect;
    if (Object.keys(patch).length > 0) tx.patch('cameras', camera.id, patch);
  },
});

export const VIEW_OPERATORS: readonly AnyOperator[] = [
  viewTool,
  manipulatorSize,
  setManipSpace,
  setNavProfile,
  cameraSettings,
];
