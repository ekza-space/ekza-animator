// The Auto-Rig rule (AUTORIG-SPEC §4.1, §4.5; D7): Auto-Rig adds no rigging, skinning, clip or export logic of its own.
// Every document write is an operator run; the shell never writes the store, never calls a kernel solver and never
// value-imports the kernels (`mesh-core`, `rig`, `io`, `mesh-view`; type imports are allowed); the `autorig.*`
// compositions under `operators/builtin/rig/wizard/` run their inner operators from `prepare`, record no undo step of
// their own and write nothing themselves. The greps target `autorig.` ids and the `wizard/` directory only — never the
// bare word `autoRig`, which is M6b's control-rig generator (`rig.autoRig.update`, GLOSSARY "Auto Rig").
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const WIZARD = fileURLToPath(new URL('../../editor-core/src/operators/builtin/rig/wizard/', import.meta.url));

interface Source {
  readonly path: string;
  readonly text: string;
}

function sources(dir: string): Source[] {
  const out: Source[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push({ path: relative(dir, path), text: readFileSync(path, 'utf8') });
  }
  return out;
}

/** The source without comments (line and block), so a sentence about a rule never trips it. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Lines of `sources` whose code matches `pattern`, as `file:line text`. */
function hits(list: readonly Source[], pattern: RegExp): string[] {
  const out: string[] = [];
  for (const source of list) {
    code(source.text)
      .split('\n')
      .forEach((line, i) => {
        if (pattern.test(line)) out.push(`${source.path}:${i + 1} ${line.trim()}`);
      });
  }
  return out;
}

const KERNELS = '@ekza-studio/(?:mesh-core|rig|io|mesh-view)(?:/[^\'"]*)?';

/** Value imports and re-exports of the kernels (a statement whose specifiers are not all `type`). */
function kernelValueImports(list: readonly Source[]): string[] {
  const out: string[] = [];
  const statement = new RegExp(`(?:import|export)\\s+([^;]*?)\\s+from\\s+['"](${KERNELS})['"]`, 'g');
  const bare = new RegExp(`import\\s+['"](${KERNELS})['"]`, 'g');
  const dynamic = new RegExp(`import\\(\\s*['"](${KERNELS})['"]\\s*\\)`, 'g');
  for (const source of list) {
    const text = code(source.text);
    for (const match of text.matchAll(statement)) {
      const clause = (match[1] ?? '').trim();
      if (clause.startsWith('type ')) continue;
      const names = /\{([^}]*)\}/.exec(clause)?.[1];
      const typeOnly =
        names !== undefined &&
        !/^\*|^[A-Za-z_$][\w$]*\s*,/.test(clause) &&
        names
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
          .every((part) => part.startsWith('type '));
      if (!typeOnly) out.push(`${source.path}: ${match[0].replace(/\s+/g, ' ')}`);
    }
    for (const match of text.matchAll(bare)) out.push(`${source.path}: ${match[0]}`);
    for (const match of text.matchAll(dynamic)) out.push(`${source.path}: ${match[0]}`);
  }
  return out;
}

describe('the Auto-Rig shell writes the document only through operators (§4.1)', () => {
  const shell = sources(SRC);

  it('finds the shell source', () => {
    expect(shell.length).toBeGreaterThan(20);
    expect(shell.some((source) => source.path === 'index.ts')).toBe(true);
  });

  it('never writes the store: no transaction, no tx.*, no app session writes, no store mutators', () => {
    expect(hits(shell, /\.transact\s*\(/)).toEqual([]);
    expect(hits(shell, /\btx\.\w+\s*\(/)).toEqual([]);
    expect(hits(shell, /\bapp\.session\.setState\s*\(/)).toEqual([]);
    // the document store is the app's; the shell's own session store (U state, `session/`) is not the document
    expect(hits(shell, /\bapp\.store\.(?:set|put|delete|patch|upsert|apply|replace|transact)\w*\s*\(/)).toEqual([]);
    expect(hits(shell, /\.history\.(?:push|record|commit)\w*\s*\(/)).toEqual([]);
  });

  it('never value-imports a kernel (mesh-core, rig, io, mesh-view); type imports only', () => {
    expect(kernelValueImports(shell)).toEqual([]);
  });

  it('never calls a solver or writer directly (fit, bind, weights, retarget, the character writer)', () => {
    const solvers =
      /\b(?:runExportCharacter|writeCharacter|exportCharacterBytes|fitTemplate|fitSkeleton|computeWeights|autoWeights|bindSkin|solveWeights|retarget\w*|applyClipParams|applyPoseAsRest|bakeRest)\s*\(/;
    expect(hits(shell, solvers)).toEqual([]);
  });

  it('runs document changes through the operator registry (operators.run, runFromUi or runUntyped)', () => {
    const runs = hits(shell, /\b(?:operators\.run|runFromUi|runUntyped)\s*\(/);
    expect(runs.length).toBeGreaterThan(5);
  });

  it('the kernel check itself sees a value import, a mixed import and a dynamic import', () => {
    const probe: Source[] = [
      { path: 'a.ts', text: "import { fitTemplate } from '@ekza-studio/rig';" },
      { path: 'b.ts', text: "import { type Vec3, packOmobaKit } from '@ekza-studio/io';" },
      { path: 'c.ts', text: "const m = await import('@ekza-studio/mesh-core');" },
      { path: 'd.ts', text: "import type { MeshId } from '@ekza-studio/mesh-core';" },
      { path: 'e.ts', text: "import { type Quat } from '@ekza-studio/rig/quickrig';" },
      { path: 'f.ts', text: "// import { fitTemplate } from '@ekza-studio/rig';" },
    ];
    expect(kernelValueImports(probe).map((line) => line.split(':')[0])).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

describe('the autorig.* compositions under wizard/ (§4.5)', () => {
  const wizard = sources(WIZARD);
  const ids = wizard.flatMap((source) =>
    [...source.text.matchAll(/\bdefineOperator<'([^']+)'/g)].map((m) => m[1] ?? ''),
  );

  it('defines only autorig.* ids; the index exports WIZARD_OPERATORS', () => {
    expect(ids.length).toBeGreaterThanOrEqual(9);
    expect(ids.filter((id) => !id.startsWith('autorig.'))).toEqual([]);
    const index = wizard.find((source) => source.path === 'index.ts')?.text ?? '';
    expect(index).toMatch(/export const WIZARD_OPERATORS/);
  });

  it('records no undo step of its own and writes nothing itself', () => {
    expect(hits(wizard, /\bundo:\s*true\b/)).toEqual([]);
    expect(hits(wizard, /\.transact\s*\(/)).toEqual([]);
    expect(hits(wizard, /\btx\.\w+\s*\(/)).toEqual([]);
  });

  it('runs its inner operators from prepare, never from apply (the runner refuses nested runs there)', () => {
    const inApply: string[] = [];
    for (const source of wizard) {
      const lines = code(source.text).split('\n');
      lines.forEach((line, i) => {
        const opens = /^ {2}(?:async )?apply\s*\(/.exec(line);
        if (opens === null) return;
        for (let j = i; j < lines.length; j++) {
          const body = lines[j] ?? '';
          if (j > i && /^ {2}\S/.test(body)) break;
          if (/\b(?:runUntyped|operators\.run|runComposition)\s*\(/.test(body)) {
            inApply.push(`${source.path}:${j + 1}`);
          }
        }
      });
    }
    expect(inApply).toEqual([]);
  });
});
