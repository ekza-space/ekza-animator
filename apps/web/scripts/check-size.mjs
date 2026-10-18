#!/usr/bin/env node
// Editor route JS size gate (M2A-SPEC §5.21.2, M-2; CI step after `pnpm build`). Measures the scripts `/editor`
// requests until its empty state shows — the definition the budget bench records from the network
// (`e2e/bench/budgets.bench.ts`, test `editor route JS`), read here from the build: the prerendered HTML's scripts
// and script preloads (not `noModule`), plus the route's `next/dynamic` files (`lib/route-scripts.mjs`) — gzip -9,
// decimal bytes. Fails above 900,000 B, or when a required lazy boundary's code is in the initial set; prints every
// lazy chunk group with its size.
//
// Usage: node scripts/check-size.mjs [--next <dir>] [--json <file>]
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kB, readRouteScripts } from './lib/route-scripts.mjs';

/** CI gate: the §14 budget (decimal bytes, gzip -9). */
export const GATE_BYTES = 900_000;
/** M2a target for the initial route (≥ 100 kB headroom under the budget); see docs/wp-notes for the record. */
export const TARGET_BYTES = 800_000;

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
];

const has = (source, markers) => markers.some((marker) => source.includes(marker));

/**
 * The size report of a build: the initial set, its gzip -9 total, the lazy groups (labelled by boundary where a
 * marker identifies them) and the boundaries whose code is in the initial set. `ok` is the gate verdict.
 */
export function checkSize(nextDir, opts = {}) {
  const gate = opts.gate ?? GATE_BYTES;
  const target = opts.target ?? TARGET_BYTES;
  const route = readRouteScripts(nextDir, opts.route ?? 'editor');
  const initial = route.initial.map((file) => ({ file, bytes: route.sizes.get(file) ?? 0 }));
  const total = initial.reduce((sum, { bytes }) => sum + bytes, 0);
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
  const problems = [];
  if (route.missing.length > 0) problems.push(`initial scripts missing from the build: ${route.missing.join(', ')}`);
  if (total > gate)
    problems.push(`initial route ${total.toLocaleString('en')} B > gate ${gate.toLocaleString('en')} B`);
  for (const id of violations)
    problems.push(`lazy boundary broken: ${BOUNDARIES.find((b) => b.id === id)?.label} is in the initial route`);
  return {
    e2eBuild: route.e2eBuild,
    initial,
    total,
    gate,
    target,
    lazy,
    violations,
    present: BOUNDARIES.filter((boundary) => lazy.some((group) => group.boundary === boundary.id)).map((b) => b.id),
    problems,
    ok: problems.length === 0,
  };
}

function print(report) {
  const out = (line) => process.stdout.write(`${line}\n`);
  const bytes = (n) => `${n.toLocaleString('en')} B`;
  out(
    `check:size — /editor initial route (${report.e2eBuild ? 'e2e build: includes the test routes' : 'production build'}): ` +
      `${report.initial.length} scripts, ${bytes(report.total)} gzip -9 (gate ${bytes(report.gate)}, target ≤ ${bytes(report.target)})`,
  );
  for (const { file, bytes: size } of [...report.initial].sort((a, b) => b.bytes - a.bytes)) {
    out(`  ${kB(size).padStart(10)}  ${file}`);
  }
  const lazyTotal = report.lazy.reduce((sum, group) => sum + group.bytes, 0);
  out(`lazy chunk groups (loaded on demand): ${report.lazy.length}, ${kB(lazyTotal)} gzip -9`);
  for (const group of [...report.lazy].sort((a, b) => b.bytes - a.bytes)) {
    out(`  ${kB(group.bytes).padStart(10)}  ${group.label}  [${group.files.join(', ')}]`);
  }
  const absent = BOUNDARIES.filter((b) => !report.present.includes(b.id) && !report.violations.includes(b.id));
  if (absent.length > 0)
    out(`boundaries not in this build (no marker anywhere): ${absent.map((b) => b.id).join(', ')}`);
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
    report = checkSize(nextDir);
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
