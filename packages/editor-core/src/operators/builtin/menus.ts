// Built-in menu-bar items (ADR 0008 menu registry). Menu ids: top-level `file`, `edit`, `select`, `key`, `pose`,
// `clip`, `graph`, `time`, `rig`, `view`, and Model's `create`, `modify`, `display`, `mesh`, `edit-mesh`,
// `mesh-tools`, `mesh-display`, `uv` (M6A-SPEC §8.3); a dotted id is a submenu (`graph.tangents`). The shell adds its own items
// (dialogs, windows, help); the time slider owns `timeline.context`. Enabled state and shortcut labels come from the
// operators' polls and the keymap.
import type { InfinityMode, TangentType } from '@ekza-studio/anim-core';
import type { LimbId } from '@ekza-studio/rig';
import type { GraphViewMode, MenuItemDef, TweenMode, WorkspaceId } from '../../types';

type Item = Omit<MenuItemDef, 'id'> & { readonly name: string };

function items(menu: string, group: string, list: readonly Omit<Item, 'menu' | 'group' | 'order'>[]): MenuItemDef[] {
  return list.map((item, index) => ({
    id: `builtin.${menu}.${item.name}`,
    menu,
    group,
    order: (index + 1) * 10,
    op: item.op,
    ...(item.args === undefined ? {} : { args: item.args }),
    ...(item.label === undefined ? {} : { label: item.label }),
  }));
}

const TANGENTS: readonly (readonly [TangentType, string])[] = [
  ['auto', 'Auto'],
  ['spline', 'Spline'],
  ['clamped', 'Clamped'],
  ['linear', 'Linear'],
  ['flat', 'Flat'],
  ['step', 'Stepped'],
  ['stepNext', 'Stepped Next'],
  ['fixed', 'Fixed'],
  ['plateau', 'Plateau'],
];

const INFINITY: readonly (readonly [InfinityMode, string])[] = [
  ['constant', 'Constant'],
  ['linear', 'Linear'],
  ['cycle', 'Cycle'],
  ['cycleOffset', 'Cycle with Offset'],
  ['oscillate', 'Oscillate'],
];

// ---------- M2a (M2A-SPEC §7 "Menus") ----------

const TWEENS: readonly (readonly [TweenMode, string])[] = [
  ['tween', 'Tween'],
  ['neighbor', 'Blend to Neighbour'],
  ['ease', 'Ease'],
  ['pushPull', 'Push/Pull'],
  ['toDefault', 'Blend to Default'],
];

const LIMBS: readonly (readonly [LimbId, string])[] = [
  ['leg.L', 'L Leg'],
  ['leg.R', 'R Leg'],
  ['arm.L', 'L Arm'],
  ['arm.R', 'R Arm'],
];

const GRAPH_VIEWS: readonly (readonly [GraphViewMode, string])[] = [
  ['absolute', 'Absolute'],
  ['normalized', 'Normalized'],
  ['stacked', 'Stacked'],
];

const MIRROR_MODES = [
  ['flip', 'Flip'],
  ['leftToRight', 'Left → Right'],
  ['rightToLeft', 'Right → Left'],
] as const;

/** Rig › IK/FK: per limb, switch, match and match range (the limb is an argument of every IK/FK operator). */
const IK_FK_ITEMS: readonly MenuItemDef[] = LIMBS.flatMap(([limb, name], l) =>
  items('rig.ik-fk', `limb-${limb}`, [
    { name: `${limb}.toIk`, op: 'rig.ikFk.switch', args: { limb, to: 'ik' }, label: `Switch ${name} to IK` },
    { name: `${limb}.toFk`, op: 'rig.ikFk.switch', args: { limb, to: 'fk' }, label: `Switch ${name} to FK` },
    { name: `${limb}.matchFk`, op: 'rig.ikFk.match', args: { limb, side: 'fk' }, label: `Match ${name} FK to IK` },
    { name: `${limb}.matchIk`, op: 'rig.ikFk.match', args: { limb, side: 'ik' }, label: `Match ${name} IK to FK` },
    {
      name: `${limb}.rangeFk`,
      op: 'rig.ikFk.matchRange',
      args: { limb, side: 'fk' },
      label: `Match Range ${name} to FK`,
    },
    {
      name: `${limb}.rangeIk`,
      op: 'rig.ikFk.matchRange',
      args: { limb, side: 'ik' },
      label: `Match Range ${name} to IK`,
    },
    // Fix round 1: matching to IK keys the key times only (§5.6 default) and warns when the in-betweens move; this
    // item matches every frame instead.
    {
      name: `${limb}.rangeIkFrames`,
      op: 'rig.ikFk.matchRange',
      args: { limb, side: 'ik', step: 'frames' },
      label: `Match Range ${name} to IK (Every Frame)`,
    },
  ]).map((item) => ({ ...item, order: item.order + l * 100 })),
);

