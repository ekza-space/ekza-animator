// @ekza-studio/autorig — the Auto-Rig mode (AUTORIG-SPEC, ADR 0021): a second shell over the same EditorApp,
// document, history and operators as Studio. It adds no rigging, skinning, clip or export logic: every document write
// is an `app.operators.run` of a Studio operator or an `autorig.*` composition (rig-workspace chunk). Only `/autorig`
// imports this package (lazily); `/editor` must never load it (`autorig-shell` boundary, §7.2), and `editor` never
// imports it. Dependency direction (§4.1): editor-core, doc, ui, viewport (types only) and `@ekza-studio/editor`
// through its `./host` and `./bodies` subpaths only.
import { AUTORIG_SHELL_MARKER } from './types';

export * from './types';
export { AutoRigShell, type AutoRigShellProps } from './shell';
export { defaultAutoRigSession } from './session';
export { autoRigProgress } from './progress';
export { installSimpleNavigation } from './nav';
export {
  formatNumber,
  type AutoRigLanguage,
  type MessageSection,
  type Messages,
  type MessageTable,
  messages,
} from './i18n';
export { AUTORIG_KEY_SCOPE, AUTORIG_KEYMAP, type AutoRigKeyBinding } from './keymap';
export { IDENTITY_CLIP_PARAMS } from './steps/animations';

/** The marker this entry references (the check-size boundary of the shell, §7.2). */
export const AUTORIG_ENTRY = AUTORIG_SHELL_MARKER;
