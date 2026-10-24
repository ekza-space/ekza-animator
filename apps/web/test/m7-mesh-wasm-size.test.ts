// MODELING-PLAN §7.2 G-a (M7): the intake chain is lazy. Its worker (`new Worker(new URL('./intake.worker.ts', …))`)
// and the main-thread fallback chunk carry the `ekza-mesh-wasm` marker; check:size labels them as the `mesh-wasm`
// group, and the marker in a route's initial scripts breaks the boundary (SIZE-1 keeps every lazy boundary).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boundariesFor, checkSize } from '../scripts/check-size.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const push = (id: number, body: string): string =>
  `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,${id},${body}]);`;
/** The shape Next 16's Turbopack emits for `new Worker(new URL('./intake.worker.ts', import.meta.url))`. */
const workerLoader = (id: number, files: readonly string[]): string =>
  `,${id},e=>{e.v(e.r(10914).default("static/chunks/turbopack-worker-7ab3c1.js",[${files.map((f) => `"${f}"`).join(',')}]))}`;

function build(chunks: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ekza-mesh-wasm-size-'));
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

describe('check:size keeps the intake chain lazy (mesh-wasm)', () => {
  it('every route checks the mesh-wasm boundary', () => {
    for (const route of ['editor', 'autorig', 'app'] as const) {
      expect(boundariesFor(route).find((b) => b.id === 'mesh-wasm')?.markers).toEqual(['ekza-mesh-wasm']);
    }
  });

  it('labels the intake worker lazy; its marker in the eager scripts breaks the boundary', () => {
    const main = push(1, `e=>{main()}${workerLoader(2, ['static/chunks/intake.js'])}`);
    const lazy = checkSize(build({ 'main.js': main, 'intake.js': push(30, 'e=>{"ekza-mesh-wasm"}') }), {
      baseline: null,
    });
    expect(lazy.ok).toBe(true);
    expect(lazy.present).toContain('mesh-wasm');
    expect(lazy.lazy.find((group) => group.boundary === 'mesh-wasm')?.files).toEqual(['static/chunks/intake.js']);
    const eager = checkSize(build({ 'main.js': `${main}"ekza-mesh-wasm";`, 'intake.js': push(30, 'e=>{}') }), {
      baseline: null,
    });
    expect(eager.violations).toEqual(['mesh-wasm']);
  });
});
