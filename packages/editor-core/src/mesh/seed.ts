// Step seeds and recorded run settings (M6A-SPEC §3 rule 3, §5.7): an **adjusted re-run** — a run from the Last-op
// card or INPUTS (`source: 'card'`) of the operator `session.lastRun` names — reuses the recorded seed (so derived ids
// of `mesh.create.*` and MeshSetOp outputs stay the same) and the recorded symmetry/soft context; every other run gets
// a fresh `newId('tx')` seed and the session's current settings. The seed of the latest run is remembered per app for
// the LastRun recorder (B11 reads it with `runSeedOf`).
import { newRecordId } from '../app/internals';
import type { EditorApp, LastRun, OperatorContext } from '../types';
import type { RunSettings } from './context';

const seeds = new WeakMap<EditorApp, { readonly opId: string; readonly seed: string }>();

/** The LastRun this run adjusts (a card run of the same operator), else null. */
export function adjustedRun(ctx: OperatorContext, opId: string): LastRun | null {
  if (ctx.source !== 'card') return null;
  const last = ctx.app.session.getState().lastRun;
  return last !== null && last.id === opId ? last : null;
}

/** The step seed of this run (remembered for the LastRun recorder). */
export function runSeed(ctx: OperatorContext, opId: string): string {
  const seed = adjustedRun(ctx, opId)?.seed ?? newRecordId(ctx.app, 'tx');
  seeds.set(ctx.app, { opId, seed });
  return seed;
}

/** The seed the latest mesh run of `app` used (B11's LastRun recorder stores it as `LastRun.seed`). */
export function runSeedOf(app: EditorApp): { readonly opId: string; readonly seed: string } | null {
  return seeds.get(app) ?? null;
}

/** The recorded symmetry/soft settings of an adjusted re-run (undefined: use the session's). */
export function runSettings(ctx: OperatorContext, opId: string): RunSettings | undefined {
  const last = adjustedRun(ctx, opId);
  if (last === null) return undefined;
  return { symmetry: last.context.symmetry, soft: last.context.soft };
}
