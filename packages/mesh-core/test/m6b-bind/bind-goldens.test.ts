// P-S5 (M6B-SPEC §5.26), Node side: the bound manifests of every golden case (goldens.ts) equal goldens.json
// (`UPDATE_GOLDENS=1` rewrites it); bind.browser.test.ts checks the same file in Chromium.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { goldenRunner } from '../../src/testing';
import { bindGoldenValues } from './goldens';

describe('P-S5 bind goldens (Node)', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), 'goldens.json');
  const computed = bindGoldenValues();
  const goldens = goldenRunner(
    file,
    computed,
    { existsSync, readFileSync, writeFileSync },
    process.env['UPDATE_GOLDENS'] === '1',
  );

  it('every case matches the goldens (manifest ids, palettes, island counts, CG iterations)', () => {
    expect(computed).toEqual(goldens);
  });

  it('a second computation in the same runtime agrees', () => {
    expect(bindGoldenValues()).toEqual(computed);
  });
});
