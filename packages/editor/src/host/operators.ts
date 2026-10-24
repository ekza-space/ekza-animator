// The page host's operators (AUTORIG-SPEC §4.4, D1; moved from the Studio shell's `shell/operators.ts`): `ui.open` and
// `ui.close` for the host's dialogs, and `prefs.set`. Registered by the HostShell, so they exist on `/editor` and
// `/autorig` alike (scripts, the palette and the MCP bridge see them on both). None writes the document.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp, OperatorDef, PollResult, Prefs, UiDialog } from '@ekza-studio/editor-core';
import type {} from '../shell/operator-map';

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
  // M6b (C10, §5.22): VRM Meta… of a character made from a model.
  'vrmMeta',
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
  // M6b (§5.22; STUDIO-TOUCH-SPEC T6-INT, P-T6B-3): the rigging preferences — Studio Pro's status-line joint size,
  // the option defaults of the Rig & Skin option boxes, Halo's Settings › Rigging and More's *Make default*.
  'rigging',
]);

export interface HostOperatorDeps {
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

export function registerHostOperators(app: EditorApp, deps: HostOperatorDeps): Disposer {
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

  const disposers = [open, close, setPrefs].map((def) => app.contribute({ kind: 'operator', def }));
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
