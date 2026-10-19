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
// warns above 250 kB; and with source maps in the build (`ANIMATOR_SOURCE_MAPS=1`) the eager scripts' bytes are
// attributed to packages (the chunk attribution report, `attribute-chunks.mjs`).
//
// Usage: node scripts/check-size.mjs [--next <dir>] [--json <file>] [--baseline <file>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
];

/** The recorded M2a baseline and the M6a eager allowance (`size-baseline.json`, §5.27). */
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
    enforced: baseline.eagerDelta?.enforce === true && !e2eBuild,
    comparable: !e2eBuild,
    pending: typeof baseline.eagerDelta?.pending === 'string' ? baseline.eagerDelta.pending : null,
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
  const gate = opts.gate ?? GATE_BYTES;
  const target = opts.target ?? TARGET_BYTES;
  const baseline = opts.baseline === undefined ? readBaseline() : opts.baseline;
  const route = readRouteScripts(nextDir, opts.route ?? 'editor');
  const initial = route.initial.map((file) => ({ file, bytes: route.sizes.get(file) ?? 0 }));
  const eager = initial.reduce((sum, { bytes }) => sum + bytes, 0);
  const initialSource = route.initial.map((file) => route.sources.get(file) ?? '').join('\n');
  const violations = BOUNDARIES.filter((boundary) => has(initialSource, boundary.markers)).map((b) => b.id);
  const lazy = route.lazy.map((group) => {
    const source = group.files.map((file) => route.sources.get(file) ?? '').join('\n');
    const boundary = BOUNDARIES.find((candidate) => has(source, candidate.markers));
    return {
      id: group.id,
      label: boundary?.label ?? `lazy chunk group ${group.id}`,
      boundary: boundary?.id ?? null,
      files: group.files,
      bytes: group.files.reduce((sum, file) => sum + (route.sizes.get(file) ?? 0), 0),
    };
  });
  const firstVisit = lazy.filter((group) => group.boundary !== null && FIRST_VISIT.includes(group.boundary));
  const total = eager + firstVisit.reduce((sum, group) => sum + group.bytes, 0);
  const problems = [];
  const warnings = [];
  if (route.missing.length > 0) problems.push(`initial scripts missing from the build: ${route.missing.join(', ')}`);
  if (total > gate)
    problems.push(`initial route ${total.toLocaleString('en')} B > gate ${gate.toLocaleString('en')} B`);
  for (const id of violations)
    problems.push(`lazy boundary broken: ${BOUNDARIES.find((b) => b.id === id)?.label} is in the initial route`);
  const delta = eagerDelta(total, baseline, route.e2eBuild);
  if (delta !== null && delta.over && delta.comparable) {
    const text =
      `M6a eager delta +${delta.delta.toLocaleString('en')} B over the ${delta.baseline.toLocaleString('en')} B ` +
      `baseline > allowance +${delta.allowance.toLocaleString('en')} B (limit ${delta.limit.toLocaleString('en')} B)`;
    if (delta.enforced) problems.push(text);
    else warnings.push(`${text}; not enforced: ${delta.pending ?? 'the baseline file does not enforce it'}`);
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
    e2eBuild: route.e2eBuild,
    initial,
    eager,
    firstVisit,
    total,
    gate,
    target,
    lazy,
    violations,
    present: BOUNDARIES.filter((boundary) => lazy.some((group) => group.boundary === boundary.id)).map((b) => b.id),
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

function print(report) {
  const out = (line) => process.stdout.write(`${line}\n`);
  const bytes = (n) => `${n.toLocaleString('en')} B`;
  const firstVisitFiles = report.firstVisit.reduce((sum, group) => sum + group.files.length, 0);
  out(
    `check:size — /editor initial route, first visit (${report.e2eBuild ? 'e2e build: includes the test routes' : 'production build'}): ` +
      `${report.initial.length + firstVisitFiles} scripts, ${bytes(report.total)} gzip -9 (gate ${bytes(report.gate)}, target ≤ ${bytes(report.target)})`,
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
  const absent = BOUNDARIES.filter((b) => !report.present.includes(b.id) && !report.violations.includes(b.id));
  if (absent.length > 0)
    out(`boundaries not in this build (no marker anywhere): ${absent.map((b) => b.id).join(', ')}`);
  const delta = report.eagerDelta;
  if (delta !== null) {
    out(
      `M6a eager delta: ${delta.delta >= 0 ? '+' : ''}${bytes(delta.delta)} over the baseline ${bytes(delta.baseline)} ` +
        `(allowance +${bytes(delta.allowance)}, limit ${bytes(delta.limit)}; ` +
        `${delta.comparable ? (delta.enforced ? 'enforced' : 'not enforced yet') : 'e2e build: not compared'})`,
    );
  }
  out(
    `Model workspace chunk (lazy: ${report.modelChunk.groups.join(', ') || 'none in this build'}): ` +
      `${bytes(report.modelChunk.bytes)} (warning above ${bytes(report.modelChunk.warnBytes)})`,
  );
  if (report.attribution === null) {
    out('chunk attribution: build with ANIMATOR_SOURCE_MAPS=1 for the per-package report of the eager scripts');
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
    const verdict =
      report.total <= report.target ? 'target met' : `above the target by ${bytes(report.total - report.target)}`;
    out(`OK: ${bytes(report.total)} ≤ ${bytes(report.gate)} (headroom ${bytes(headroom)}); ${verdict}`);
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
  let report;
  try {
    const baseline = args.includes('--baseline')
      ? readBaseline(resolve(args[args.indexOf('--baseline') + 1]))
      : undefined;
    report = checkSize(nextDir, baseline === undefined ? {} : { baseline });
  } catch (error) {
    process.stderr.write(`check:size: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  print(report);
  if (args.includes('--json')) {
    writeFileSync(args[args.indexOf('--json') + 1], `${JSON.stringify(report, null, 2)}\n`);
  }
  if (!report.ok) process.exit(1);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
