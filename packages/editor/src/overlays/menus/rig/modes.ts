// The RMB mode menu `rig.modes` (M6B-SPEC §8.5; C7 data, B9's generic marking menu draws it): RMB anywhere in a Rig &
// Skin pane. Slots N Skeleton · W Skin · NE Object · E Go to Bind Pose · SE Select ▸ · SW Isolate · NW X-Ray Joints;
// the list below. Shapes (S) arrives after the MVP and is absent (Q-MVP-15). Positions are provisional (Q-RIG-UI-1).
import { type EditorApp, type MarkingMenuDef, type MarkingMenuItem, paneDisplayPort } from '@ekza-studio/editor-core';

const mode = (label: string, value: 'object' | 'skeleton' | 'skin'): MarkingMenuItem => ({
  label,
  op: 'rig.mode',
  args: { mode: value },
  checked: (app) => app.session.getState().rig.mode === value,
});

function xrayJoints(app: EditorApp): boolean {
  const port = paneDisplayPort(app);
  const pane = port?.activePane() ?? null;
  return pane !== null && port?.display(pane)?.xrayJoints === true;
}

export const RIG_MODES_MENU: MarkingMenuDef = {
  id: 'rig.modes',
  trigger: { button: 'rmb', mods: 'none' },
  workspaces: ['rig'],
  when: { over: 'any' },
  slots: {
    N: mode('Skeleton', 'skeleton'),
    W: mode('Skin', 'skin'),
    NE: mode('Object Mode', 'object'),
    E: { label: 'Go to Bind Pose', op: 'rig.pose.view', args: { view: 'bind' } },
    SE: {
      label: 'Select',
      submenu: [
        { label: 'All Joints', op: 'select.joints', args: { all: true } },
        { label: 'None', op: 'select.joints', args: { ids: [] } },
      ],
    },
    SW: { label: 'Isolate', op: 'view.isolate' },
    NW: { label: 'X-Ray Joints', op: 'view.display.toggle', args: { flag: 'xrayJoints' }, checked: xrayJoints },
  },
  list: [
    { label: 'Test Pose', op: 'rig.pose.view', args: { view: 'test' } },
    { label: 'Hide Selected', op: 'view.hide', args: { target: 'selected' } },
    { label: 'Show All', op: 'view.showAll' },
    { label: 'Frame', op: 'view.frame', args: { what: 'selection' } },
    { label: 'Attributes', op: 'workspace.showPanel', args: { panel: 'rigToolkit' } },
  ],
};
