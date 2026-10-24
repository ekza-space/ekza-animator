// AUTORIG-SPEC §3.3 (D2): the landing (`app/entry.ts`) and Studio keep separate copies of the remembered-choice code,
// because the app cannot be imported from the editor package and the landing must not load the editor: Studio's is
// `packages/editor/src/dialogs/entryChoice.ts` (Preferences › Start in, and — through Studio's switch `shell.autoRig
// {remember}` and its lazy `shell/autoRigSwitch.ts` — the first-run dialog's "Open this mode next time"). This holds
// the copies to one key and one record:
// the editor's sources name the same key, write `{ choice, at }` and accept the same choices; the page renders
// the cards and the redirect script from `entry.ts`.
//
// STUDIO-TOUCH-SPEC §1.2 (T2): the choice gains `'halo'` (`/app`) behind `HALO_ENTRY`, one flag in both copies. While
// it is off the landing is exactly today's (the same script byte for byte, two cards, a stored `'halo'` is Ask); on,
// a first visit opens `/app`, a remembered Pro or Auto-Rig still wins, and `/?chooser=1` lists three rows.
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  ENTRY_KEY,
  ENTRY_ROUTES,
  type EntryChoice,
  HALO_ENTRY,
  parseChoice,
  REDIRECT_SCRIPT,
  readChoice,
  redirectHref,
  redirectScript,
} from '../app/entry';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The script `/` shipped before T2 (AUTORIG-SPEC §3.3): with `HALO_ENTRY` off it must not change by one byte. */
const SHIPPED_SCRIPT =
  "(function(){try{var n=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];if(n&&n.type==='back_forward')return;var q=new URLSearchParams(location.search);if(q.get('chooser')==='1')return;var v=JSON.parse(localStorage.getItem('ekza-studio:entry:v1')||'null');var c=v&&v.choice;var r=c==='autorig'?'/autorig':c==='studio'?'/editor':'';if(!r)return;q.delete('chooser');var s=q.toString();location.replace(r+(s?'?'+s:''))}catch(e){}})();";

describe('the remembered-choice contract between the landing and Studio (§3.3)', () => {
  const prefs = read('../../../packages/editor/src/dialogs/entryChoice.ts');
  const firstRun = read('../../../packages/editor/src/dialogs/FirstRunDialog.tsx');

  it('Studio reads and writes the landing key and record, with the same choices and the same flag', () => {
    expect(prefs).toContain(`export const ENTRY_KEY = '${ENTRY_KEY}';`);
    expect(prefs).toContain('JSON.stringify({ choice, at: Date.now() })');
    expect(prefs).toContain("choice === 'autorig' || choice === 'studio' || (HALO_ENTRY && choice === 'halo')");
    expect(prefs).toContain(`export const HALO_ENTRY = ${String(HALO_ENTRY)};`);
    expect(prefs).toContain("export type EntryChoice = 'autorig' | 'studio' | 'halo';");
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
    const preferences = read('../../../packages/editor/src/dialogs/PreferencesDialog.tsx');
    expect(preferences).toContain("from './entryChoice'");
    expect(preferences).toContain("(HALO_ENTRY && value === 'halo')");
  });

  it('the redirect script and the cards use the routes and key of entry.ts', () => {
    expect(ENTRY_ROUTES).toEqual({ autorig: '/autorig', studio: '/editor', halo: '/app' });
    expect(REDIRECT_SCRIPT).toBe(redirectScript(HALO_ENTRY));
    for (const on of [false, true]) {
      const script = redirectScript(on);
      expect(script).toContain(`'${ENTRY_KEY}'`);
      for (const choice of on ? (['autorig', 'studio', 'halo'] as const) : (['autorig', 'studio'] as const)) {
        expect(script).toContain(`'${ENTRY_ROUTES[choice]}'`);
      }
      expect(script.length).toBeLessThan(600);
    }
    const page = read('../app/page.tsx');
    expect(page).toContain('href={ENTRY_ROUTES[card.choice]}');
    expect(page).toContain('__html: REDIRECT_SCRIPT');
    expect(page).toContain('const CARDS = HALO_ENTRY ? HALO_ROWS : TWO_CARDS;');
    // Today's two cards: Auto-Rig first (the newcomer path), Studio second (§3.2) …
    const two = page.slice(page.indexOf('const TWO_CARDS'), page.indexOf('const HALO_ROWS'));
    expect([...two.matchAll(/choice: '(\w+)'/g)].map((m) => m[1])).toEqual(['autorig', 'studio']);
    // … and with HALO_ENTRY the three rows of `/?chooser=1`: Ekza Studio, Ekza Studio Pro, Rig a model for me (§1.2)
    const rows = page.slice(page.indexOf('const HALO_ROWS'), page.indexOf('const CARDS'));
    expect([...rows.matchAll(/choice: '(\w+)'/g)].map((m) => m[1])).toEqual(['halo', 'studio', 'autorig']);
    expect([...rows.matchAll(/title: '([^']+)'/g)].map((m) => m[1])).toEqual([
      'Ekza Studio',
      'Ekza Studio Pro',
      'Rig a model for me',
    ]);
  });
});

