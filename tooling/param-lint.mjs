#!/usr/bin/env node
// Param lint (STUDIO-TOUCH-SPEC §5.6, §6.3, §20.3 items 6–7, §20.5 test 9; T5a). The touch shell ("Halo") shows an
// operator's parameters three ways: after-run chips (`edit.adjustLast`, adjustable operators only), a pre-run form
// (the Halo-only `FormDef`s of `@ekza-studio/editor-core/forms`, or the ParamDefs of a non-adjustable operator) and an
// Options surface (Studio Pro's option box). This gate keeps those honest without changing Studio Pro:
//
// - static: only the touch shell (`packages/halo`) imports the forms subpath — so Studio Pro, the Last-op card, Repeat
//   Last / Adjust Last and the agent schema generator never read it — and nothing declares an `addParams`;
// - forms: every form names a live operator that is not adjustable and declares no ParamDefs, and its params pass
//   `assertParams` (that its params name the operator's arguments is the `satisfies FormDef<…>` check of `pnpm
//   typecheck`);
// - wrappers: every public UI wrapper is registered by its lazy chunk, public, undoable, without ParamDefs (never
//   adjustable or repeatable), has a form and is denied to agents by the agent-tools policy;
// - surfaces (once the touch shell's manifest exports them, T6b): every operator surfaced with after-run chips is
//   adjustable, every operator surfaced with a form has one, and every operator with a Studio Pro option box has an
//   Options surface.
//
// The run-time checks load the real registry headless (every lazy operator chunk) through a TypeScript transpile hook
// (the root `typescript`), so they see the definitions Studio Pro and the touch shell register.
//
// Usage: node tooling/param-lint.mjs [workspaceRoot]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FORMS_SUBPATH = '@ekza-studio/editor-core/forms';
const FORMS_DIR = join('packages', 'editor-core', 'src', 'forms');
/** Files that may import the forms: the touch shell, the forms themselves and editor-core's tests. */
const FORMS_IMPORTERS = [
  join('packages', 'halo') + sep,
  FORMS_DIR + sep,
  join('packages', 'editor-core', 'test') + sep,
];
/** Where the touch shell's manifest exports its parameter surfaces (T6b): `PARAM_SURFACES`. */
export const SURFACES_FILE = join('packages', 'halo', 'src', 'manifest', 'paramSurfaces.ts');
const SCANNED = ['packages', 'apps'];
const SKIPPED_DIRS = new Set(['node_modules', '.next', '.tsbuild', '.turbo', 'dist', 'public', 'fixtures']);
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

// ---------- static checks ----------

function* sourceFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* sourceFiles(join(dir, entry.name));
    } else if (SOURCE.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

/** Source text without comments (a rough strip: enough for identifiers outside strings). */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const SPECIFIERS = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

/** True when a module specifier of `file` (workspace-relative) reaches the forms subpath or its directory. */
function reachesForms(root, file, specifier) {
  if (specifier === FORMS_SUBPATH || specifier.startsWith(`${FORMS_SUBPATH}/`)) return true;
  if (!specifier.startsWith('.')) return false;
  const target = relative(root, resolve(root, dirname(file), specifier));
  return target === FORMS_DIR || target.startsWith(FORMS_DIR + sep);
}

/**
 * Static violations of a workspace: importers of the Halo-only forms outside the touch shell, and `addParams`
 * anywhere in package sources (§20.3 item 6: there is none).
 */
export function staticViolations(root) {
  const violations = [];
  for (const top of SCANNED) {
    for (const path of sourceFiles(join(root, top))) {
      const file = relative(root, path);
      const text = readFileSync(path, 'utf8');
      const allowed = FORMS_IMPORTERS.some((prefix) => file.startsWith(prefix));
      if (!allowed) {
        for (const match of text.matchAll(SPECIFIERS)) {
          if (reachesForms(root, file, match[1])) {
            violations.push(
              `${file}: imports the Halo-only forms ('${match[1]}'); only packages/halo may (§20.3 item 6)`,
            );
          }
        }
      }
      if (file.startsWith(`packages${sep}`) && file.includes(`${sep}src${sep}`) && /\baddParams\b/.test(code(text))) {
        violations.push(`${file}: declares or calls addParams; forms are Halo-only data (§20.3 item 6)`);
      }
    }
  }
  return violations;
}

// ---------- registry checks (plain data, so the tests can feed fakes) ----------

/** Visible scalar params: what Studio Pro's option box shows for an operator. */
function optionBoxParams(def) {
  return (def.params ?? []).filter((param) => param.hidden !== true && param.kind !== 'data');
}

/**
 * Violations of the forms, the wrappers and (when present) the surfaces against the registry.
 * - `operators`: the registered definitions (`id`, `flags`, `params`, `undoLabel`);
 * - `forms`: `FORM_DEFS` values; `formProblems(form)` its well-formedness check;
 * - `wrappers`: `UI_WRAPPER_IDS`; `policyOf(id)` the agent-tools table entry;
 * - `surfaces`: `{ op, surface: 'chips' | 'form' | 'options' }[]`, or null before the touch shell's manifest exists.
 */
export function registryViolations({ operators, forms, formProblems, wrappers, policyOf, surfaces }) {
  const violations = [];
  const byId = new Map(operators.map((def) => [def.id, def]));
  const formIds = new Set();
  for (const form of forms) {
    if (formIds.has(form.id)) violations.push(`form ${form.id}: defined twice`);
    formIds.add(form.id);
    for (const problem of formProblems(form)) violations.push(`form ${problem}`);
    const def = byId.get(form.id);
    if (def === undefined) {
      violations.push(`form ${form.id}: names no registered operator`);
      continue;
    }
    if (def.flags?.adjustable === true) {
      violations.push(`form ${form.id}: the operator is adjustable; it gets after-run chips, not a form (§5.6)`);
    }
    if (def.params !== undefined) {
      violations.push(`form ${form.id}: the operator declares ParamDefs; its pre-run form is those (§5.6)`);
    }
  }
  for (const id of wrappers) {
    const def = byId.get(id);
    if (def === undefined) {
      violations.push(`wrapper ${id}: not registered by its chunk (loadUiWrappers)`);
      continue;
    }
    if (def.flags?.internal === true) violations.push(`wrapper ${id}: internal (wrappers are public)`);
    if (def.flags?.undo !== true) violations.push(`wrapper ${id}: not undoable (one step per run)`);
    if (typeof def.undoLabel !== 'function') violations.push(`wrapper ${id}: no undo label`);
    if (def.params !== undefined || def.flags?.adjustable === true || def.flags?.repeatable === true) {
      violations.push(`wrapper ${id}: declares ParamDefs or is adjustable/repeatable (Studio Pro would change)`);
    }
    if (!formIds.has(id)) violations.push(`wrapper ${id}: has no form`);
    if (policyOf(id)?.policy !== 'denied') violations.push(`wrapper ${id}: not denied to agents (agent-tools policy)`);
  }
  if (surfaces !== null) {
    const options = new Set();
    for (const { op, surface } of surfaces) {
      const def = byId.get(op);
      if (def === undefined) {
        violations.push(`surface ${surface} of ${op}: names no registered operator`);
        continue;
      }
      if (surface === 'chips' && def.flags?.adjustable !== true) {
        violations.push(`surface chips of ${op}: not adjustable; use a pre-run form (§5.6)`);
      }
      if (surface === 'form' && !formIds.has(op) && optionBoxParams(def).length === 0) {
        violations.push(`surface form of ${op}: no FormDef and no ParamDefs`);
      }
      if (surface === 'options') options.add(op);
    }
    for (const def of operators) {
      if (def.flags?.internal !== true && optionBoxParams(def).length > 0 && !options.has(def.id)) {
        violations.push(`${def.id}: has a Studio Pro option box but no Options surface in the touch shell (§6.3)`);
      }
    }
  }
  return violations;
}

// ---------- loading the TypeScript sources ----------

let hooked = false;

/** Lets Node import the workspace's TypeScript sources (transpiled by the root `typescript`, extensionless paths). */
async function installTypeScriptHooks() {
  if (hooked) return;
  hooked = true;
  const { registerHooks } = await import('node:module');
  const { default: ts } = await import('typescript');
  const options = {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2023,
    verbatimModuleSyntax: true,
    sourceMap: false,
  };
  const isOwnTs = (url) => url.startsWith('file:') && /\.[cm]?tsx?$/.test(url) && !url.includes('/node_modules/');
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (context.parentURL === undefined || !(specifier.startsWith('.') || specifier.startsWith('/'))) throw error;
        const base = new URL(specifier, context.parentURL).href;
        for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
          const candidate = new URL(base + suffix);
          const path = fileURLToPath(candidate);
          if (existsSync(path) && statSync(path).isFile()) return { url: candidate.href, shortCircuit: true };
        }
        throw error;
      }
    },
    load(url, context, nextLoad) {
      if (!isOwnTs(url)) return nextLoad(url, context);
      const fileName = fileURLToPath(url);
      const output = ts.transpileModule(readFileSync(fileName, 'utf8'), { compilerOptions: options, fileName });
      return { format: 'module', source: output.outputText, shortCircuit: true };
    },
  });
}

