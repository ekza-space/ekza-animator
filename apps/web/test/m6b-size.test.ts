// M6B-SPEC §2.1, §0.4.9 (C0): check:size's M6b boundaries — the rig-workspace, skin-worker, character-runtime and
// clip-library chunks are labelled when lazy, fail the gate when any of them is in the eager scripts, and warn above
// their size thresholds.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSize, M6B_CHUNK_WARN_BYTES } from '../scripts/check-size.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const push = (id: number, body: string): string =>
  `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,${id},${body}]);`;
const loader = (id: number, files: readonly string[], target: number): string =>
  push(id, `e=>{e.v(t=>Promise.all([${files.map((f) => `"${f}"`).join(',')}].map(t=>e.l(t))).then(()=>t(${target})))}`);

/** A minimal editor route: one eager script that loads the four M6b chunks lazily. */
function build(chunks: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ekza-m6b-size-'));
  dirs.push(dir);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write(
    'server/app/editor.html',
    '<!DOCTYPE html><html><head><script src="/_next/static/chunks/main.js" async=""></script></head></html>',
  );
  write('server/app/editor/page/react-loadable-manifest.json', JSON.stringify({}));
  for (const [name, text] of Object.entries(chunks)) write(`static/chunks/${name}`, text);
  return dir;
}

const MARKERS = {
  'rig-workspace': 'ekza-rig-workspace',
  'skin-worker': 'ekza-skin-worker',
  'character-runtime': 'ekza-character-runtime',
  'clip-library': 'ekza-clip-library',
} as const;

const LAZY = {
  'main.js': `${loader(1, ['static/chunks/rig.js'], 10)}${loader(2, ['static/chunks/skin.js'], 20)}${loader(3, ['static/chunks/runtime.js'], 30)}${loader(4, ['static/chunks/library.js'], 40)}main();`,
  'rig.js': push(10, `e=>{"${MARKERS['rig-workspace']}"}`),
  'skin.js': push(20, `e=>{"${MARKERS['skin-worker']}"}`),
  'runtime.js': push(30, `e=>{"${MARKERS['character-runtime']}"}`),
  'library.js': push(40, `e=>{"${MARKERS['clip-library']}"}`),
};

describe('check:size M6b boundaries (§2.1, §0.4.9)', () => {
  it('labels the four lazy chunks and passes while they stay lazy', () => {
    const report = checkSize(build(LAZY), { baseline: null });
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.present).toEqual(expect.arrayContaining(Object.keys(MARKERS)));
    expect(report.lazy.map((group) => String(group.boundary)).sort((a, b) => a.localeCompare(b))).toEqual(
      Object.keys(MARKERS).sort((a, b) => a.localeCompare(b)),
    );
  });

  it.each(Object.entries(MARKERS))('fails when the %s chunk is pulled into the eager scripts', (boundary, marker) => {
    const report = checkSize(build({ ...LAZY, 'main.js': `${LAZY['main.js']}"${marker}";` }), { baseline: null });
    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([boundary]);
    expect(report.problems.some((problem) => problem.startsWith('lazy boundary broken'))).toBe(true);
  });

  it('warns above the chunk thresholds of §0.4.9', () => {
    expect(M6B_CHUNK_WARN_BYTES).toEqual({
      'rig-workspace': 250_000,
      'skin-worker': 120_000,
      'character-runtime': 150_000,
      'clip-library': 60_000,
    });
    // Random hex compresses badly: ~61 kB gzip for the library chunk.
    let noise = '';
    let x = 1;
    while (noise.length < 140_000) {
      x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
      noise += x.toString(16);
    }
    const report = checkSize(
      build({ ...LAZY, 'library.js': push(40, `e=>{"${MARKERS['clip-library']}";"${noise}"}`) }),
      {
        baseline: null,
      },
    );
    expect(report.ok).toBe(true);
    expect(report.warnings.some((warning) => warning.startsWith('clip-library chunk'))).toBe(true);
  });
});
