// `⌕ Do or find…` (STUDIO-TOUCH-SPEC §8): Halo's own touch view over the host palette's data and ranking
// (`@ekza-studio/editor/overlays`: entries, fuzzy scores; Pro's palette view is not restyled). A 16 px field, 52 pt rows,
// a sheet on Compact containers. **Do**: every operator, in every stage — search ignores `OperatorDef.workspaces`, and a
// result from another stage says *switches to Rig* and switches when run; a run with parameters opens its form
// (§5.6). **Things**: controls, meshes and characters by name — tap one to select it, frame it and open its Halo.
// Search is the safety net, never counted as parity (§20.5). A lazy chunk.
import type { OperatorId, RunContext } from '@ekza-studio/editor-core';
import { PANEL } from '@ekza-studio/editor-core';
import { filterEntries, type PaletteEntry, paletteEntries } from '@ekza-studio/editor/overlays';
import { Sheet, SheetGroup, SheetRow } from '@ekza-studio/ui/touch';
import { type JSX, useMemo, useState } from 'react';
import { en } from '../i18n/en';
import { matchRecipes, type RecipeMatch, runRecipe, SEARCH_RECIPES } from '../recipes';
import type { HaloController } from '../shell/controller';
import { PANE, stageOfWorkspace, workspaceOfStage } from '../shell/stage';
import { useHaloStore } from '../shell/store';

const CONTEXT: RunContext = { panel: PANEL.viewport, paneId: PANE };
const MAX_ROWS = 40;

interface Thing {
  readonly key: string;
  readonly label: string;
  readonly kind: 'control' | 'mesh' | 'character';
  readonly id: string;
}

export default function Palette({
  controller,
  side,
}: {
  readonly controller: HaloController;
  readonly side: 'right' | 'bottom';
}): JSX.Element {
  const { ctx } = controller;
  const { app, store } = ctx;
  const stage = useHaloStore(store, (s) => s.stage);
  const [query, setQuery] = useState('');
  const entries = useMemo((): PaletteEntry[] => {
    const here = paletteEntries(app, CONTEXT);
    const seen = new Set(here.map((e) => e.op));
    // §8: every operator in every stage (Pro's palette lists only the workspace's)
    for (const def of app.operators.list()) {
      if (def.flags?.internal === true || seen.has(def.id)) continue;
      const poll = app.operators.poll(def.id, CONTEXT);
      here.push({
        key: def.id,
        op: def.id,
        args: undefined,
        label: def.label,
        aliases: def.aliases ?? [],
        shortcut: null,
        enabled: poll === true,
        reason: poll === true ? null : poll.reason,
        params: def.params ?? [],
        testId: `halo-cmd-${def.id}`,
      });
    }
    return here;
  }, [app]);
  const things = useMemo((): Thing[] => {
    const list: Thing[] = [];
    for (const c of app.store.list('characters'))
      list.push({ key: `c:${c.id}`, label: c.name, kind: 'character', id: c.id });
    for (const m of app.store.list('meshes')) list.push({ key: `m:${m.id}`, label: m.name, kind: 'mesh', id: m.id });
    for (const c of app.store.list('controls'))
      list.push({ key: `k:${c.id}`, label: c.name, kind: 'control', id: c.id });
    return list;
  }, [app]);
  const q = query.trim().toLowerCase();
  const doRows = filterEntries(entries, query).slice(0, q === '' ? 12 : MAX_ROWS);
  const thingRows = q === '' ? [] : things.filter((t) => t.label.toLowerCase().includes(q)).slice(0, 12);
  // §8, §9.11 (T11): the recipes a phrase names (*wave twice*, *loop it*), above the operators
  const recipeRows = matchRecipes(SEARCH_RECIPES, query);
  const close = (): void => store.set({ palette: false });
  const runMatch = (match: RecipeMatch): void => {
    close();
    store.set((s) => ({ touches: s.touches + 1 }));
    void runRecipe(
      { app, run: (op, args) => ctx.run(op, args), toast: (toast) => ctx.toasts.push(toast) },
      match.recipe,
      match.params,
    );
  };
  const runEntry = (entry: PaletteEntry): void => {
    close();
    const def = app.operators.get(entry.op);
    const workspaces = def?.workspaces;
    const here = workspaceOfStage(stage);
    const run = (): void =>
      controller.runVerb(
        {
          id: entry.key,
          label: entry.label,
          run: { op: entry.op as OperatorId, ...(entry.args === undefined ? {} : { args: entry.args }) },
        },
        'more',
      );
    if (workspaces !== undefined && workspaces.length > 0 && !workspaces.includes(here)) {
      void controller.enterStage(stageOfWorkspace(workspaces[0] ?? here)).then(run);
    } else run();
  };
  const pickThing = (thing: Thing): void => {
    close();
    const select =
      thing.kind === 'control'
        ? ctx.run('select.controls', { ids: [thing.id], mode: 'replace' })
        : thing.kind === 'mesh'
          ? ctx.run('select.objects', { ids: [thing.id], mode: 'replace' })
          : Promise.resolve(null);
    void select.then(() => {
      controller.grammar.frame('selection');
      controller.grammar.open();
    });
  };
  const switchesTo = (entry: PaletteEntry): string | null => {
    const workspaces = app.operators.get(entry.op)?.workspaces;
    if (workspaces === undefined || workspaces.length === 0 || workspaces.includes(workspaceOfStage(stage)))
      return null;
    return en.palette.switchesTo(en.stage[stageOfWorkspace(workspaces[0] ?? 'model')]);
  };
  return (
    <Sheet
      data-testid="halo-palette"
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      modal
      side={side}
      defaultDetent="full"
      title={en.palette.label}
    >
      <input
        // a button until tapped is the top bar's search pill (§4.1); here the field is live
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the palette opens to type
        autoFocus
        type="search"
        aria-label={en.palette.label}
        placeholder={en.palette.placeholder}
        data-testid="halo-palette-input"
        className="mb-2 min-h-(--touch-hit) w-full rounded-touch border border-line-strong bg-field px-3 text-[16px] text-fg"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            const recipe = recipeRows[0];
            if (recipe !== undefined) {
              runMatch(recipe);
              return;
            }
            const first = doRows[0];
            if (first !== undefined && first.enabled) runEntry(first);
          }
        }}
      />
      {recipeRows.length > 0 ? <SheetGroup>{en.recipes.group}</SheetGroup> : null}
      {recipeRows.map((match) => (
        <div key={match.recipe.id} data-testid={`halo-recipe-${match.recipe.id}`}>
          <SheetRow title={match.title} detail={match.recipe.detail} onClick={() => runMatch(match)} />
        </div>
      ))}
      {thingRows.length > 0 ? <SheetGroup>{en.palette.things}</SheetGroup> : null}
      {thingRows.map((thing) => (
        <SheetRow
          key={thing.key}
          title={thing.label}
          detail={en.palette.kinds[thing.kind] ?? thing.kind}
          onClick={() => pickThing(thing)}
        />
      ))}
      <SheetGroup>{en.palette.do}</SheetGroup>
      {doRows.length === 0 ? <p className="m-0 px-2 py-3 text-fg-2">{en.palette.none}</p> : null}
      {doRows.map((entry) => {
        const note = switchesTo(entry);
        const detail = [entry.shortcut, note, entry.reason].filter((s) => s !== null && s !== '').join(' · ');
        return (
          <SheetRow
            key={entry.key}
            title={entry.label}
            {...(detail === '' ? {} : { detail })}
            disabled={!entry.enabled}
            onClick={() => runEntry(entry)}
          />
        );
      })}
    </Sheet>
  );
}
