// Menu items contributed by the shell for its own operators (dialogs, panels, workspace, help). Built-in editing
// commands come from WP-7b's BUILTIN_MENU_ITEMS; items with the same operator and arguments are shown once.
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp, MenuItemDef, PanelKind, ViewportLayout, WorkspaceId } from '@ekza-animator/editor-core';
import { ANIMATE_SLOTS, MODEL_SLOTS } from './layout';

const LAYOUTS: readonly { readonly layout: ViewportLayout; readonly label: string }[] = [
  { layout: 'single', label: 'Single View' },
  { layout: 'split', label: 'Shot | Free (Split)' },
  { layout: 'quad', label: 'Four View' },
];
/** Model's presets (§8.2): M-Single, M-Quad, M-Side (`front | persp`, the split layout's panes in Model). */
const MODEL_LAYOUTS: readonly { readonly layout: ViewportLayout; readonly label: string }[] = [
  { layout: 'single', label: 'Single View' },
  { layout: 'quad', label: 'Four View' },
  { layout: 'split', label: 'Front | Persp (Side)' },
];

export function shellMenuItems(
  extraPanels: readonly { readonly kind: PanelKind; readonly title: string }[],
): MenuItemDef[] {
  const items: MenuItemDef[] = [
    {
      id: 'shell.file.open',
      menu: 'file',
      op: 'ui.open',
      args: { dialog: 'open' },
      group: 'open',
      order: 10,
      label: 'Open…',
    },
    {
      id: 'shell.file.import',
      menu: 'file',
      op: 'ui.open',
      args: { dialog: 'import' },
      group: 'open',
      order: 20,
      label: 'Import…',
    },
    {
      // M2A-SPEC §7 File › Recover… (the Recovery dialog lists the orphaned autosave slots; A5).
      id: 'shell.file.recover',
      menu: 'file',
      op: 'ui.open',
      args: { dialog: 'recovery' },
      group: 'recovery',
      order: 70,
      label: 'Recover…',
    },
    {
      id: 'shell.file.export',
      menu: 'file',
      op: 'ui.open',
      args: { dialog: 'export' },
      group: 'export',
      order: 60,
      label: 'Export…',
    },
    {
      id: 'shell.edit.prefs',
      menu: 'edit',
      op: 'ui.open',
      args: { dialog: 'preferences' },
      group: 'prefs',
      order: 900,
      label: 'Preferences…',
    },
    {
      id: 'shell.help.shortcuts',
      menu: 'help',
      op: 'ui.open',
      args: { dialog: 'shortcuts' },
      group: 'help',
      order: 10,
      label: 'Keyboard Shortcuts',
    },
    {
      id: 'shell.help.start',
      menu: 'help',
      op: 'ui.open',
      args: { dialog: 'firstRun' },
      group: 'help',
      order: 20,
      label: 'Getting Started',
    },
    {
      id: 'shell.help.about',
      menu: 'help',
      op: 'ui.open',
      args: { dialog: 'about' },
      group: 'about',
      order: 90,
      label: 'About Ekza Animator',
    },
    {
      // M6A-SPEC §8.3 Mesh › Mesh Check: shows the Mesh Check panel (B10 registers it).
      id: 'shell.mesh.meshCheck',
      menu: 'mesh',
      op: 'workspace.showPanel',
      args: { panel: 'meshCheck' },
      group: 'check',
      order: 250,
      label: 'Mesh Check',
      workspaces: ['model'],
    },
    {
      id: 'shell.windows.reset',
      menu: 'windows',
      op: 'workspace.reset',
      group: 'workspace',
      order: 900,
      label: 'Reset Workspace',
    },
    {
      // M6A-SPEC §8.2: Model hides the time slider; Windows › Timeline shows it (and hides it again).
      id: 'shell.windows.timeline',
      menu: 'windows',
      op: 'workspace.toggleTimeline',
      group: 'workspace',
      order: 890,
      label: 'Timeline',
      workspaces: ['model'],
    },
  ];
  const panels = [...ANIMATE_SLOTS.map((slot) => ({ kind: slot.kind, title: slot.title })), ...extraPanels];
  panels.forEach((panel, index) => {
    items.push({
      id: `shell.windows.panel.${panel.kind}`,
      menu: 'windows',
      op: 'workspace.showPanel',
      args: { panel: panel.kind },
      group: 'panels',
      order: 100 + index,
      label: panel.title,
    });
  });
  // M6a: the Model-only panels (Toolkit, Palette, Mesh Check) are listed in Model.
  MODEL_SLOTS.filter((slot) => !panels.some((panel) => panel.kind === slot.kind)).forEach((slot, index) => {
    items.push({
      id: `shell.windows.panel.${slot.kind}`,
      menu: 'windows',
      op: 'workspace.showPanel',
      args: { panel: slot.kind },
      group: 'panels',
      order: 150 + index,
      label: slot.title,
      workspaces: ['model'],
    });
  });
  const layouts = (list: typeof LAYOUTS, workspaces: readonly WorkspaceId[], prefix: string): void => {
    list.forEach((entry, index) => {
      items.push({
        id: `${prefix}.${entry.layout}`,
        menu: 'windows.layout',
        op: 'view.layout',
        args: { layout: entry.layout },
        group: 'layouts',
        order: 200 + index,
        label: entry.label,
        workspaces,
      });
    });
  };
  layouts(LAYOUTS, ['animate', 'rig', 'review'], 'shell.windows.layout');
  layouts(MODEL_LAYOUTS, ['model'], 'shell.windows.model-layout');
  return items;
}

export function registerShellMenuItems(
  app: EditorApp,
  extraPanels: readonly { readonly kind: PanelKind; readonly title: string }[],
): Disposer {
  const disposers: Disposer[] = [];
  for (const def of shellMenuItems(extraPanels)) {
    if (app.menus.get(def.id) !== undefined) continue;
    disposers.push(app.contribute({ kind: 'menu', def }));
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
