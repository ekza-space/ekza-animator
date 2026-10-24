#!/usr/bin/env node
// Editor route JS size gate (M2A-SPEC §5.21.2, M-2; CI step after `pnpm build`). Measures the scripts `/editor`
// requests until its empty state shows — the definition the budget bench records from the network
// (`e2e/bench/budgets.bench.ts`, test `editor route JS`), read here from the build: the prerendered HTML's scripts
// and script preloads (not `noModule`), plus the route's `next/dynamic` files (`lib/route-scripts.mjs`), plus the
// lazy groups a browser's first visit opens before the empty state can be used (the First-run dialog) — gzip -9,
// decimal bytes. Fails above 900,000 B, or when a required lazy boundary's code is in the eager scripts; prints
// every lazy chunk group with its size.
//
// M6a (M6A-SPEC §5.27; B9): the eager-delta gate — the route may grow by at most the M6a allowance (+20,480 B) over
// the recorded M2a baseline (`size-baseline.json`; enforced once the owner has decided the allowance, a warning
// until then); the Model workspace chunk (the lazy groups entering Model loads: kernel, mesh view, marking menu)
// warns above 250 kB; and with source maps in the build (`STUDIO_SOURCE_MAPS=1`) the eager scripts' bytes are
// attributed to packages (the chunk attribution report, `attribute-chunks.mjs`).
//
// AUTORIG-SPEC §7.2 (D0): the gate runs once per app route (`ROUTES`: `/editor`, and `/autorig` — required when the
// app source has its page, else when the build has it;
// `--route <name>` picks one). Each route has its gate, target, first-visit groups and boundaries: `/editor` keeps the
// shipped ones plus the `autorig-shell` boundary; `/autorig` (gate 660,000 B, target 620,000 B — reported, not
// enforced, until D1 records its baseline under `routes.autorig` in `size-baseline.json`) adds the dockview,
// curve-editor and Studio-shell boundaries and opens no First-run dialog.
//
// STUDIO-TOUCH-SPEC §20.6 (T2): a third route, `/app` (Ekza Studio's Simple layout, the Halo shell): gate 700,000 B,
// target 660,000 B (ST-19, OQ-3), reported and not enforced until T12 records its baseline under `routes.app` (the
// Auto-Rig D0→D7 pattern); it bans dockview, the Studio and Auto-Rig shells and the curve editor from its initial
// scripts, and the Halo shell (`ekza-halo-shell`) is a banned boundary of `/editor` and `/autorig`.
//
// Usage: node scripts/check-size.mjs [--next <dir>] [--app <dir>] [--route <name>] [--json <file>] [--baseline <file>]
// (`--app`: the app source whose routes are required; default this app unless `--next` names another build).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attributeFiles } from './attribute-chunks.mjs';
import { kB, readRouteScripts } from './lib/route-scripts.mjs';

/** CI gate: the §14 budget (decimal bytes, gzip -9). */
export const GATE_BYTES = 900_000;
/**
 * M2a target for the initial route of a first visit (M2A-SPEC §5.21.2: 800,000 B provisional, set at the M2a
 * integration to the spec's ceiling of 850,000 B with the attribution recorded: A1…A4 added ≈ 58 kB of eager code;
 * docs/wp-notes/m2a-integration.md M2A-INT-4, A5's measurements in docs/wp-notes/m2a-platform-perf.md). Report only;
 * the gate is GATE_BYTES.
 */
export const TARGET_BYTES = 850_000;

/**
 * Required lazy boundaries (M2A-SPEC §5.21.2), each recognised by strings only its code contains. A marker in an
 * initial script is a violation; `label` names the lazy chunk group that holds it.
 */
