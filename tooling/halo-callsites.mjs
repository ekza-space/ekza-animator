#!/usr/bin/env node
// Halo call-site scan (STUDIO-TOUCH-SPEC §20.5 test 2; T6b). Studio Pro's panels, overlays, shell and dialogs and the
// Auto-Rig wizard send operators with argument values written in their source; the touch shell ("Halo") needs a
// Disclosure Manifest entry for every (operator, argument shape) pair they send. This scan lists those pairs from the
// TypeScript syntax trees (`ts.createSourceFile`, no type checker) of
// `packages/editor/src/{panels,overlays,shell,dialogs}` and `packages/autorig/src`.
//
// Recognised forms (the operator id is a string literal or no-substitution template matching `ID`, a template literal
// whose head starts like an id — recorded as a pattern with `*`, e.g. `mesh.create.*` — a same-file `const X = 'a.b'`,
// or a conditional whose branches are any of these; `null` / `undefined` branches send nothing):
//
// - calls of the run wrappers (`WRAPPERS`: `runOperator`, `runFromUi`, `run`, `runUntyped`, `runOp`, the panel
//   helpers `runUntypedOperator`, `runGraphOperator`, the Auto-Rig `runIntake`, the clip library's `act`, the shell's
//   `quiet` and the marking-menu item factory `op`), by name or as a property (`app.run`, `shell.runFromUi`): the
//   operator is the first argument that is an id literal or id template, else the wrapper's operator argument
//   (`WRAPPERS`); the argument right after it is the arguments (two after it for `op(id, label, args)`);
// - object literals with an `op` property (menu, marking-menu, toolbar and button tables, `{ op, args }` descriptors):
//   the sibling `args` property is the arguments (none: `null`, or `'*'` when a spread may supply them);
// - JSX elements with an `op` attribute (operator buttons): the sibling `args` attribute is the arguments;
// - menu rows `[name, op, args, label, …]` (`shell/menus/*.ts`): a tuple of three or more elements whose second element
//   is an id literal, whose first is not and whose third is not a string (lists of rule ids are not rows).
//
// An argument shape is `null` (no arguments, `undefined` or `null`), `'*'` (not an object literal) or an object with
// sorted keys mapping each property to its literal (string, number — negative too —, boolean, null, or a member of a
// `TABLES` constant such as `PANEL.graph`), a nested shape (object literal) or `'*'` (anything else, shorthand
// properties included); a spread adds the key `'...'` and a computed key the key `'[*]'`, both `'*'`.
//
// Sites whose operator is a variable or parameter are listed as `unresolved` for review (`forwarded: true` when it is a
// parameter of the enclosing function: a wrapper's body, whose callers are scanned when the wrapper is in `WRAPPERS`).
// The scan does no data flow beyond the same-file `const`: a factory's parameters (`tool(label, toolId)`) are `'*'`.
//
// Usage: node tooling/halo-callsites.mjs [workspaceRoot] [--json]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The scanned source roots, workspace-relative (§20.5 test 2). */
export const SCAN_ROOTS = [
  'packages/editor/src/panels',
  'packages/editor/src/overlays',
  'packages/editor/src/shell',
  'packages/editor/src/dialogs',
  'packages/autorig/src',
];
const SKIPPED_DIRS = new Set(['node_modules', '.next', '.tsbuild']);
const SOURCE = /\.tsx?$/;

/** An operator id: a namespace and one or more dotted segments. */
export const ID = /^[a-zA-Z]+(\.[a-zA-Z0-9]+)+$/;
/** Wildcard of an argument value the scan cannot read, and of a template operator id's substitutions. */
export const ANY = '*';

/**
 * The run wrappers by callee name: `op` is the operator argument's position when no argument is an id literal (default:
 * the first, after a leading `app` / `ctx` / `shell` / `host`); `args` is the arguments' offset from the operator
 * argument (default 1; the marking-menu factory `op(id, label?, args?)` has its label in between).
 */
