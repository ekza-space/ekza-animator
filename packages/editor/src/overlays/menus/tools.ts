// The Model tools marking menus (M6A-SPEC §8.4; B11 owns `model.tools.*`, `model.primitives` and `model.merge`; the
// generic MarkingMenu is B9's): Shift+RMB opens the tools of the current mode (object, vertex, edge, face) — over
// empty space in object mode the primitives menu (./primitives.ts) — and `M` the merge menu (./merge.ts). The S, W and
// SW slots are the same family in every component menu: S Extrude, W Multi-Cut, SW Delete (Maya's plain Delete).
// Data only: items name operators (stubs poll-fail with their reasons until their owners land them); items that are
// M6a-stretch carry a static `disabledReason`.
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp, MarkingMenuDef, MarkingMenuItem, OperatorId } from '@ekza-animator/editor-core';
import { MERGE_MENU } from './merge';
import { PRIMITIVES_MENU } from './primitives';

const tool = (label: string, id: string): MarkingMenuItem => ({
  label,
  op: 'view.tool',
  args: { panel: 'viewport', tool: id },
});
const op = (op: OperatorId, label?: string, args?: unknown): MarkingMenuItem => ({
  op,
  ...(label === undefined ? {} : { label }),
  ...(args === undefined ? {} : { args }),
});
const later = (label: string, reason: string): MarkingMenuItem => ({ label, disabledReason: reason });

const EXTRUDE = op('mesh.extrude', 'Extrude');
const MULTI_CUT = tool('Multi-Cut', 'multiCut');
const DELETE = op('mesh.delete', 'Delete');
const SHIFT_RMB = { button: 'rmb', mods: 'shift' } as const;
const MODEL = ['model'] as const;

export const TOOLS_OBJECT_MENU: MarkingMenuDef = {
  id: 'model.tools.object',
  trigger: SHIFT_RMB,
  workspaces: MODEL,
  when: { modes: ['object'], over: 'mesh' },
  slots: {
    N: tool('Insert Edge Loop', 'insertLoop'),
    NE: op('mesh.mirror', 'Mirror'),
    E: op('mesh.combine', 'Combine'),
    SE: op('mesh.separate', 'Separate'),
    S: op('mesh.pivot.center', 'Center Pivot'),
    SW: op('scene.delete', 'Delete'),
    W: MULTI_CUT,
    NW: op('workspace.showPanel', 'Mesh Check', { panel: 'meshCheck' }),
  },
  list: [
    op('mesh.freezeTransforms', 'Freeze Transformations', { translate: true, rotate: true, scale: true }),
    op('mesh.resetTransforms', 'Reset Transformations'),
    op('mesh.triangulate', 'Triangulate'),
    op('mesh.conform', 'Conform'),
    op('mesh.cleanup', 'Cleanup…'),
    op('mesh.makeEditable', 'Make Editable'),
  ],
};

export const TOOLS_VERTEX_MENU: MarkingMenuDef = {
  id: 'model.tools.vertex',
  trigger: SHIFT_RMB,
  workspaces: MODEL,
  when: { modes: ['vertex'], over: 'any' },
  slots: {
    N: op('mesh.mergeToCenter', 'Merge to Center'),
    NE: tool('Target Weld', 'targetWeld'),
    E: op('mesh.connect', 'Connect'),
    SE: later('Chamfer Vertex', 'Chamfer Vertex arrives later'),
    // §8.4: Extrude with its own poll reason in vertex mode ("Vertex extrude is not available yet", M6A-B11-9).
    S: EXTRUDE,
    SW: DELETE,
    W: MULTI_CUT,
    NW: op('mesh.averageVertices', 'Average Vertices'),
  },
  list: [
    op('mesh.deleteEdgeVertex', 'Delete Edge/Vertex'),
    op('mesh.merge', 'Merge'),
    tool('Slide', 'slide'),
    // The sticky grid snap of §6.2 (B12a's `model.snap.toggle`; its stub says why until it lands).
    op('model.snap.toggle', 'Snap to Grid', { kind: 'grid' }),
  ],
};