describe('HALO_ENTRY off (until T12, ST-30): the landing is exactly today’s', () => {
  it('is off, and the script is the one that shipped', () => {
    expect(HALO_ENTRY).toBe(false);
    expect(redirectScript(false)).toBe(SHIPPED_SCRIPT);
  });

  it("a stored 'halo' reads as Ask (the chooser), and nothing remembered shows the chooser", () => {
    const halo = JSON.stringify({ choice: 'halo', at: 1 });
    expect(parseChoice(halo, false)).toBeNull();
    expect(readChoice({ getItem: () => halo, setItem: () => {}, removeItem: () => {} }, false)).toBeNull();
    expect(redirectHref('', null, false, false)).toBeNull();
    expect(run(redirectScript(false), { search: '', stored: halo }).replaced).toEqual([]);
  });
});

describe('HALO_ENTRY on (T12): a first visit opens Ekza Studio, a remembered choice wins (ST-2)', () => {
  const record = (choice: string): string => JSON.stringify({ choice, at: 1 });

  it("honours a stored 'halo'", () => {
    expect(parseChoice(record('halo'), true)).toBe('halo');
  });

  it.each([
    ['', null, '/app'],
    ['?e2e=1&ns=x', null, '/app?e2e=1&ns=x'],
    ['', 'halo', '/app'],
    ['', 'studio', '/editor'],
    ['?e2e=1', 'autorig', '/autorig?e2e=1'],
    ['?chooser=1', null, null],
    ['?chooser=1', 'studio', null],
    ['?chooser=0', null, '/app'],
  ] as [string, EntryChoice | null, string | null][])(
    '%s with %s → %s (function and script agree)',
    (search, choice, href) => {
      expect(redirectHref(search, choice, false, true)).toBe(href);
      const result = run(redirectScript(true), { search, stored: choice === null ? null : record(choice) });
      expect(result.replaced).toEqual(href === null ? [] : [href]);
      expect(result.globals).toEqual([]);
    },
  );

  it('a malformed record or blocked storage is a first visit; a back/forward visit never redirects', () => {
    expect(run(redirectScript(true), { search: '', stored: '{' }).replaced).toEqual(['/app']);
    expect(run(redirectScript(true), { search: '', stored: record('editor') }).replaced).toEqual(['/app']);
    expect(run(redirectScript(true), { search: '', blocked: true }).replaced).toEqual(['/app']);
    expect(redirectHref('', null, true, true)).toBeNull();
    expect(run(redirectScript(true), { search: '', navigationType: 'back_forward' }).replaced).toEqual([]);
  });
});

/** Runs a redirect script in a VM context with a fake `location`, `localStorage` and `performance`. */
function run(
  script: string,
  opts: {
    readonly search: string;
    readonly stored?: string | null;
    readonly blocked?: boolean;
    readonly navigationType?: string;
  },
): { readonly replaced: string[]; readonly globals: string[] } {
  const replaced: string[] = [];
  const sandbox: Record<string, unknown> = {
    URLSearchParams,
    JSON,
    location: { search: opts.search, replace: (href: string) => void replaced.push(href) },
    performance: {
      getEntriesByType: (type: string) => (type === 'navigation' ? [{ type: opts.navigationType ?? 'navigate' }] : []),
    },
  };
  if (opts.blocked === true) {
    Object.defineProperty(sandbox, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
    });
  } else {
    sandbox['localStorage'] = { getItem: (key: string) => (key === ENTRY_KEY ? (opts.stored ?? null) : null) };
  }
  const context = createContext(sandbox);
  const before = new Set(Object.keys(sandbox));
  runInContext(script, context);
  return { replaced, globals: Object.keys(sandbox).filter((key) => !before.has(key)) };
}
