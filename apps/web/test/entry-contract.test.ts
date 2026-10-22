// AUTORIG-SPEC §3.3 (D2): the landing (`app/entry.ts`) and Studio (`packages/editor/src/dialogs/entryChoice.ts`, used
// by the first-run dialog and Preferences › Start in) keep separate copies of the remembered-choice code, because the
// app cannot be imported from the editor package and the landing must not load the editor. This holds the copies to
// one key and one record: the editor's source names the same key, writes `{ choice, at }` and accepts only the two
// choices; the page renders the cards and the redirect script from `entry.ts`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENTRY_KEY, ENTRY_ROUTES, REDIRECT_SCRIPT } from '../app/entry';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('the remembered-choice contract between the landing and Studio (§3.3)', () => {
  const editor = read('../../../packages/editor/src/dialogs/entryChoice.ts');

  it('Studio writes the landing key and record', () => {
    expect(editor).toContain(`export const ENTRY_KEY = '${ENTRY_KEY}';`);
    expect(editor).toContain('JSON.stringify({ choice, at: Date.now() })');
    expect(editor).toContain("choice === 'autorig' || choice === 'studio'");
  });

  it('the redirect script and the cards use the routes and key of entry.ts', () => {
    expect(REDIRECT_SCRIPT).toContain(`'${ENTRY_KEY}'`);
    for (const route of Object.values(ENTRY_ROUTES)) expect(REDIRECT_SCRIPT).toContain(`'${route}'`);
    const page = read('../app/page.tsx');
    expect(page).toContain('href={ENTRY_ROUTES[card.choice]}');
    expect(page).toContain('__html: REDIRECT_SCRIPT');
    // Auto-Rig first (the newcomer path), Studio second (§3.2)
    expect(page.indexOf("choice: 'autorig'")).toBeLessThan(page.indexOf("choice: 'studio'"));
  });
});
