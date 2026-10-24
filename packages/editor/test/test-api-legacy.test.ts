// The e2e URL parameters `nav` and `space` (MVP-SPEC §4.8) with ids renamed in DECISIONS-OPEN TM-1: an old id reads
// as its current id. The old spellings come from editor-core's legacy table.
import { LEGACY_IDS } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import { parseEditorParams } from '../src/test-api/params';

describe('URL parameters with renamed ids', () => {
  it('reads the current ids', () => {
    expect(parseEditorParams('?e2e=1&nav=dcc&space=maximize', true)).toMatchObject({ nav: 'dcc', space: 'maximize' });
  });

  it.each(Object.entries(LEGACY_IDS.spaceBehaviour))('space=%s reads as %s', (old, now) => {
    expect(parseEditorParams(`?e2e=1&space=${old}`, true).space).toBe(now);
  });

  it('nav= maps an old id to its current id when the URL may choose it (mouse or trackpad)', () => {
    for (const [old, now] of Object.entries(LEGACY_IDS.navProfile)) {
      expect(parseEditorParams(`?e2e=1&nav=${old}`, true).nav).toBe(now === 'dcc' ? 'dcc' : null);
    }
  });
});
