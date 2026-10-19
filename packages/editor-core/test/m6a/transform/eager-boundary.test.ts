// M6A-SPEC §5.27 (B12a): the lazy halves of the transform operators stay out of the eager route. The bundler keeps a
// whole module once any eager module imports a value from it (B11's probe, test/ops-ui/eager-boundary.test.ts), so
// only the barrel (re-exports for the lazy viewport runtime and the test API) and the lazy modules themselves may
// import values from `pivotImpl` (Bake Pivot and Freeze: loaded by the operators' `prepare`) and `softWeights`.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');
const LAZY = ['operators/builtin/pivotImpl', 'operators/builtin/softWeights'];
const ALLOWED = new Set(['index.ts', 'operators/builtin/pivotImpl.ts', 'operators/builtin/softWeights.ts']);

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

describe('the lazy halves of the B12a operators stay lazy (§5.27)', () => {
  it('no eager editor-core module imports a value from pivotImpl or softWeights', () => {
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

  it('pivot.ts reaches pivotImpl through a dynamic import only', () => {
    const code = readFileSync(join(SRC, 'operators/builtin/pivot.ts'), 'utf8');
    expect(code).toContain("import('./pivotImpl')");
    expect(valueImports(code)).not.toContain('./pivotImpl');
  });
});
