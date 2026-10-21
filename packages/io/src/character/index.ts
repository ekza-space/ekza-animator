// The character writer (M6B-SPEC §4.4, §5.22): C1 lands the minimal writer (skeleton + skinned meshes) and the
// in-memory container, C10 the full VRM 1.0 / GLB writer. C0 stubs.
import { EkzaError } from '@ekza-studio/anim-core';
import type { CharacterWriteInput, GlbContainer } from '../types';

/** Deterministic bytes (stable order, sorted keys, no timestamps); C1 lands the skeleton + skinned meshes subset. */
export function writeCharacter(
  _input: CharacterWriteInput,
  _opts: { readonly generator: string; readonly format: 'vrm' | 'glb' },
): Promise<Uint8Array> {
  return Promise.reject(new EkzaError('not-implemented', 'io.writeCharacter'));
}

/** The in-memory container of a model-sourced character (display and export path, §5.1). */
export function synthesizeContainer(_input: CharacterWriteInput): Promise<GlbContainer> {
  return Promise.reject(new EkzaError('not-implemented', 'io.synthesizeContainer'));
}
