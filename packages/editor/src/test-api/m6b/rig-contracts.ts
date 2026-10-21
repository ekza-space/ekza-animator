// M6b test API, C0 group (M6B-SPEC §4.8): `keysHash()`, the sha256 of the curves and keys tables (§3 rule 7, P-C6):
// rig edits, test poses and previews must leave it unchanged.
import { sha256Hex } from '@ekza-studio/anim-core';
import type { EkzaStudioTestApi } from '../types';
import type { M6bTestApiContext } from './support';

export type RigContractsTestApi = Pick<EkzaStudioTestApi, 'keysHash'>;

/** A stable JSON text: object keys sorted at every level. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function rigContractsTestApi(ctx: M6bTestApiContext): RigContractsTestApi {
  return {
    keysHash() {
      ctx.sync();
      const store = ctx.shell.app.store;
      const text = stable({ curves: store.list('curves'), keys: store.list('keys') });
      return sha256Hex(new TextEncoder().encode(text));
    },
  };
}
