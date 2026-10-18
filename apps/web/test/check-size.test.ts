// M2A-SPEC §5.21.2 (M-2): the size gate on a fixture build — the initial set is the prerendered route's scripts and
// script preloads (never `noModule`) plus the route's `next/dynamic` files; every other Turbopack chunk-list loader
// is a lazy group, labelled by the boundary its code belongs to; the gate fails above the budget, when an initial
// script is missing, or when a lazy boundary's code is in the initial set.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSize, GATE_BYTES, TARGET_BYTES } from '../scripts/check-size.mjs';
import { chunkLoaders, htmlScripts } from '../scripts/lib/route-scripts.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const push = (id: number, body: string): string =>
  `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,${id},${body}]);`;
const loader = (id: number, files: readonly string[], target: number): string =>
  push(id, `e=>{e.v(t=>Promise.all([${files.map((f) => `"${f}"`).join(',')}].map(t=>e.l(t))).then(()=>t(${target})))}`);

/** A minimal Next.js build of the editor route: HTML, loadable manifest and Turbopack chunks. */
function fixtureBuild(chunks: Readonly<Record<string, string>>, opts: { readonly e2e?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ekza-size-'));
  dirs.push(dir);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write(
    'server/app/editor.html',
    '<!DOCTYPE html><html><head>' +
      '<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/main.js"/>' +
      '<script src="/_next/static/chunks/runtime.js" async=""></script>' +
      '<script src="/_next/static/chunks/polyfill.js" noModule=""></script>' +
      '<script src="/_next/static/chunks/main.js?dpl=abc" async=""></script>' +
      '<script>self.__next_f.push([1,"inline"])</script></head></html>',
  );
  write(
    'server/app/editor/page/react-loadable-manifest.json',
    JSON.stringify({ 7: { id: 7, files: ['static/chunks/editor-a.js', 'static/chunks/editor-b.js'] } }),
  );
  if (opts.e2e === true) write('server/app/e2e/vrma-check.html', '<html></html>');
  for (const [name, text] of Object.entries(chunks)) write(`static/chunks/${name}`, text);
  return dir;
}

const gz = (text: string): number => gzipSync(Buffer.from(text), { level: 9 }).byteLength;

const CHUNKS = {
  'runtime.js': 'runtime();',
  'polyfill.js': 'polyfill'.repeat(1000),
  'main.js': `${loader(1, ['static/chunks/editor-a.js', 'static/chunks/editor-b.js'], 7)}main();`,
  'editor-a.js': `${loader(2, ['static/chunks/models.js'], 20)}${loader(3, ['static/chunks/writer.js'], 30)}editorA();`,
  'editor-b.js': `${loader(4, ['static/chunks/about.js', 'static/chunks/editor-b.js'], 40)}editorB();`,
  'models.js': push(20, 'e=>{"VRMC_materials_mtoon";"THREE.GLTFLoader"}'),
  'writer.js': push(30, 'e=>{"glTF-Transform"}'),
  'about.js': push(40, 'e=>{"data-testid","about-dialog"}'),
};

describe('route scripts', () => {
  it('reads script tags and script preloads, skipping noModule and inline scripts', () => {
    expect(
      htmlScripts(
        '<script src="/_next/static/chunks/a.js" async></script><script noModule src="/_next/static/chunks/p.js"></script>' +
          '<link href="/_next/static/chunks/b.js" rel="preload" as="script"><link rel="modulepreload" href="/_next/c.js">' +
          '<link rel="stylesheet" href="/_next/static/chunks/s.css"><script>inline()</script>',
      ),
    ).toEqual(['static/chunks/a.js', 'static/chunks/b.js', 'c.js']);
  });

  it('finds Turbopack chunk-list loaders with their files and target module', () => {
    expect(chunkLoaders(`${CHUNKS['editor-a.js']}`)).toEqual([
      { id: 2, target: 20, files: ['static/chunks/models.js'] },
      { id: 3, target: 30, files: ['static/chunks/writer.js'] },
    ]);
    // the minified shape Next 16 emits (parameter names vary)
    const real =
      '0,31061,t=>{t.v(c=>Promise.all(["static/chunks/138w05tx6je4c.js"].map(c=>t.l(c))).then(()=>c(55368)))}]);';
    expect(chunkLoaders(real)).toEqual([{ id: 31061, target: 55368, files: ['static/chunks/138w05tx6je4c.js'] }]);
  });
});

describe('check:size', () => {
  it('measures the initial set (HTML + next/dynamic files) and labels the lazy groups', () => {
    const report = checkSize(fixtureBuild(CHUNKS));
    // script tags in document order, then preloads not already listed, then the next/dynamic files
    expect(report.initial.map((entry) => entry.file)).toEqual([
      'static/chunks/runtime.js',
      'static/chunks/main.js',
      'static/chunks/editor-a.js',
      'static/chunks/editor-b.js',
    ]);
    const expected = ['main.js', 'runtime.js', 'editor-a.js', 'editor-b.js'].reduce(
      (sum, name) => sum + gz(CHUNKS[name as keyof typeof CHUNKS]),
      0,
    );
    expect(report.total).toBe(expected);
    expect(report.lazy.map((group) => [group.id, group.boundary, group.files])).toEqual([
      [2, 'model-loader', ['static/chunks/models.js']],
      [3, 'export-path', ['static/chunks/writer.js']],
      // a loader's files that are already initial are not part of its lazy group
      [4, 'dialog-about', ['static/chunks/about.js']],
    ]);
    expect(report.lazy[0]?.bytes).toBe(gz(CHUNKS['models.js']));
    expect(report.present).toEqual(['model-loader', 'export-path', 'dialog-about']);
    expect(report.ok).toBe(true);
    expect(report.e2eBuild).toBe(false);
    expect([report.gate, report.target]).toEqual([GATE_BYTES, TARGET_BYTES]);
    expect(GATE_BYTES).toBe(900_000);
  });

  it('fails above the gate', () => {
    const report = checkSize(fixtureBuild(CHUNKS), { gate: 50 });
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toMatch(/^initial route \d[\d,]* B > gate 50 B$/);
  });

  it('fails when a lazy boundary is in the initial set (e.g. three-vrm imported statically)', () => {
    const report = checkSize(
      fixtureBuild({ ...CHUNKS, 'editor-b.js': `${CHUNKS['editor-b.js']}"VRMC_materials_mtoon";"ds-canvas"` }),
    );
    expect(report.violations).toEqual(['model-loader', 'dope-sheet']);
    expect(report.ok).toBe(false);
    expect(report.problems).toContain(
      'lazy boundary broken: model loader (io/three, three-vrm, GLTF/Draco/KTX2/meshopt loaders) is in the initial route',
    );
  });

  it('fails when an initial script is missing from the build; reports an e2e build', () => {
    const { 'editor-b.js': _gone, ...rest } = CHUNKS;
    const report = checkSize(fixtureBuild(rest, { e2e: true }));
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toBe('initial scripts missing from the build: static/chunks/editor-b.js');
    expect(report.e2eBuild).toBe(true);
  });

  it('refuses a build without the prerendered route', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ekza-size-'));
    dirs.push(dir);
    expect(() => checkSize(dir)).toThrow(/no prerendered \/editor/);
  });
});
