// WP-7a stub: final signature (MVP-SPEC §7 WP-7a); throws until the kernel lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { DocumentStore, IdSource } from '@ekza-animator/doc';
import type { EditorApp, EditorServices } from '../types';

export function createEditorApp(_opts: {
  readonly services: EditorServices;
  readonly store?: DocumentStore;
  readonly platform?: 'mac' | 'other';
  readonly idSource?: IdSource;
  /** Default true: registerBuiltins (WP-7b). */
  readonly builtins?: boolean;
}): EditorApp {
  throw new EkzaError('not-implemented', 'editor-core.createEditorApp');
}
