// *Fix for OMOBA* (STUDIO-TOUCH-SPEC §9.11, §7.3, §13.3): each problem of the OMOBA & Ekza Space list that one
// operator fixes, fixed in order with that operator (the same row Share and Health show, from the one readiness list,
// §7.2 — Mesh Check clean-ups, Validation fixes such as adding thumbs, the game's own fixes). The licence and the
// author are never chosen for the person (Q-SKIN-3); problems that need hands stay on the list (*Go fix ▸*), and the
// last toast says how many are left.
import type { EditorApp } from '@ekza-studio/editor-core';
import { readiness } from '../path/readiness';
import { en } from '../i18n/en';
import type { Recipe } from './recipe';

/** The OMOBA list's one-operator fixes, in the list's order (each row at most once). */
export function omobaFixes(app: EditorApp) {
  const rows = readiness(app, 'omoba').rows;
  const seen = new Set<string>();
  const fixes = rows.flatMap((row) => {
    if (row.fix === null) return [];
    const key = `${row.fix.op}:${JSON.stringify(row.fix.args ?? null)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ op: row.fix.op, args: row.fix.args }];
  });
  return { fixes, handsOn: rows.filter((row) => row.fix === null).length };
}

export const fixForOmobaRecipe: Recipe<Record<string, never>> = {
  id: 'fixForOmoba',
  title: () => en.recipes.fixForOmoba,
  detail: en.recipes.fixForOmobaDetail,
  match: (query) => (/\bfix\b/.test(query) && /\bomoba\b/.test(query) ? {} : null),
  plan(app) {
    const { fixes, handsOn } = omobaFixes(app);
    if (fixes.length === 0) return { problem: handsOn > 0 ? en.recipes.handsOn(handsOn) : en.share.ready };
    return { steps: fixes };
  },
};
