// Menu items contributed by the shell for its own operators (dialogs, panels, workspace, help). Built-in editing
// commands come from WP-7b's BUILTIN_MENU_ITEMS; items with the same operator and arguments are shown once.
// Auto-Rig (AUTORIG-SPEC §3.4, D2): File › Auto-Rig This Model… and Help › Switch to Auto-Rig run `shell.autoRig`, a
// small eager operator of the Studio shell that calls the host's navigation port directly (no chunk loads before the
// push; `autorig.navigate` is the rig chunk's palette/script wrapper of the same port).
import type { Disposer } from '@ekza-studio/anim-core';
import type { CharacterId, MeshRecord } from '@ekza-studio/doc';
import {
  type AutoRigSubject,
  type EditorApp,
  hostNavigation,
  type MenuItemDef,
  type OperatorDef,
  type PanelKind,
  type ViewportLayout,
  type WorkspaceId,
} from '@ekza-studio/editor-core';
import { ANIMATE_SLOTS, type ChromePart, MODEL_SLOTS } from './layout';
import { BUILTIN_PRESETS, type LayoutPresetStore } from './presets';
import { RIG_LAYOUTS } from './rig/layouts';

/** What the check-box items of the Windows menu read when it opens (layout presets, docs/LAYOUT-PRESETS.md). */
export interface ShellMenuState {
  chromeShown(part: ChromePart): boolean;
  focused(): boolean;
  fullscreen(): boolean;
}

/** The workspaces that use Animate's layout (the Animate presets are listed there). */
const ANIMATE_LIKE: readonly WorkspaceId[] = ['animate', 'rig', 'review'];

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

/**
 * What Auto-Rig works on when Studio switches to it (§3.4): the selection — the selected scene meshes, else the active
 * character — else every visible scene mesh; else null (Auto-Rig starts at its Model step). §3.4's last fallback, "the
 * only character", is the active character: the session keeps one active whenever a character exists
 * (`repairSession`). Visible = neither the mesh nor its parent is hidden (Model's Hide; an import's meshes sit under
 * one group). The Model operators chunk's helper is not imported: this module is eager.
 */
function autoRigSubject(app: EditorApp): AutoRigSubject | null {
  const { selection, activeCharacter, model } = app.session.getState();
  const hidden: ReadonlySet<string | null> = model.hiddenObjects;
  const scene = app.store.list('meshes').filter((mesh) => 'scene' in mesh.owner);
  const pick = (meshes: readonly MeshRecord[], character: CharacterId | null = null): AutoRigSubject | null =>
    meshes.length > 0 || character ? { character, meshes: meshes.map((mesh) => mesh.id) } : null;
  return (
    pick(scene.filter((mesh) => selection.objects.includes(mesh.id))) ??
    pick([], activeCharacter) ??
    pick(scene.filter((mesh) => !hidden.has(mesh.id) && !hidden.has(mesh.parent)))
  );
}

/**
 * `shell.autoRig {subject?}`: switches to Auto-Rig on the same page through the host's navigation port, the document
 * kept. With `subject: true` (File › Auto-Rig This Model…) it needs a subject (meshes or a character) and hands
 * `autoRigSubject` over; without (Help › Switch to Auto-Rig, the first-run dialog) it hands nothing over. Not undoable;
 * hidden from the palette (`autorig.navigate` is listed there). Without a port (a harness) it does nothing.
 */
function autoRigOperator(app: EditorApp): OperatorDef<{ readonly subject?: boolean } | undefined> {
  return {
    id: 'shell.autoRig',
    label: 'Switch to Auto-Rig',
    category: 'ui',
    scope: 'global',
    flags: { internal: true },
    poll: (_ctx, args) =>
      args?.subject === true && autoRigSubject(app) === null ? { ok: false, reason: 'Nothing to auto-rig' } : true,
    async prepare(_ctx, args) {
      const subject = args?.subject === true ? autoRigSubject(app) : null;
      await hostNavigation(app)?.go({ to: 'autorig', from: 'studio', ...(subject && { subject }) });
    },
    apply() {},
  };
}