export const BOUNDARIES = [
  {
    id: 'model-loader',
    label: 'model loader (io/three, three-vrm, GLTF/Draco/KTX2/meshopt loaders)',
    markers: ['VRMC_materials_mtoon', 'THREE.GLTFLoader'],
  },
  {
    id: 'import-path',
    label: 'import pipelines (editor-core importModel/importAnimation, rig import, io readers)',
    markers: [' has no skinned skeleton to animate'],
  },
  { id: 'export-path', label: 'export path (io/write, glTF Transform)', markers: ['glTF-Transform'] },
  { id: 'export-pipeline', label: 'export pipeline (editor-core exportRun)', markers: ['export.in-place-unavailable'] },
  { id: 'project-archive', label: 'project archive (io/project, fflate)', markers: ['invalid zip data'] },
  { id: 'dope-sheet', label: 'Dope Sheet panel', markers: ['ds-canvas'] },
  { id: 'dialog-export', label: 'dialog: Export', markers: ['export-dialog'] },
  { id: 'dialog-import', label: 'dialog: Import', markers: ['import-dialog'] },
  { id: 'dialog-recovery', label: 'dialog: Recovery', markers: ['recovery-dialog'] },
  { id: 'dialog-first-run', label: 'dialog: First run', markers: ['firstrun-dialog'] },
  { id: 'dialog-about', label: 'dialog: About', markers: ['about-dialog'] },
  { id: 'dialog-shortcuts', label: 'dialog: Shortcuts', markers: ['shortcuts-dialog'] },
  { id: 'dialog-preferences', label: 'dialog: Preferences', markers: ['preferences-dialog'] },
  { id: 'dialog-confirm', label: 'dialog: Confirm', markers: ['confirm-dialog'] },
  { id: 'dialog-open', label: 'dialog: Open', markers: ['-file-input'] },
  { id: 'test-api', label: 'e2e test API', markers: ['flushAutosave: '] },
  { id: 'path-browserify', label: 'path-browserify (loaded by the export path)', markers: ['Path must be a string.'] },
  // M6A-SPEC §2 (B0a): the mesh kernel (mesh-core root: ops, editMeshFrom, triangulation, normals, revisions) and the
  // mesh view (mesh-view, three-mesh-bvh) load on first need; their marker constants are referenced by every entry.
  { id: 'mesh-kernel', label: 'mesh kernel (mesh-core)', markers: ['ekza-mesh-kernel'] },
  { id: 'mesh-view', label: 'mesh view (mesh-view, three-mesh-bvh)', markers: ['ekza-mesh-view'] },
  // M6A-SPEC §5.18 (B9): the drawings of the marking menu and the command palette load when first opened.
  { id: 'marking-menu', label: 'marking menu drawing', markers: ['mm-slot-'] },
  { id: 'command-palette', label: 'command palette list', markers: ['cmdk-input'] },
  // M6A-INT-13/14 (§5.27): the Model operators chunk (definitions, polls and bodies of the Model-only operators, the
  // Model menu items, the op descriptors) loads on the first Model entry; B10's selection service with the kernel.
  { id: 'model-operators', label: 'Model operators', markers: ['Works on edges: enter edge mode first'] },
  { id: 'component-selection', label: 'component selection service', markers: ['is not open for component edits'] },
  // M6B-SPEC §2.1, §0.4.9 (C0): the Rig & Skin workspace (rig operators, panels, tools, overlays), the skin worker,
  // the runtime of model-sourced characters and the clip library each load lazily; their markers are referenced by
  // their entry modules only.
  { id: 'rig-workspace', label: 'Rig & Skin workspace', markers: ['ekza-rig-workspace'] },
  { id: 'skin-worker', label: 'skin worker (bind solvers)', markers: ['ekza-skin-worker'] },
  {
    id: 'character-runtime',
    label: 'character runtime (model-sourced characters)',
    markers: ['ekza-character-runtime'],
  },
  { id: 'clip-library', label: 'clip library (panel, preview, Use Clip)', markers: ['ekza-clip-library'] },
  // M-AI B5 (MCP-SPEC §0.3): the actor side of the run scope loads with the runner's actor rules; the apply bodies of
  // the Graph Editor, pose and clip operators load on their first run (`operators/builtin/lazyBodies.ts`).
  {
    id: 'actor-scope',
    label: 'agent run scope (actorScope, actorRun)',
    markers: ['An agent tween at a pose needs frames'],
  },
  {
    id: 'graph-bodies',
    label: 'Graph Editor operator bodies',
    markers: ['with locked rotation curves were not filtered'],
  },
  { id: 'pose-bodies', label: 'pose operator bodies', markers: ['locked channel(s) were not changed'] },
  { id: 'clip-bodies', label: 'clip operator bodies', markers: ['clip.duplicate runs in a transaction'] },
  // CHARACTER-CONTRACT-SPEC §8.15 (C1): the target chunk (contract reader, slot statuses, target operators) loads with
  // the Target panel, Auto-Rig ④'s *For a game…* or a `target.*` run, never with a route.
  {
    id: 'character-target',
    label: 'character target (contracts, slot statuses, target operators)',
    markers: ['ekza-character-target'],
  },
];

