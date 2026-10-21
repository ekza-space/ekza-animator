// The RMB mode menu `model.modes` (M6A-SPEC §8.4; B10 data, B9's generic marking menu draws it): RMB on a mesh in
// the Model viewport. Slots N Edge · W Vertex · S Face · NE Object Mode · E UV (later) · NW Multi (stretch) ·
// SE Select ▸; the list below. Running a mode slot on a mesh that is not hilited adds it to the hilite set
// (`select.mode` reads the press point through the pointer probe, §5.6). Positions are provisional (Q-MOD-UI-1).
import type { MarkingMenuDef, MarkingMenuItem } from '@ekza-animator/editor-core';

const mode = (label: string, value: 'object' | 'vertex' | 'edge' | 'face'): MarkingMenuItem => ({
  label,
  op: 'select.mode',
  args: { mode: value },
  checked: (app) => app.session.getState().model.componentMode === value,
});

export const MODES_MENU: MarkingMenuDef = {
  id: 'model.modes',
  trigger: { button: 'rmb', mods: 'none' },
  workspaces: ['model'],
  when: { over: 'mesh' },
  slots: {
    N: mode('Edge', 'edge'),
    W: mode('Vertex', 'vertex'),
    S: mode('Face', 'face'),
    NE: mode('Object Mode', 'object'),
    E: { label: 'UV', disabledReason: 'UV editor arrives later' },
    NW: { label: 'Multi', disabledReason: 'Multi-component mode arrives later' },
    SE: {
      label: 'Select',
      submenu: [
        { label: 'All', op: 'select.mesh.all' },
        { label: 'Shell', op: 'select.mesh.shell' },
        { label: 'Border', op: 'select.mesh.border' },
        { label: 'Invert', op: 'select.mesh.invert' },
      ],
    },
  },
  list: [
    { label: 'Select All', op: 'select.mesh.all' },
    { label: 'Select Shell', op: 'select.mesh.shell' },
    { label: 'Hide Selected', op: 'view.hide', args: { target: 'selected' } },
    { label: 'Show All', op: 'view.showAll' },
    { label: 'Isolate', op: 'view.isolate' },
    { label: 'Assign Colour', submenu: [{ label: 'Active Swatch', op: 'mesh.paint' }] },
    {
      label: 'Assign New Material',
      submenu: [
        { label: 'Lambert', op: 'palette.assignMaterial', args: { shader: 'lambert' } },
        { label: 'Blinn', op: 'palette.assignMaterial', args: { shader: 'blinn' } },
      ],
    },
    {
      label: 'Pivot',
      submenu: [
        { label: 'Center Pivot', op: 'mesh.pivot.center' },
        { label: 'Bottom Center', op: 'mesh.pivot.bottomCenter' },
        { label: 'Reset', op: 'mesh.pivot.reset' },
        { label: 'Bake', op: 'mesh.pivot.bake' },
        { label: 'Edit Pivot', op: 'model.pivot.editToggle' },
      ],
    },
    { label: 'Rename…', op: 'workspace.showPanel', args: { panel: 'outliner' } },
    { label: 'Attributes', op: 'workspace.showPanel', args: { panel: 'attributes' } },
  ],
};
