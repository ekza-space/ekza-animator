// Contribution registries (ADR 0008): built-ins and extensions register through the same calls. Registration order
// is the list order; a duplicate id is an error; a disposer removes only the definition it registered.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { Registry } from '../types';

export function createRegistry<T extends { readonly id: string }>(kind: string): Registry<T> {
  const items = new Map<string, T>();
  const listeners = new Set<() => void>();
  let cache: readonly T[] | null = null;
  const notify = (): void => {
    cache = null;
    for (const listener of listeners) listener();
  };
  return {
    register(def: T): Disposer {
      if (typeof def.id !== 'string' || def.id.length === 0) {
        throw new EkzaError('invalid-record', `${kind} definitions need a non-empty id`);
      }
      if (items.has(def.id)) throw new EkzaError('unsupported', `${kind} '${def.id}' is already registered`);
      items.set(def.id, def);
      notify();
      return () => {
        if (items.get(def.id) !== def) return;
        items.delete(def.id);
        notify();
      };
    },
    get: (id: string) => items.get(id),
    list(): readonly T[] {
      cache ??= Object.freeze([...items.values()]);
      return cache;
    },
    subscribe(listener: () => void): Disposer {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
