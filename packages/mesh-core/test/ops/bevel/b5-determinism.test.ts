// P6 for B5 (M6A-SPEC §5.29), Node side: the bevel, cleanup, Mesh Check and projection values match
// test/goldens/b5-determinism.json (`UPDATE_GOLDENS=1` rewrites it); b5.browser.test.ts checks the same file in
// Chromium.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { goldenRunner } from '../../../src/testing';
import { b5DeterminismValues } from './b5-determinism';

describe('P6 determinism of the B5 ops (Node)', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../../goldens/b5-determinism.json');
  const computed = b5DeterminismValues();
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
    expect(b5DeterminismValues()).toEqual(computed);
  });

  it('every bevel, fix and projection ran (the plane’s edges are all border edges)', () => {
    expect(Object.keys(computed).filter((key) => computed[key]?.startsWith('refused:'))).toEqual([
      'bevel/plane/sampled',
    ]);
    expect(computed['bevel/plane/sampled']).toBe('refused:bevel.border-edge');
  });
});
