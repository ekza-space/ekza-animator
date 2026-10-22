// AUTORIG-SPEC §7.2 (D0): a fixture `.next` tree of the editor route, written in one of three shapes from the SAME
// chunk files, so the route-group regression test can compare their measures:
//
// - `flat` — today's `app/editor/page.tsx`: app-paths entry `/editor/page`, one page manifest naming the editor island
//   (host code included, as today's single island holds it);
// - `group` — `app/(studio)/editor/page.tsx` under a `(studio)/layout.tsx` whose client island loads a dynamic host:
//   app-paths entry `/(studio)/editor/page`, and Turbopack's shape (measured on a real build, wp-notes): the layout's
//   `next/dynamic` files are written into the page entry's manifest at `server/app/(studio)/editor/page/`;
// - `group-layout-manifest` — the same, with the layout's dynamic files in a separate
//   `server/app/(studio)/layout/react-loadable-manifest.json` (the shape the reader must also handle).
//
// Chunks: `runtime.js` + `main.js` (HTML scripts), `host.js` (the StudioHost entry, marker `ekza-studio-host`; its
// `React.lazy` loaders fetch `shell.js` — the Studio shell, marker `ekza-studio-shell` — and `autorig.js` — the Auto-Rig
// shell, marker `ekza-autorig-shell`), `editor-a.js` + `editor-b.js` (the editor island), and three lazy groups: the
// About dialog, the First-run dialog, the rig workspace.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export type RouteGroupShape = 'flat' | 'group' | 'group-layout-manifest';

const push = (id: number, body: string): string =>
  `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,${id},${body}]);`;
const loader = (id: number, files: readonly string[], target: number): string =>
  push(id, `e=>{e.v(t=>Promise.all([${files.map((f) => `"${f}"`).join(',')}].map(t=>e.l(t))).then(()=>t(${target})))}`);
const c = (name: string): string => `static/chunks/${name}`;

/** The chunk files every shape shares (byte-identical across shapes). */
export const ROUTE_GROUP_CHUNKS: Readonly<Record<string, string>> = {
  'runtime.js': `runtime();${'/* next runtime */'.repeat(40)}`,
  'polyfill.js': 'polyfill'.repeat(1000),
  'main.js': `${loader(1, [c('host.js')], 70)}${loader(2, [c('editor-a.js'), c('editor-b.js')], 71)}main();`,
  'host.js': `${loader(3, [c('shell.js')], 72)}${loader(4, [c('autorig.js')], 73)}${push(70, `e=>{const HOST="ekza-studio-host";${'"host services";'.repeat(30)}}`)}`,
  'shell.js': push(72, `e=>{const SHELL="ekza-studio-shell";${'"dockview menus panels";'.repeat(30)}}`),
  'autorig.js': push(73, `e=>{const SHELL="ekza-autorig-shell";${'"wizard frame";'.repeat(30)}}`),
  'editor-a.js': `${loader(5, [c('about.js')], 40)}${loader(6, [c('rig.js')], 60)}editorA();${'"editor a";'.repeat(50)}`,
  'editor-b.js': `${loader(7, [c('welcome.js')], 50)}editorB();${'"editor b";'.repeat(50)}`,
  'about.js': push(40, 'e=>{"data-testid","about-dialog"}'),
  'welcome.js': push(50, `e=>{"data-testid","firstrun-dialog";"${'Welcome to Ekza Studio. '.repeat(20)}"}`),
  'rig.js': push(60, 'e=>{const RIG="ekza-rig-workspace"}'),
};

const HTML = (route: string): string =>
  '<!DOCTYPE html><html><head>' +
  '<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/main.js"/>' +
  '<script src="/_next/static/chunks/runtime.js" async=""></script>' +
  '<script src="/_next/static/chunks/polyfill.js" noModule=""></script>' +
  '<script src="/_next/static/chunks/main.js?dpl=abc" async=""></script>' +
  `<script>self.__next_f.push([1,"${route}"])</script></head></html>`;

const HOST_ENTRY = { 70: { id: 70, files: [c('host.js')] } };
const ISLAND_ENTRY = { 71: { id: 71, files: [c('editor-a.js'), c('editor-b.js')] } };

/**
 * Writes the fixture tree in `shape` to a new temp directory and returns it (the caller removes it). `routes` lists
 * the prerendered app routes (default: `editor` and `autorig`; `autorig` mounts no editor island).
 */
export function routeGroupBuild(shape: RouteGroupShape, routes: readonly string[] = ['editor', 'autorig']): string {
  const dir = mkdtempSync(join(tmpdir(), 'ekza-route-group-'));
  const write = (path: string, data: unknown): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof data === 'string' ? data : JSON.stringify(data));
  };
  const appPaths: Record<string, string> = { '/page': 'app/page.js', '/_not-found/page': 'app/_not-found/page.js' };
  write('server/app/page/react-loadable-manifest.json', {});
  for (const route of routes) {
    const island = route === 'editor' ? ISLAND_ENTRY : {};
    write(`server/app/${route}.html`, HTML(route));
    if (shape === 'flat') {
      appPaths[`/${route}/page`] = `app/${route}/page.js`;
      // today: one client island holds the host code too
      write(`server/app/${route}/page/react-loadable-manifest.json`, { ...HOST_ENTRY, ...island });
    } else {
      appPaths[`/(studio)/${route}/page`] = `app/(studio)/${route}/page.js`;
      if (shape === 'group') {
        write(`server/app/(studio)/${route}/page/react-loadable-manifest.json`, { ...HOST_ENTRY, ...island });
      } else {
        write(`server/app/(studio)/${route}/page/react-loadable-manifest.json`, island);
        write('server/app/(studio)/layout/react-loadable-manifest.json', HOST_ENTRY);
      }
    }
  }
  write('server/app-paths-manifest.json', appPaths);
  for (const [name, text] of Object.entries(ROUTE_GROUP_CHUNKS)) write(`static/chunks/${name}`, text);
  return dir;
}
