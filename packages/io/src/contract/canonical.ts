// Canonical JSON and the contract revision (CHARACTER-CONTRACT-SPEC §3.1): recursively sorted keys, compact separators,
// integer-valued numbers as integers, other numbers in ordinary decimal notation (finite, JavaScript-safe, magnitude at
// least 0.000001) — the exact rule of `omoba.asset-catalog.v1` (`scripts/export_asset_catalog.py` `canonical`), so the
// same browser code reproduces both. `revision` = `sha256-` + SHA-256 of the canonical UTF-8 bytes of the document
// without its `revision` key.
import { EkzaError, sha256Hex } from '@ekza-studio/anim-core';

const MAX_SAFE = 9007199254740991;

function fail(path: string, expected: string): never {
  throw new EkzaError('invalid-input', `canonical JSON: ${path} must be ${expected}`, { field: path });
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value) || Math.abs(value) > MAX_SAFE) fail(path, 'a finite, JavaScript-safe number');
      if (Number.isInteger(value)) return String(Object.is(value, -0) ? 0 : value);
      if (Math.abs(value) < 0.000001) fail(path, 'a number of magnitude ≥ 0.000001 (or an integer)');
      // In this range JavaScript's shortest round-trip text never uses an exponent and equals Python's
      // `format(Decimal(repr(x)), 'f')`.
      return String(value);
    }
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item, i) => encode(item, `${path}[${i}]`)).join(',')}]`;
      const record = value as Readonly<Record<string, unknown>>;
      const keys = Object.keys(record).sort();
      const parts: string[] = [];
      for (const key of keys) {
        for (let i = 0; i < key.length; i++) if (key.charCodeAt(i) > 0x7f) fail(`${path}.${key}`, 'an ASCII key');
        const item = record[key];
        if (item === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${encode(item, `${path}.${key}`)}`);
      }
      return `{${parts.join(',')}}`;
    }
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      return fail(path, 'JSON');
  }
  // Exhaustive over typeof; this only satisfies the return-type check.
  return fail(path, 'JSON');
}

/** The canonical JSON text of a value (throws `EkzaError('invalid-input')` naming the offending path). */
export function canonicalJson(value: unknown): string {
  return encode(value, '$');
}

/** `sha256-<hex>` over the canonical JSON of `document` without its `revision` key. */
export function contractRevision(document: Readonly<Record<string, unknown>>): string {
  const { revision: _revision, ...rest } = document;
  return `sha256-${sha256Hex(new TextEncoder().encode(canonicalJson(rest)))}`;
}
