// JSON value helpers: structural equality (the surgeon's preservation invariant, MVP-SPEC §4.11.13) and canonical
// serialization with sorted keys (deterministic manifests).

/** Deep equality of JSON values: same primitives, arrays element-wise, objects with the same keys (any order). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((value, i) => jsonEqual(value, other[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  return keys.every((key) => Object.hasOwn(rb, key) && jsonEqual(ra[key], rb[key]));
}

/** JSON text with object keys sorted at every level (no whitespace unless `indent` is given). */
export function canonicalJson(value: unknown, indent?: number): string {
  return JSON.stringify(sortKeys(value), null, indent);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] !== undefined) out[key] = sortKeys(record[key]);
  }
  return out;
}
