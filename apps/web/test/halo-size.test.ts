// STUDIO-TOUCH-SPEC §20.6 (T2): check:size measures a third route, `/app` (Ekza Studio's Simple layout): gate
// 700,000 B, target 660,000 B, reported and not enforced until T12 records it (`routes.app` in size-baseline.json);
// its initial scripts are the host and the Halo shell entry (`ekza-halo-shell`), never dockview, the Studio or
// Auto-Rig shell or the curve editor; the Halo shell is a banned boundary of `/editor` and `/autorig`; no First-run
// dialog. Modelled on ar-size.test.ts (a synthetic three-route build).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BASELINE_FILE,
  boundariesFor,
  checkRoutes,
  checkSize,
  HALO_GATE_BYTES,
  HALO_TARGET_BYTES,
  hasSourcePage,
  readBaseline,
  ROUTE_BOUNDARIES,
  ROUTE_LIMITS,
  ROUTES,
} from '../scripts/check-size.mjs';
import { ROUTE_INITIAL_MARKERS } from '../scripts/lib/route-scripts.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const push = (id: number, body: string): string =>
  `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,${id},${body}]);`;
const loader = (id: number, files: readonly string[], target: number): string =>
  push(id, `e=>{e.v(t=>Promise.all([${files.map((f) => `"${f}"`).join(',')}].map(t=>e.l(t))).then(()=>t(${target})))}`);
const c = (name: string): string => `static/chunks/${name}`;
const gz = (text: string): number => gzipSync(Buffer.from(text), { level: 9 }).byteLength;
const html = (main: string): string =>
  `<!DOCTYPE html><html><head><script src="/_next/static/chunks/${main}" async=""></script></head></html>`;

// `/app`'s page chunk holds the host entry's loader; the host's chunk holds the Halo shell's loader (both promoted to
// initial by their markers); Studio's shell, the Graph Editor and the rig workspace stay lazy groups.
const CHUNKS: Readonly<Record<string, string>> = {
  'editor-main.js': `${loader(1, [c('welcome.js')], 10)}"dv-dockview";"ekza-studio-shell";editor();`,
  'autorig-main.js': `"ekza-autorig-shell";autorig();`,
  'app-main.js': `${loader(5, [c('host.js')], 50)}app();`,
  'host.js': `${loader(6, [c('halo.js')], 60)}${loader(7, [c('graph.js')], 70)}${push(50, 'e=>{"ekza-studio-host"}')}`,
  'halo.js': `${loader(8, [c('rig.js')], 20)}${push(60, 'e=>{"ekza-halo-shell";halo()}')}`,
  'graph.js': push(70, 'e=>{"Absolute, normalized or stacked curves"}'),
  'welcome.js': push(10, `e=>{"data-testid","firstrun-dialog"}`),
  'rig.js': push(20, 'e=>{"ekza-rig-workspace"}'),
};

function build(chunks: Readonly<Record<string, string>> = CHUNKS): string {
  const dir = mkdtempSync(join(tmpdir(), 'ekza-halo-size-'));
  dirs.push(dir);
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write(
    'server/app-paths-manifest.json',
    JSON.stringify({
      '/(studio)/editor/page': 'app/(studio)/editor/page.js',
      '/(studio)/autorig/page': 'app/(studio)/autorig/page.js',
      '/(studio)/app/page': 'app/(studio)/app/page.js',
    }),
  );
  for (const route of ['editor', 'autorig', 'app']) {
    write(`server/app/${route}.html`, html(`${route}-main.js`));
    write(`server/app/(studio)/${route}/page/react-loadable-manifest.json`, '{}');
  }
  for (const [name, text] of Object.entries(chunks)) write(`static/chunks/${name}`, text);
  return dir;
}