/** The registry with every lazy operator chunk loaded, the forms, the wrappers, the policy and the surfaces. */
async function loadRegistry(root) {
  await installTypeScriptHooks();
  const load = (path) => import(pathToFileURL(join(root, path)).href);
  const core = await load('packages/editor-core/src/index.ts');
  const forms = await load('packages/editor-core/src/forms/index.ts');
  // its own module, outside the forms index (P-T6A-6: keeps anim-core's assertParams out of every route)
  const problems = await load('packages/editor-core/src/forms/problems.ts');
  const policy = await load('packages/agent-tools/src/policy.ts');
  const app = core.createHeadlessEditorApp();
  await Promise.all([app.rig.load(), app.library.load(), core.loadModelOperators(), core.loadUiWrappers(app)]);
  let surfaces = null;
  if (existsSync(join(root, SURFACES_FILE))) surfaces = (await load(SURFACES_FILE)).PARAM_SURFACES ?? [];
  return {
    operators: app.operators.list(),
    forms: [...forms.FORM_DEFS.values()],
    formProblems: problems.formProblems,
    wrappers: [...core.UI_WRAPPER_IDS],
    policyOf: policy.tablePolicyOf,
    surfaces,
  };
}

/** Every violation of the workspace (static and run time), with a summary of what was checked. */
export async function lintParams(root = resolve(HERE, '..')) {
  const registry = await loadRegistry(root);
  const violations = [...staticViolations(root), ...registryViolations(registry)];
  const optionBoxes = registry.operators.filter(
    (def) => def.flags?.internal !== true && optionBoxParams(def).length > 0,
  );
  const summary =
    `${registry.forms.length} forms, ${registry.wrappers.length} UI wrappers, ${registry.operators.length} operators ` +
    `(${optionBoxes.length} with an option box); surfaces: ` +
    (registry.surfaces === null ? `not checked until ${SURFACES_FILE} exists (T6b)` : `${registry.surfaces.length}`);
  return { violations, summary };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? resolve(HERE, '..'));
  const { violations, summary } = await lintParams(root);
  if (violations.length > 0) {
    for (const violation of violations) console.error(`param-lint: ${violation}`);
    console.error(`param-lint: ${violations.length} violation(s); ${summary}`);
    process.exit(1);
  }
  console.log(`param-lint: OK — ${summary}`);
}
