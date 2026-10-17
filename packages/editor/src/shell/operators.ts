// Operators owned by the shell (MVP-SPEC §4.9 owner 8): `view.toggleMaximize`, `ui.open`, `ui.close`, plus the
// shell's own commands for preferences, the workspace and the selection mask. Registered through
// `app.contribute` like every other operator (ADR 0008); none of them writes the document.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import {
  type Contribution,
  type EditorApp,
  type OperatorDef,
  PANEL,
  type PanelKind,
  type PollResult,
  type Prefs,
  type SelectionMask,
  type UiDialog,
} from '@ekza-animator/editor-core';
import type {} from './operator-map';
import type { WorkspaceApi } from './types';

export const UI_DIALOGS: readonly UiDialog[] = [
  'open',
  'import',
  'export',
  'shortcuts',
  'about',
  'firstRun',
  'preferences',
];

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
]);

export interface ShellOperatorDeps {
  readonly workspace: WorkspaceApi;
  /** Called when the import dialog closes without importing (drops the pending file). */
  readonly onImportClosed: () => void;
}

const ok: PollResult = true;
const fail = (reason: string): PollResult => ({ ok: false, reason });

/** The `ui.open` poll: dialogs that need a character fail politely in an empty document. */
function pollDialog(app: EditorApp, dialog: UiDialog): PollResult {
  if (!UI_DIALOGS.includes(dialog)) return fail(`Unknown dialog '${String(dialog)}'`);
  if (dialog === 'export' && app.store.list('characters').length === 0) return fail('Load a character to export');
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
      return unknown.length === 0 ? ok : fail(`Unknown preference ${unknown.join(', ')}`);
    },
    apply(_ctx, args) {
      app.prefs.setState({ ...args.patch });
    },
  };

  const resetWorkspace: OperatorDef = {
    id: 'workspace.reset',
    label: 'Reset Workspace',
    description: 'Restore the default Animate layout.',
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

  return [toggleMaximize, open, close, setPrefs, resetWorkspace, showPanel, selectionMask].map(
    (def) => ({ kind: 'operator', def: def as OperatorDef<unknown, unknown, unknown> }) as const,
  );
}

export function registerShellOperators(app: EditorApp, deps: ShellOperatorDeps): Disposer {
  const disposers = shellOperatorDefs(app, deps).map((contribution) => app.contribute(contribution));
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
