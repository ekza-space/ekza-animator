// The model-character hook of the character registry (M6B-SPEC §5.1, §2.1; C1): model-sourced characters
// (`source.kind === 'model'`) get their runtime from the lazy `character-runtime` chunk, which this hook loads the first
// time the document holds one, in any workspace. Until then (and for asset characters always) the registry answers.
// Eager and small (§0.4.9: C1's allowance is 512 B gzip): everything else lives in the chunk (./modelRuntime.ts).
import type { CharacterEvent } from '../types';
import type { createCharacterRegistry, KernelCharacters } from './registry';
import { loadCharacterRuntime } from './runtimeChunk';

/** What the registry was created with (its `app` getter included). */
export type ModelHookContext = Parameters<typeof createCharacterRegistry>[0];

/** The registry of `base` (asset characters) plus the model characters' runtimes once the chunk has loaded. */
export function withModelCharacters(base: KernelCharacters, ctx: ModelHookContext): KernelCharacters {
  let impl: KernelCharacters | null = null;
  let loading: Promise<unknown> | null = null;
  const listeners = new Set<(e: CharacterEvent) => void>();
  const emit = (e: CharacterEvent): void => {
    for (const listener of listeners) listener(e);
  };
  const check = (): void => {
    if (loading !== null || !ctx.store.list('characters').some((c) => c.source?.kind === 'model')) return;
    loading = loadCharacterRuntime().then(
      (chunk) => {
        if (impl === null && loading !== null) impl = chunk.createModelCharacters(base, ctx, emit);
      },
      () => {
        loading = null; // retried on the next batch
      },
    );
  };
  const off = [base.subscribe(emit), ctx.store.subscribe(check)];
  check();
  return {
    get: (id) => (impl ?? base).get(id),
    list: () => (impl ?? base).list(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async settled() {
      await loading;
      await (impl ?? base).settled();
    },
    redisplay: (id) => (impl ?? base).redisplay(id),
    dispose() {
      for (const dispose of off) dispose();
      loading = Promise.resolve();
      (impl ?? base).dispose();
      listeners.clear();
    },
  };
}
