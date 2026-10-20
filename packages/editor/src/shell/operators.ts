// Operators owned by the shell (MVP-SPEC §4.9 owner 8): `view.toggleMaximize`, `ui.open`, `ui.close`, plus the
// shell's own commands for preferences, the workspace and the selection mask. Registered through
// `app.contribute` like every other operator (ADR 0008); none of them writes the document.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import {
  type Contribution,
  DEFAULT_WORKSPACE_VIEWS,
  type EditorApp,
  type OperatorDef,
  PANEL,
  type PanelKind,
  type PollResult,
  type Prefs,
  type SelectionMask,
  type UiDialog,
} from '@ekza-animator/editor-core';
import type { StoreApi } from 'zustand/vanilla';
import { CHROME_PARTS, type ChromePart } from './layout';
import type {} from './operator-map';
import { builtinPreset, type LayoutPresetStore, presetNameProblem } from './presets';
import type { ShellUiState, WorkspaceApi } from './types';

export const UI_DIALOGS: readonly UiDialog[] = [
  'open',
  'import',
  'export',
  'shortcuts',
  'about',
  'firstRun',
  'preferences',
  'recovery',
  // M6a (B13): the Make editable report and the reference image import (M6A-SPEC §4.6 UiDialog).
  'makeEditableReport',
  'imagePlaneImport',
  // Layout presets (docs/LAYOUT-PRESETS.md): save, rename and delete the user's presets.
  'layoutPresets',
];

/** Dialogs whose implementation has not landed yet (none since M2a's Recovery dialog). */
const PENDING_DIALOGS: ReadonlySet<UiDialog> = new Set();

const PREF_KEYS: ReadonlySet<string> = new Set([
  'firstRunDone',
  'navProfile',
  'spaceBehaviour',
  'keymapOverrides',
  'defaultTangents',
  'autoKey',
  'autoKeyMode',
  'graphHandles',
  'moveSpace',
  'rotateSpace',
  'reduceOnImport',
  'uiScale',
  // M2a (M2A-SPEC §4.5)
  'autoRigIk',
  'ikFkVisibility',
  'ikFkSwitchKey',
  'tweenOvershoot',
  'arrowKeys',
  'virtualSlider',
  'exportReduce',
  'autosave',
  // M6a (M6A-SPEC §4.6; B13): the first-run start workspace and the modeling preferences (palette recents).
  'lastWorkspace',
  'modeling',
]);

export interface ShellOperatorDeps {
  readonly workspace: WorkspaceApi;
  /** The shell's UI state (M6a: the time slider's visibility per workspace). */
  readonly ui: StoreApi<ShellUiState>;
  /** The user's layout presets (docs/LAYOUT-PRESETS.md). */
  readonly presets: LayoutPresetStore;
  /** The document whose Fullscreen API `view.toggleFullscreen` uses (default: the global document; null: none). */
  readonly document?: Document | null;
  /** Called when the import dialog closes without importing (drops the pending file). */
  readonly onImportClosed: () => void;
}

const ok: PollResult = true;
const fail = (reason: string): PollResult => ({ ok: false, reason });

/** The `ui.open` poll: dialogs that need a character fail politely in an empty document. */
function pollDialog(app: EditorApp, dialog: UiDialog): PollResult {
  if (!UI_DIALOGS.includes(dialog)) return fail(`Unknown dialog '${String(dialog)}'`);
  if (PENDING_DIALOGS.has(dialog)) return fail('not available yet');
  // M6a (B13): the Export dialog's Static model section exports scene meshes without a character (§8.8).
  if (dialog === 'export' && app.store.list('characters').length === 0 && app.store.list('meshes').length === 0) {
    return fail('Load a character to export');
  }
  // M2A-SPEC §5.20: File › Recover… needs the autosave store (the dialog lists its orphaned slots).
  if (
    dialog === 'recovery' &&
    !app.session.getState().autosave.enabled &&
    app.session.getState().recovery.length === 0
  ) {
    return fail('Autosave is off in this editor');
  }
  return ok;
}

