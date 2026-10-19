// M6A-SPEC §5.27 (B9): check:size's M6a gates on fixture builds — the eager delta over the recorded M2a baseline
// (enforced, or a warning while the owner's allowance decision is pending; never for e2e builds), the Model workspace
// chunk warning, the marking-menu and command-palette lazy boundaries, and the per-package attribution report of
// builds with source maps.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BASELINE_FILE,
  checkSize,
  eagerDelta,
  modelChunk,
  readBaseline,
  type SizeBaseline,
} from '../scripts/check-size.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const push = (id: number, body: string): string =>
  `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,${id},${body}]);`;
const loader = (id: number, files: readonly string[], target: number): string =>
  push(id, `e=>{e.v(t=>Promise.all([${files.map((f) => `"${f}"`).join(',')}].map(t=>e.l(t))).then(()=>t(${target})))}`);
const gz = (text: string): number => gzipSync(Buffer.from(text), { level: 9 }).byteLength;

function fixtureBuild(chunks: Readonly<Record<string, string>>, opts: { readonly e2e?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ekza-m6a-size-'));
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
  if (opts.e2e === true) write('server/app/e2e/vrma-check.html', '<html></html>');
  for (const [name, text] of Object.entries(chunks)) write(`static/chunks/${name}`, text);
  return dir;
}

const CHUNKS = {
  'main.js':
    `${loader(1, ['static/chunks/kernel.js'], 10)}${loader(2, ['static/chunks/view.js'], 20)}` +
    `${loader(3, ['static/chunks/mm.js'], 30)}${loader(4, ['static/chunks/cmdk.js'], 40)}main();`,
  'kernel.js': push(10, `e=>{const KERNEL_MARKER="ekza-mesh-kernel";${'kernel();'.repeat(400)}}`),
  'view.js': push(20, 'e=>{const VIEW_MARKER="ekza-mesh-view"}'),
  'mm.js': push(30, 'e=>{"data-testid","mm-slot-N"}'),
  'cmdk.js': push(40, 'e=>{"data-testid","cmdk-input"}'),
};

const baseline = (fields: { total: number; allowance: number; enforce: boolean }): SizeBaseline => ({
  baseline: { total: fields.total },
  eagerDelta: { allowance: fields.allowance, enforce: fields.enforce, pending: 'owner decision pending' },
  modelChunk: { warnBytes: 250_000 },
});

describe('the recorded baseline (size-baseline.json)', () => {
  it('records the M2a route and the +20,480 B allowance, not enforced until the owner decides', () => {
    const recorded = readBaseline(BASELINE_FILE);
    expect(recorded?.baseline.total).toBe(845_267);
    expect(recorded?.eagerDelta.allowance).toBe(20_480);
    expect(recorded?.eagerDelta.enforce).toBe(false);
    expect(recorded?.eagerDelta.pending).toMatch(/Decision requested/);
    expect(recorded?.modelChunk?.warnBytes).toBe(250_000);
    expect(JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))).toEqual(recorded);
  });
});

describe('the eager-delta gate (§5.27)', () => {
  it('computes the delta against the baseline and the limit', () => {
    expect(eagerDelta(865_000, baseline({ total: 845_000, allowance: 20_480, enforce: true }), false)).toEqual({
      baseline: 845_000,
      allowance: 20_480,
      limit: 865_480,
      delta: 20_000,
      over: false,
      enforced: true,
      comparable: true,
      pending: 'owner decision pending',
    });
    expect(eagerDelta(870_000, baseline({ total: 845_000, allowance: 20_480, enforce: true }), false)?.over).toBe(true);
    expect(eagerDelta(870_000, null, false)).toBeNull();
    // An e2e build carries the test routes: it is never compared.
    expect(eagerDelta(870_000, baseline({ total: 845_000, allowance: 20_480, enforce: true }), true)).toMatchObject({
      enforced: false,
      comparable: false,
    });
  });

  it('fails the gate above the limit when enforced, warns while the decision is pending, passes under it', () => {
    const build = fixtureBuild(CHUNKS);
    const measured = checkSize(build, { baseline: null }).total;
    expect(measured).toBe(gz(CHUNKS['main.js']));
    const enforced = checkSize(build, { baseline: baseline({ total: measured - 100, allowance: 50, enforce: true }) });
    expect(enforced.ok).toBe(false);
    expect(enforced.problems).toEqual([
      `M6a eager delta +100 B over the ${(measured - 100).toLocaleString('en')} B baseline > allowance +50 B (limit ${(measured - 50).toLocaleString('en')} B)`,
    ]);
    const pending = checkSize(build, { baseline: baseline({ total: measured - 100, allowance: 50, enforce: false }) });
    expect(pending.ok).toBe(true);
    expect(pending.warnings).toEqual([
      expect.stringMatching(/^M6a eager delta \+100 B .* not enforced: owner decision pending$/),
    ]);
    const within = checkSize(build, { baseline: baseline({ total: measured - 40, allowance: 50, enforce: true }) });
    expect(within.ok).toBe(true);
    expect(within.eagerDelta).toMatchObject({ delta: 40, over: false });
    const e2e = checkSize(fixtureBuild(CHUNKS, { e2e: true }), {
      baseline: baseline({ total: measured - 100, allowance: 50, enforce: true }),
    });
    expect(e2e.ok).toBe(true);
    expect(e2e.warnings).toEqual([]);
  });
});