/**
 * AUTORIG-SPEC §7.2: boundaries of one route only. `/editor` must never load the Auto-Rig shell; `/autorig` must never
 * load dockview, the curve editor (Graph Editor, Dope Sheet) or the Studio shell (marker referenced by the Studio
 * shell's entry, D1). Each is recognised by strings only its code contains.
 */
const AUTORIG_SHELL = { id: 'autorig-shell', label: 'Auto-Rig shell', markers: ['ekza-autorig-shell'] };
const DOCKVIEW = { id: 'dockview', label: 'dockview (Studio docking)', markers: ['dv-dockview'] };
const CURVE_EDITOR = {
  id: 'curve-editor',
  label: 'curve editor (Graph Editor, Dope Sheet)',
  markers: ['Absolute, normalized or stacked curves', 'DopeSheetController: the canvas'],
};
const STUDIO_SHELL = { id: 'studio-shell', label: 'Studio shell', markers: ['ekza-studio-shell'] };
/** STUDIO-TOUCH-SPEC §20.6 (T2): the Halo shell's entry marker (`@ekza-studio/halo`). */
const HALO_SHELL = { id: 'halo-shell', label: 'Halo shell (Ekza Studio)', markers: ['ekza-halo-shell'] };

export const ROUTE_BOUNDARIES = {
  editor: [AUTORIG_SHELL, HALO_SHELL],
  autorig: [DOCKVIEW, CURVE_EDITOR, STUDIO_SHELL, HALO_SHELL],
  // STUDIO-TOUCH-SPEC §20.6 (T2): `/app` never loads dockview, the other two shells or the curve editor at first.
  app: [DOCKVIEW, STUDIO_SHELL, AUTORIG_SHELL, CURVE_EDITOR],
};

/** The routes `check:size` measures (AUTORIG-SPEC §7.2; `app` STUDIO-TOUCH-SPEC §20.6); `/editor` is required, the
 *  others when the app source or the build has them. */
export const ROUTES = ['editor', 'autorig', 'app'];

/** `/autorig` first-visit gate and target (AUTORIG-SPEC §7.2, AR-D8; gzip -9, decimal bytes). */
export const AUTORIG_GATE_BYTES = 660_000;
export const AUTORIG_TARGET_BYTES = 620_000;

/** `/app` first-visit gate and target (STUDIO-TOUCH-SPEC §20.6, ST-19, OQ-3; gzip -9, decimal bytes). */
export const HALO_GATE_BYTES = 700_000;
export const HALO_TARGET_BYTES = 660_000;

/** Per-route gate, target and first-visit groups (neither Auto-Rig nor Halo opens the First-run dialog). */
export const ROUTE_LIMITS = {
  editor: { gate: 900_000, target: 850_000, firstVisit: ['dialog-first-run'] },
  autorig: { gate: AUTORIG_GATE_BYTES, target: AUTORIG_TARGET_BYTES, firstVisit: [] },
  app: { gate: HALO_GATE_BYTES, target: HALO_TARGET_BYTES, firstVisit: [] },
};

/** The boundaries checked on a route: every shipped one plus the route's own. */
export function boundariesFor(route) {
  return [...BOUNDARIES, ...(ROUTE_BOUNDARIES[route] ?? [])];
}

