// B2 goldens (Node side): walker index lists, the loop table, grow/shrink/convert, symmetry maps and pointer samples,
// soft weights and transform manifests match test/goldens/mesh-select.json (`UPDATE_GOLDENS=1` rewrites it);
// b2.browser.test.ts checks the same file in Chromium (P6).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { goldenRunner } from '../../src/testing';
import { b2GoldenValues } from './b2-goldens';

describe('B2 goldens (Node)', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../goldens/mesh-select.json');
  const computed = JSON.parse(JSON.stringify(b2GoldenValues())) as Record<string, unknown>;
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
    expect(JSON.parse(JSON.stringify(b2GoldenValues()))).toEqual(computed);
  });
});
