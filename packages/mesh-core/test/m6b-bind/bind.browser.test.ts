// P-S5 (M6B-SPEC §5.26), Chromium side (Vitest browser mode): the same bound manifests as Node (goldens.json, which
// the Node run keeps).
import { describe, expect, it } from 'vitest';
import { bindGoldenValues } from './goldens';
import goldens from './goldens.json?raw';

describe('Chromium (C4 bind)', () => {
  it('runs in a browser (not Node)', () => {
    expect(typeof (globalThis as { readonly document?: unknown }).document).toBe('object');
  });

  it('P-S5: the same manifests as Node', () => {
    expect(bindGoldenValues()).toEqual(JSON.parse(goldens) as unknown);
  });
});
