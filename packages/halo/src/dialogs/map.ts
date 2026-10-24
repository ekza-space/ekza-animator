// Questions the kernel asks (STUDIO-TOUCH-SPEC §6.7, ST-38, AS-ST-20): every `UiDialog` value maps to a Halo surface.
// The host's dialog host renders Studio Pro's dialogs on every route; while Halo is mounted its watcher (`./watcher`)
// takes each value first and shows the Halo surface instead — an inline confirm card, a sheet, a file picker, Home —
// so no Pro dialog opens over the canvas. A typed record: a new `UiDialog` value fails to compile until it has a row,
// and `test/dialogs.test.ts` checks the rows at run time.
import type { UiDialog } from '@ekza-studio/editor-core';
import { en } from '../i18n/en';

export type DialogSurface =
  /** An inline card beside the verb that asked (§6.7: Bind again, Unbind, Use as rest pose). */
  | { readonly kind: 'confirm'; readonly text: string; readonly yes: string }
  /** A Halo sheet (T6b, T11 own the bodies). */
  | { readonly kind: 'sheet'; readonly sheet: 'share' | 'about' | 'help' | 'settings' }
  /** Files, with sniffing (project menu › Open / Import). */
  | { readonly kind: 'picker'; readonly picker: 'open' | 'import' }
  /** Home › Continue: Halo never shows the Recovery dialog (§17). */
  | { readonly kind: 'home' }
  /** Nothing: Home replaces Pro's first-run dialog. */
  | { readonly kind: 'noop' }
  /** Studio Pro's window chrome: *Open in the Pro layout ▸* (`PRO_CHROME`). */
  | { readonly kind: 'pro' }
  /** Shown by the host until its stage package builds the Halo surface (Reference picker T8, Make editable report). */
  | { readonly kind: 'host'; readonly owner: 'T8' }
  /** Deferred M6b stubs: hidden in both shells until they ship. */
  | { readonly kind: 'deferred' };

const d = en.dialogs;

export const DIALOG_SURFACES: Readonly<Record<UiDialog, DialogSurface>> = {
  rebindSkin: { kind: 'confirm', text: d.rebindSkin, yes: d.rebindSkinYes },
  unbindSkin: { kind: 'confirm', text: d.unbindSkin, yes: d.unbindSkinYes },
  applyPoseAsRest: { kind: 'confirm', text: d.applyPoseAsRest, yes: d.applyPoseAsRestYes },
  imagePlaneImport: { kind: 'host', owner: 'T8' },
  vrmMeta: { kind: 'sheet', sheet: 'about' },
  export: { kind: 'sheet', sheet: 'share' },
  open: { kind: 'picker', picker: 'open' },
  import: { kind: 'picker', picker: 'import' },
  recovery: { kind: 'home' },
  makeEditableReport: { kind: 'host', owner: 'T8' },
  shortcuts: { kind: 'sheet', sheet: 'help' },
  about: { kind: 'sheet', sheet: 'help' },
  preferences: { kind: 'sheet', sheet: 'settings' },
  firstRun: { kind: 'noop' },
  layoutPresets: { kind: 'pro' },
  makeCharacterEditable: { kind: 'deferred' },
  attachProp: { kind: 'deferred' },
};

/** The surface of a dialog value; an unknown one (an extension's) gets *Open in the Pro layout ▸*. */
export function surfaceOf(dialog: string): DialogSurface {
  return (DIALOG_SURFACES as Readonly<Record<string, DialogSurface>>)[dialog] ?? { kind: 'pro' };
}
