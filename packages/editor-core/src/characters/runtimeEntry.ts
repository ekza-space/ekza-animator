// The character-runtime chunk (M6B-SPEC §2.1; C0 entry, C1 body): what every workspace needs to show and animate a
// model-sourced character — the model-character runtimes (./modelRuntime.ts) with skeletonFromDoc, measureSkinned,
// jointsFingerprint and the record helpers. `readSkin` is the mesh kernel's (the chunk never carries mesh-core code);
// `synthesizeContainer` and the minimal writer come with io's write path (`loadWritePath()`), so glTF Transform is
// shared with the export chunk, never duplicated. Loaded only through `loadCharacterRuntime()` (./runtimeChunk.ts); `CHARACTER_RUNTIME_MARKER` is the check-size marker of the
// `character-runtime` boundary (≤ 150 kB gzip, never in the initial route).
import { createModelCharacters as createModelRuntimes } from './modelRuntime';
import type { KernelCharacters } from './registry';

export { characterVertices, jointsFingerprint, measureSkinned, skeletonFromDoc } from '@ekza-studio/io';
export {
  characterMeshes,
  characterPalettes,
  docSkeletonInput,
  type ModelParts,
  meshesSettled,
  modelParts,
  modelProvenance,
} from './modelInput';
export { ModelRuntime } from './modelRuntime';

/** `check-size` marker of the character-runtime chunk (§2.1). */
export const CHARACTER_RUNTIME_MARKER = 'ekza-character-runtime' as const;

/** The model-character runtimes (./modelRuntime.ts); the entry point references the chunk's size marker. */
export function createModelCharacters(...args: Parameters<typeof createModelRuntimes>): KernelCharacters {
  if (typeof CHARACTER_RUNTIME_MARKER !== 'string') throw new Error('character-runtime chunk without its marker');
  return createModelRuntimes(...args);
}