const M2A_MENU_ITEMS: readonly MenuItemDef[] = [
  ...items('file', 'recovery', [{ name: 'autosaveNow', op: 'file.autosaveNow', label: 'Save Recovery Point' }]),

  ...items('key', 'breakdown', [
    { name: 'setBreakdown', op: 'key.set', args: { breakdown: true }, label: 'Set Breakdown' },
    { name: 'toBreakdown', op: 'key.convert', args: { to: 'breakdown' }, label: 'Convert to Breakdown' },
    { name: 'toKey', op: 'key.convert', args: { to: 'key' }, label: 'Convert to Key' },
  ]),
  ...items('key', 'ripple', [{ name: 'ripple', op: 'key.toggleRipple', label: 'Ripple Edit' }]),
  ...items(
    'key.tween',
    'tween',
    TWEENS.flatMap(([mode, label]) => [
      { name: `${mode}-50`, op: 'key.tween', args: { mode, amount: -50 }, label: `${label} −50` },
      { name: `${mode}+50`, op: 'key.tween', args: { mode, amount: 50 }, label: `${label} +50` },
    ]),
  ),
  ...items('key.key-target', 'target', [
    { name: 'selected', op: 'key.setTarget', args: { target: 'selected' }, label: 'Selected Controls' },
    { name: 'bodyPart', op: 'key.setTarget', args: { target: 'bodyPart' }, label: 'Body Part' },
    { name: 'character', op: 'key.setTarget', args: { target: 'character' }, label: 'Character' },
  ]),

  ...items(
    'pose.mirror-animation',
    'mirror',
    MIRROR_MODES.map(([mode, label]) => ({
      name: mode,
      op: 'pose.mirrorAnimation',
      args: { mode, offset: 'none' },
      label,
    })),
  ),
  ...items(
    'pose.mirror-animation',
    'halfCycle',
    MIRROR_MODES.map(([mode, label]) => ({
      name: `${mode}-half`,
      op: 'pose.mirrorAnimation',
      args: { mode, offset: 'halfCycle' },
      label: `${label} (half cycle)`,
    })),
  ),

  ...items('rig', 'ik', [{ name: 'addLimbIk', op: 'rig.addLimbIk', label: 'Add Limb IK' }]),
  ...IK_FK_ITEMS,

  // Time › Insert Frame / Remove Frame act at the current frame (`time.insertTime` without `at`); Delete Time removes
  // the band's frames, or the current frame without a band (`time.deleteTime` without `range`), M2A-SPEC §5.9.
  ...items('time', 'insert', [
    { name: 'insertFrame', op: 'time.insertTime', args: { frames: 1 }, label: 'Insert Frame' },
    { name: 'removeFrame', op: 'time.insertTime', args: { frames: -1 }, label: 'Remove Frame' },
    { name: 'deleteTime', op: 'time.deleteTime', label: 'Delete Time' },
  ]),

  ...items('graph.buffer', 'buffer', [
    { name: 'snapshot', op: 'graph.buffer.snapshot', label: 'Snapshot' },
    { name: 'swap', op: 'graph.buffer.swap', label: 'Swap' },
    { name: 'clear', op: 'graph.buffer.clear', label: 'Clear' },
  ]),
  ...items(
    'graph.view',
    'view',
    GRAPH_VIEWS.map(([mode, label]) => ({ name: mode, op: 'graph.view.setMode', args: { mode }, label })),
  ),
];

// ---------- M6a: the Model menu set (M6A-SPEC §8.1, §8.3; B0b) ----------
// The Model menu items live in `./modelMenus` (the Model operators chunk, M6A-INT-13): they register once that chunk
// has loaded (the first Model entry); the menu ids of Model's menu bar stay here (`WorkspaceDef.menus`).

const ANIMATE: readonly WorkspaceId[] = ['animate'];

/** The Model workspace's menu-bar menus in order (§8.1): the data of its `WorkspaceDef.menus` (B9 registers Model). */
export const MODEL_MENUS: readonly string[] = [
  'file',
  'edit',
  'create',
  'select',
  'modify',
  'display',
  'mesh',
  'edit-mesh',
  'mesh-tools',
  'mesh-display',
  'uv',
  'windows',
  'help',
];

function inWorkspaces(workspaces: readonly WorkspaceId[], list: readonly MenuItemDef[]): MenuItemDef[] {
  return list.map((item) => ({ ...item, workspaces }));
}