export function shellOperatorDefs(app: EditorApp, deps: ShellOperatorDeps): Contribution[] {
  const toggleMaximize: OperatorDef<{ readonly paneId?: string; readonly panel?: PanelKind } | void> = {
    id: 'view.toggleMaximize',
    label: 'Maximize Panel',
    description: 'Maximize or restore the viewport pane or panel under the pointer.',
    category: 'view',
    scope: 'global',
    apply(ctx, args) {
      const explicit: { readonly paneId?: string; readonly panel?: PanelKind } =
        typeof args === 'object' && args !== null ? args : {};
      const hovered = app.session.getState().hoveredPanel;
      const panel =
        explicit.panel ?? (explicit.paneId === undefined ? null : PANEL.viewport) ?? ctx.panel ?? hovered?.kind ?? null;
      const paneId = explicit.paneId ?? (panel === PANEL.viewport ? (ctx.paneId ?? hovered?.paneId ?? null) : null);
      const session = app.session.getState();
      if (panel === PANEL.viewport && paneId !== null) {
        app.session.setState({ maximizedPane: session.maximizedPane === paneId ? null : paneId });
        return;
      }
      if (panel !== null && deps.workspace.toggleMaximize({ kind: panel })) return;
      if (session.maximizedPane !== null) {
        app.session.setState({ maximizedPane: null });
        return;
      }
      if (deps.workspace.hasMaximized()) deps.workspace.toggleMaximize({});
    },
  };

  const open: OperatorDef<{ readonly dialog: UiDialog }> = {
    id: 'ui.open',
    label: 'Open Dialog',
    category: 'ui',
    scope: 'global',
    flags: { internal: true },
    poll: (_ctx, args) => pollDialog(app, args.dialog),
    apply(_ctx, args) {
      app.session.setState({ dialog: args.dialog });
    },
  };

  const close: OperatorDef = {
    id: 'ui.close',
    label: 'Close Dialog',
    category: 'ui',
    scope: 'global',
    flags: { internal: true },
    apply() {
      const dialog = app.session.getState().dialog;
      if (dialog === null) return;
      app.session.setState({ dialog: null });
      if (dialog === 'import') deps.onImportClosed();
    },
  };

  const setPrefs: OperatorDef<{ readonly patch: Partial<Omit<Prefs, 'version'>> }> = {
    id: 'prefs.set',
    label: 'Set Preferences',
    category: 'ui',
    scope: 'global',
    flags: { internal: true },
    poll(_ctx, args) {
      const unknown = Object.keys(args.patch).filter((key) => !PREF_KEYS.has(key));
      if (unknown.length > 0) return fail(`Unknown preference ${unknown.join(', ')}`);
      // M2A-SPEC §1.2: the 'ghost' IK/FK display is M2a-stretch.
      if (args.patch.ikFkVisibility === 'ghost') return fail('not available yet');
      return ok;
    },
    apply(_ctx, args) {
      app.prefs.setState({ ...args.patch });
    },
  };

  const resetWorkspace: OperatorDef = {
    id: 'workspace.reset',
    label: 'Reset Workspace',
    description: 'Restore the default layout of the current workspace.',
    category: 'view',
    scope: 'global',
    apply() {
      app.session.setState({ maximizedPane: null });
      deps.workspace.reset();
    },
  };

  const showPanel: OperatorDef<{ readonly panel: PanelKind }> = {
    id: 'workspace.showPanel',
    label: 'Show Panel',
    category: 'view',
    scope: 'global',
    poll: (_ctx, args) => (typeof args.panel === 'string' && args.panel !== '' ? ok : fail('No panel given')),
    apply(_ctx, args) {
      if (!deps.workspace.showPanel(args.panel)) {
        throw new EkzaError('unsupported', `Panel '${args.panel}' is not available in this build`);
      }
    },
  };

  const selectionMask: OperatorDef<{ readonly mask: Partial<SelectionMask> }> = {
    id: 'view.selectionMask',
    label: 'Selection Mask',
    category: 'select',
    scope: 'global',
    apply(_ctx, args) {
      const tools = app.session.getState().tools;
      app.session.setState({ tools: { ...tools, selectionMask: { ...tools.selectionMask, ...args.mask } } });
    },
  };

  // M6a (§8.2): Windows › Timeline shows or hides the time slider in the current workspace (hidden in Model).
  const toggleTimeline: OperatorDef = {
    id: 'workspace.toggleTimeline',
    label: 'Timeline',
    description: 'Show or hide the time slider in this workspace.',
    category: 'view',
    scope: 'global',
    apply() {
      deps.workspace.setChrome('timeline', !deps.workspace.chrome().timeline);
    },
  };

  // Layout presets (docs/LAYOUT-PRESETS.md): the chrome toggles, focus mode, presets and fullscreen.
  const toggleChrome: OperatorDef<{ readonly part: ChromePart; readonly shown?: boolean }> = {
    id: 'workspace.toggleChrome',
    label: 'Show or Hide Chrome',
    aliases: ['Hide toolbar', 'Show toolbar', 'Hide UI'],
    description: 'Show or hide the tool strip, the help line or the time slider in this workspace.',
    category: 'view',
    scope: 'global',
    poll: (_ctx, args) =>
      CHROME_PARTS.includes(args.part)
        ? ok
        : fail(`expects { part: ${CHROME_PARTS.map((p) => `'${p}'`).join(' | ')} }`),
    apply(_ctx, args) {
      deps.workspace.setChrome(args.part, args.shown ?? !deps.workspace.chrome()[args.part]);
    },
  };

  const toggleFocus: OperatorDef<void, { readonly focused: boolean }> = {
    id: 'workspace.toggleFocus',
    label: 'Focus Mode',
    aliases: ['Hide UI', 'Show UI', 'Toggle UI'],
    description: 'Hide the panels and the tool strip around the viewport; again to bring them back as they were.',
    category: 'view',
    scope: 'global',
    poll: () => (deps.workspace.dockview === null ? fail('The workspace is not shown yet') : ok),
    apply() {
      return { focused: deps.workspace.toggleFocus() };
    },
  };

  const presetWorkspace = (): string => app.session.getState().workspace;
  const animateLike = (workspace: string): boolean => (app.workspaces.get(workspace)?.timeline ?? true) === true;

  const applyPreset: OperatorDef<{ readonly preset: string }> = {
    id: 'workspace.preset.apply',
    label: 'Apply Layout Preset',
    aliases: ['Layout preset', 'Workspace layout'],
    description: 'Switch to a built-in or saved layout preset (panels, chrome and viewport panes).',
    category: 'view',
    scope: 'global',
    poll(_ctx, args) {
      if (typeof args.preset !== 'string' || args.preset === '') return fail('expects { preset }');
      if (deps.workspace.dockview === null) return fail('The workspace is not shown yet');
      const workspace = presetWorkspace();
      const builtin = builtinPreset(args.preset);
      if (builtin !== undefined) {
        if (builtin.animateOnly && !animateLike(workspace)) {
          return fail(`${builtin.label} is an Animate preset; Alt+1 restores this workspace's default layout`);
        }
        return ok;
      }
      return deps.presets.get(workspace, args.preset) === undefined ? fail(`No preset '${args.preset}'`) : ok;
    },
    apply(_ctx, args) {
      const workspace = presetWorkspace();
      const builtin = builtinPreset(args.preset);
      if (builtin !== undefined) {
        const views = DEFAULT_WORKSPACE_VIEWS[workspace] ?? DEFAULT_WORKSPACE_VIEWS['animate'];
        deps.workspace.applyLayout(builtin.dock, builtin.chrome);
        app.session.setState({
          viewportLayout: builtin.viewportLayout ?? views?.layout ?? 'split',
          maximizedPane: builtin.viewportLayout === null ? (views?.maximizedPane ?? null) : null,
        });
        return;
      }
      const preset = deps.presets.get(workspace, args.preset);
      if (preset === undefined) throw new EkzaError('unsupported', `No preset '${args.preset}'`);
      deps.workspace.applyLayout(preset.dockview, preset.chrome);
      app.session.setState({ viewportLayout: preset.viewportLayout, maximizedPane: preset.maximizedPane });
    },
  };

  const savePreset: OperatorDef<{ readonly name: string }, { readonly id: string; readonly persistent: boolean }> = {
    id: 'workspace.preset.save',
    label: 'Save Layout Preset',
    description: 'Save the current panels, chrome and viewport panes as a named preset of this workspace.',
    category: 'view',
    scope: 'global',
    flags: { internal: true },
    poll(_ctx, args) {
      const problem = presetNameProblem(args.name);
      if (problem !== null) return fail(problem);
      return deps.workspace.dockview === null ? fail('The workspace is not shown yet') : ok;
    },
    apply(_ctx, args) {
      const captured = deps.workspace.capture();
      if (captured === null) throw new EkzaError('unsupported', 'The workspace is not shown yet');
      const session = app.session.getState();
      const preset = deps.presets.save(session.workspace, args.name, {
        dockview: captured.dockview,
        chrome: captured.chrome,
        viewportLayout: session.viewportLayout,
        maximizedPane: session.maximizedPane,
      });
      return { id: preset.id, persistent: deps.presets.persistent() };
    },
  };

  const renamePreset: OperatorDef<{ readonly id: string; readonly name: string }> = {
    id: 'workspace.preset.rename',
    label: 'Rename Layout Preset',
    category: 'view',
    scope: 'global',
    flags: { internal: true },
    poll(_ctx, args) {
      const problem = presetNameProblem(args.name);
      if (problem !== null) return fail(problem);
      const workspace = presetWorkspace();
      if (deps.presets.get(workspace, args.id) === undefined) return fail(`No preset '${String(args.id)}'`);
      const clash = deps.presets
        .list(workspace)
        .find((preset) => preset.id !== args.id && preset.name.toLowerCase() === args.name.trim().toLowerCase());
      return clash === undefined ? ok : fail(`A preset named '${clash.name}' already exists`);
    },
    apply(_ctx, args) {
      deps.presets.rename(presetWorkspace(), args.id, args.name);
    },
  };

  const deletePreset: OperatorDef<{ readonly id: string }> = {
    id: 'workspace.preset.delete',
    label: 'Delete Layout Preset',
    category: 'view',
    scope: 'global',
    flags: { internal: true },
    poll: (_ctx, args) =>
      deps.presets.get(presetWorkspace(), args.id) === undefined ? fail(`No preset '${String(args.id)}'`) : ok,
    apply(_ctx, args) {
      deps.presets.remove(presetWorkspace(), args.id);
    },
  };

  const doc = (): Document | null =>
    deps.document !== undefined ? deps.document : typeof document === 'undefined' ? null : document;
  const toggleFullscreen: OperatorDef = {
    id: 'view.toggleFullscreen',
    label: 'Full Screen',
    aliases: ['Fullscreen'],
    description: 'Show the editor full screen (the browser Fullscreen API), or leave full screen.',
    category: 'view',
    scope: 'global',
    poll() {
      const d = doc();
      return d !== null && d.fullscreenEnabled ? ok : fail('Full screen is not available in this browser');
    },
    apply() {
      const d = doc();
      if (d === null) return;
      // Called in the key or menu event's user activation; the browser answers asynchronously.
      const request =
        d.fullscreenElement === null
          ? d.documentElement.requestFullscreen({ navigationUI: 'hide' })
          : d.exitFullscreen();
      request.catch((error: unknown) =>
        app.services.notify.toast({
          kind: 'warning',
          text: `The browser refused full screen${error instanceof Error ? `: ${error.message}` : ''}`,
        }),
      );
    },
  };

  return [
    toggleMaximize,
    open,
    close,
    setPrefs,
    resetWorkspace,
    showPanel,
    selectionMask,
    toggleTimeline,
    toggleChrome,
    toggleFocus,
    applyPreset,
    savePreset,
    renamePreset,
    deletePreset,
    toggleFullscreen,
  ].map((def) => ({ kind: 'operator', def: def as OperatorDef<unknown, unknown, unknown> }) as const);
}

export function registerShellOperators(app: EditorApp, deps: ShellOperatorDeps): Disposer {
  const disposers = shellOperatorDefs(app, deps).map((contribution) => app.contribute(contribution));
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
