// The character-runtime chunk (M6B-SPEC §2.1; C0 entry, C1 body): what every workspace needs to show and animate a
// model-sourced character — the model-character runtimes (./modelRuntime.ts) with skeletonFromDoc, measureSkinned,
// jointsFingerprint, readSkin, synthesizeContainer and the minimal writer. Loaded only through
// `loadCharacterRuntime()` (./runtimeChunk.ts); `CHARACTER_RUNTIME_MARKER` is the check-size marker of the
// `character-runtime` boundary (≤ 150 kB gzip, never in the initial route).
// oxlint-disable-next-line no-restricted-imports -- the character-runtime chunk entry: lazy, loaded only by loadCharacterRuntime()
export { readSkin } from '@ekza-studio/mesh-core';
export {
  characterVertices,
  jointsFingerprint,
  measureSkinned,
  skeletonFromDoc,
  synthesizeContainer,
  writeCharacter,
} from '@ekza-studio/io';
export {
  characterMeshes,
  characterPalettes,
  docSkeletonInput,
  type ModelParts,
  meshesSettled,
  modelParts,
  modelProvenance,
} from './modelInput';
export { createModelCharacters, ModelRuntime } from './modelRuntime';

/** `check-size` marker of the character-runtime chunk (§2.1). */
export const CHARACTER_RUNTIME_MARKER = 'ekza-character-runtime' as const;
