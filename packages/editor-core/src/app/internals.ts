// Per-app kernel internals the edit-kernel helpers need beyond the public `EditorApp` surface: the dependency
// bindings (curve engine, shape-preserving insert, scene clock) and the history capture. Apps built by the kernel
// register theirs; any other `EditorApp` implementation gets the production bindings and no capture.
import type { IdOfKind, IdSource, TableName } from '@ekza-studio/doc';
import { newId } from '@ekza-studio/doc';
import type { DocCapture } from '../history/capture';
import type { EditorApp } from '../types';
import { DEFAULT_DEPS, type KernelDeps } from './deps';

export interface KernelInternals {
  readonly deps: KernelDeps;
  /** Attributes commits to history steps; null for apps not built by the kernel. */
  readonly capture: DocCapture | null;
  /** The app's ID source (null: doc's default source). */
  readonly idSource: IdSource | null;
  /** Channel-edit gestures in progress (`edit.escape` cancels them). */
  readonly gestures: Set<{ cancel(): void }>;
}

const registry = new WeakMap<EditorApp, KernelInternals>();

export function bindInternals(app: EditorApp, internals: Omit<KernelInternals, 'gestures'>): void {
  registry.set(app, { ...internals, gestures: new Set() });
}

export function internalsOf(app: EditorApp): KernelInternals {
  let internals = registry.get(app);
  if (internals === undefined) {
    internals = { deps: DEFAULT_DEPS, capture: null, idSource: null, gestures: new Set() };
    registry.set(app, internals);
  }
  return internals;
}

const TABLE_OF_KIND: Readonly<Partial<Record<keyof IdOfKind, TableName>>> = {
  character: 'characters',
  rig: 'rigs',
  constraint: 'constraints',
  solver: 'solvers',
  camera: 'cameras',
  clip: 'clips',
  layer: 'layers',
  curve: 'curves',
  key: 'keys',
  // M6a (M6A-SPEC §4.2)
  mesh: 'meshes',
  group: 'groups',
  palette: 'palettes',
  swatch: 'swatches',
  imagePlane: 'imagePlanes',
  skeleton: 'skeletons',
  joint: 'joints',
};

/**
 * A new record ID from the app's ID source (seeded in tests and `?e2e=1`) that no record of the document uses, soft
 * deleted ones included. A seeded source replays the same sequence in every session, so a project saved in one
 * session and opened in the next already holds the IDs it is about to produce (v0.3 integration: importing a model
 * after reopening a project failed with `use-patch`). Random IDs practically never collide; the check is O(1).
 */
export function newRecordId<K extends keyof IdOfKind>(app: EditorApp, kind: K): IdOfKind[K] {
  const source = internalsOf(app).idSource;
  const table = TABLE_OF_KIND[kind];
  for (let attempt = 0; ; attempt++) {
    const id = source === null ? newId(kind) : newId(kind, source);
    if (table === undefined || attempt >= 64) return id;
    if (app.store.getIncludingDeleted(table, id as never) === undefined) return id;
  }
}
