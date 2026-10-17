// WP-7a stubs: final signatures (MVP-SPEC §7 WP-7a); bodies throw until the kernel lands.
import { EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { ClipRecord } from '@ekza-animator/doc';
import type { CharacterRuntime, EditorApp } from '../types';

export function activeClip(_app: EditorApp): ClipRecord | null {
  throw new EkzaError('not-implemented', 'editor-core.activeClip');
}

export function activeRuntime(_app: EditorApp): CharacterRuntime | null {
  throw new EkzaError('not-implemented', 'editor-core.activeRuntime');
}

export function activeClipFrame(_app: EditorApp): Frame | null {
  throw new EkzaError('not-implemented', 'editor-core.activeClipFrame');
}
