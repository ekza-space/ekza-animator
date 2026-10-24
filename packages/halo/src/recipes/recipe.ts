// Recipes (STUDIO-TOUCH-SPEC §9.11, §8, P9; T11 builds the contract and four recipes, T9 adds *Rig it* and *Fix where
// it bends*): a recipe is data — its title, the search phrases that offer it, and a plan of ordinary operator calls
// (each an undoable step with its own label) computed from the document when it starts; a later step may read the
// results of the earlier ones (the wave keys the animation the first step made). The runner runs the steps in order
// through the shell's funnel, says *Wave · 2 of 8* while it runs and *Wave: done · Undo all* at the end; *Undo all*
// reverts exactly the recipe's steps (`edit.revertSteps`, the AI groups' undo). A refused step stops the recipe and
// says why; the steps before it stay (P9: sparse, labelled, undoable). React-free.
import type { EditorApp, OperatorResult } from '@ekza-studio/editor-core';
import { en } from '../i18n/en';

/** One step: an operator and its arguments (from the document and the earlier steps' results). */
export interface RecipeStep {
  readonly op: string;
  readonly args: unknown | ((results: readonly unknown[]) => unknown);
}

/** A recipe's plan for the document as it is, or why it cannot start (a plain sentence). */
export type RecipePlan = { readonly steps: readonly RecipeStep[] } | { readonly problem: string };

export interface Recipe<P> {
  readonly id: string;
  title(params: P): string;
  readonly detail: string;
  /** The parameters a search query asks for, or null when the query does not name this recipe (§8 phrases). */
  match(query: string): P | null;
  plan(app: EditorApp, params: P): RecipePlan;
}

/** What the runner needs of the shell. */
export interface RecipeHost {
  readonly app: EditorApp;
  run(op: string, args?: unknown): Promise<OperatorResult<unknown>>;
  toast(toast: {
    readonly key: string;
    readonly text: string;
    readonly tone?: 'neutral' | 'warning' | 'error';
    readonly durationMs?: number;
    readonly action?: { readonly label: string; readonly run: () => void };
  }): void;
}

export type RecipeOutcome =
  | { readonly status: 'done'; readonly steps: readonly number[]; readonly results: readonly unknown[] }
  | { readonly status: 'stopped'; readonly reason: string; readonly steps: readonly number[] };

const stepIds = (app: EditorApp): Set<number> => new Set(app.history.entries().undo.map((step) => step.id));

/** Runs a recipe's plan (§9.11); every step is the person's run, so a failure is a toast and the recipe stops. */
export async function runRecipe<P>(host: RecipeHost, recipe: Recipe<P>, params: P): Promise<RecipeOutcome> {
  const title = recipe.title(params);
  const plan = recipe.plan(host.app, params);
  if ('problem' in plan) {
    host.toast({ key: 'recipe', text: en.recipes.stopped(title, plan.problem), tone: 'warning' });
    return { status: 'stopped', reason: plan.problem, steps: [] };
  }
  const before = stepIds(host.app);
  const results: unknown[] = [];
  const added = (): number[] => [...stepIds(host.app)].filter((id) => !before.has(id));
  for (const [index, step] of plan.steps.entries()) {
    if (plan.steps.length > 1) {
      host.toast({ key: 'recipe', text: en.recipes.step(title, index + 1, plan.steps.length) });
    }
    const args = typeof step.args === 'function' ? (step.args as (r: readonly unknown[]) => unknown)(results) : step.args;
    const result = await host.run(step.op, args);
    if (result.status !== 'finished') {
      const reason = result.status === 'failed' ? result.error.message : result.reason;
      host.toast({ key: 'recipe', text: en.recipes.stopped(title, reason), tone: 'warning' });
      return { status: 'stopped', reason, steps: added() };
    }
    results.push(result.value);
  }
  const steps = added();
  host.toast({
    key: 'recipe',
    text: en.recipes.done(title),
    durationMs: 8000,
    ...(steps.length === 0
      ? {}
      : { action: { label: en.recipes.undoAll, run: () => void host.run('edit.revertSteps', { steps }) } }),
  });
  return { status: 'done', steps, results };
}

/** A recipe offered by a query, with the parameters the query asked for. */
export interface RecipeMatch {
  readonly recipe: Recipe<unknown>;
  readonly params: unknown;
  readonly title: string;
}

/** The recipes search offers for a query (§8: a small deterministic matcher, never a silent guess). */
export function matchRecipes(recipes: readonly Recipe<unknown>[], query: string): readonly RecipeMatch[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const out: RecipeMatch[] = [];
  for (const recipe of recipes) {
    const params = recipe.match(q);
    if (params !== null) out.push({ recipe, params, title: recipe.title(params) });
  }
  return out;
}

/** The live character a recipe works on: the active one, else the first. */
export function recipeCharacter(app: EditorApp): string | null {
  const live = app.store.list('characters').filter((c) => c.deleted === null);
  const active = app.session.getState().activeCharacter;
  return (live.find((c) => c.id === active) ?? live[0])?.id ?? null;
}
