// M6A-SPEC §5.27 (B11): the B11 runtime chunk stays out of the eager route. The bundler keeps a whole module once any
// eager module imports a value from it, and drops a barrel re-export nobody eager uses; so no editor-core module but
// the barrel (re-exports for the lazy views and the test API) and the chunk's own modules may import a value from the
// chunk's modules. Eager code reaches them through `loadOpsRuntime` (a dynamic import).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');

/** The B11 runtime chunk (relative to src, without the extension). */
const LAZY = ['edit/paramInput', 'edit/captureEngine', 'operators/builtin/lastopEngine'];

/** Modules allowed to import values from the chunk: the barrel and the chunk itself. */
const ALLOWED = new Set(['index.ts', 'edit/captureEngine.ts', 'operators/builtin/lastopEngine.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Specifiers of the static imports and re-exports of `code` that bring in values (type-only ones excluded). */
function valueImports(code: string): string[] {
  const out: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)'/g;
  for (const match of code.matchAll(statement)) {
    const [, , typeOnly, clause = '', from = ''] = match;
    if (typeOnly !== undefined) continue;
    const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
    if (named !== null) {
      const specifiers = (named[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (specifiers.every((s) => s.startsWith('type '))) continue;
    }
    out.push(from);
  }
  return out;
}

describe('the B11 runtime chunk stays lazy (§5.27)', () => {
  it('no eager editor-core module imports a value from paramInput, captureEngine or lastopEngine', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      for (const spec of valueImports(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const target = relative(SRC, resolve(dirname(file), spec)).replace(/\.ts$/, '');
        if (LAZY.includes(target)) offenders.push(`${rel} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scan sees value imports and skips type-only ones', () => {
    expect(
      valueImports(
        "import type { A } from './a';\nimport { type B } from './b';\nimport { c, type D } from './c';\nexport { e } from './e';",
      ),
    ).toEqual(['./c', './e']);
  });
});
