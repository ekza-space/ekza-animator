// `createEditorApp` (MVP-SPEC §7 WP-7a): the production kernel over the real doc, anim-core, rig and io packages.
import type { DocumentStore, IdSource } from '@ekza-animator/doc';
import type { EditorApp, EditorServices } from '../types';
import { DEFAULT_DEPS } from './deps';
import { createKernelApp } from './kernel';

/**
 * Creates the editor kernel. Without `store` it uses doc's memory store. `platform` decides `mod` (Cmd on macOS) and
 * keymap labels; it defaults to 'other' because headless code cannot inspect the browser. `idSource` seeds every
 * record ID the app creates (tests, `?e2e=1`). With `builtins` (default) the built-in operators, importers,
 * exporters, export profiles, menu items and the `maya` keymap are registered (`registerBuiltins`, WP-7b).
 *
 * Hosts that display models must call `app.services.models.setRenderer(renderer)` (the app's own wrapper) before
 * display models can load.
 */
export function createEditorApp(opts: {
  readonly services: EditorServices;
  readonly store?: DocumentStore;
  readonly platform?: 'mac' | 'other';
  readonly idSource?: IdSource;
  /** Default true: registerBuiltins (WP-7b). */
  readonly builtins?: boolean;
}): EditorApp {
  return createKernelApp(opts, DEFAULT_DEPS);
}