export const BUILTIN_MENU_ITEMS: readonly MenuItemDef[] = [
  ...items('file', 'new', [{ name: 'new', op: 'file.new', label: 'New Project' }]),
  ...items('file', 'save', [
    { name: 'save', op: 'file.save', label: 'Save' },
    { name: 'saveAs', op: 'file.saveAs', label: 'Save As…' },
    { name: 'saveJson', op: 'file.saveJson', label: 'Save Debug JSON' },
  ]),
  ...items('file.samples', 'samples', [
    { name: 'seed-san', op: 'file.loadSample', args: { sample: 'seed-san' }, label: 'Seed-san (VRM 1.0)' },
    { name: 'polybot', op: 'file.loadSample', args: { sample: 'polybot' }, label: 'Polybot (VRM 0.x)' },
    {
      name: 'quaternius-ual',
      op: 'file.loadSample',
      args: { sample: 'quaternius-ual' },
      label: 'Quaternius Animation Library (GLB)',
    },
  ]),

  ...items('edit', 'history', [
    { name: 'undo', op: 'edit.undo' },
    { name: 'redo', op: 'edit.redo' },
  ]),
  // M6a: the pose clipboard and control selection act on controls, which Model never shows (its own Edit and
  // Select items follow); Animate lists them exactly as shipped.
  ...inWorkspaces(ANIMATE, [
    ...items('edit', 'clipboard', [
      { name: 'copy', op: 'edit.copy' },
      { name: 'paste', op: 'edit.paste' },
      { name: 'delete', op: 'edit.delete' },
    ]),
    ...items('select', 'controls', [
      { name: 'all', op: 'select.all' },
      { name: 'none', op: 'select.none' },
      { name: 'mirror', op: 'select.mirror' },
    ]),
  ]),

  ...items('key', 'set', [
    { name: 'set', op: 'key.set', args: { channels: 'all' }, label: 'Set Key' },
    { name: 'translate', op: 'key.set', args: { channels: 'translate' }, label: 'Key Translate' },
    { name: 'rotate', op: 'key.set', args: { channels: 'rotate' }, label: 'Key Rotate' },
    { name: 'scale', op: 'key.set', args: { channels: 'scale' }, label: 'Key Scale' },
  ]),
  ...items('key', 'delete', [{ name: 'deleteAtFrame', op: 'key.deleteAtFrame' }]),
  ...items('key', 'auto', [{ name: 'autoKey', op: 'key.toggleAutoKey', label: 'Toggle Auto Key' }]),

  ...items('pose', 'clipboard', [
    { name: 'copy', op: 'pose.copy' },
    { name: 'paste', op: 'pose.paste' },
    { name: 'pasteMirrored', op: 'pose.paste', args: { mirrored: true }, label: 'Paste Pose Mirrored' },
  ]),
  ...items('pose', 'mirror', [
    { name: 'flip', op: 'pose.mirror', args: { mode: 'flip' }, label: 'Flip Pose' },
    { name: 'leftToRight', op: 'pose.mirror', args: { mode: 'leftToRight' }, label: 'Mirror Left → Right' },
    { name: 'rightToLeft', op: 'pose.mirror', args: { mode: 'rightToLeft' }, label: 'Mirror Right → Left' },
  ]),
  ...items('pose', 'reset', [{ name: 'reset', op: 'pose.resetToRest' }]),
  ...items('pose', 'feet', [
    { name: 'pinFeet', op: 'pose.pinFeet' },
    { name: 'plantFeet', op: 'pose.plantFeet' },
    { name: 'unpinFeet', op: 'pose.unpinFeet' },
  ]),

  ...items('clip', 'new', [{ name: 'new', op: 'clip.new' }]),

  ...items(
    'graph.tangents',
    'types',
    TANGENTS.map(([type, label]) => ({ name: type, op: 'graph.tangent.set', args: { type }, label })),
  ),
  ...items('graph.tangents', 'unify', [
    { name: 'break', op: 'graph.tangent.break' },
    { name: 'unify', op: 'graph.tangent.unify' },
  ]),
  ...items('graph.tangents', 'weights', [
    { name: 'weighted', op: 'graph.curve.setWeighted', args: { weighted: true }, label: 'Weighted Tangents' },
    { name: 'nonWeighted', op: 'graph.curve.setWeighted', args: { weighted: false }, label: 'Non-weighted Tangents' },
    { name: 'lockWeight', op: 'graph.tangent.lockWeight', args: { locked: true }, label: 'Lock Tangent Weight' },
    { name: 'freeWeight', op: 'graph.tangent.lockWeight', args: { locked: false }, label: 'Free Tangent Weight' },
  ]),
  ...items(
    'graph.infinity',
    'pre',
    INFINITY.map(([mode, label]) => ({
      name: `pre-${mode}`,
      op: 'graph.infinity.set',
      args: { pre: mode },
      label: `Pre: ${label}`,
    })),
  ),
  ...items(
    'graph.infinity',
    'post',
    INFINITY.map(([mode, label]) => ({
      name: `post-${mode}`,
      op: 'graph.infinity.set',
      args: { post: mode },
      label: `Post: ${label}`,
    })),
  ),
  ...items('graph.curves', 'curves', [
    { name: 'eulerFilter', op: 'graph.eulerFilter' },
    { name: 'simplify', op: 'graph.curves.simplify' },
  ]),
  ...items('graph', 'keys', [
    { name: 'keyCurves', op: 'graph.keys.keyCurves', label: 'Key Curves at Current Frame' },
    { name: 'copy', op: 'graph.keys.copy' },
    { name: 'paste', op: 'graph.keys.paste' },
    { name: 'pasteReplace', op: 'graph.keys.paste', args: { mode: 'replace' }, label: 'Paste Keys (Replace)' },
    { name: 'delete', op: 'graph.keys.delete' },
  ]),

  ...items('time', 'play', [
    { name: 'togglePlay', op: 'time.togglePlay' },
    { name: 'playBackwards', op: 'time.play', args: { direction: -1 }, label: 'Play Backwards' },
    { name: 'stop', op: 'time.stop' },
  ]),
  ...items('time', 'go', [
    { name: 'start', op: 'time.goToStart' },
    { name: 'end', op: 'time.goToEnd' },
    { name: 'prevKey', op: 'time.prevKey' },
    { name: 'nextKey', op: 'time.nextKey' },
    { name: 'prevFrame', op: 'time.step', args: { delta: -1 }, label: 'Previous Frame' },
    { name: 'nextFrame', op: 'time.step', args: { delta: 1 }, label: 'Next Frame' },
  ]),
  ...items('time.loop', 'loop', [
    { name: 'loop', op: 'time.setLoop', args: { loop: 'loop' }, label: 'Loop' },
    { name: 'once', op: 'time.setLoop', args: { loop: 'once' }, label: 'Play Once' },
    { name: 'oscillate', op: 'time.setLoop', args: { loop: 'oscillate' }, label: 'Oscillate' },
  ]),
  ...items('time.speed', 'speed', [
    { name: 'realtime', op: 'time.setSpeed', args: { speed: 'realtime' }, label: 'Real Time' },
    { name: 'everyFrame', op: 'time.setSpeed', args: { speed: 'every-frame' }, label: 'Every Frame' },
    { name: 'half', op: 'time.setSpeed', args: { speed: 'half' }, label: 'Half Speed' },
    { name: 'double', op: 'time.setSpeed', args: { speed: 'double' }, label: 'Double Speed' },
  ]),

  ...items('rig', 'display', [{ name: 'secondary', op: 'rig.toggleSecondary' }]),

  ...items('view.tools', 'tools', [
    { name: 'select', op: 'view.tool', args: { panel: 'viewport', tool: 'select' }, label: 'Select Tool' },
    { name: 'move', op: 'view.tool', args: { panel: 'viewport', tool: 'move' }, label: 'Move Tool' },
    { name: 'rotate', op: 'view.tool', args: { panel: 'viewport', tool: 'rotate' }, label: 'Rotate Tool' },
  ]),
  ...items('view.space', 'move', [
    { name: 'moveObject', op: 'view.setManipSpace', args: { tool: 'move', space: 'object' }, label: 'Move: Object' },
    { name: 'moveWorld', op: 'view.setManipSpace', args: { tool: 'move', space: 'world' }, label: 'Move: World' },
  ]),
  ...items('view.space', 'rotate', [
    {
      name: 'rotateObject',
      op: 'view.setManipSpace',
      args: { tool: 'rotate', space: 'object' },
      label: 'Rotate: Object',
    },
    { name: 'rotateWorld', op: 'view.setManipSpace', args: { tool: 'rotate', space: 'world' }, label: 'Rotate: World' },
    {
      name: 'rotateGimbal',
      op: 'view.setManipSpace',
      args: { tool: 'rotate', space: 'gimbal' },
      label: 'Rotate: Gimbal',
    },
  ]),
  ...items('view.navigation', 'navigation', [
    { name: 'maya', op: 'view.setNavProfile', args: { profile: 'maya' }, label: 'Maya (three-button mouse)' },
    { name: 'trackpad', op: 'view.setNavProfile', args: { profile: 'trackpad' }, label: 'Trackpad' },
  ]),
  ...items('view.manipulator', 'size', [
    { name: 'smaller', op: 'view.manipulatorSize', args: { delta: -10 }, label: 'Smaller Manipulator' },
    { name: 'larger', op: 'view.manipulatorSize', args: { delta: 10 }, label: 'Larger Manipulator' },
  ]),
  ...M2A_MENU_ITEMS,
];
