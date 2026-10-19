// View operators owned by WP-7b (MVP-SPEC §4.9): tools, manipulator size and space, navigation profile, and camera
// settings (WP-9 R-3). The pane, camera navigation and framing operators belong to the viewport (WP-5).
import { EkzaError } from '@ekza-animator/anim-core';
import type { CameraId } from '@ekza-animator/doc';
import {
  DOPE_TOOL,
  type EditorApp,
  GLOBAL_SCOPE,
  GRAPH_TOOL,
  type ManipSpace,
  type NavProfile,
  PANEL,
  VIEWPORT_TOOL,
} from '../../types';
import { isTransformTool } from '../../workspaces/switch';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord, OK } from './define';
import { pollEditable } from './polls';
import { NOT_AVAILABLE_YET } from './stub';

/** Manipulator size limits in CSS px (§4.9 `view.manipulatorSize`). */
export const MANIPULATOR_SIZE = { min: 40, max: 200 } as const;
const NAV_PROFILES: readonly NavProfile[] = ['maya', 'trackpad', 'mayaOneButton'];
const SPACES: readonly ManipSpace[] = ['object', 'world', 'gimbal'];

/** Panels with tools and the `ToolState` field each one writes (M2a: the Dope Sheet). */
const TOOL_FIELD = {
  [PANEL.viewport]: 'viewport',
  [PANEL.graph]: 'graph',
  [PANEL.dopeSheet]: 'dopeSheet',
} as const satisfies Readonly<Record<string, 'viewport' | 'graph' | 'dopeSheet'>>;
const DOPE_TOOLS: ReadonlySet<string> = new Set(Object.values(DOPE_TOOL));
/** The built-in tool ids of the panels whose tools grow in M2a (§4.5 `GRAPH_TOOL`, `DOPE_TOOL`) and M6a (§4.6
 *  `VIEWPORT_TOOL`: scale, Multi-Cut, Insert Edge Loop, Target Weld, Slide, Paint Colour, the extrude manipulator). */
const BUILTIN_TOOLS: Readonly<Record<string, ReadonlySet<string>>> = {
  [PANEL.graph]: new Set(Object.values(GRAPH_TOOL)),
  [PANEL.dopeSheet]: DOPE_TOOLS,
  [PANEL.viewport]: new Set(Object.values(VIEWPORT_TOOL)),
};

const viewTool = defineOperator({
  id: 'view.tool',
  label: 'Tool',
  description:
    'Choose the viewport tool (Q select, W move, E rotate, R scale; the Model tools), the Graph Editor tool (Q, W, ' +
    'I insert, R scale) or the Dope Sheet tool (Q, W, R scale).',
  category: 'view',
  scope: GLOBAL_SCOPE,
  poll({ app }, args) {
    if (!isRecord(args) || typeof args['panel'] !== 'string' || typeof args['tool'] !== 'string') {
      return fail('expects { panel, tool }');
    }
    const { panel, tool } = args;
    if (!Object.hasOwn(TOOL_FIELD, panel)) return fail(`The ${panel} panel has no tools`);
    // Tools register with their panels; before that (headless, or a Dope Sheet that has not mounted yet) any id of
    // the panel's built-in set is accepted (M2A-SPEC §4.5 DOPE_TOOL; any id for the viewport and Graph Editor).
    const tools = app.tools.list(panel);
    if (tools.length === 0) {
      return panel !== PANEL.dopeSheet || DOPE_TOOLS.has(tool) ? OK : fail(`Unknown ${panel} tool '${tool}'`);
    }
    if (app.tools.get(panel, tool) !== undefined) return OK;
    // A built-in tool whose owner has not registered it yet (the Graph Editor's M2a scale tool, A4; a Dope Sheet tool,
    // A3) is an M2a feature that is not there yet (§3 rule 1), not an unknown id: `R` over the Graph Editor says so.
    return BUILTIN_TOOLS[panel]?.has(tool) === true ? fail(NOT_AVAILABLE_YET) : fail(`Unknown ${panel} tool '${tool}'`);
  },
  apply({ app }, args) {
    const session = app.session.getState();
    const tools = session.tools;
    const key = TOOL_FIELD[args.panel as keyof typeof TOOL_FIELD];
    if (key === undefined) throw new EkzaError('unsupported', `The ${args.panel} panel has no tools`);
    // M6a (§6.2): in Model the last non-transform viewport tool is what `Y` re-activates (Maya's "last tool").
    const model =
      session.workspace === 'model' &&
      key === 'viewport' &&
      !isTransformTool(args.tool) &&
      session.model.lastTool !== args.tool
        ? { ...session.model, lastTool: args.tool }
        : session.model;
    if (tools[key] !== args.tool || model !== session.model) {
      app.session.setState({ tools: { ...tools, [key]: args.tool }, model });
    }
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