/** M6B-SPEC §0.4.9: warning thresholds of the M6b lazy chunks (gzip -9, decimal bytes). */
export const M6B_CHUNK_WARN_BYTES = {
  'rig-workspace': 250_000,
  'skin-worker': 120_000,
  'character-runtime': 150_000,
  'clip-library': 60_000,
};

/**
 * The recorded baseline and the current eager allowance (`size-baseline.json`; M6A-SPEC §5.27, M6B-SPEC §0.4.9, since
 * AUTORIG-SPEC §7.0 the AR-B1 re-baseline: the measured route counts the FIRST_VISIT groups).
 */
export const BASELINE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'size-baseline.json');

/** Reads a size baseline file (null when there is none). */
export function readBaseline(file = BASELINE_FILE) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * The eager-delta check (§5.27): how far the measured route is above the recorded baseline, against the allowance.
 * `over` is true above `baseline + allowance`; it fails the gate only when the baseline says `enforce` (production
 * builds; an e2e build carries test routes and is never compared).
 */
export function eagerDelta(total, baseline, e2eBuild) {
  if (baseline === null || baseline === undefined) return null;
  const base = baseline.baseline?.total;
  const allowance = baseline.eagerDelta?.allowance;
  if (typeof base !== 'number' || typeof allowance !== 'number') return null;
  const delta = total - base;
  return {
    baseline: base,
    allowance,
    limit: base + allowance,
    delta,
    over: delta > allowance,
    label: typeof baseline.eagerDelta?.label === 'string' ? baseline.eagerDelta.label : 'Eager delta',
    enforced: baseline.eagerDelta?.enforce === true && !e2eBuild,
    comparable: !e2eBuild,
    pending: typeof baseline.eagerDelta?.pending === 'string' ? baseline.eagerDelta.pending : null,
    packages:
      typeof baseline.eagerDelta?.packages === 'object' && baseline.eagerDelta.packages !== null
        ? baseline.eagerDelta.packages
        : null,
  };
}

/** The Model workspace chunk (§5.27): the lazy groups of the given boundaries, with the warning threshold. */
export function modelChunk(lazy, baseline) {
  const boundaries = baseline?.modelChunk?.boundaries ?? ['mesh-kernel', 'mesh-view', 'marking-menu'];
  const groups = lazy.filter((group) => group.boundary !== null && boundaries.includes(group.boundary));
  const bytes = groups.reduce((sum, group) => sum + group.bytes, 0);
  const warnBytes = baseline?.modelChunk?.warnBytes ?? 250_000;
  return { bytes, warnBytes, over: bytes > warnBytes, groups: groups.map((group) => group.boundary) };
}

/**
 * Lazy boundaries a browser's first visit loads before the empty state can be used: the editor opens the First-run
 * dialog while `prefs.firstRunDone` is false (a fresh profile). They stay lazy for every later visit, and they count
 * in the measured initial route, which is the first visit's (the bench measures a fresh profile).
 */
export const FIRST_VISIT = ['dialog-first-run'];

const has = (source, markers) => markers.some((marker) => source.includes(marker));

/**
 * The size report of a build: the eager scripts and their gzip -9 total (`eager`), the first-visit groups and the
 * measured total (`total` = eager + first visit, the number the gate and the target apply to), the lazy groups
 * (labelled by boundary where a marker identifies them) and the boundaries whose code is in the eager scripts.
 * `ok` is the gate verdict.
 */
