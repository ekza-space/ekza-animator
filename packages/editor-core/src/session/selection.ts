// WP-7a stubs: final signatures (MVP-SPEC §7 WP-7a); bodies throw until the kernel lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { EditorApp, Selection } from '../types';

export function selectionSnapshot(_selection: Selection): unknown {
  throw new EkzaError('not-implemented', 'editor-core.selectionSnapshot');
}

export function restoreSelection(_app: EditorApp, _snapshot: unknown): void {
  throw new EkzaError('not-implemented', 'editor-core.restoreSelection');
}
