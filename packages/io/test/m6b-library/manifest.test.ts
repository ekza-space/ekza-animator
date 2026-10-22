// C12 (M6B-SPEC §0.4.7, §0.5): parseStarterPackManifest — the committed manifest parses to itself; every malformed
// field is refused with EkzaError('invalid-input') naming that field.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStarterPackManifest } from '../../src/library/manifest';

const COMMITTED = JSON.parse(
  readFileSync(new URL('../../../../apps/web/public/library/animations/starter-pack.json', import.meta.url), 'utf8'),
) as Record<string, unknown> & { clips: Record<string, unknown>[] };

const clone = (): typeof COMMITTED => structuredClone(COMMITTED);

describe('parseStarterPackManifest', () => {
  it('parses the committed manifest to an equal object with the 14 clips', () => {
    const manifest = parseStarterPackManifest(clone());
    expect(manifest).toEqual(COMMITTED);
    expect(manifest.clips.map((clip) => clip.id)).toEqual([
      'idle',
      'walk',
      'run',
      'jog',
      'sword-attack',
      'punch',
      'cast',
      'hit',
      'death',
      'dance',
      'pistol-shoot',
      'jump-start',
      'jump-loop',
      'jump-land',
    ]);
  });

  const cases: readonly [string, (json: ReturnType<typeof clone>) => unknown, string][] = [
    ['not an object', () => [], 'manifest'],
    ['wrong version', (j) => ({ ...j, version: 2 }), 'manifest.version'],
    ['wrong id', (j) => ({ ...j, id: 'other' }), 'manifest.id'],
    ['empty title', (j) => ({ ...j, title: ' ' }), 'manifest.title'],
    ['licence not CC0', (j) => ({ ...j, license: 'MIT' }), 'manifest.license'],
    ['source without sha', (j) => ({ ...j, source: { file: 'x' } }), 'manifest.source.sha256'],
    ['no clips', (j) => ({ ...j, clips: [] }), 'manifest.clips'],
    ['clip id with capitals', (j) => (j.clips[0] && (j.clips[0]['id'] = 'Idle'), j), 'manifest.clips[0].id'],
    ['file not <id>.vrma', (j) => (j.clips[1] && (j.clips[1]['file'] = 'x.vrma'), j), 'manifest.clips[1].file'],
    ['bad sha256', (j) => (j.clips[2] && (j.clips[2]['sha256'] = 'ABC'), j), 'manifest.clips[2].sha256'],
    ['zero bytes', (j) => (j.clips[3] && (j.clips[3]['bytes'] = 0), j), 'manifest.clips[3].bytes'],
    ['fractional bytes', (j) => (j.clips[3] && (j.clips[3]['bytes'] = 1.5), j), 'manifest.clips[3].bytes'],
    ['fps not 30', (j) => (j.clips[4] && (j.clips[4]['fps'] = 24), j), 'manifest.clips[4].fps'],
    ['loop not boolean', (j) => (j.clips[5] && (j.clips[5]['loop'] = 'yes'), j), 'manifest.clips[5].loop'],
    ['empty slot', (j) => (j.clips[6] && (j.clips[6]['slot'] = ''), j), 'manifest.clips[6].slot'],
    ['credit not Quaternius', (j) => (j.clips[7] && (j.clips[7]['credit'] = 'X'), j), 'manifest.clips[7].credit'],
    [
      'duplicate id',
      (j) => (j.clips[1] && ((j.clips[1]['id'] = 'idle'), (j.clips[1]['file'] = 'idle.vrma')), j),
      'manifest.clips[1].id',
    ],
  ];
  it.each(cases)('refuses %s, naming the field', (_name, mutate, field) => {
    expect(() => parseStarterPackManifest(mutate(clone()))).toThrow(
      expect.objectContaining({ code: 'invalid-input', details: { field } }),
    );
  });
});
