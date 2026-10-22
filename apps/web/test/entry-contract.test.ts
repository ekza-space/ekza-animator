// AUTORIG-SPEC §3.3 (D2): the landing (`app/entry.ts`) and Studio keep separate copies of the remembered-choice code,
// because the app cannot be imported from the editor package and the landing must not load the editor: Studio's is
// `packages/editor/src/dialogs/entryChoice.ts` (Preferences › Start in, and — through Studio's switch `shell.autoRig
// {remember}` and its lazy `shell/autoRigSwitch.ts` — the first-run dialog's "Open this mode next time"). This holds
// the copies to one key and one record:
// the editor's sources name the same key, write `{ choice, at }` and accept only the two choices; the page renders
// the cards and the redirect script from `entry.ts`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENTRY_KEY, ENTRY_ROUTES, REDIRECT_SCRIPT } from '../app/entry';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('the remembered-choice contract between the landing and Studio (§3.3)', () => {
  const prefs = read('../../../packages/editor/src/dialogs/entryChoice.ts');
  const firstRun = read('../../../packages/editor/src/dialogs/FirstRunDialog.tsx');

  it('Studio reads and writes the landing key and record', () => {
    expect(prefs).toContain(`export const ENTRY_KEY = '${ENTRY_KEY}';`);
    expect(prefs).toContain('JSON.stringify({ choice, at: Date.now() })');
    expect(prefs).toContain("choice === 'autorig' || choice === 'studio'");
  });

  it("the first-run dialog's remember writes the same record through Studio's module; so does Preferences", () => {
    expect(firstRun).toContain("shell.runFromUi('shell.autoRig', { remember })");
    expect(firstRun).not.toContain('localStorage');
    const menuItems = read('../../../packages/editor/src/shell/menuItems.ts');
    expect(menuItems).toContain("writeEntryChoice('autorig')");
    expect(menuItems).not.toContain('localStorage');
    expect(read('../../../packages/editor/src/shell/autoRigSwitch.ts')).toContain(
      "export { writeEntryChoice } from '../dialogs/entryChoice';",
    );
    expect(read('../../../packages/editor/src/dialogs/PreferencesDialog.tsx')).toContain("from './entryChoice'");
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