export const WRAPPERS = new Map([
  ['run', {}],
  ['runOp', {}],
  ['runOperator', { op: 2 }],
  ['runFromUi', {}],
  ['runUntyped', {}],
  ['runUntypedOperator', { op: 2 }],
  ['runGraphOperator', { op: 1 }],
  ['runIntake', { op: 2 }],
  ['act', { op: 2 }],
  ['quiet', {}],
  ['op', { args: 2 }],
]);
const CONTEXT_ARGUMENTS = new Set(['app', 'ctx', 'shell', 'host']);
/**
 * Constant tables whose members are read as literals in argument values: editor-core's `PANEL` (`PANEL.graph` →
 * `'graph'`), read from its source so a renamed member cannot drift.
 */
export const TABLES = { PANEL: 'packages/editor-core/src/types.ts' };

// ---------- shapes ----------

/** A stable JSON of a shape: object keys sorted at every level. */
export function stableKey(shape) {
  return JSON.stringify(sortKeys(shape));
}

function sortKeys(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

/** The dedup key of an (operator, argument shape) pair. */
export function shapeKey(op, args) {
  return `${op} ${stableKey(args)}`;
}

/**
 * Whether an argument shape satisfies a manifest entry's argument predicate (`ArgPredicate` of
 * `packages/halo/src/manifest/types.ts`). The rule, for every key of `when` (a property name, or a dot path into
 * nested argument objects such as `patch.jointAxes`), with the allowed values `when[key]` (one value or a list):
 *
 * - the shape's value is a literal → it must be one of the allowed values;
 * - the value is `'*'` (unreadable, the whole arguments are `'*'`, or the key is absent beside a spread `'...'`) or a
 *   nested shape → the allowed values must list `'*'`;
 * - the key is absent (or the shape is `null`) or its literal is `null` → the allowed values must list `null`.
 *
 * Keys the predicate does not name are free. An absent or empty `when` matches every shape.
 */
export function argsMatch(shape, when) {
  if (when === undefined || when === null) return true;
  for (const [key, allowed] of Object.entries(when)) {
    const values = Array.isArray(allowed) ? allowed : [allowed];
    const value = valueAt(shape, key);
    if (value === undefined || value === null) {
      if (!values.includes(null)) return false;
    } else if (value === ANY || typeof value === 'object') {
      if (!values.includes(ANY)) return false;
    } else if (!values.includes(value)) {
      return false;
    }
  }
  return true;
}

function valueAt(shape, path) {
  let value = shape;
  for (const part of path.split('.')) {
    if (value === ANY) return ANY;
    if (value === null || typeof value !== 'object') return undefined;
    if (!Object.hasOwn(value, part)) return Object.hasOwn(value, '...') ? ANY : undefined;
    value = value[part];
  }
  return value;
}

/** Strips parentheses, `as`, `satisfies`, `!` and `<T>` from an expression. */
function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

const isUndefined = (node) => ts.isIdentifier(node) && node.text === 'undefined';
const isNothing = (node) => node.kind === ts.SyntaxKind.NullKeyword || isUndefined(node);
const isStringLiteral = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

/** The literal value of an expression (a `TABLES` member included), or `ANY`. */
function literalOf(node, tables) {
  const value = unwrap(node);
  if (isStringLiteral(value)) return value.text;
  if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) {
    const member = tables.get(value.expression.text)?.get(value.name.text);
    if (member !== undefined) return member;
  }
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (
    ts.isPrefixUnaryExpression(value) &&
    value.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(unwrap(value.operand))
  ) {
    return -Number(unwrap(value.operand).text);
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  return ANY;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null; // computed
}

/** The shape of an object literal. */
function objectShape(node, tables) {
  const shape = {};
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      shape['...'] = ANY;
      continue;
    }
    const name = property.name === undefined ? null : propertyName(property.name);
    if (name === null) {
      shape['[*]'] = ANY;
    } else if (ts.isPropertyAssignment(property)) {
      const value = unwrap(property.initializer);
      shape[name] = ts.isObjectLiteralExpression(value) ? objectShape(value, tables) : literalOf(value, tables);
    } else {
      shape[name] = ANY; // shorthand, method, accessor
    }
  }
  return sortKeys(shape);
}

