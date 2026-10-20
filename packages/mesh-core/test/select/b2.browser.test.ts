// The Chromium run of B2 (Vitest browser mode, M6A-SPEC §5.29 P6): the walkers, the loop table, the symmetry maps,
// soft weights and transform manifests give exactly the values the Node run keeps in test/goldens/mesh-select.json.
import { describe, expect, it } from 'vitest';
import goldens from '../goldens/mesh-select.json?raw';
import { b2GoldenValues } from './b2-goldens';

describe('Chromium (B2)', () => {
  it('runs in a browser (not Node)', () => {
    expect(typeof (globalThis as { readonly document?: unknown }).document).toBe('object');
  });

  it('P6: the same walker lists, maps, weights and manifests as Node', () => {
    expect(JSON.parse(JSON.stringify(b2GoldenValues()))).toEqual(JSON.parse(goldens) as Record<string, unknown>);
  });
});
