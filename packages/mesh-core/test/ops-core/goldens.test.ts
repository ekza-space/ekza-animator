// B3's JSON goldens, Node side (M6A-SPEC §5.29): the §5.29 count rows of B3's ops equal the spec's numbers and the
// golden file, and every case's manifest matches test/goldens/ops-core.json (P6; `UPDATE_GOLDENS=1` rewrites it);
// ops-core.browser.test.ts checks the same file in Chromium.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { goldenRunner } from '../../src/testing';
import { type GoldenValue, opsCoreValues, SPEC_COUNTS } from './goldens';

describe('B3 goldens (Node)', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../goldens/ops-core.json');
  const computed = opsCoreValues();
  const goldens = goldenRunner(
    file,
    computed,
    { existsSync, readFileSync, writeFileSync },
    process.env['UPDATE_GOLDENS'] === '1',
  ) as Readonly<Record<string, GoldenValue>>;

  it('the §5.29 count oracles of B3’s ops hold (spec numbers, not the file)', () => {
    const spec = Object.fromEntries(Object.keys(SPEC_COUNTS).map((name) => [name, computed[name]?.counts]));
    expect(spec).toEqual(SPEC_COUNTS);
    for (const name of Object.keys(SPEC_COUNTS)) expect(goldens[name]?.counts).toBe(SPEC_COUNTS[name]);
  });

  it('P6: every case matches the goldens (counts and manifest ids)', () => {
    expect(computed).toEqual(goldens);
  });

  it('P6: a second computation in the same runtime agrees', () => {
    expect(opsCoreValues()).toEqual(computed);
  });
});
