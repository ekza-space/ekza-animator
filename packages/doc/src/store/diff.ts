// Structural equality and field diffs over JSON-like record values (MVP-SPEC §4.2). Records are plain data, so the
// comparison follows JSON semantics: object properties whose value is `undefined` count as absent, and NaN equals
// NaN (a record holding NaN must not look changed forever).

/** Deep structural equality of JSON-like values (plain objects, arrays, primitives). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== 'object' || a === null || b === null) return false;
  const arrayA = Array.isArray(a);
  if (arrayA !== Array.isArray(b)) return false;
  if (arrayA) {
    const left = a as readonly unknown[];
    const right = b as readonly unknown[];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (!deepEqual(left[i], right[i])) return false;
    return true;
  }
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  // M-1 fast path: stored records are plain objects without `undefined` fields, so equal values field by field plus
  // equal key counts decide without the own-property checks; an `undefined` value or differing counts take the exact
  // walk below.
  let countLeft = 0;
  for (const key in left) {
    countLeft++;
    const value = left[key];
    if (value === undefined) return objectsEqual(left, right);
    const other = right[key];
    if (value === other) continue;
    if (typeof value !== 'object' && typeof value !== 'number') return false;
    if (!deepEqual(value, other)) return false;
  }
  let countRight = 0;
  for (const _key in right) countRight++;
  return countLeft === countRight || objectsEqual(left, right);
}

/** Object equality with JSON semantics: own enumerable fields, `undefined` = absent. */
function objectsEqual(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean {
  let definedLeft = 0;
  for (const key in left) {
    if (!Object.hasOwn(left, key)) continue;
    const value = left[key];
    if (value === undefined) continue;
    definedLeft++;
    if (!Object.hasOwn(right, key)) return false;
    const other = right[key];
    // M-1: equal primitives (the common case for record fields) without a recursive call.
    if (value === other) continue;
    if (typeof value !== 'object' && typeof value !== 'number') return false;
    if (!deepEqual(value, other)) return false;
  }
  let definedRight = 0;
  for (const key in right) {
    if (Object.hasOwn(right, key) && right[key] !== undefined) definedRight++;
  }
  return definedLeft === definedRight;
}

/**
 * Top-level fields whose values differ between two records, sorted in code-unit order. A field present on one side
 * only counts as changed; a field holding `undefined` counts as absent.
 */
export function diffFields(before: object, after: object): readonly string[] {
  const left = before as Readonly<Record<string, unknown>>;
  const right = after as Readonly<Record<string, unknown>>;
  const changed: string[] = [];
  for (const key in left) {
    if (Object.hasOwn(left, key) && !deepEqual(left[key], Object.hasOwn(right, key) ? right[key] : undefined)) {
      changed.push(key);
    }
  }
  for (const key in right) {
    if (Object.hasOwn(right, key) && !Object.hasOwn(left, key) && right[key] !== undefined) changed.push(key);
  }
  return changed.sort(compareStrings);
}

/** Code-unit order: IDs and fractional indexes compare this way, never locale-dependent. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