export function checkSize(nextDir, opts = {}) {
  const routeName = opts.route ?? 'editor';
  const limits = ROUTE_LIMITS[routeName] ?? { gate: GATE_BYTES, target: TARGET_BYTES, firstVisit: [] };
  const baseline = opts.baseline === undefined ? readBaseline() : opts.baseline;
  // `/editor` uses the file's top-level record; another route its `routes.<name>` record (D1 records `/autorig`'s).
  const routeRecord = routeName === 'editor' ? null : (baseline?.routes?.[routeName] ?? null);
  const gate = opts.gate ?? routeRecord?.gate ?? limits.gate;
  const target = opts.target ?? routeRecord?.target ?? limits.target;
  const gateEnforced = routeName === 'editor' || opts.gate !== undefined || routeRecord?.enforce === true;
  const firstVisitIds = routeName === 'editor' ? FIRST_VISIT : limits.firstVisit;
  const boundaries = boundariesFor(routeName);
  const labels = [...boundaries, ...Object.values(ROUTE_BOUNDARIES).flat()];
  const route = readRouteScripts(nextDir, routeName);
  const initial = route.initial.map((file) => ({ file, bytes: route.sizes.get(file) ?? 0 }));
  const eager = initial.reduce((sum, { bytes }) => sum + bytes, 0);
  const initialSource = route.initial.map((file) => route.sources.get(file) ?? '').join('\n');
  const violations = boundaries.filter((boundary) => has(initialSource, boundary.markers)).map((b) => b.id);
  const lazy = route.lazy.map((group) => {
    const source = group.files.map((file) => route.sources.get(file) ?? '').join('\n');
    const boundary = labels.find((candidate) => has(source, candidate.markers));
    return {
      id: group.id,
      label: boundary?.label ?? `lazy chunk group ${group.id}`,
      boundary: boundary?.id ?? null,
      files: group.files,
      bytes: group.files.reduce((sum, file) => sum + (route.sizes.get(file) ?? 0), 0),
    };
  });
  const firstVisit = lazy.filter((group) => group.boundary !== null && firstVisitIds.includes(group.boundary));
  const total = eager + firstVisit.reduce((sum, group) => sum + group.bytes, 0);
  const problems = [];
  const warnings = [];
  if (route.missing.length > 0) problems.push(`initial scripts missing from the build: ${route.missing.join(', ')}`);
  if (total > gate) {
    const text = `initial route ${total.toLocaleString('en')} B > gate ${gate.toLocaleString('en')} B`;
    if (gateEnforced) problems.push(text);
    else warnings.push(`/${routeName} ${text}; not enforced: ${routeRecord?.pending ?? 'no recorded baseline yet'}`);
  }
  for (const id of violations)
    problems.push(`lazy boundary broken: ${boundaries.find((b) => b.id === id)?.label} is in the initial route`);
  const delta = routeName === 'editor' ? eagerDelta(total, baseline, route.e2eBuild) : null;
  if (delta !== null && delta.over && delta.comparable) {
    const text =
      `${delta.label} +${delta.delta.toLocaleString('en')} B over the ${delta.baseline.toLocaleString('en')} B ` +
      `baseline > allowance +${delta.allowance.toLocaleString('en')} B (limit ${delta.limit.toLocaleString('en')} B)`;
    if (delta.enforced) problems.push(text);
    else warnings.push(`${text}; not enforced: ${delta.pending ?? 'the baseline file does not enforce it'}`);
  }
  for (const [boundary, warnBytes] of Object.entries(M6B_CHUNK_WARN_BYTES)) {
    const bytes = lazy.filter((group) => group.boundary === boundary).reduce((sum, group) => sum + group.bytes, 0);
    if (bytes > warnBytes) {
      warnings.push(`${boundary} chunk ${bytes.toLocaleString('en')} B > ${warnBytes.toLocaleString('en')} B (§0.4.9)`);
    }
  }
  const model = modelChunk(lazy, baseline);
  if (model.over) {
    warnings.push(
      `Model workspace chunk ${model.bytes.toLocaleString('en')} B > ${model.warnBytes.toLocaleString('en')} B ` +
        `(${model.groups.join(', ')})`,
    );
  }
  let attribution = null;
  if (opts.attribute !== false) {
    const mapped = route.initial.filter((file) => /\/\/# sourceMappingURL=\S+\s*$/.test(route.sources.get(file) ?? ''));
    if (mapped.length > 0) attribution = attributeFiles(nextDir, route, route.initial);
  }
  return {
    route: routeName,
    segment: route.segment,
    e2eBuild: route.e2eBuild,
    initial,
    eager,
    firstVisit,
    total,
    gate,
    gateEnforced,
    target,
    lazy,
    violations,
    present: labels.filter((boundary) => lazy.some((group) => group.boundary === boundary.id)).map((b) => b.id),
    eagerDelta: delta,
    modelChunk: model,
    attribution:
      attribution === null
        ? null
        : { packages: attribution.packages, unmappedChunks: attribution.unmappedChunks, total: attribution.total },
    problems,
    warnings,
    ok: problems.length === 0,
  };
}

/** Whether a build has a route's prerendered page (`server/app/<route>.html`). */
export function hasRoute(nextDir, route) {
  return existsSync(join(nextDir, 'server', 'app', `${route}.html`));
}

const PAGE_FILE = /^page\.(tsx|ts|jsx|js)$/;

/**
 * Whether the app source has a page for a route: `app/<route>/page.tsx`, also under route groups
 * (`app/(studio)/<route>/page.tsx`); `page.dev.tsx` test routes do not count.
 */
export function hasSourcePage(appDir, route) {
  const want = route === '' ? '' : `/${route}`;
  const walk = (dir, url) => {
    if (!existsSync(dir)) return false;
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (walk(path, /^\(.*\)$/.test(entry) ? url : `${url}/${entry}`)) return true;
      } else if (url === want && PAGE_FILE.test(entry)) return true;
    }
    return false;
  };
  return walk(join(appDir, 'app'), '');
}

