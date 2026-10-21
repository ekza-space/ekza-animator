// The Model menu set (M6A-SPEC §8.1, §8.3; B0b): every item names its operator with `workspaces: ['model']`, so the
// Animate menu bar never shows it; an item with `modes` is listed only in those component modes (Edit › Delete and
// Select › All switch between objects and components). Sub-menu ids are dotted (`create.polygon-primitives`); the menu
// bar title-cases the last part. Part of the Model operators chunk (`./modelOpsChunk`, M6A-INT-13): the items register
// once it has loaded, on the first Model entry (`registerBuiltins`); Model's menu ids stay eager (`MODEL_MENUS`).
import type { ComponentMode, MenuItemDef, OperatorId, WorkspaceId } from '../../types';

const MODEL: readonly WorkspaceId[] = ['model'];
const OBJECT: readonly ComponentMode[] = ['object'];
const COMPONENT: readonly ComponentMode[] = ['vertex', 'edge', 'face'];

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

export const MODEL_MENU_ITEMS: readonly MenuItemDef[] = [
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
      ['noneObjects', 'select.objects', { ids: [], mode: 'replace' }, 'None', OBJECT],
      ['none', 'select.mesh.none', undefined, 'None', COMPONENT],
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
    ['mirror', 'mesh.mirror', undefined, 'Mirror'],
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
  // SHADING-SPEC §5: Maya's Assign New Material on the selected faces or objects.
  ...model('edit-mesh.assign-new-material', 'material', [
    ['lambert', 'palette.assignMaterial', { shader: 'lambert' }, 'Lambert'],
    ['blinn', 'palette.assignMaterial', { shader: 'blinn' }, 'Blinn'],
  ]),

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
    ['setNormalAngle', 'mesh.setNormalAngle', undefined, 'Set Normal Angle'],
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
