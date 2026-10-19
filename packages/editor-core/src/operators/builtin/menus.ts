// Built-in menu-bar items (ADR 0008 menu registry). Menu ids: top-level `file`, `edit`, `select`, `key`, `pose`,
// `clip`, `graph`, `time`, `rig`, `view`, and Model's `create`, `modify`, `display`, `mesh`, `edit-mesh`,
// `mesh-tools`, `mesh-display`, `uv` (M6A-SPEC §8.3); a dotted id is a submenu (`graph.tangents`). The shell adds its own items
// (dialogs, windows, help); the time slider owns `timeline.context`. Enabled state and shortcut labels come from the
// operators' polls and the keymap.
import type { InfinityMode, TangentType } from '@ekza-animator/anim-core';
import type { LimbId } from '@ekza-animator/rig';
import type { ComponentMode, GraphViewMode, MenuItemDef, OperatorId, TweenMode, WorkspaceId } from '../../types';

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
// Every item names its operator with `workspaces: ['model']`, so the Animate menu bar never shows it; an item with
// `modes` is listed only in those component modes (Edit › Delete and Select › All switch between objects and
// components). Sub-menu ids are dotted (`create.polygon-primitives`); the menu bar title-cases the last part.

const ANIMATE: readonly WorkspaceId[] = ['animate'];
const MODEL: readonly WorkspaceId[] = ['model'];
const OBJECT: readonly ComponentMode[] = ['object'];
const COMPONENT: readonly ComponentMode[] = ['vertex', 'edge', 'face'];

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

/** `[name, op, args?, label?, modes?]` */
type ModelRow = readonly [string, OperatorId, unknown?, string?, (readonly ComponentMode[])?];

/** Model items of one menu group; `base` orders the groups of a menu (100, 200, …). */
function model(menu: string, group: string, rows: readonly ModelRow[], base = 100): MenuItemDef[] {
  return rows.map(([name, op, args, label, modes], index) => ({
    id: `builtin.model.${menu}.${name}`,
    menu,
    group,
    order: base + index * 10,
    op,
    ...(args === undefined ? {} : { args }),
    ...(label === undefined ? {} : { label }),
    workspaces: MODEL,
    ...(modes === undefined ? {} : { modes }),
  }));
}

const tool = (id: string) => ({ panel: 'viewport', tool: id });

