// Questions the kernel asks (STUDIO-TOUCH-SPEC §6.7, ST-38, AS-ST-20; T6b): every `UiDialog` value maps to a Halo
// surface. The `Record<UiDialog, …>` type makes a new value fail the typecheck until it is mapped here; the dialog
// watcher (`dialogs/watcher.ts`, T6a) reads this table, and an unknown value shows a toast with *Open in the Pro
// layout ▸* rather than dead-ending. The `ui.open` manifest entries are derived from it, one per dialog value.
import type { OperatorId, UiDialog } from '@ekza-studio/editor-core';
import { type Owner, SHEET_OWNER, type SheetId } from './types';

export type DialogSurface =
  /** Opens a Halo sheet. */
  | { readonly sheet: SheetId; readonly section?: string }
  /** An inline confirm card at the petal or row that asked; ✓ re-runs `op` with `{confirm: true}`. */
  | { readonly confirm: OperatorId; readonly text: string; readonly yes: string }
  /** The Files picker (with byte sniffing) for a project, a model or a reference image. */
  | { readonly picker: 'open' | 'import' | 'reference' }
  /** Home › Continue (Halo installs its own recovery hook; it never shows the Recovery dialog, §17). */
  | { readonly home: 'continue' }
  /** Nothing to show in Halo, with the reason (`firstRun`: Home replaces it). */
  | { readonly noop: string }
  /** A Studio Pro presentation (its window chrome): *Open in the Pro layout ▸*. */
  | { readonly proOnly: 'PRO_CHROME'; readonly reason: string }
  /** A deferred stub's question: hidden in both shells until it ships. */
  | { readonly deferred: string };

/** Who builds each surface (the watcher is T6a's; the sheets and cards are their owners'). */
export function dialogOwner(surface: DialogSurface): Owner | null {
  if ('sheet' in surface) return SHEET_OWNER[surface.sheet];
  if ('confirm' in surface || 'picker' in surface) return 'T6a';
  if ('home' in surface) return 'T11';
  return null;
}

export const DIALOG_SURFACES: Readonly<Record<UiDialog, DialogSurface>> = {
  rebindSkin: {
    confirm: 'skin.bind',
    text: 'Binding again replaces the painted weights',
    yes: 'Bind again',
  },
  unbindSkin: { confirm: 'skin.unbind', text: 'Unbind removes the weights; the skeleton stays', yes: 'Unbind' },
  applyPoseAsRest: {
    confirm: 'skel.pose.applyAsRest',
    text: 'The current pose becomes the rest pose; animations keep their keys',
    yes: 'Apply',
  },
  imagePlaneImport: { picker: 'reference' },
  vrmMeta: { sheet: 'about' },
  export: { sheet: 'share' },
  open: { picker: 'open' },
  import: { picker: 'import' },
  recovery: { home: 'continue' },
  makeEditableReport: { sheet: 'makeEditableReport' },
  shortcuts: { sheet: 'help', section: 'shortcuts' },
  about: { sheet: 'help', section: 'about' },
  preferences: { sheet: 'settings' },
  firstRun: { noop: "Home replaces Studio Pro's first-run dialog (§17)" },
  layoutPresets: { proOnly: 'PRO_CHROME', reason: "Layout presets arrange Studio Pro's panels" },
  makeCharacterEditable: { deferred: 'A deferred M6b stub (char.makeEditable): hidden in both shells until it ships' },
  attachProp: { deferred: 'A deferred M6b stub (char.attachProp): hidden in both shells until it ships' },
};

/** The dialog values listed as deferred (AS-ST-20: "has a Halo handler or is listed as deferred"). */
export const DEFERRED_DIALOGS: readonly UiDialog[] = (Object.keys(DIALOG_SURFACES) as UiDialog[]).filter(
  (dialog) => 'deferred' in DIALOG_SURFACES[dialog],
);