describe('check:size on /app (STUDIO-TOUCH-SPEC §20.6, T2)', () => {
  it('declares the route, its gate and target, its initial markers and its boundaries', () => {
    expect(ROUTES).toEqual(['editor', 'autorig', 'app']);
    expect([HALO_GATE_BYTES, HALO_TARGET_BYTES]).toEqual([700_000, 660_000]);
    expect(ROUTE_LIMITS.app).toEqual({ gate: 700_000, target: 660_000, firstVisit: [] });
    expect(ROUTE_INITIAL_MARKERS['app']).toEqual(['ekza-studio-host', 'ekza-halo-shell']);
    expect(ROUTE_BOUNDARIES.app?.map((b) => b.id)).toEqual([
      'dockview',
      'studio-shell',
      'autorig-shell',
      'curve-editor',
    ]);
    // the Halo shell is banned from the other two routes' initial scripts
    for (const route of ['editor', 'autorig'] as const) {
      expect(ROUTE_BOUNDARIES[route]?.find((b) => b.id === 'halo-shell')?.markers).toEqual(['ekza-halo-shell']);
    }
    // /app checks every shipped lazy boundary too (dialogs, palette, marking menu, model operators, M6b, test API)
    const app = boundariesFor('app').map((b) => b.id);
    for (const id of [
      'dialog-first-run',
      'command-palette',
      'marking-menu',
      'model-operators',
      'rig-workspace',
      'test-api',
    ]) {
      expect(app).toContain(id);
    }
  });

  it('measures /app as the host and the Halo shell entry; its gate is reported, not enforced', () => {
    const { reports, ok } = checkRoutes(build(), { baseline: null });
    expect(ok).toBe(true);
    const app = reports['app'];
    expect(app?.initial.map((entry) => entry.file)).toEqual([c('app-main.js'), c('host.js'), c('halo.js')]);
    expect(app?.total).toBe(
      gz(CHUNKS['app-main.js'] ?? '') + gz(CHUNKS['host.js'] ?? '') + gz(CHUNKS['halo.js'] ?? ''),
    );
    expect(app?.firstVisit).toEqual([]);
    expect(app?.lazy.map((group) => group.boundary)).toEqual(['curve-editor', 'rig-workspace']);
    expect(app?.violations).toEqual([]);
    expect([app?.gate, app?.target, app?.gateEnforced, app?.eagerDelta]).toEqual([700_000, 660_000, false, null]);
    // the editor route's own report is unchanged by the third route
    expect(reports['editor']?.firstVisit.map((g) => g.boundary)).toEqual(['dialog-first-run']);
  });

  it('fails /app when dockview, a shell of the other routes or the curve editor is initial', () => {
    const broken = checkSize(
      build({
        ...CHUNKS,
        'app-main.js': `${CHUNKS['app-main.js']}"dv-dockview";"ekza-studio-shell";"ekza-autorig-shell"`,
      }),
      { route: 'app', baseline: null },
    );
    expect(broken.violations).toEqual(['dockview', 'studio-shell', 'autorig-shell']);
    expect(broken.ok).toBe(false);
    const curves = checkSize(build({ ...CHUNKS, 'halo.js': `${CHUNKS['halo.js']}"DopeSheetController: the canvas"` }), {
      route: 'app',
      baseline: null,
    });
    expect(curves.violations).toEqual(['curve-editor']);
  });

  it('fails /editor and /autorig when the Halo shell is in their initial scripts', () => {
    const halo = `"ekza-halo-shell"`;
    const editor = checkSize(build({ ...CHUNKS, 'editor-main.js': `${CHUNKS['editor-main.js']}${halo}` }), {
      baseline: null,
    });
    expect(editor.violations).toEqual(['halo-shell']);
    const autorig = checkSize(build({ ...CHUNKS, 'autorig-main.js': `${CHUNKS['autorig-main.js']}${halo}` }), {
      route: 'autorig',
      baseline: null,
    });
    expect(autorig.violations).toEqual(['halo-shell']);
  });

  it('reports /app over its gate as a warning until T12 enforces it', () => {
    const dir = build();
    const reported = checkSize(dir, {
      route: 'app',
      baseline: { baseline: { total: 0 }, eagerDelta: { allowance: 0, enforce: false }, routes: { app: { gate: 10 } } },
    });
    expect(reported.ok).toBe(true);
    expect(reported.warnings).toEqual([expect.stringMatching(/^\/app initial route \d+ B > gate 10 B; not enforced/)]);
    const enforced = checkSize(dir, {
      route: 'app',
      baseline: {
        baseline: { total: 0 },
        eagerDelta: { allowance: 0, enforce: false },
        routes: { app: { gate: 10, enforce: true } },
      },
    });
    expect(enforced.ok).toBe(false);
  });

  it('requires /app in this app (the page is in the source) and records it unenforced in size-baseline.json', () => {
    expect(hasSourcePage(join(__dirname, '..'), 'app')).toBe(true);
    const recorded = readBaseline(BASELINE_FILE);
    expect(recorded?.routes?.['app']).toMatchObject({ gate: 700_000, target: 660_000, enforce: false });
    expect(recorded?.routes?.['app']?.pending).toMatch(/T12/);
  });
});
