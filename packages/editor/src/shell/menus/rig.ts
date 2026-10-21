// The Rig & Skin menu set (M6B-SPEC §0.4.5, §8.4; C7): every item names its operator with `workspaces: ['rig']`, so
// Model and Animate never list it. Only what works in the MVP is listed (Q-MVP-15: deferred items are absent, not
// disabled stubs). Items whose arguments depend on the selection (Symmetry X, Snap to Projected Center, Map Humanoid
// Bone) live in the status line and the Rig Toolkit, which compute them. Registered by the lazy rig shell
// (`shell/rig/register.ts`) on the first Rig & Skin entry; the menu ids are the eager `RIG_MENUS`.
import { type EditorApp, type MenuItemDef, type OperatorId, PANEL, paneDisplayPort } from '@ekza-studio/editor-core';

const RIG = ['rig'] as const;

/** `[name, op, args?, label?, checked?]` */
type Row = readonly [string, OperatorId, unknown?, string?, ((app: EditorApp) => boolean)?];

function rig(menu: string, group: string, rows: readonly Row[], base = 100): MenuItemDef[] {
  return rows.map(([name, op, args, label, checked], index) => ({
    id: `rig.${menu}.${name}`,
    menu,
    group,
    order: base + index * 10,
    op,
    ...(args === undefined ? {} : { args }),
    ...(label === undefined ? {} : { label }),
    workspaces: RIG,
    ...(checked === undefined ? {} : { checked }),
  }));
}

/** A display flag of the active pane (Display menu check marks). */
function paneFlag<K extends 'xrayJoints' | 'jointAxes' | 'jointLabels' | 'weights'>(app: EditorApp, flag: K): unknown {
  const port = paneDisplayPort(app);
  const pane = port?.activePane() ?? null;
  return pane === null ? undefined : port?.display(pane)?.[flag];
}
const display = (patch: Readonly<Record<string, unknown>>): unknown => ({ patch });
const displayRow = (name: string, flag: 'jointAxes' | 'jointLabels' | 'weights', value: string, label: string): Row => [
  name,
  'view.display.set',
  display({ [flag]: value }),
  label,
  (app) => paneFlag(app, flag) === value,
];

const PRESETS = [
  ['lite17', 'Lite 17'],
  ['core21', 'Core 21'],
  ['standard33', 'Standard 33'],
  ['full52', 'Full 52'],
] as const;

export const RIG_MENU_ITEMS: readonly MenuItemDef[] = [
  // File (§0.4.5): the character exports.
  ...rig(
    'file',
    'rig-character',
    [
      ['exportCharacter', 'ui.open', { dialog: 'export' }, 'Export Character…'],
      ['vrmMeta', 'ui.open', { dialog: 'vrmMeta' }, 'VRM Meta…'],
      ['renderThumbnail', 'char.renderThumbnail', undefined, 'Render Thumbnail'],
    ],
    650,
  ),
  // Create: templates and a character from the selected meshes.
  ...rig(
    'create.skeleton-template',
    'templates',
    PRESETS.map(([preset, label]): Row => [preset, 'skel.template.create', { preset }, label]),
  ),
  ...rig('create', 'character', [['fromModel', 'char.fromModel', undefined, 'Character from Selection']], 200),
  // Select: the modes.
  ...rig('select.mode', 'modes', [
    ['object', 'rig.mode', { mode: 'object' }, 'Object', (app) => app.session.getState().rig.mode === 'object'],
    ['skeleton', 'rig.mode', { mode: 'skeleton' }, 'Skeleton', (app) => app.session.getState().rig.mode === 'skeleton'],
    ['skin', 'rig.mode', { mode: 'skin' }, 'Skin', (app) => app.session.getState().rig.mode === 'skin'],
  ]),
  ...rig('select', 'joints', [['allJoints', 'select.joints', { all: true }, 'All Joints']], 300),
  // Modify.
  ...rig('modify', 'pose', [['resetTest', 'rig.pose.resetTest', undefined, 'Reset Test Pose']]),
  // Display (§0.4.5): Joint Size lives in the status line (it edits a preference by steps).
  ...rig('display', 'joints', [
    [
      'xrayJoints',
      'view.display.toggle',
      { flag: 'xrayJoints' },
      'X-Ray Joints',
      (app) => paneFlag(app, 'xrayJoints') === true,
    ],
  ]),
  ...rig('display.local-rotation-axes', 'axes', [
    displayRow('none', 'jointAxes', 'none', 'None'),
    displayRow('selected', 'jointAxes', 'selected', 'Selected'),
    displayRow('all', 'jointAxes', 'all', 'All'),
  ]),
  ...rig('display.joint-labels', 'labels', [
    displayRow('none', 'jointLabels', 'none', 'None'),
    displayRow('hover', 'jointLabels', 'hover', 'On Hover'),
    displayRow('all', 'jointLabels', 'all', 'All'),
  ]),
  ...rig('display.weight-display', 'weights', [
    displayRow('greyscale', 'weights', 'greyscale', 'Greyscale'),
    displayRow('ramp', 'weights', 'ramp', 'Ramp'),
    displayRow('influences', 'weights', 'influences', 'Influence Colours'),
  ]),
  // Skeleton (§0.4.5).
  ...rig('skeleton', 'build', [
    ['quickRig', 'skel.quickRig.start', undefined, 'Quick Rig…'],
    ['orient', 'skel.joint.orient', undefined, 'Orient Joints…'],
    ['mirror', 'skel.joint.mirror', undefined, 'Mirror Joints…'],
  ]),
  ...rig(
    'skeleton.skeleton-template',
    'templates',
    PRESETS.map(([preset, label]): Row => [preset, 'skel.template.create', { preset }, label]),
  ),
  ...rig('skeleton', 'rig', [['updateControlRig', 'rig.autoRig.update', undefined, 'Update Control Rig']], 300),
  // Skin (§0.4.5).
  ...rig('skin', 'bind', [
    ['bind', 'skin.bind', undefined, 'Bind Skin…'],
    ['unbind', 'skin.unbind', undefined, 'Unbind Skin'],
    ['bindPose', 'rig.pose.view', { view: 'bind' }, 'Go to Bind Pose'],
  ]),
  ...rig(
    'skin',
    'weights',
    [
      ['paint', 'view.tool', { panel: 'viewport', tool: 'paintSkinWeights' }, 'Paint Skin Weights'],
      ['mirror', 'skin.weights.mirror', undefined, 'Mirror Skin Weights…'],
      ['smooth', 'skin.weights.smooth', undefined, 'Smooth Skin Weights…'],
      ['prune', 'skin.weights.prune', undefined, 'Prune Small Weights…'],
      ['normalize', 'skin.weights.normalize', undefined, 'Normalize Weights'],
      ['compact', 'skin.palette.compact', undefined, 'Remove Unused Influences'],
    ],
    200,
  ),
  // Windows (§0.4.5): the Rig & Skin panels (Clip Library is listed everywhere from the Animate slots).
  ...rig(
    'windows',
    'panels',
    [
      ['rigToolkit', 'workspace.showPanel', { panel: PANEL.rigToolkit }, 'Rig Toolkit'],
      ['paintWeights', 'workspace.showPanel', { panel: PANEL.paintWeights }, 'Paint Weights'],
      ['validation', 'workspace.showPanel', { panel: PANEL.validation }, 'Validation'],
    ],
    160,
  ),
];