/** The argument shape of an arguments expression (`undefined` when there is none). */
function argsShape(node, tables) {
  if (node === undefined) return null;
  const value = unwrap(node);
  if (isNothing(value)) return null;
  if (ts.isObjectLiteralExpression(value)) return objectShape(value, tables);
  return ANY;
}

/**
 * The arguments of a descriptor without an `args` property: `null`, unless a spread may supply them (`'*'`); a spread
 * of an object literal, or a conditional of object literals and `null` / `undefined`, may only when one names `args`.
 */
function spreadArgs(spreads) {
  const mayHaveArgs = (node) => {
    const value = unwrap(node);
    if (isNothing(value)) return false;
    if (ts.isObjectLiteralExpression(value)) {
      return value.properties.some(
        (property) =>
          ts.isSpreadAssignment(property) || (property.name !== undefined && propertyName(property.name) === 'args'),
      );
    }
    if (ts.isConditionalExpression(value)) return mayHaveArgs(value.whenTrue) || mayHaveArgs(value.whenFalse);
    return true;
  };
  return spreads.some(mayHaveArgs) ? ANY : null;
}

// ---------- operator ids ----------

/** `mesh.create.${kind}` → `mesh.create.*` when the template starts like an id, else null. */
function templatePattern(node) {
  if (!ts.isTemplateExpression(node)) return null;
  const pattern = node.head.text + node.templateSpans.map((span) => ANY + span.literal.text).join('');
  if (!/^[a-zA-Z]+\./.test(node.head.text)) return null;
  return ID.test(pattern.replaceAll(ANY, 'x')) ? pattern : null;
}

/** An id literal or id template: `{ op, pattern }`, else null. */
function literalOp(node) {
  const value = unwrap(node);
  if (isStringLiteral(value)) return ID.test(value.text) ? { op: value.text, pattern: false } : null;
  const pattern = templatePattern(value);
  return pattern === null ? null : { op: pattern, pattern: true };
}

/** Every `const X = 'a.b'` of a file (names declared twice with different ids are left out). */
function fileConstants(sourceFile) {
  const constants = new Map();
  const ambiguous = new Set();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const found = literalOp(node.initializer);
      if (found !== null) {
        const seen = constants.get(node.name.text);
        if (seen !== undefined && seen.op !== found.op) ambiguous.add(node.name.text);
        constants.set(node.name.text, found);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  for (const name of ambiguous) constants.delete(name);
  return constants;
}

/**
 * The operator ids an expression names: a list of `{ op, pattern }` (empty for `null` / `undefined`), or null when the
 * expression is not one of the resolvable forms.
 */
function resolveOps(node, constants) {
  const value = unwrap(node);
  const literal = literalOp(value);
  if (literal !== null) return [literal];
  if (isNothing(value)) return [];
  if (ts.isIdentifier(value)) {
    const constant = constants.get(value.text);
    return constant === undefined ? null : [constant];
  }
  if (ts.isConditionalExpression(value)) {
    const whenTrue = resolveOps(value.whenTrue, constants);
    const whenFalse = resolveOps(value.whenFalse, constants);
    return whenTrue === null || whenFalse === null ? null : [...whenTrue, ...whenFalse];
  }
  return null;
}

/** Whether an identifier is a parameter (or a destructured parameter) of an enclosing function. */
function isParameter(node) {
  const value = unwrap(node);
  if (!ts.isIdentifier(value)) return false;
  const names = (binding) =>
    ts.isIdentifier(binding)
      ? [binding.text]
      : binding.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : names(element.name)));
  for (let current = value.parent; current !== undefined; current = current.parent) {
    if (ts.isFunctionLike(current) && current.parameters?.some((p) => names(p.name).includes(value.text))) return true;
  }
  return false;
}

// ---------- the scan ----------

function parse(file) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
}

