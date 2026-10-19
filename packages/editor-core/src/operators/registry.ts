// Operator registry (ADR 0008 §1): ids are `<area>.<object>.<verb>`; duplicates are errors; `poll` never throws (a
// throwing poll reads as disabled with its message, so menus stay usable).
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { EditorApp, OperatorContext, OperatorDef, OperatorRegistry, PollResult, RunContext } from '../types';

export type AnyOperatorDef = OperatorDef<unknown, unknown, unknown>;

/** The operator context of a run; the M-AI fields are always set, null when the run context lacks them (rule 7). */
export function operatorContext(app: EditorApp, ctx: RunContext | undefined): OperatorContext {
  return {
    app,
    panel: ctx?.panel ?? null,
    paneId: ctx?.paneId ?? null,
    source: ctx?.source ?? null,
    actor: ctx?.actor ?? null,
    runScope: ctx?.actor === undefined ? null : (ctx.runScope ?? null),
    signal: ctx?.signal ?? null,
    access: ctx?.access ?? null,
  };
}

export function unknownOperator(id: string): string {
  return `unknown operator '${id}'`;
}

export function createOperatorRegistry(app: () => EditorApp): OperatorRegistry {
  const operators = new Map<string, AnyOperatorDef>();
  let cache: readonly AnyOperatorDef[] | null = null;
  return {
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
}
