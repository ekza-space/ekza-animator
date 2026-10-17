// Per-app kernel internals the edit-kernel helpers need beyond the public `EditorApp` surface: the dependency
// bindings (curve engine, shape-preserving insert, scene clock) and the history capture. Apps built by the kernel
// register theirs; any other `EditorApp` implementation gets the production bindings and no capture.
import type { IdOfKind, IdSource } from '@ekza-animator/doc';
import { newId } from '@ekza-animator/doc';
import type { DocCapture } from '../history/capture';
import type { EditorApp } from '../types';
import { DEFAULT_DEPS, type KernelDeps } from './deps';

export interface KernelInternals {
  readonly deps: KernelDeps;
  /** Attributes commits to history steps; null for apps not built by the kernel. */
  readonly capture: DocCapture | null;
  /** The app's ID source (null: doc's default source). */
  readonly idSource: IdSource | null;
}

const registry = new WeakMap<EditorApp, KernelInternals>();
const FOREIGN: KernelInternals = { deps: DEFAULT_DEPS, capture: null, idSource: null };

export function bindInternals(app: EditorApp, internals: KernelInternals): void {
  registry.set(app, internals);
}

export function internalsOf(app: EditorApp): KernelInternals {
  return registry.get(app) ?? FOREIGN;
}

/** A new record ID from the app's ID source (seeded in tests and `?e2e=1`). */
export function newRecordId<K extends keyof IdOfKind>(app: EditorApp, kind: K): IdOfKind[K] {
  const source = internalsOf(app).idSource;
  return source === null ? newId(kind) : newId(kind, source);
}