export const TOOLS_EDGE_MENU: MarkingMenuDef = {
  id: 'model.tools.edge',
  trigger: SHIFT_RMB,
  workspaces: MODEL,
  when: { modes: ['edge'], over: 'any' },
  slots: {
    N: tool('Insert Edge Loop', 'insertLoop'),
    NE: op('mesh.bevel', 'Bevel'),
    E: op('mesh.bridge', 'Bridge'),
    SE: op('mesh.collapse', 'Collapse'),
    S: EXTRUDE,
    SW: DELETE,
    W: MULTI_CUT,
    NW: {
      label: 'Soften/Harden',
      submenu: [
        op('mesh.soften', 'Soften Edge'),
        op('mesh.harden', 'Harden Edge'),
        op('mesh.setNormalAngle', 'Set Normal Angle'),
      ],
    },
  },
  list: [
    op('mesh.deleteEdgeVertex', 'Delete Edge/Vertex'),
    op('mesh.fillHole', 'Fill Hole'),
    op('mesh.offsetLoop', 'Offset Edge Loop'),
    tool('Slide Edge', 'slide'),
    op('mesh.connect', 'Connect'),
    {
      label: 'Spin',
      submenu: [
        op('mesh.spinEdge', 'Spin Edge Forward', { direction: 'forward' }),
        op('mesh.spinEdge', 'Spin Edge Backward', { direction: 'back' }),
      ],
    },
    op('mesh.flipTriangleEdge', 'Flip Triangle Edge'),
    {
      label: 'Select Loop / Ring',
      submenu: [
        op('select.mesh.convert', 'Edge Loop', { to: 'edge', mode: 'loop' }),
        op('select.mesh.convert', 'Edge Ring', { to: 'edge', mode: 'ring' }),
      ],
    },
  ],
};

export const TOOLS_FACE_MENU: MarkingMenuDef = {
  id: 'model.tools.face',
  trigger: SHIFT_RMB,
  workspaces: MODEL,
  when: { modes: ['face'], over: 'any' },
  slots: {
    N: op('mesh.inset', 'Inset'),
    NE: op('mesh.bevel', 'Bevel'),
    E: op('mesh.duplicateFaces', 'Duplicate Face'),
    SE: op('mesh.extract', 'Extract'),
    S: EXTRUDE,
    SW: DELETE,
    W: MULTI_CUT,
    NW: later('Poke', 'Poke arrives later'),
  },
  list: [
    op('mesh.bridge', 'Bridge'),
    op('mesh.triangulate', 'Triangulate'),
    op('mesh.quadrangulate', 'Quadrangulate'),
    op('mesh.reverse', 'Reverse'),
    { label: 'Assign Colour', submenu: [op('mesh.paint', 'Active Swatch')] },
    {
      label: 'Assign New Material',
      submenu: [
        op('palette.assignMaterial', 'Lambert', { shader: 'lambert' }),
        op('palette.assignMaterial', 'Blinn', { shader: 'blinn' }),
      ],
    },
    op('mesh.mirror', 'Mirror'),
  ],
};

/** Every B11 marking menu (§8.4), in registration order. */
export const MODEL_OPS_MARKING_MENUS: readonly MarkingMenuDef[] = [
  PRIMITIVES_MENU,
  TOOLS_OBJECT_MENU,
  TOOLS_VERTEX_MENU,
  TOOLS_EDGE_MENU,
  TOOLS_FACE_MENU,
  MERGE_MENU,
];

/** Registers B11's marking menus (ids already registered by the host or an extension are left as they are). */
export function registerModelOpsMenus(app: EditorApp): Disposer {
  const disposers: Disposer[] = [];
  for (const def of MODEL_OPS_MARKING_MENUS) {
    if (app.markingMenus.get(def.id) === undefined) disposers.push(app.contribute({ kind: 'markingMenu', def }));
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
