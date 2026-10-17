// WP-7a edit kernel stubs (MVP-SPEC §4.11.0, §7 WP-7a): final signatures; bodies throw until the kernel lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { Tx } from '@ekza-animator/doc';
import type { ChannelEdit, ChannelEditGesture, ChannelEditResult, EditorApp, KeyPolicy } from '../types';

export function applyChannelEdits(
  _app: EditorApp,
  _tx: Tx,
  _edits: readonly ChannelEdit[],
  _opts: { readonly key: KeyPolicy },
): ChannelEditResult {
  throw new EkzaError('not-implemented', 'editor-core.applyChannelEdits');
}

export function beginChannelEditGesture(
  _app: EditorApp,
  _label: string,
  _opts: { readonly key: KeyPolicy },
): ChannelEditGesture {
  throw new EkzaError('not-implemented', 'editor-core.beginChannelEditGesture');
}
