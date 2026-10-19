// M2A-SPEC §5.21.2 (M-2): the size gate on a fixture build — the eager set is the prerendered route's scripts and
// script preloads (never `noModule`) plus the route's `next/dynamic` files; every other Turbopack chunk-list loader
// is a lazy group, labelled by the boundary its code belongs to; the measured initial route is the first visit's
// (eager plus the First-run dialog group); the gate fails above the budget, when an initial script is missing, or
// when a lazy boundary's code is in the eager set.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSize, FIRST_VISIT, GATE_BYTES, TARGET_BYTES } from '../scripts/check-size.mjs';
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
  'editor-b.js': `${loader(4, ['static/chunks/about.js', 'static/chunks/editor-b.js'], 40)}${loader(5, ['static/chunks/welcome.js'], 50)}editorB();`,
  'models.js': push(20, 'e=>{"VRMC_materials_mtoon";"THREE.GLTFLoader"}'),
  'writer.js': push(30, 'e=>{"glTF-Transform"}'),
  'about.js': push(40, 'e=>{"data-testid","about-dialog"}'),
  'welcome.js': push(50, `e=>{"data-testid","firstrun-dialog";"${'Welcome to Ekza Animator. '.repeat(20)}"}`),
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
  it('measures the eager set (HTML + next/dynamic files) plus the first visit and labels the lazy groups', () => {
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
    expect(report.eager).toBe(expected);
    // a fresh profile opens the First-run dialog at start: its group counts in the measured route, not in `eager`
    expect(FIRST_VISIT).toEqual(['dialog-first-run']);
    expect(report.firstVisit.map((group) => [group.id, group.boundary, group.files])).toEqual([
      [5, 'dialog-first-run', ['static/chunks/welcome.js']],
    ]);
    expect(report.total).toBe(expected + gz(CHUNKS['welcome.js']));
    expect(report.lazy.map((group) => [group.id, group.boundary, group.files])).toEqual([
      [2, 'model-loader', ['static/chunks/models.js']],
      [3, 'export-path', ['static/chunks/writer.js']],
      // a loader's files that are already initial are not part of its lazy group
      [4, 'dialog-about', ['static/chunks/about.js']],
      [5, 'dialog-first-run', ['static/chunks/welcome.js']],
    ]);
    expect(report.lazy[0]?.bytes).toBe(gz(CHUNKS['models.js']));
    expect(report.present).toEqual(['model-loader', 'export-path', 'dialog-first-run', 'dialog-about']);
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

  it('gates the first visit: the First-run dialog group can push the route over the gate', () => {
    const base = checkSize(fixtureBuild(CHUNKS));
    const report = checkSize(fixtureBuild(CHUNKS), { gate: base.eager });
    expect(base.total).toBeGreaterThan(base.eager);
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([
      `initial route ${base.total.toLocaleString('en')} B > gate ${base.eager.toLocaleString('en')} B`,
    ]);
  });

  it('counts no first-visit group when the build has no First-run dialog boundary', () => {
    const { 'welcome.js': _gone, ...rest } = CHUNKS;
    const report = checkSize(
      fixtureBuild({ ...rest, 'editor-b.js': CHUNKS['editor-b.js'].replace(/,\d+,e=>\{[^}]*welcome[^}]*\}/, '') }),
    );
    expect(report.lazy.map((group) => group.id)).toEqual([2, 3, 4]);
    expect(report.firstVisit).toEqual([]);
    expect(report.total).toBe(report.eager);
    expect(report.ok).toBe(true);
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

  it('M6a: labels the lazy mesh kernel and mesh view chunks, and fails when either is imported eagerly', () => {
    const lazy = checkSize(
      fixtureBuild({
        ...CHUNKS,
        'editor-a.js': `${loader(6, ['static/chunks/kernel.js'], 60)}${loader(8, ['static/chunks/view.js'], 80)}${CHUNKS['editor-a.js']}`,
        'kernel.js': push(60, 'e=>{const KERNEL_MARKER="ekza-mesh-kernel"}'),
        'view.js': push(80, 'e=>{const VIEW_MARKER="ekza-mesh-view"}'),
      }),
    );
    expect(lazy.violations).toEqual([]);
    expect(lazy.present).toEqual(expect.arrayContaining(['mesh-kernel', 'mesh-view']));
    expect(lazy.ok).toBe(true);
    const eager = checkSize(
      fixtureBuild({ ...CHUNKS, 'editor-b.js': `${CHUNKS['editor-b.js']}"ekza-mesh-kernel";"ekza-mesh-view"` }),
    );
    expect(eager.violations).toEqual(['mesh-kernel', 'mesh-view']);
    expect(eager.ok).toBe(false);
    expect(eager.problems).toContain('lazy boundary broken: mesh kernel (mesh-core) is in the initial route');
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