const MODEL_MENU_ITEMS: readonly MenuItemDef[] = [
  ...model('edit', 'model-last', [
    ['adjustLast', 'view.lastOpCard', { expand: true, focusPrimary: true }],
    ['repeatLast', 'edit.repeatLast'],
    ['lastTool', 'tool.last'],
  ]),
  ...model(
    'edit',
    'model-scene',
    [
      ['duplicate', 'scene.duplicate'],
      ['group', 'scene.group'],
      ['parent', 'scene.parent'],
      ['unparent', 'scene.unparent'],
      ['deleteObjects', 'scene.delete', undefined, 'Delete', OBJECT],
      ['deleteComponents', 'mesh.delete', undefined, 'Delete', COMPONENT],
    ],
    200,
  ),

  ...model(
    'create.polygon-primitives',
    'primitives',
    (['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] as const).map((kind) => [kind, `mesh.create.${kind}`]),
  ),
  ...model('create.templates', 'templates', [
    ['prop', 'mesh.create.template', { template: 'prop' }, 'Prop'],
    ['handheld', 'mesh.create.template', { template: 'handheld' }, 'Handheld'],
    ['humanoid', 'mesh.create.template', { template: 'humanoid' }, 'Humanoid Guides'],
    ['bodySmooth', 'mesh.create.template', { template: 'humanoidBody', style: 'smooth' }, 'Humanoid Body (Smooth)'],
    [
      'bodySegmented',
      'mesh.create.template',
      { template: 'humanoidBody', style: 'segmented' },
      'Humanoid Body (Segmented)',
    ],
  ]),
  ...model(
    'create.reference-image',
    'reference',
    (['front', 'side', 'top'] as const).map((camera) => [
      camera,
      'imagePlane.import',
      { camera },
      `${camera.charAt(0).toUpperCase()}${camera.slice(1)}…`,
    ]),
  ),
  ...model('create', 'group', [['emptyGroup', 'scene.group', { ids: [] }, 'Empty Group']]),

  ...model('select', 'model-modes', [
    ['objectMode', 'select.mode', { mode: 'object' }, 'Object Mode'],
    ['vertex', 'select.mode', { mode: 'vertex' }, 'Vertex'],
    ['edge', 'select.mode', { mode: 'edge' }, 'Edge'],
    ['face', 'select.mode', { mode: 'face' }, 'Face'],
  ]),
  ...model(
    'select',
    'model-walk',
    [
      ['grow', 'select.mesh.grow', undefined, 'Grow'],
      ['shrink', 'select.mesh.shrink', undefined, 'Shrink'],
      ['edgeLoop', 'select.mesh.convert', { to: 'edge', mode: 'loop' }, 'Edge Loop'],
      ['edgeRing', 'select.mesh.convert', { to: 'edge', mode: 'ring' }, 'Edge Ring'],
      ['border', 'select.mesh.border', undefined, 'Border'],
      ['shell', 'select.mesh.shell', undefined, 'Shell'],
    ],
    200,
  ),
  ...model(
    'select',
    'model-all',
    [
      ['allObjects', 'select.objects', { all: 'meshes', mode: 'replace' }, 'All', OBJECT],
      ['all', 'select.mesh.all', undefined, 'All', COMPONENT],
      ['invert', 'select.mesh.invert', undefined, 'Invert'],
      ['none', 'select.mesh.none', undefined, 'None'],
      ['bySwatch', 'select.mesh.bySwatch', undefined, 'By Swatch'],
    ],
    300,
  ),
  ...model('select.convert-selection', 'convert', [
    ['toVertices', 'select.mesh.convert', { to: 'vertex', mode: 'touching' }, 'To Vertices'],
    ['toEdges', 'select.mesh.convert', { to: 'edge', mode: 'touching' }, 'To Edges'],
    ['toFaces', 'select.mesh.convert', { to: 'face', mode: 'touching' }, 'To Faces'],
    ['toEdgeLoop', 'select.mesh.convert', { to: 'edge', mode: 'loop' }, 'To Edge Loop'],
    ['toEdgeRing', 'select.mesh.convert', { to: 'edge', mode: 'ring' }, 'To Edge Ring'],
    ['toShell', 'select.mesh.convert', { to: 'face', mode: 'shell' }, 'To Shell'],
    ['toBorder', 'select.mesh.convert', { to: 'edge', mode: 'border' }, 'To Border'],
    ['containedEdges', 'select.mesh.convert', { to: 'edge', mode: 'contained' }, 'Contained Edges'],
    ['containedFaces', 'select.mesh.convert', { to: 'face', mode: 'contained' }, 'Contained Faces'],
    ['edgePerimeter', 'select.mesh.convert', { to: 'edge', mode: 'perimeter' }, 'Edge Perimeter'],
    ['vertexPerimeter', 'select.mesh.convert', { to: 'vertex', mode: 'perimeter' }, 'Vertex Perimeter'],
  ]),

  ...model('modify', 'pivot', [['centerPivot', 'mesh.pivot.center']]),
  ...model(
    'modify',
    'transforms',
    [
      ['freeze', 'mesh.freezeTransforms', { translate: true, rotate: true, scale: true }],
      ['reset', 'mesh.resetTransforms'],
    ],
    200,
  ),
  ...model('modify.pivot', 'pivot', [
    ['bottomCenter', 'mesh.pivot.bottomCenter', undefined, 'Bottom Center'],
    ['reset', 'mesh.pivot.reset', undefined, 'Reset'],
    ['bake', 'mesh.pivot.bake', undefined, 'Bake'],
    ['edit', 'model.pivot.editToggle'],
  ]),
  ...model(
    'modify.snap',
    'snap',
    (
      [
        ['grid', 'Grid'],
        ['vertex', 'Vertex'],
        ['increment', 'Increment'],
      ] as const
    ).map(([kind, label]) => [kind, 'model.snap.toggle', { kind }, label]),
  ),

  ...model('display', 'hide', [
    ['hideSelected', 'view.hide', { target: 'selected' }, 'Hide Selected'],
    ['showAll', 'view.showAll'],
    ['hideUnselected', 'view.hide', { target: 'unselected' }, 'Hide Unselected'],
    ['isolate', 'view.isolate', undefined, 'Isolate'],
  ]),
  ...model(
    'display.shading',
    'shading',
    (
      [
        ['wire', 'Wireframe'],
        ['shaded', 'Shaded'],
        ['colours', 'Colours'],
        ['lit', 'Lit'],
      ] as const
    ).map(([mode, label]) => [mode, 'view.shading', { mode }, label]),
  ),

  ...model('mesh', 'combine', [
    ['combine', 'mesh.combine'],
    ['separate', 'mesh.separate'],
    ['fillHole', 'mesh.fillHole'],
    ['mirror', 'mesh.mirror', undefined, 'Mirror…'],
    ['symmetrize', 'mesh.symmetrize'],
  ]),
  ...model(
    'mesh',
    'topology',
    [
      ['triangulate', 'mesh.triangulate'],
      ['quadrangulate', 'mesh.quadrangulate'],
      ['cleanup', 'mesh.cleanup', undefined, 'Cleanup…'],
    ],
    200,
  ),
  ...model('mesh', 'editable', [['makeEditable', 'mesh.makeEditable']], 300),

  ...model('edit-mesh', 'components', [
    ['extrude', 'mesh.extrude'],
    ['inset', 'mesh.inset'],
    ['bevel', 'mesh.bevel'],
    ['bridge', 'mesh.bridge'],
    ['connect', 'mesh.connect'],
    ['insertLoop', 'mesh.insertLoop'],
    ['averageVertices', 'mesh.averageVertices'],
  ]),
  ...model(
    'edit-mesh',
    'faces',
    [
      ['extract', 'mesh.extract'],
      ['duplicateFaces', 'mesh.duplicateFaces'],
      ['deleteEdgeVertex', 'mesh.deleteEdgeVertex'],
      ['flipTriangleEdge', 'mesh.flipTriangleEdge'],
    ],
    200,
  ),
  ...model('edit-mesh.merge', 'merge', [
    ['merge', 'mesh.merge'],
    ['mergeToCenter', 'mesh.mergeToCenter'],
    ['mergeByDistance', 'mesh.mergeByDistance'],
    ['collapse', 'mesh.collapse'],
  ]),
  ...model('edit-mesh.spin-edge', 'spin', [
    ['forward', 'mesh.spinEdge', { direction: 'forward' }, 'Spin Edge Forward'],
    ['back', 'mesh.spinEdge', { direction: 'back' }, 'Spin Edge Backward'],
  ]),
  ...model('edit-mesh.assign-colour', 'colour', [['activeSwatch', 'mesh.paint', undefined, 'Active Swatch']]),

  ...model('mesh-tools', 'tools', [
    ['multiCut', 'view.tool', tool('multiCut'), 'Multi-Cut'],
    ['insertLoop', 'view.tool', tool('insertLoop'), 'Insert Edge Loop'],
    ['offsetLoop', 'mesh.offsetLoop'],
    ['slide', 'view.tool', tool('slide'), 'Slide Edge'],
    ['targetWeld', 'view.tool', tool('targetWeld'), 'Target Weld'],
    ['paint', 'view.tool', tool('paint'), 'Paint Colour'],
  ]),

  ...model('mesh-display', 'normals', [
    ['soften', 'mesh.soften'],
    ['harden', 'mesh.harden'],
    ['setNormalAngle', 'mesh.setNormalAngle', undefined, 'Set Normal Angle…'],
    ['reverse', 'mesh.reverse'],
    ['conform', 'mesh.conform'],
  ]),
  // Faceted ✓ (§8.3) waits for a non-internal operator: `mesh.setAttributes` is the Attributes panel's (internal).
  ...model('mesh-display.show', 'show', [
    ['normals', 'view.display.set', { patch: { normals: 'both' } }, 'Normals'],
    ['normalsOff', 'view.display.set', { patch: { normals: 'off' } }, 'Hide Normals'],
    ...(
      [
        ['faceOrientation', 'Face Orientation'],
        ['triangulation', 'Triangulation'],
        ['hardEdges', 'Hard Edges'],
        ['wireOnShaded', 'Wire on Shaded'],
        ['cull', 'Backface Culling'],
        ['dimUnhilited', 'Dim Unhilited'],
      ] as const
    ).map(([flag, label]): ModelRow => [flag, 'view.display.toggle', { flag }, label]),
  ]),

  ...model('uv', 'projections', [
    ['planar', 'mesh.uv.planar', undefined, 'Planar'],
    ['automatic', 'mesh.uv.box', undefined, 'Automatic'],
    ['cylindrical', 'mesh.uv.cylindrical', undefined, 'Cylindrical'],
  ]),
];

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
  ...MODEL_MENU_ITEMS,
];