describe('the Model workspace chunk and the B9 lazy boundaries', () => {
  it('labels the marking-menu and command-palette drawings and fails when either is eager', () => {
    const report = checkSize(fixtureBuild(CHUNKS), { baseline: null });
    expect(report.present).toEqual(
      expect.arrayContaining(['mesh-kernel', 'mesh-view', 'marking-menu', 'command-palette']),
    );
    expect(report.violations).toEqual([]);
    const eager = checkSize(fixtureBuild({ ...CHUNKS, 'main.js': `${CHUNKS['main.js']}"mm-slot-N";"cmdk-input"` }), {
      baseline: null,
    });
    expect(eager.violations).toEqual(['marking-menu', 'command-palette']);
    expect(eager.problems).toContain('lazy boundary broken: marking menu drawing is in the initial route');
  });

  it('sums the lazy groups entering Model loads (kernel, mesh view, marking menu) and warns above 250 kB', () => {
    const report = checkSize(fixtureBuild(CHUNKS), { baseline: null });
    const expected = gz(CHUNKS['kernel.js']) + gz(CHUNKS['view.js']) + gz(CHUNKS['mm.js']);
    expect(report.modelChunk).toEqual({
      bytes: expected,
      warnBytes: 250_000,
      over: false,
      groups: ['mesh-kernel', 'mesh-view', 'marking-menu'],
    });
    const lazy = report.lazy;
    const tight = modelChunk(lazy, {
      ...baseline({ total: 0, allowance: 0, enforce: false }),
      modelChunk: { warnBytes: 10 },
    });
    expect(tight.over).toBe(true);
    const warned = checkSize(fixtureBuild(CHUNKS), {
      baseline: { ...baseline({ total: 0, allowance: 1e9, enforce: true }), modelChunk: { warnBytes: 10 } },
    });
    expect(warned.ok).toBe(true);
    expect(warned.warnings).toEqual([
      `Model workspace chunk ${expected.toLocaleString('en')} B > 10 B (mesh-kernel, mesh-view, marking-menu)`,
    ]);
  });
});

describe('the chunk attribution report', () => {
  it('attributes the eager scripts to packages when the build has source maps; null otherwise', () => {
    expect(checkSize(fixtureBuild(CHUNKS), { baseline: null }).attribution).toBeNull();
    const code = 'console.log("a");console.log("b");\n//# sourceMappingURL=main.js.map';
    const build = fixtureBuild({ ...CHUNKS, 'main.js': code });
    const map = {
      version: 3,
      sources: [
        'turbopack:///[project]/packages/editor/src/shell/MenuBar.tsx',
        'turbopack:///[project]/node_modules/react/index.js',
      ],
      // AAAA = column 0, source 0; then column 17 (i), source +1 (C).
      mappings: 'AAAA,iBCAA',
    };
    writeFileSync(join(build, 'static/chunks/main.js.map'), JSON.stringify(map));
    const report = checkSize(build, { baseline: null });
    expect(report.attribution?.unmappedChunks).toBe(0);
    expect(report.attribution?.packages.map((p) => p.pkg).sort()).toEqual([
      '(unmapped)',
      '@ekza-animator/editor',
      'react',
    ]);
    const sum = report.attribution?.packages.reduce((total, p) => total + p.gzip, 0) ?? 0;
    expect(sum).toBeCloseTo(gz(code), 6);
  });
});
