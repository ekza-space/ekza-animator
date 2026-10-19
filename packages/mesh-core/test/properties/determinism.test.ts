// P6 (M6A-SPEC §5.29), Node side: the determinism values match test/goldens/primitives-determinism.json
// (`UPDATE_GOLDENS=1` rewrites it); determinism.browser.test.ts checks the same file in Chromium.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { goldenRunner } from '../../src/testing';
import { determinismValues } from './determinism';

describe('P6 determinism (Node)', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../goldens/primitives-determinism.json');
  const computed = determinismValues();
  const goldens = goldenRunner(
    file,
    computed,
    { existsSync, readFileSync, writeFileSync },
    process.env['UPDATE_GOLDENS'] === '1',
  );

  it('matches the goldens', () => {
    expect(computed).toEqual(goldens);
  });

  it('is stable within one runtime (a second computation agrees)', () => {
    expect(determinismValues()).toEqual(computed);
  });
});