export function shellMenuItems(
  extraPanels: readonly { readonly kind: PanelKind; readonly title: string }[],
  state?: ShellMenuState,
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
      id: 'shell.file.autoRig',
      menu: 'file',
      op: 'shell.autoRig',
      args: { subject: true },
      group: 'export',
      order: 80,
      label: 'Auto-Rig This Model…',
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
      id: 'shell.help.autoRig',
      menu: 'help',
      op: 'shell.autoRig',
      group: 'help',
      order: 30,
      // label: the operator's, "Switch to Auto-Rig"
    },
    {
      id: 'shell.help.about',
      menu: 'help',
      op: 'ui.open',
      args: { dialog: 'about' },
      group: 'about',
      order: 90,
      label: 'About Ekza Studio',
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
      // M6A-SPEC §8.2: Model hides the time slider; Windows › Timeline shows it (and hides it again). Layout presets:
      // listed in every workspace, beside the other chrome toggles.
      id: 'shell.windows.timeline',
      menu: 'windows',
      op: 'workspace.toggleTimeline',
      group: 'chrome',
      order: 820,
      label: 'Time Slider',
      ...(state === undefined ? {} : { checked: () => state.chromeShown('timeline') }),
    },
    {
      id: 'shell.windows.toolbar',
      menu: 'windows',
      op: 'workspace.toggleChrome',
      args: { part: 'toolbar' },
      group: 'chrome',
      order: 800,
      label: 'Tool Strip',
      ...(state === undefined ? {} : { checked: () => state.chromeShown('toolbar') }),
    },
    {
      id: 'shell.windows.helpLine',
      menu: 'windows',
      op: 'workspace.toggleChrome',
      args: { part: 'helpLine' },
      group: 'chrome',
      order: 810,
      label: 'Help Line',
      ...(state === undefined ? {} : { checked: () => state.chromeShown('helpLine') }),
    },
    {
      id: 'shell.windows.focus',
      menu: 'windows',
      op: 'workspace.toggleFocus',
      group: 'chrome',
      order: 830,
      label: 'Focus Mode',
      ...(state === undefined ? {} : { checked: () => state.focused() }),
    },
    {
      id: 'shell.windows.fullscreen',
      menu: 'windows',
      op: 'view.toggleFullscreen',
      group: 'chrome',
      order: 840,
      label: 'Full Screen',
      ...(state === undefined ? {} : { checked: () => state.fullscreen() }),
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
  layouts(LAYOUTS, ['animate', 'review'], 'shell.windows.layout');
  // M6b (C7): Rig & Skin's presets R-Single, R-Side, R-Markers.
  layouts(RIG_LAYOUTS, ['rig'], 'shell.windows.rig-layout');
  layouts(MODEL_LAYOUTS, ['model'], 'shell.windows.model-layout');
  // Windows › Presets (after Layout, so the sub-menus keep their order): the built-in presets, then the manage items.
  items.push(
    {
      id: 'shell.windows.presets.save',
      menu: 'windows.presets',
      op: 'ui.open',
      args: { dialog: 'layoutPresets' },
      group: 'manage',
      order: 400,
      label: 'Save Current Layout as…',
    },
    {
      // The same dialog, opened on its list (the extra argument keeps the item apart from Save…).
      id: 'shell.windows.presets.manage',
      menu: 'windows.presets',
      op: 'ui.open',
      args: { dialog: 'layoutPresets', manage: true },
      group: 'manage',
      order: 410,
      label: 'Rename or Delete Presets…',
    },
    {
      // Model has no Blocking, Polish or Review: Alt+1 brings back its default layout.
      id: 'shell.windows.presets.model-default',
      menu: 'windows.presets',
      op: 'workspace.preset.apply',
      args: { preset: 'animate' },
      group: 'builtin',
      order: 200,
      label: 'Default Layout',
      workspaces: ['model'],
    },
  );
  BUILTIN_PRESETS.forEach((preset, index) => {
    items.push({
      id: `shell.windows.presets.${preset.id}`,
      menu: 'windows.presets',
      op: 'workspace.preset.apply',
      args: { preset: preset.id },
      group: 'builtin',
      order: 200 + index,
      label: preset.label,
      workspaces: ANIMATE_LIKE,
    });
  });
  return items;
}

/** Windows › Presets items of the user's presets (one per saved preset, listed in its workspace). */
export function userPresetMenuItems(presets: LayoutPresetStore, workspaces: readonly WorkspaceId[]): MenuItemDef[] {
  return workspaces.flatMap((workspace) =>
    presets.list(workspace).map(
      (preset, index): MenuItemDef => ({
        id: `shell.windows.presets.user.${workspace}.${preset.id}`,
        menu: 'windows.presets',
        op: 'workspace.preset.apply',
        args: { preset: preset.id },
        group: 'user',
        order: 300 + index,
        label: preset.name,
        workspaces: [workspace],
      }),
    ),
  );
}

/** Keeps the Windows › Presets items of the user's presets in step with the store. */
export function registerUserPresetMenuItems(app: EditorApp, presets: LayoutPresetStore): Disposer {
  let disposers: Disposer[] = [];
  const sync = (): void => {
    for (const dispose of disposers.reverse()) dispose();
    disposers = [];
    const workspaces = app.workspaces.list().map((def) => def.id);
    for (const def of userPresetMenuItems(presets, workspaces)) {
      disposers.push(app.contribute({ kind: 'menu', def }));
    }
  };
  sync();
  const unsubscribe = presets.subscribe(sync);
  const unsubscribeWorkspaces = app.workspaces.subscribe(sync);
  return () => {
    unsubscribe();
    unsubscribeWorkspaces();
    for (const dispose of disposers.reverse()) dispose();
    disposers = [];
  };
}

export function registerShellMenuItems(
  app: EditorApp,
  extraPanels: readonly { readonly kind: PanelKind; readonly title: string }[],
  state?: ShellMenuState,
): Disposer {
  const disposers: Disposer[] = [app.contribute({ kind: 'operator', def: autoRigOperator(app) })];
  for (const def of shellMenuItems(extraPanels, state)) {
    if (app.menus.get(def.id) !== undefined) continue;
    disposers.push(app.contribute({ kind: 'menu', def }));
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
