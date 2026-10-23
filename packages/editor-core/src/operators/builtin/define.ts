// Typing and small helpers for the built-in operators: each definition is checked against `OperatorMap` (args and
// result of its id), then stored type-erased like any contribution (ADR 0008 §1–2).
import { EkzaError } from '@ekza-studio/anim-core';
import type {
  OperatorArgs,
  OperatorContext,
  OperatorDef,
  OperatorReturn,
  PanelKind,
  PollResult,
  RunContext,
} from '../../types';
import { isRecord } from '../../workflows/util';
import type { OperatorMap } from '../args';
import type { CoalescingOperatorDef } from '../runner';

export type AnyOperator = OperatorDef<unknown, unknown, unknown>;

/** A built-in operator: its id fixes the argument and result types. */
export type BuiltinOperator<K extends keyof OperatorMap, P = void> = CoalescingOperatorDef<
  OperatorArgs<K>,
  OperatorReturn<K>,
  P
> & { readonly id: K };

export function defineOperator<K extends keyof OperatorMap, P = void>(def: BuiltinOperator<K, P>): AnyOperator {
  return def;
}

export const OK: PollResult = true;

export function fail(reason: string): PollResult {
  return { ok: false, reason };
}

/** The first failing poll, or OK. */
export function all(...results: readonly PollResult[]): PollResult {
  return results.find((result) => result !== true) ?? OK;
}

/** Args of operators whose args may be omitted: an object, or {} for undefined/null. */
export function optionalArgs(args: unknown): Readonly<Record<string, unknown>> | null {
  if (args === undefined || args === null) return {};
  return isRecord(args) ? args : null;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The panel an operator runs for: the run context's, else the panel under the pointer. */
export function panelOf(ctx: OperatorContext): PanelKind | null {
  return ctx.panel ?? ctx.app.session.getState().hoveredPanel?.kind ?? null;
}

/** Message of anything thrown. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The run context an operator was run with (to forward it). M-AI runner rule 7: the source, actor, run scope, signal
 * and access are forwarded too, so a nested run is attributed, scoped, cancellable and checked like its parent.
 */
export function runContextOf(ctx: OperatorContext): RunContext {
  return {
    ...(ctx.panel === null ? {} : { panel: ctx.panel }),
    ...(ctx.paneId === null ? {} : { paneId: ctx.paneId }),
    ...(ctx.source === undefined || ctx.source === null ? {} : { source: ctx.source }),
    ...(ctx.actor === undefined || ctx.actor === null ? {} : { actor: ctx.actor }),
    ...(ctx.runScope === undefined || ctx.runScope === null ? {} : { runScope: ctx.runScope }),
    ...(ctx.signal === undefined || ctx.signal === null ? {} : { signal: ctx.signal }),
    ...(ctx.access === undefined || ctx.access === null ? {} : { access: ctx.access }),
  };
}

/** True when an operator runs for an agent (`RunContext.actor`, MCP-SPEC §4.1). */
export function isActorRun(ctx: OperatorContext): boolean {
  return ctx.actor !== undefined && ctx.actor !== null;
}

/**
 * Runs another operator from a dispatcher's `prepare` (never from `apply`, §4.11.0) and returns its value; a failed
 * or refused run fails the dispatcher with the same code.
 */
export async function forward(ctx: OperatorContext, op: string, args: unknown): Promise<unknown> {
  const result = await ctx.app.runUntyped(op, args, runContextOf(ctx));
  if (result.status === 'failed') throw new EkzaError(result.error.code, result.error.message);
  if (result.status === 'cancelled') throw new EkzaError('unsupported', result.reason);
  return result.value;
}

export { isRecord };
