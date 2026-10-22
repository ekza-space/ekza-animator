// AUTORIG-SPEC §7.2 (D0): check:size measures every route of the build — `/editor` with its shipped boundaries plus
// `autorig-shell`, `/autorig` with the dockview, curve-editor and Studio-shell boundaries, no First-run dialog and a
// gate reported (not enforced) until D1 records its baseline; lazy groups are only the ones a route can reach.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTORIG_GATE_BYTES,
  AUTORIG_TARGET_BYTES,
  BASELINE_FILE,
  boundariesFor,
  checkRoutes,
  checkSize,
  readBaseline,
  ROUTE_BOUNDARIES,
  ROUTES,
} from '../scripts/check-size.mjs';

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

const CHUNKS: Readonly<Record<string, string>> = {
  'editor-main.js': `${loader(1, [c('welcome.js')], 10)}${loader(2, [c('rig.js')], 20)}"dv-dockview";"Absolute, normalized or stacked curves";editor();`,
  'autorig-main.js': `${loader(3, [c('rig.js')], 20)}"ekza-autorig-shell";autorig();`,
  'welcome.js': push(10, `e=>{"data-testid","firstrun-dialog";"${'Welcome. '.repeat(30)}"}`),
  'rig.js': `${loader(4, [c('skin.js')], 40)}${push(20, 'e=>{"ekza-rig-workspace"}')}`,
  'skin.js': push(40, 'e=>{"ekza-skin-worker"}'),
};

function build(chunks: Readonly<Record<string, string>> = CHUNKS): string {
  const dir = mkdtempSync(join(tmpdir(), 'ekza-ar-size-'));
  dirs.push(dir);
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write(
    'server/app-paths-manifest.json',
    JSON.stringify({ '/editor/page': 'app/editor/page.js', '/autorig/page': 'app/autorig/page.js' }),
  );
  write('server/app/editor.html', html('editor-main.js'));
  write('server/app/autorig.html', html('autorig-main.js'));
  write('server/app/editor/page/react-loadable-manifest.json', '{}');
  write('server/app/autorig/page/react-loadable-manifest.json', '{}');
  for (const [name, text] of Object.entries(chunks)) write(`static/chunks/${name}`, text);
  return dir;
}

describe('check:size per route (AUTORIG-SPEC §7.2)', () => {
  it('declares the routes, the /autorig gate and the per-route boundaries', () => {
    expect(ROUTES).toEqual(['editor', 'autorig']);
    expect([AUTORIG_GATE_BYTES, AUTORIG_TARGET_BYTES]).toEqual([660_000, 620_000]);
    expect(ROUTE_BOUNDARIES.editor?.map((b) => [b.id, b.markers])).toEqual([['autorig-shell', ['ekza-autorig-shell']]]);
    expect(ROUTE_BOUNDARIES.autorig?.map((b) => b.id)).toEqual(['dockview', 'curve-editor', 'studio-shell']);
    // /autorig checks every shipped lazy boundary too (first-run dialog, palette, marking menu, model operators, M6b)
    const autorig = boundariesFor('autorig').map((b) => b.id);
    for (const id of [
      'dialog-first-run',
      'command-palette',
      'marking-menu',
      'model-operators',
      'rig-workspace',
      'skin-worker',
      'character-runtime',
      'clip-library',
    ]) {
      expect(autorig).toContain(id);
    }
    expect(boundariesFor('editor').map((b) => b.id)).not.toContain('dockview');
  });

  it('measures both routes of one build; each route lists only the lazy groups it can reach', () => {
    const { reports, ok } = checkRoutes(build(), { baseline: null });
    expect(ok).toBe(true);
    const editor = reports['editor'];
    const autorig = reports['autorig'];
    expect(editor?.total).toBe(gz(CHUNKS['editor-main.js'] ?? '') + gz(CHUNKS['welcome.js'] ?? ''));
    expect(editor?.firstVisit.map((g) => g.boundary)).toEqual(['dialog-first-run']);
    expect(editor?.lazy.map((g) => g.boundary)).toEqual(['dialog-first-run', 'rig-workspace', 'skin-worker']);
    // the Auto-Rig shell opens no First-run dialog, and the editor's lazy groups are not its own
    expect(autorig?.total).toBe(gz(CHUNKS['autorig-main.js'] ?? ''));
    expect(autorig?.firstVisit).toEqual([]);
    expect(autorig?.lazy.map((g) => g.boundary)).toEqual(['rig-workspace', 'skin-worker']);
    expect(autorig?.gateEnforced).toBe(false);
    expect([autorig?.gate, autorig?.target]).toEqual([660_000, 620_000]);
    expect(autorig?.eagerDelta).toBeNull();
  });

  it('fails /editor when the Auto-Rig shell is eager, /autorig when dockview or the curve editor is', () => {
    const editorBroken = checkSize(
      build({ ...CHUNKS, 'editor-main.js': `${CHUNKS['editor-main.js']}"ekza-autorig-shell"` }),
      { baseline: null },
    );
    expect(editorBroken.violations).toEqual(['autorig-shell']);
    expect(editorBroken.ok).toBe(false);
    const autorigBroken = checkSize(
      build({
        ...CHUNKS,
        'autorig-main.js': `${CHUNKS['autorig-main.js']}"dv-dockview";"DopeSheetController: the canvas";"ekza-studio-shell"`,
      }),
      { route: 'autorig', baseline: null },
    );
    expect(autorigBroken.violations).toEqual(['dockview', 'curve-editor', 'studio-shell']);
    expect(autorigBroken.problems).toContain('lazy boundary broken: dockview (Studio docking) is in the initial route');
  });

  it('reports the /autorig gate until its baseline is recorded, enforces it after', () => {
    const dir = build();
    const reported = checkSize(dir, { route: 'autorig', baseline: { ...base(), routes: { autorig: { gate: 10 } } } });
    expect(reported.ok).toBe(true);
    expect(reported.warnings).toEqual([
      expect.stringMatching(/^\/autorig initial route \d+ B > gate 10 B; not enforced/),
    ]);
    const enforced = checkSize(dir, {
      route: 'autorig',
      baseline: { ...base(), routes: { autorig: { gate: 10, enforce: true } } },
    });
    expect(enforced.ok).toBe(false);
    expect(enforced.problems[0]).toMatch(/^initial route \d+ B > gate 10 B$/);
  });

  it('measures only /editor when the build has no /autorig page', () => {
    const dir = build();
    rmSync(join(dir, 'server', 'app', 'autorig.html'));
    expect(Object.keys(checkRoutes(dir, { baseline: null }).reports)).toEqual(['editor']);
  });

  it('records the /autorig gate as reported until D1 (size-baseline.json routes.autorig)', () => {
    const recorded = readBaseline(BASELINE_FILE);
    expect(recorded?.routes?.['autorig']).toMatchObject({
      gate: 660_000,
      target: 620_000,
      enforce: false,
      total: null,
    });
  });
});

function base(): NonNullable<ReturnType<typeof readBaseline>> {
  return { baseline: { total: 0 }, eagerDelta: { allowance: 0, enforce: false } };
}
