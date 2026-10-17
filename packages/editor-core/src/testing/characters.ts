// Character runtimes of the fake app: one naive rig program per character over the test skeleton, rebuilt when a
// batch touches its character, rig or controls ('added' | 'removed' | 'recompiled' events). No display models.
import type { Disposer } from '@ekza-animator/anim-core';
import type { AnyChange, AssetId, CharacterId, CharacterRecord, ClipId, DocumentStore } from '@ekza-animator/doc';
import type { GlbContainer } from '@ekza-animator/io';
import type { ClipSampler, SkeletonDesc } from '@ekza-animator/rig';
import type { CharacterEvent, CharacterRegistry, CharacterRuntime } from '../types';
import { type CurveCompiler, createNaiveSampler } from './evaluation';
import { createNaiveRigProgram } from './rig';

const STRUCTURAL_TABLES = new Set(['characters', 'rigs', 'controls']);

export interface FakeCharacterRegistry extends CharacterRegistry {
  dispose(): void;
}

/** Runtimes exist only when the fake app was given a skeleton; every character shares it. */
export function createFakeCharacters(
  store: DocumentStore,
  skeleton: SkeletonDesc | null,
  compiler: CurveCompiler,
): FakeCharacterRegistry {
  const runtimes = new Map<CharacterId, CharacterRuntime>();
  const listeners = new Set<(e: CharacterEvent) => void>();

  const build = (character: CharacterRecord): CharacterRuntime | undefined => {
    if (skeleton === null) return undefined;
    const rig = store.get('rigs', character.rig) ?? store.query.rigOfCharacter(character.id);
    if (rig === undefined) return undefined;
    const program = createNaiveRigProgram(skeleton, rig, store.query.controlsOfRig(rig.id));
    const channels = program.allocChannels();
    const pose = program.allocPose();
    program.evaluate(channels, pose);
    const samplers = new Map<ClipId, ClipSampler>();
    return {
      id: character.id,
      asset: character.asset,
      container: placeholderContainer(character.asset),
      skeleton,
      program,
      channels,
      pose,
      display: null,
      sampler(clip: ClipId): ClipSampler {
        let sampler = samplers.get(clip);
        if (sampler === undefined) {
          sampler = createNaiveSampler(store, compiler, clip, program);
          samplers.set(clip, sampler);
        }
        return sampler;
      },
    };
  };

  const emit = (event: CharacterEvent): void => {
    for (const listener of listeners) listener(event);
  };

  /** Characters whose runtime a batch invalidates (null: every character, e.g. on load). */
  const affected = (changes: readonly AnyChange[]): Set<CharacterId> => {
    const ids = new Set<CharacterId>();
    for (const change of changes) {
      const row = change.after ?? change.before;
      if (row === undefined) continue;
      if (change.table === 'characters') ids.add(change.id);
      else if (change.table === 'rigs') ids.add((row as { readonly character: CharacterId }).character);
      else if (change.table === 'controls') {
        const rig = store.getIncludingDeleted('rigs', (row as { readonly rig: CharacterRecord['rig'] }).rig);
        if (rig !== undefined) ids.add(rig.character);
      }
    }
    return ids;
  };

  const sync = (touched: ReadonlySet<CharacterId> | null): void => {
    const present = new Map(store.list('characters').map((character) => [character.id, character]));
    for (const id of runtimes.keys()) {
      if (present.has(id)) continue;
      runtimes.delete(id);
      emit({ type: 'removed', id });
    }
    for (const [id, character] of present) {
      const existed = runtimes.has(id);
      if (existed && touched !== null && !touched.has(id)) continue;
      const runtime = build(character);
      if (runtime === undefined) {
        if (existed) {
          runtimes.delete(id);
          emit({ type: 'removed', id });
        }
        continue;
      }
      runtimes.set(id, runtime);
      emit({ type: existed ? 'recompiled' : 'added', id });
    }
  };

  sync(null);
  const unsubscribe = store.subscribe((batch) => {
    if (batch.origin === 'load') sync(null);
    else if (batch.changes.some((change) => STRUCTURAL_TABLES.has(change.table))) sync(affected(batch.changes));
  });

  return {
    get: (id: CharacterId) => runtimes.get(id),
    list: () => [...runtimes.values()],
    subscribe(listener: (e: CharacterEvent) => void): Disposer {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(): void {
      unsubscribe();
      listeners.clear();
    },
  };
}

/** The fake app has no model bytes: an empty container that names the asset. */
function placeholderContainer(asset: AssetId): GlbContainer {
  return {
    bytes: new Uint8Array(0),
    json: { asset: { version: '2.0', generator: 'ekza-animator test kit (no model)' } },
    jsonByteLength: 0,
    bin: null,
    sha256: asset,
  };
}
