// The Model operators, eager side (M6A-SPEC §5.27; M6A-INT-13, the B0a notes' option C). The 900,000 B gate on the
// editor's first visit cannot hold every M6a package's operator definitions, polls and bodies, so the Model-only ones
// live in a lazy chunk (`./modelOpsChunk`) that loads on the first Model entry. The registry holds a proxy per
// operator from the generated manifest (`./modelManifest`: id, label, category, key scope, flags, workspaces,
// aliases), so menus, the keymap, the command palette and `resolveKey` see every operator from the start. Until the
// chunk has loaded a proxy polls "Model tools are loading" and starts the load; the runner awaits the load before it
// coerces and polls (`pendingModelOperator`), so a key press, a menu click or a script run in that window still runs
// the real operator. Loading fills each proxy in place with its definition (poll, prepare, apply, params, extraArgs,
// description, tool, undo label): every holder of the registry's object sees the real operator afterwards.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { OperatorDef, PollResult } from '../../types';
import type { AnyOperator } from './define';
import { MODEL_OPERATOR_MANIFEST } from './modelManifest';
import type * as ModelOpsChunk from './modelOpsChunk';

export type ModelOpsModule = typeof ModelOpsChunk;

/** The poll reason of a Model operator before its chunk has loaded (and the error of a run whose load failed). */
export const MODEL_TOOLS_LOADING = 'Model tools are loading';

/** The eager metadata of one lazy operator (the manifest's entries; everything else comes with the chunk). */
export interface ModelOperatorMeta {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly scope: string;
  readonly icon?: string;
  readonly flags?: OperatorDef['flags'];
  readonly workspaces?: readonly string[];
  readonly aliases?: readonly string[];
}

/** The manifest's groups, in `BUILTIN_OPERATORS` order (see `MODEL_OPERATOR_GROUPS`). */
export interface ModelOperatorManifest {
  readonly mesh: readonly ModelOperatorMeta[];
  readonly select: readonly ModelOperatorMeta[];
  readonly content: readonly ModelOperatorMeta[];
}

/** The manifest entry of an operator definition (the generator and the drift check use it). */
export function operatorMeta(def: AnyOperator): ModelOperatorMeta {
  return {
    id: def.id,
    label: def.label,
    category: def.category,
    scope: def.scope,
    ...(def.icon === undefined ? {} : { icon: def.icon }),
    ...(def.flags === undefined ? {} : { flags: def.flags }),
    ...(def.workspaces === undefined ? {} : { workspaces: def.workspaces }),
    ...(def.aliases === undefined ? {} : { aliases: def.aliases }),
  };
}

const loadingPoll = (): PollResult => {
  void loadModelOperators().catch(() => {});
  return { ok: false, reason: MODEL_TOOLS_LOADING };
};

const loadingApply = (): never => {
  throw new EkzaError('unsupported', MODEL_TOOLS_LOADING);
};

function proxyOf(meta: ModelOperatorMeta): AnyOperator {
  return { ...meta, poll: loadingPoll, apply: loadingApply } as AnyOperator;
}

/** The proxies of a manifest group, in order. */
const PROXIES = {
  mesh: MODEL_OPERATOR_MANIFEST.mesh.map(proxyOf),
  select: MODEL_OPERATOR_MANIFEST.select.map(proxyOf),
  content: MODEL_OPERATOR_MANIFEST.content.map(proxyOf),
} as const;

/** The proxies `BUILTIN_OPERATORS` registers, by group. */
export const MODEL_OPERATOR_PROXIES: Readonly<Record<keyof ModelOperatorManifest, readonly AnyOperator[]>> = PROXIES;

const byId = new Map<string, AnyOperator>(
  [...PROXIES.mesh, ...PROXIES.select, ...PROXIES.content].map((proxy) => [proxy.id, proxy]),
);
const proxySet = new WeakSet<object>(byId.values());

let chunk: ModelOpsModule | null = null;
let loading: Promise<ModelOpsModule> | null = null;
/** Chunk operators without a manifest entry: only a test's mocked kernel adds them (the drift test keeps it empty). */
let extras: readonly AnyOperator[] = [];
const loadedListeners = new Set<(module: ModelOpsModule) => void>();

/** Replaces a proxy's behaviour with its definition, in place (keys the definition lacks, e.g. `poll`, go). */
function fill(proxy: AnyOperator, def: AnyOperator): void {
  const target = proxy as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) if (!(key in def)) delete target[key];
  Object.assign(target, def);
}

/**
 * Fills the proxies from a loaded chunk (once). Exported for test setups, which install the chunk synchronously
 * (`@ekza-animator/editor-core/testing`); the app loads it through `loadModelOperators`.
 */
export function installModelOperators(module: ModelOpsModule): void {
  if (chunk !== null) return;
  const defs = new Map<string, AnyOperator>(module.MODEL_OPERATORS.map((def) => [def.id, def]));
  const missing = [...byId.keys()].filter((id) => !defs.has(id));
  if (missing.length > 0) {
    throw new EkzaError(
      'internal',
      `The Model operator manifest is out of date (no ${missing.join(', ')}): regenerate it (test/m6a/model-ops.test.ts)`,
    );
  }
  for (const [id, proxy] of byId) fill(proxy, defs.get(id) as AnyOperator);
  extras = module.MODEL_OPERATORS.filter((def) => !byId.has(def.id));
  chunk = module;
  for (const listener of Array.from(loadedListeners)) listener(module);
  loadedListeners.clear();
}

/** Loads the Model operators chunk once (a failed load is retried by the next call). */
export function loadModelOperators(): Promise<ModelOpsModule> {
  if (chunk !== null) return Promise.resolve(chunk);
  if (loading === null) {
    const load = import('./modelOpsChunk').then((module) => {
      installModelOperators(module);
      return module;
    });
    loading = load;
    load.catch(() => {
      if (loading === load) loading = null;
    });
  }
  return loading;
}

/** Operators the loaded chunk has beyond the manifest (registered as they are; empty outside mocked tests). */
export function modelOperatorExtras(): readonly AnyOperator[] {
  return extras;
}

/** The loaded chunk, or null while the Model operators are proxies. */
export function modelOperators(): ModelOpsModule | null {
  return chunk;
}

/** Calls `listener` once the chunk has loaded (at once when it has); the disposer stops waiting. */
export function whenModelOperatorsLoaded(listener: (module: ModelOpsModule) => void): Disposer {
  if (chunk !== null) {
    listener(chunk);
    return () => {};
  }
  loadedListeners.add(listener);
  return () => {
    loadedListeners.delete(listener);
  };
}

/** The load a run of `def` has to await first: a Model operator proxy before its chunk has loaded, else null. */
export function pendingModelOperator(def: object): Promise<ModelOpsModule> | null {
  return chunk === null && proxySet.has(def) ? loadModelOperators() : null;
}