/** The `TABLES` of a workspace: name → (member → string literal); a table whose file is missing is left out. */
function readTables(root) {
  const tables = new Map();
  for (const [name, path] of Object.entries(TABLES)) {
    const file = join(root, ...path.split('/'));
    if (!existsSync(file)) continue;
    const members = new Map();
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
        const value = node.initializer === undefined ? undefined : unwrap(node.initializer);
        for (const property of value !== undefined && ts.isObjectLiteralExpression(value) ? value.properties : []) {
          const key = ts.isPropertyAssignment(property) ? propertyName(property.name) : null;
          if (key !== null && isStringLiteral(unwrap(property.initializer))) {
            members.set(key, unwrap(property.initializer).text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
    tables.set(name, members);
  }
  return tables;
}

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

function calleeName(callee) {
  const value = unwrap(callee);
  if (ts.isIdentifier(value)) return value.text;
  if (ts.isPropertyAccessExpression(value)) return value.name.text;
  return null;
}

/** Where a wrapper call's operator argument is when no argument is an id literal. */
function opArgumentIndex(wrapper, args) {
  if (wrapper.op !== undefined) return wrapper.op;
  const first = args[0] === undefined ? undefined : unwrap(args[0]);
  return first !== undefined && ts.isIdentifier(first) && CONTEXT_ARGUMENTS.has(first.text) ? 1 : 0;
}

/** Expressions that cannot be an operator id (callbacks, tables): a wrapper call with one there is not a send. */
function cannotBeOp(node) {
  const value = unwrap(node);
  return (
    ts.isArrowFunction(value) ||
    ts.isFunctionExpression(value) ||
    ts.isObjectLiteralExpression(value) ||
    ts.isArrayLiteralExpression(value) ||
    ts.isNumericLiteral(value) ||
    isStringLiteral(value) ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword
  );
}

function jsxAttribute(attributes, name) {
  return attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === name,
  );
}

/** The expression of a JSX attribute's value (`op="a.b"` → the literal, `args={{…}}` → the object). */
function jsxValue(attribute) {
  const initializer = attribute.initializer;
  if (initializer === undefined) return undefined;
  if (ts.isJsxExpression(initializer)) return initializer.expression;
  return initializer;
}

/** Scans one source file; `report(site)` gets `{ opNode, ops (null: unresolved), args (a shape), via }`. */
function scanFile(sourceFile, tables, report) {
  const constants = fileConstants(sourceFile);
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const wrapper = name === null ? undefined : WRAPPERS.get(name);
      if (wrapper !== undefined && node.arguments.length > 0) {
        const args = node.arguments;
        let index = args.findIndex((arg) => literalOp(arg) !== null);
        if (index < 0) index = opArgumentIndex(wrapper, args);
        const opNode = args[index];
        if (opNode !== undefined && (literalOp(opNode) !== null || !cannotBeOp(opNode))) {
          report({
            opNode,
            ops: resolveOps(opNode, constants),
            args: argsShape(args[index + (wrapper.args ?? 1)], tables),
            via: `${unwrap(node.expression).getText(sourceFile)}()`,
          });
        }
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      const opProperty = node.properties.find(
        (property) =>
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
          propertyName(property.name) === 'op',
      );
      if (opProperty !== undefined) {
        const opNode = ts.isPropertyAssignment(opProperty) ? opProperty.initializer : opProperty.name;
        // `{ op: 'replace' }` (a brush mode, not an operator) and other non-id strings are not sends.
        if (!isStringLiteral(unwrap(opNode)) || literalOp(opNode) !== null) {
          const argsProperty = node.properties.find(
            (property) => property.name !== undefined && propertyName(property.name) === 'args',
          );
          const spreads = node.properties.filter(ts.isSpreadAssignment).map((spread) => spread.expression);
          report({
            opNode,
            ops: resolveOps(opNode, constants),
            args:
              argsProperty === undefined
                ? spreadArgs(spreads)
                : ts.isPropertyAssignment(argsProperty)
                  ? argsShape(argsProperty.initializer, tables)
                  : ANY,
            via: 'op:',
          });
        }
      }
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opAttribute = jsxAttribute(node.attributes, 'op');
      const opNode = opAttribute === undefined ? undefined : jsxValue(opAttribute);
      if (opNode !== undefined && (!isStringLiteral(unwrap(opNode)) || literalOp(opNode) !== null)) {
        const argsAttribute = jsxAttribute(node.attributes, 'args');
        const spreads = node.attributes.properties.filter(ts.isJsxSpreadAttribute).map((spread) => spread.expression);
        report({
          opNode,
          ops: resolveOps(opNode, constants),
          args: argsAttribute === undefined ? spreadArgs(spreads) : argsShape(jsxValue(argsAttribute), tables),
          via: `<${node.tagName.getText(sourceFile)} op>`,
        });
      }
    } else if (ts.isArrayLiteralExpression(node) && node.elements.length >= 3) {
      const [first, second, third] = node.elements.map(unwrap);
      if (
        isStringLiteral(second) &&
        literalOp(second) !== null &&
        literalOp(first) === null &&
        !isStringLiteral(third) &&
        !ts.isSpreadElement(first) &&
        !ts.isSpreadElement(third)
      ) {
        const args = argsShape(third, tables);
        report({ opNode: second, ops: resolveOps(second, constants), args, via: '[name, op, args]' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/**
 * Every (operator, argument shape) pair the scanned roots send, and the sites the scan cannot resolve.
 *
 * @param {string} root the workspace root
 * @returns {{ pairs: { op: string, args: unknown, sites: string[], pattern?: true }[],
 *   unresolved: { site: string, expr: string, via: string, forwarded?: true }[] }}
 */
export function scanCallSites(root = resolve(HERE, '..')) {
  const pairs = new Map();
  const unresolved = [];
  const tables = readTables(root);
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of sourceFiles(join(root, ...scanRoot.split('/')))) {
      const sourceFile = parse(file);
      const path = relative(root, file).split(sep).join('/');
      scanFile(sourceFile, tables, ({ opNode, ops, args, via }) => {
        const line = sourceFile.getLineAndCharacterOfPosition(opNode.getStart(sourceFile)).line + 1;
        const site = `${path}:${line}`;
        if (ops === null) {
          const expr = opNode.getText(sourceFile).replace(/\s+/g, ' ');
          unresolved.push({ site, expr, via, ...(isParameter(opNode) ? { forwarded: true } : {}) });
          return;
        }
        for (const { op, pattern } of ops) {
          const key = shapeKey(op, args);
          let pair = pairs.get(key);
          if (pair === undefined) {
            pair = { op, args, sites: [], ...(pattern ? { pattern: true } : {}) };
            pairs.set(key, pair);
          }
          if (!pair.sites.includes(site)) pair.sites.push(site);
        }
      });
    }
  }
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const bySite = (a, b) => {
    const [fileA, lineA] = splitSite(a);
    const [fileB, lineB] = splitSite(b);
    return compare(fileA, fileB) || lineA - lineB;
  };
  const sorted = [...pairs.values()]
    .map((pair) => ({ ...pair, sites: pair.sites.sort(bySite) }))
    .sort((a, b) => compare(a.op, b.op) || compare(stableKey(a.args), stableKey(b.args)));
  unresolved.sort((a, b) => bySite(a.site, b.site) || compare(a.expr, b.expr));
  return { pairs: sorted, unresolved };
}

function splitSite(site) {
  const at = site.lastIndexOf(':');
  return [site.slice(0, at), Number(site.slice(at + 1))];
}

/** A one-line summary of a scan. */
export function summarize({ pairs, unresolved }) {
  const ops = new Set(pairs.map((pair) => pair.op));
  const forwarded = unresolved.filter((site) => site.forwarded === true).length;
  return (
    `${pairs.length} (operator, argument shape) pairs, ${ops.size} distinct operators ` +
    `(${pairs.filter((pair) => pair.pattern === true).length} pattern pairs); ` +
    `${unresolved.length} unresolved sites (${forwarded} forwarded parameters)`
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const root = resolve(argv.find((arg) => arg !== '--json') ?? resolve(HERE, '..'));
  const scan = scanCallSites(root);
  if (json) {
    console.log(JSON.stringify(scan, null, 2));
  } else {
    console.log(`halo-callsites: ${summarize(scan)}`);
    for (const site of scan.unresolved) {
      console.log(`  unresolved ${site.site}: ${site.expr} (${site.via}${site.forwarded ? ', forwarded' : ''})`);
    }
  }
}