/**
 * The reports of every route the build has (`/editor` always; it throws without it). With `opts.appDir` (the CLI
 * passes the app's own), a route whose page is in the app source is required: a build without its prerendered HTML
 * throws instead of silently dropping the route's report and boundaries (D0 fix round 1).
 */
export function checkRoutes(nextDir, opts = {}) {
  const required = opts.appDir === undefined ? [] : ROUTES.filter((route) => hasSourcePage(opts.appDir, route));
  for (const route of required) {
    if (route !== 'editor' && !hasRoute(nextDir, route)) {
      throw new Error(
        `/${route} has a page in ${join(opts.appDir, 'app')} but the build has no prerendered ` +
          `server/app/${route}.html: check:size would drop its report and boundaries`,
      );
    }
  }
  const routes =
    opts.routes ?? ROUTES.filter((route) => route === 'editor' || required.includes(route) || hasRoute(nextDir, route));
  const reports = {};
  for (const route of routes) reports[route] = checkSize(nextDir, { ...opts, route });
  return { reports, ok: Object.values(reports).every((report) => report.ok) };
}

function print(report) {
  const out = (line) => process.stdout.write(`${line}\n`);
  const bytes = (n) => `${n.toLocaleString('en')} B`;
  const firstVisitFiles = report.firstVisit.reduce((sum, group) => sum + group.files.length, 0);
  out(
    `check:size — /${report.route} initial route, first visit (${report.e2eBuild ? 'e2e build: includes the test routes' : 'production build'}; segment ${report.segment}): ` +
      `${report.initial.length + firstVisitFiles} scripts, ${bytes(report.total)} gzip -9 (gate ${bytes(report.gate)}${report.gateEnforced ? '' : ', reported only'}, target ≤ ${bytes(report.target)})`,
  );
  out(`eager scripts (every visit): ${report.initial.length}, ${bytes(report.eager)}`);
  for (const { file, bytes: size } of [...report.initial].sort((a, b) => b.bytes - a.bytes)) {
    out(`  ${kB(size).padStart(10)}  ${file}`);
  }
  out(
    `first visit only (lazy; a fresh profile opens them at start): ${firstVisitFiles}, ${bytes(report.total - report.eager)}`,
  );
  for (const group of report.firstVisit)
    out(`  ${kB(group.bytes).padStart(10)}  ${group.label}  [${group.files.join(', ')}]`);
  const lazyTotal = report.lazy.reduce((sum, group) => sum + group.bytes, 0);
  out(`lazy chunk groups (loaded on demand): ${report.lazy.length}, ${kB(lazyTotal)} gzip -9`);
  for (const group of [...report.lazy].sort((a, b) => b.bytes - a.bytes)) {
    out(`  ${kB(group.bytes).padStart(10)}  ${group.label}  [${group.files.join(', ')}]`);
  }
  const absent = boundariesFor(report.route).filter(
    (b) => !report.present.includes(b.id) && !report.violations.includes(b.id),
  );
  if (absent.length > 0)
    out(`boundaries not in this route's scripts (no marker reachable): ${absent.map((b) => b.id).join(', ')}`);
  const delta = report.eagerDelta;
  if (delta !== null) {
    out(
      `${delta.label}: ${delta.delta >= 0 ? '+' : ''}${bytes(delta.delta)} over the baseline ${bytes(delta.baseline)} ` +
        `(allowance +${bytes(delta.allowance)}, limit ${bytes(delta.limit)}; ` +
        `${delta.comparable ? (delta.enforced ? 'enforced' : 'not enforced yet') : 'e2e build: not compared'})`,
    );
    // The per-package allowances inside the gate (each package measures its own delta; AR-B1, M6B-SPEC §0.4.9).
    if (delta.packages !== null) {
      const list = Object.entries(delta.packages).map(([id, allowance]) => `${id} +${bytes(allowance)}`);
      out(`  per-package eager allowances (measured at each merge, wp-notes): ${list.join(', ')}; others 0 B`);
    }
  }
  out(
    `Model workspace chunk (lazy: ${report.modelChunk.groups.join(', ') || 'none in this build'}): ` +
      `${bytes(report.modelChunk.bytes)} (warning above ${bytes(report.modelChunk.warnBytes)})`,
  );
  if (report.attribution === null) {
    out('chunk attribution: build with STUDIO_SOURCE_MAPS=1 for the per-package report of the eager scripts');
  } else {
    out(
      `chunk attribution of the eager scripts (gzip -9${report.attribution.unmappedChunks > 0 ? `; ${report.attribution.unmappedChunks} chunks without a map` : ''}):`,
    );
    for (const pkg of report.attribution.packages.slice(0, 12)) {
      out(`  ${kB(pkg.gzip).padStart(10)}  ${pkg.pkg}`);
    }
  }
  for (const warning of report.warnings) out(`WARN: ${warning}`);
  if (report.ok) {
    const headroom = report.gate - report.total;
    if (headroom < 0) {
      out(`REPORTED: /${report.route} ${bytes(report.total)} > ${bytes(report.gate)} (gate not enforced yet)`);
      return;
    }
    const verdict =
      report.total <= report.target ? 'target met' : `above the target by ${bytes(report.total - report.target)}`;
    out(
      `OK: /${report.route} ${bytes(report.total)} ≤ ${bytes(report.gate)} (headroom ${bytes(headroom)}); ${verdict}`,
    );
  } else {
    for (const problem of report.problems) out(`FAIL: ${problem}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const nextDir = args.includes('--next') ? resolve(args[args.indexOf('--next') + 1]) : join(appDir, '.next');
  if (!existsSync(nextDir)) {
    process.stderr.write(`check:size: no production build at ${nextDir}; run \`pnpm build\` first.\n`);
    process.exit(1);
  }
  let result;
  try {
    const baseline = args.includes('--baseline')
      ? readBaseline(resolve(args[args.indexOf('--baseline') + 1]))
      : undefined;
    const routes = args.includes('--route') ? [args[args.indexOf('--route') + 1]] : undefined;
    // the app source whose routes are required: this app for its own `.next`, `--app <dir>` for another build
    const sourceDir = args.includes('--app')
      ? resolve(args[args.indexOf('--app') + 1])
      : args.includes('--next')
        ? undefined
        : appDir;
    result = checkRoutes(nextDir, {
      ...(sourceDir === undefined ? {} : { appDir: sourceDir }),
      ...(baseline === undefined ? {} : { baseline }),
      ...(routes === undefined ? {} : { routes }),
    });
  } catch (error) {
    process.stderr.write(`check:size: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const reports = Object.values(result.reports);
  reports.forEach((report, index) => {
    if (index > 0) process.stdout.write('\n');
    print(report);
  });
  if (args.includes('--json')) {
    writeFileSync(args[args.indexOf('--json') + 1], `${JSON.stringify(result.reports, null, 2)}\n`);
  }
  if (!result.ok) process.exit(1);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
