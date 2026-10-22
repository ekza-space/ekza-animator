// The Rig & Skin menu set (M6B-SPEC §0.4.5, §8.4; C7): every item names its operator with `workspaces: ['rig']`, so
// Model and Animate never list it. Only what works in the MVP is listed (Q-MVP-15: deferred items are absent, not
// disabled stubs). Registered by the lazy rig shell (`shell/rig/register.ts`) on the first Rig & Skin entry; the
// menu ids are the eager `RIG_MENUS`. Items whose arguments come from the active skeleton or the lead joint
// (Skeleton › Symmetry X ✓, Map Humanoid Bone ▸) are re-registered when those change (`registerRigDynamicMenus`).
import type { Disposer } from '@ekza-studio/anim-core';
import type { HumanBoneName, JointId, SkeletonRecord } from '@ekza-studio/doc';
import { type EditorApp, type MenuItemDef, type OperatorId, PANEL, paneDisplayPort } from '@ekza-studio/editor-core';
import { HUMAN_BONE_NAMES } from '@ekza-studio/rig';
import { JOINT_SIZES } from '../rig/operators';

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
  // Display (§0.4.5).
  ...rig(
    'display.joint-size',
    'sizes',
    JOINT_SIZES.map(
      ([size, label]): Row => [
        `size${size}`,
        'rig.jointSize.set',
        { size },
        label,
        (app) => app.prefs.getState().rigging.jointSize === size,
      ],
    ),
  ),
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
  ...rig(
    'skeleton',
    'options',
    [
      [
        'snapCenter',
        'rig.snap.projectedCenter',
        undefined,
        'Snap to Projected Center',
        (app) => app.session.getState().rig.snap.projectedCenter,
      ],
    ],
    410,
  ),
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

/** The active character's live skeleton, or undefined. */
function activeSkeleton(app: EditorApp): SkeletonRecord | undefined {
  const character = app.session.getState().rig.character;
  const skeleton = character === null ? undefined : app.store.query.skeletonOfCharacter(character);
  return skeleton?.deleted === null ? skeleton : undefined;
}

/** The lead (last) selected live joint, or null. */
function leadJoint(app: EditorApp): JointId | null {
  const joints = app.session.getState().selection.joints;
  const lead = joints[joints.length - 1];
  return lead !== undefined && app.store.get('joints', lead)?.deleted === null ? lead : null;
}

const FINGERS = /(Thumb|Index|Middle|Ring|Little)/;
/** Map Humanoid Bone ▸ groups: centre, the left and right limbs, then the fingers of each hand. */
function boneGroup(bone: HumanBoneName): readonly [string, number] {
  const side = bone.startsWith('left') ? 'left' : bone.startsWith('right') ? 'right' : null;
  if (side === null) return ['center', 0];
  return FINGERS.test(bone) ? [`${side}-fingers`, side === 'left' ? 3 : 4] : [side, side === 'left' ? 1 : 2];
}

/** Skeleton › Symmetry X ✓ and Map Humanoid Bone ▸ for this skeleton and lead joint (no args: poll-fails). */
export function rigDynamicMenuItems(skeleton: SkeletonRecord | undefined, joint: JointId | null): MenuItemDef[] {
  const symmetry: MenuItemDef = {
    id: 'rig.skeleton.symmetry',
    menu: 'skeleton',
    group: 'options',
    order: 400,
    op: 'skel.symmetry.set',
    ...(skeleton === undefined ? {} : { args: { skeleton: skeleton.id, on: !skeleton.symmetry } }),
    label: 'Symmetry X',
    workspaces: RIG,
    checked: () => skeleton?.symmetry === true,
  };
  const bones: MenuItemDef[] = [null, ...HUMAN_BONE_NAMES].map((bone, index) => {
    const [group, rank] = bone === null ? ['none', 5] : boneGroup(bone);
    return {
      id: `rig.skeleton.map-humanoid-bone.${bone ?? 'none'}`,
      menu: 'skeleton.map-humanoid-bone',
      group,
      order: rank * 1000 + index,
      op: 'skel.joint.setHumanBone',
      ...(joint === null ? {} : { args: { joint, bone } }),
      label: bone ?? 'None',
      workspaces: RIG,
      checked: (app: EditorApp) => joint !== null && (app.store.get('joints', joint)?.humanBone ?? null) === bone,
    };
  });
  return [symmetry, ...bones];
}

/** Keeps the selection-dependent Skeleton items current (re-registered when the skeleton or the lead joint changes). */
export function registerRigDynamicMenus(app: EditorApp): Disposer {
  let key: string | null = null;
  let items: Disposer[] = [];
  const refresh = (): void => {
    const skeleton = activeSkeleton(app);
    const joint = leadJoint(app);
    const next = `${skeleton?.id ?? '-'}:${String(skeleton?.symmetry)}:${joint ?? '-'}`;
    if (next === key) return;
    key = next;
    for (const dispose of items.splice(0)) dispose();
    items = rigDynamicMenuItems(skeleton, joint).map((def) => app.contribute({ kind: 'menu', def }));
  };
  refresh();
  const offs = [app.session.subscribe(refresh), app.store.subscribe(refresh)];
  return () => {
    for (const off of offs) off();
    for (const dispose of items.splice(0)) dispose();
  };
}
