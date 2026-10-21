// Operator registry (ADR 0008 §1): ids are `<area>.<object>.<verb>`; duplicates are errors; `poll` never throws (a
// throwing poll reads as disabled with its message, so menus stay usable).
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import type {
  EditorApp,
  OperatorContext,
  OperatorDef,
  OperatorId,
  OperatorRegistry,
  PollResult,
  RunContext,
} from '../types';

export type AnyOperatorDef = OperatorDef<unknown, unknown, unknown>;

export function operatorContext(app: EditorApp, ctx: RunContext | undefined): OperatorContext {
  return {
    app,
    panel: ctx?.panel ?? null,
    paneId: ctx?.paneId ?? null,
    // M6a (B0a addition): the run's source and auto-repeat flag reach poll/prepare/apply.
    ...(ctx?.source === undefined ? {} : { source: ctx.source }),
    ...(ctx?.repeat === undefined ? {} : { repeat: ctx.repeat }),
  };
}

export function unknownOperator(id: string): string {
  return `unknown operator '${id}'`;
}

type BeforeDocumentRun = (id: OperatorId) => void;
/** M6b (§0.5): the `onBeforeDocumentRun` listeners of each registry (the runner dispatches through `beforeDocumentRun`). */
const beforeRunListeners = new WeakMap<OperatorRegistry, Set<BeforeDocumentRun>>();

/**
 * M6b C0 hook (M6B-SPEC §0.5): runs the registry's `onBeforeDocumentRun` listeners synchronously, in registration
 * order; a throwing listener never stops the run (its error is reported and the next listener runs).
 */
export function beforeDocumentRun(registry: OperatorRegistry, id: string): void {
  const listeners = beforeRunListeners.get(registry);
  if (listeners === undefined || listeners.size === 0) return;
  for (const listener of Array.from(listeners)) {
    try {
      listener(id as OperatorId);
    } catch (error) {
      console.error(error);
    }
  }
}

export function createOperatorRegistry(app: () => EditorApp): OperatorRegistry {
  const operators = new Map<string, AnyOperatorDef>();
  let cache: readonly AnyOperatorDef[] | null = null;
  const beforeRun = new Set<BeforeDocumentRun>();
  const registry: OperatorRegistry = {
    onBeforeDocumentRun(listener: BeforeDocumentRun): Disposer {
      beforeRun.add(listener);
      return () => {
        beforeRun.delete(listener);
      };
    },
    register<A, R, P>(def: OperatorDef<A, R, P>): Disposer {
      if (typeof def.id !== 'string' || !/^[^.\s]+\.\S+$/.test(def.id)) {
        throw new EkzaError('invalid-record', `Operator id '${String(def.id)}' must look like '<area>.<name>'`);
      }
      if (operators.has(def.id)) throw new EkzaError('unsupported', `Operator '${def.id}' is already registered`);
      // Stored type-erased: the registry serves untyped callers (keymaps, menus, plugins).
      const stored = def as unknown as AnyOperatorDef;
      operators.set(def.id, stored);
      cache = null;
      return () => {
        if (operators.get(def.id) !== stored) return;
        operators.delete(def.id);
        cache = null;
      };
    },
    get: (id: string) => operators.get(id),
    list(): readonly AnyOperatorDef[] {
      cache ??= Object.freeze([...operators.values()]);
      return cache;
    },
    poll(id: string, ctx?: RunContext, args?: unknown): PollResult {
      const def = operators.get(id);
      if (def === undefined) return { ok: false, reason: unknownOperator(id) };
      try {
        return def.poll?.(operatorContext(app(), ctx), args) ?? true;
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
  beforeRunListeners.set(registry, beforeRun);
  return registry;
}
