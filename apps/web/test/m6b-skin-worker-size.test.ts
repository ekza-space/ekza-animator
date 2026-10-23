// M6B-SPEC §2.1, §9.0 C4 (C0 follow-up): the skin worker is a Turbopack web-worker entry (`new Worker(new URL(…))`),
// whose loader differs from `import()`'s chunk-list loader; check:size reads it as a lazy group, so the `skin-worker`
// boundary is labelled (and its §0.4.9 warning applies) and its chunks never count as eager.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSize } from '../scripts/check-size.mjs';
import { chunkLoaders } from '../scripts/lib/route-scripts.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const push = (id: number, body: string): string =>
  `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,${id},${body}]);`;
/** The shape Next 16's Turbopack emits for `new Worker(new URL('./skin.worker.ts', import.meta.url))`. */
const workerLoader = (id: number, files: readonly string[]): string =>
  `,${id},e=>{e.v(e.r(10914).default("static/chunks/turbopack-worker-2ru9m5gbh1na6.js",[${files.map((f) => `"${f}"`).join(',')}]))}`;

function build(chunks: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ekza-skin-worker-size-'));
  dirs.push(dir);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write(
    'server/app/editor.html',
    '<!DOCTYPE html><html><head><script src="/_next/static/chunks/main.js" async=""></script></head></html>',
  );
  write('server/app-paths-manifest.json', JSON.stringify({ '/editor/page': 'app/editor/page.js' }));
  write('server/app/editor/page/react-loadable-manifest.json', JSON.stringify({}));
  for (const [name, text] of Object.entries(chunks)) write(`static/chunks/${name}`, text);
  return dir;
}

describe('check:size reads web-worker entries (the skin worker)', () => {
  it('chunkLoaders finds the worker loader (target −1) next to import() loaders', () => {
    const source = `[0${workerLoader(99641, ['static/chunks/skin.js', 'static/chunks/turbopack-w.js'])}]`;
    expect(chunkLoaders(source)).toEqual([
      { id: 99641, target: -1, files: ['static/chunks/skin.js', 'static/chunks/turbopack-w.js'] },
    ]);
  });

  it('labels the skin-worker group lazy; its marker in the eager scripts breaks the boundary', () => {
    const main = push(1, `e=>{main()}${workerLoader(2, ['static/chunks/skin.js'])}`);
    const lazy = checkSize(build({ 'main.js': main, 'skin.js': push(20, 'e=>{"ekza-skin-worker"}') }), {
      baseline: null,
    });
    expect(lazy.ok).toBe(true);
    expect(lazy.present).toContain('skin-worker');
    expect(lazy.lazy.find((group) => group.boundary === 'skin-worker')?.files).toEqual(['static/chunks/skin.js']);
    const eager = checkSize(build({ 'main.js': `${main}"ekza-skin-worker";`, 'skin.js': push(20, 'e=>{}') }), {
      baseline: null,
    });
    expect(eager.violations).toEqual(['skin-worker']);
  });
});
