// AUTORIG-SPEC §7.2 (D0, blocker RV-1 of the v0.3 review): the size tooling is route-group-proof. Moving
// `app/editor/page.tsx` under `app/(studio)/` (a shared layout with a dynamic host) must not change what `/editor`
// measures: the segment comes from the app-paths manifest, the page's and the layouts' loadable manifests are unioned,
// a missing page manifest throws (no silent `{}`), and the host and the route's own shell count as initial by their
// markers even behind `React.lazy`.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSize } from '../scripts/check-size.mjs';
import {
  loadableManifests,
  ROUTE_INITIAL_MARKERS,
  readRouteScripts,
  routeSegment,
  stripRouteGroups,
} from '../scripts/lib/route-scripts.mjs';
import { ROUTE_GROUP_CHUNKS, type RouteGroupShape, routeGroupBuild } from './fixtures/route-group';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const build = (shape: RouteGroupShape, routes?: readonly string[]): string => {
  const dir = routeGroupBuild(shape, routes);
  dirs.push(dir);
  return dir;
};
const gz = (name: string): number => gzipSync(Buffer.from(ROUTE_GROUP_CHUNKS[name] ?? ''), { level: 9 }).byteLength;
const chunks = (...names: string[]): string[] => names.map((name) => `static/chunks/${name}`);

describe('route-group-proof route scripts (AUTORIG-SPEC §7.2)', () => {
  it('resolves the segment from the app-paths manifest, route groups included', () => {
    expect(stripRouteGroups('/(studio)/editor/page')).toBe('/editor/page');
    expect(stripRouteGroups('/(a)/(b)/x/page')).toBe('/x/page');
    expect(routeSegment(build('flat'), 'editor')).toBe('/editor/page');
    const group = build('group');
    expect(routeSegment(group, 'editor')).toBe('/(studio)/editor/page');
    expect(routeSegment(group, 'autorig')).toBe('/(studio)/autorig/page');
    expect(routeSegment(group, '')).toBe('/page');
    expect(() => routeSegment(group, 'nowhere')).toThrow(/no page for \/nowhere/);
  });

  it('lists the page manifest and every layout manifest above it', () => {
    const { page, layouts } = loadableManifests('/n', '/(studio)/editor/page');
    expect(page).toBe(join('/n', 'server', 'app', '(studio)', 'editor', 'page', 'react-loadable-manifest.json'));
    expect(layouts).toEqual([
      join('/n', 'server', 'app', '(studio)', 'editor', 'layout', 'react-loadable-manifest.json'),
      join('/n', 'server', 'app', '(studio)', 'layout', 'react-loadable-manifest.json'),
      join('/n', 'server', 'app', 'layout', 'react-loadable-manifest.json'),
    ]);
  });

  it('a (studio) /editor measures equal to a flat /editor built from the same chunks (both manifest shapes)', () => {
    const flat = checkSize(build('flat'), { baseline: null });
    const group = checkSize(build('group'), { baseline: null });
    const layoutManifest = checkSize(build('group-layout-manifest'), { baseline: null });
    const expected =
      ['runtime.js', 'main.js', 'host.js', 'editor-a.js', 'editor-b.js', 'shell.js'].reduce(
        (sum, name) => sum + gz(name),
        0,
      ) + gz('welcome.js');
    expect(flat.total).toBe(expected);
    for (const report of [group, layoutManifest]) {
      expect(report.total).toBe(flat.total);
      expect(report.eager).toBe(flat.eager);
      expect(new Set(report.initial.map((entry) => entry.file))).toEqual(new Set(flat.initial.map((e) => e.file)));
      expect(report.firstVisit.map((g) => g.boundary)).toEqual(['dialog-first-run']);
      expect(report.lazy.map((g) => g.files)).toEqual(flat.lazy.map((g) => g.files));
      expect(report.ok).toBe(true);
    }
    // the island (≈ the whole editor) is in the measure under the group, never silently dropped
    expect(group.initial.map((entry) => entry.file)).toEqual(
      expect.arrayContaining(chunks('editor-a.js', 'editor-b.js', 'host.js')),
    );
  });

  it('counts the host and the route’s own shell as initial by marker; the other shell stays lazy', () => {
    const dir = build('group');
    const editor = readRouteScripts(dir, 'editor');
    expect(editor.segment).toBe('/(studio)/editor/page');
    expect(editor.promoted).toEqual([{ id: 3, files: chunks('shell.js') }]);
    expect(editor.initial).toEqual(expect.arrayContaining(chunks('host.js', 'shell.js')));
    expect(editor.initial).not.toContain('static/chunks/autorig.js');
    expect(editor.lazy.map((group) => group.files)).toContainEqual(chunks('autorig.js'));

    const autorig = readRouteScripts(dir, 'autorig');
    expect(autorig.promoted).toEqual([{ id: 4, files: chunks('autorig.js') }]);
    expect(autorig.initial).toEqual(chunks('runtime.js', 'main.js', 'host.js', 'autorig.js'));
    expect(autorig.lazy.map((group) => group.files)).toContainEqual(chunks('shell.js'));
    expect(ROUTE_INITIAL_MARKERS).toEqual({
      editor: ['ekza-studio-host', 'ekza-studio-shell'],
      autorig: ['ekza-studio-host', 'ekza-autorig-shell'],
    });
    // without markers the React.lazy shell is a lazy group (the definition is the markers, not a guess)
    expect(readRouteScripts(dir, 'editor', { initialMarkers: [] }).initial).not.toContain('static/chunks/shell.js');
  });

  it('reads a separate layout manifest when the build writes one', () => {
    const dir = build('group-layout-manifest');
    const route = readRouteScripts(dir, 'editor');
    expect(route.loadableManifests).toEqual([
      join(dir, 'server', 'app', '(studio)', 'editor', 'page', 'react-loadable-manifest.json'),
      join(dir, 'server', 'app', '(studio)', 'layout', 'react-loadable-manifest.json'),
    ]);
    expect(route.dynamic).toEqual(chunks('editor-a.js', 'editor-b.js', 'host.js'));
  });

  it('throws when the page manifest is missing, naming the path it expected', () => {
    for (const shape of ['flat', 'group'] as const) {
      const dir = build(shape);
      const segment = shape === 'flat' ? ['editor'] : ['(studio)', 'editor'];
      const path = join(dir, 'server', 'app', ...segment, 'page', 'react-loadable-manifest.json');
      rmSync(path);
      expect(() => readRouteScripts(dir, 'editor')).toThrow(`${path} not found`);
      expect(() => checkSize(dir, { baseline: null })).toThrow(`${path} not found`);
    }
  });

  it('throws without an app-paths manifest instead of guessing the folder', () => {
    const dir = build('group');
    rmSync(join(dir, 'server', 'app-paths-manifest.json'));
    expect(() => readRouteScripts(dir, 'editor')).toThrow(/app-paths-manifest\.json not found/);
    // the prerendered HTML stays at server/app/editor.html under a route group
    expect(readFileSync(join(dir, 'server', 'app', 'editor.html'), 'utf8')).toContain('main.js');
  });
});
