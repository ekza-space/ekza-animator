// M6A-SPEC §5.27 (B12b): the extrude session's engine stays out of the eager route. The bundler keeps a whole module
// once any eager module imports a value from it and drops a barrel re-export nobody eager uses; so no editor-core
// module but the barrel (re-exports for the viewport's lazy tools and the test API) and the engine itself may import
// a value from it. Eager code reaches it through `loadExtrudeEngine` (a dynamic import).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const LAZY = 'operators/builtin/extrudeEngine';
const ALLOWED = new Set(['index.ts', 'operators/builtin/extrudeEngine.ts']);

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

describe('the extrude engine stays lazy (§5.27)', () => {
  it('no eager editor-core module imports a value from extrudeEngine', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      for (const spec of valueImports(readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const target = relative(SRC, resolve(dirname(file), spec)).replace(/\.ts$/, '');
        if (target === LAZY) offenders.push(`${rel} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
