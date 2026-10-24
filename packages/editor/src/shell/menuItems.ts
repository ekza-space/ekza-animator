// Menu items contributed by the shell for its own operators (dialogs, panels, workspace, help). Built-in editing
// commands come from WP-7b's BUILTIN_MENU_ITEMS; items with the same operator and arguments are shown once.
// Auto-Rig (AUTORIG-SPEC §3.4, D2): File › Auto-Rig This Model… and Help › Switch to Auto-Rig run `shell.autoRig`, a
// small eager operator of the Studio shell that calls the host's navigation port directly (never through the Rig & Skin
// chunk; `autorig.navigate` is that chunk's palette/script wrapper of the same port). Its subject rule is the small
// lazy `./autoRigSwitch`, prefetched when the menu opens.
// Ekza Studio's Simple layout (STUDIO-TOUCH-SPEC §16.1; T3): Help › and File › Switch to the Simple Layout (and the
// status line's *▤ Simple layout*) run `shell.halo`, built the same way with the lazy `./haloSwitch`.
import type { Disposer } from '@ekza-studio/anim-core';
import {
  type EditorApp,
  hostNavigation,
  type MenuItemDef,
  type OperatorDef,
  type PanelKind,
  type ViewportLayout,
  type WorkspaceId,
} from '@ekza-studio/editor-core';
import type * as AutoRigSwitch from './autoRigSwitch';
import type * as HaloSwitch from './haloSwitch';
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

/** The lazy half of the switch (`./autoRigSwitch`: the subject rule, the remembered-choice write); null when it cannot
 *  load (the switch then happens without them). */
const loadAutoRigSwitch = (): Promise<typeof AutoRigSwitch | null> => import('./autoRigSwitch').catch(() => null);

/**
 * `shell.autoRig {subject?, remember?}`: switches to Auto-Rig on the same page through the host's navigation port, the
 * document kept, handing the subject over when there is one (`autoRigSubject`, §3.4). `subject: true` (File › Auto-Rig
 * This Model…) is enabled when the scene has meshes or a character (§3.4); Help › Switch to Auto-Rig and the first-run
 * dialog are always enabled. `remember: true` (the first-run dialog's "Open this mode next time") first writes the
 * landing's remembered choice. The subject rule and the write are the small `./autoRigSwitch` chunk (AR-D2-11): the
 * poll — run when a menu showing the item opens — prefetches it (intent, M2A-SPEC §5.21.2), so a menu click does not
 * wait for it. It never loads the Rig & Skin chunk. Not undoable; hidden from the palette (`autorig.navigate` is listed
 * there). Without a port (a harness) it does nothing.
 */
const AUTO_RIG_OPERATOR: OperatorDef<{ readonly subject?: boolean; readonly remember?: boolean } | undefined> = {
  id: 'shell.autoRig',
  label: 'Switch to Auto-Rig',
  category: 'ui',
  scope: 'global',
  flags: { internal: true },
  poll({ app }, args) {
    void loadAutoRigSwitch();
    return args?.subject && app.store.list('meshes').length === 0 && app.session.getState().activeCharacter === null
      ? { ok: false, reason: 'Nothing to auto-rig' }
      : true;
  },
  async prepare({ app }, args) {
    const lazy = await loadAutoRigSwitch();
    if (args?.remember) lazy?.writeEntryChoice('autorig');
    const subject = lazy?.autoRigSubject(app);
    await hostNavigation(app)?.go({ to: 'autorig', from: 'studio', ...(subject && { subject }) });
  },
  apply() {},
};

/**
 * STUDIO-TOUCH-SPEC §1.1, ST-30 (T3): Pro's own chrome names it "Ekza Studio Pro" once the Simple layout ships as
 * Ekza Studio; T12 turns this on with `HALO_ENTRY` (until then it stays "Ekza Studio", as shipped).
 */
export const PRO_TITLE: boolean = false;
/** The name Pro's chrome shows (the menu bar's mark). */
export const PRO_NAME = PRO_TITLE ? 'Ekza Studio Pro' : 'Ekza Studio';

/**
 * Pro's switch to the Simple layout (the File › and Help › items, the status line's button) is visible once Halo ships
 * (`PRO_TITLE`, T12); until then only e2e pages and `?simple=1` show it, so `dev` can carry the touch shell unreleased.
 */
export function simpleLayoutSwitch(): boolean {
  if (PRO_TITLE) return true;
  if (typeof window === 'undefined') return false;
  return /[?&](e2e|simple)=1(&|$)/.test(window.location.search);
}

/** The lazy half of the Simple layout switch (`./haloSwitch`); null when it cannot load (the switch still happens). */
const loadHaloSwitch = (): Promise<typeof HaloSwitch | null> => import('./haloSwitch').catch(() => null);

/**
 * `shell.halo` (STUDIO-TOUCH-SPEC §16.1, ST-B1; T3): switches to Ekza Studio's Simple layout (`/app`) on the same page
 * through the host's navigation port, the document, its undo history, selection, time and cameras kept; the workspace
 * travels (Halo arrives at the matching stage) and, behind `HALO_ENTRY`, a remembered Pro becomes Ekza Studio (§1.2).
 * Both are the small `./haloSwitch` chunk, prefetched by the poll when a menu showing the item opens; the status line
 * runs it from its button. Not undoable; hidden from the palette. Without a port (a harness) it does nothing.
 */
const HALO_OPERATOR: OperatorDef<undefined> = {
  id: 'shell.halo',
  label: 'Switch to the Simple Layout',
  category: 'ui',
  scope: 'global',
  flags: { internal: true },
  poll() {
    void loadHaloSwitch();
    return true;
  },
  async prepare({ app }) {
    const lazy = await loadHaloSwitch();
    lazy?.rememberSimpleLayout();
    await hostNavigation(app)?.go(lazy?.haloRequest(app) ?? { to: 'halo', from: 'studio' });
  },
  apply() {},
};

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
      // STUDIO-TOUCH-SPEC §16.1 (T3).
      id: 'shell.file.halo',
      menu: 'file',
      op: 'shell.halo',
      group: 'export',
      order: 90,
      // label: the operator's, "Switch to the Simple Layout"
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
      // STUDIO-TOUCH-SPEC §16.1, J9 (T3).
      id: 'shell.help.halo',
      menu: 'help',
      op: 'shell.halo',
      group: 'help',
      order: 35,
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
  if (!simpleLayoutSwitch())
    return items.filter((item) => item.id !== 'shell.file.halo' && item.id !== 'shell.help.halo');
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
  const disposers: Disposer[] = [
    app.contribute({ kind: 'operator', def: AUTO_RIG_OPERATOR }),
    app.contribute({ kind: 'operator', def: HALO_OPERATOR }),
  ];
  for (const def of shellMenuItems(extraPanels, state)) {
    if (app.menus.get(def.id) !== undefined) continue;
    disposers.push(app.contribute({ kind: 'menu', def }));
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
