// AUTORIG-SPEC §3.3 (D2): `REDIRECT_SCRIPT`, the inline script of `/`, follows the same rule as `redirectHref` over
// `readChoice` (it is written without helpers so it runs on its own while the page is parsed). Run in a VM context
// with a fake `location`, `localStorage` and `performance` over the cases of the rule, plus blocked storage and an
// environment without the Navigation Timing API; it leaves no globals behind.
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ENTRY_KEY, REDIRECT_SCRIPT, redirectHref } from '../app/entry';

interface Run {
  readonly replaced: string[];
  readonly globals: string[];
}

function runScript(opts: {
  readonly search: string;
  readonly stored?: string | null;
  readonly blocked?: boolean;
  readonly navigationType?: string | null;
}): Run {
  const replaced: string[] = [];
  const localStorage = {
    getItem(key: string): string | null {
      if (opts.blocked === true) throw new Error('SecurityError');
      return key === ENTRY_KEY ? (opts.stored ?? null) : null;
    },
  };
  const performance =
    opts.navigationType === null
      ? {}
      : {
          getEntriesByType: (type: string) =>
            type === 'navigation' ? [{ type: opts.navigationType ?? 'navigate' }] : [],
        };
  const sandbox: Record<string, unknown> = {
    URLSearchParams,
    JSON,
    location: { search: opts.search, replace: (href: string) => void replaced.push(href) },
    performance,
  };
  // Blocked storage in Safari/Chrome throws on the accessor itself.
  if (opts.blocked === true) {
    Object.defineProperty(sandbox, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
    });
  } else {
    sandbox['localStorage'] = localStorage;
  }
  const context = createContext(sandbox);
  const before = new Set(Object.keys(sandbox));
  runInContext(REDIRECT_SCRIPT, context);
  return { replaced, globals: Object.keys(sandbox).filter((key) => !before.has(key)) };
}

const record = (choice: string): string => JSON.stringify({ choice, at: 1 });

describe('REDIRECT_SCRIPT (§3.3)', () => {
  it.each([
    ['', 'autorig'],
    ['', 'studio'],
    ['?e2e=1&ns=x', 'autorig'],
    ['?chooser=1', 'autorig'],
    ['?e2e=1&chooser=1', 'studio'],
    ['?chooser=0&e2e=1', 'studio'],
    ['', null],
    ['?e2e=1', null],
  ] as const)('on %s with %s does what redirectHref says', (search, choice) => {
    const run = runScript({ search, stored: choice === null ? null : record(choice) });
    const href = redirectHref(search, choice);
    expect(run.replaced).toEqual(href === null ? [] : [href]);
    expect(run.globals).toEqual([]);
  });

  it.each([['{"choice":"editor"}'], ['{"choice":"toString"}'], ['not json'], ['null'], ['42']])(
    'a malformed record %s shows the chooser',
    (stored) => {
      expect(runScript({ search: '', stored }).replaced).toEqual([]);
    },
  );

  it('blocked storage shows the chooser and throws nothing', () => {
    expect(() => runScript({ search: '', blocked: true })).not.toThrow();
    expect(runScript({ search: '', blocked: true }).replaced).toEqual([]);
  });

  it('a back/forward visit never redirects (no history trap)', () => {
    expect(runScript({ search: '', stored: record('autorig'), navigationType: 'back_forward' }).replaced).toEqual([]);
    expect(runScript({ search: '', stored: record('autorig'), navigationType: 'reload' }).replaced).toEqual([
      '/autorig',
    ]);
  });

  it('works without the Navigation Timing API', () => {
    expect(runScript({ search: '', stored: record('studio'), navigationType: null }).replaced).toEqual(['/editor']);
  });

  it('stays small', () => {
    expect(REDIRECT_SCRIPT.length).toBeLessThan(600);
  });
});
