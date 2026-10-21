// The `import()` wrapper of the character-runtime chunk (M6B-SPEC §2.1, §9.1; C0, then C1). The `CharacterRegistry`
// model-character hook (C1, ./model.ts) awaits it whenever the document holds a live model-sourced character; the
// rig-workspace chunk imports it too. Eager and tiny: the chunk itself is ./runtimeEntry.ts.
import type * as RuntimeEntry from './runtimeEntry';

export type CharacterRuntimeChunk = typeof RuntimeEntry;

let loading: Promise<CharacterRuntimeChunk> | null = null;

export function loadCharacterRuntime(): Promise<CharacterRuntimeChunk> {
  loading ??= import('./runtimeEntry').then((chunk) => {
    // The chunk's entry references its size marker; reading it keeps the export in the chunk.
    if (typeof chunk.CHARACTER_RUNTIME_MARKER !== 'string')
      throw new Error('character-runtime chunk without its marker');
    return chunk;
  });
  return loading;
}
