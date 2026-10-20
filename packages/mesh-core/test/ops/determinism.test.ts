// P6 for the B4 ops (M6A-SPEC §5.29), Node side, and the B4 count oracles: the values match
// test/goldens/ops-shape.json (`UPDATE_GOLDENS=1` rewrites it); ops.browser.test.ts checks the same file in Chromium.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { goldenRunner } from '../../src/testing';
import { opsShapeValues } from './determinism';

describe('P6 determinism and count oracles of the B4 ops (Node)', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../goldens/ops-shape.json');
  const computed = opsShapeValues();
  const goldens = goldenRunner(
    file,
    computed,
    { existsSync, readFileSync, writeFileSync },
    process.env['UPDATE_GOLDENS'] === '1',
  );

  it('the §5.29 count oracles', () => {
    const counts = Object.fromEntries(
      Object.entries(computed)
        .filter(([key]) => key.startsWith('oracle/'))
        .map(([key, value]) => [key, value.split(' ')[0]]),
    );
    expect(counts).toEqual({
      'oracle/triangulate-cube': '8/18/12',
      'oracle/half-cube': '8/12/5',
      'oracle/half-cube-mirror': '12/20/10',
      'oracle/mirrored-duplicate-combine': '16/24/10',
      'oracle/spin-cube-edge': '8/12/6',
      'oracle/cut-plane': '9/12/4',
    });
  });

  it('matches the goldens', () => {
    expect(computed).toEqual(goldens);
  });

  it('is stable within one runtime (a second computation agrees)', () => {
    expect(opsShapeValues()).toEqual(computed);
  });
});
