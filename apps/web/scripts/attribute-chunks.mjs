#!/usr/bin/env node
// Chunk attribution of the editor route (M2A-SPEC §5.21.2, M-2 first deliverable): reads a production build made
// with browser source maps (`STUDIO_SOURCE_MAPS=1 pnpm --filter web build`) and attributes every byte of the
// route's initial scripts (`lib/route-scripts.mjs`, the definition `check:size` and the bench share) to a package
// and a top-level module through the source maps.
//
// Bytes per group: raw = generated characters mapped to that group's sources (UTF-8 bytes); gzip = the group's
// generated code of each chunk compressed on its own (gzip -9), scaled so a chunk's groups add up to the chunk's
// real gzip -9 size (compression shares context across groups, so a standalone figure over-counts). Generated code a
// map does not cover (the chunk wrapper, Turbopack's module table) is "(unmapped)".
//
// Usage: node scripts/attribute-chunks.mjs [--json out.json] [--top N] [--lazy]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzip9, kB, readRouteScripts } from './lib/route-scripts.mjs';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nextDir = join(appDir, '.next');

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) DIGIT[BASE64.charCodeAt(i)] = i;

/** Decodes a v3 `mappings` string into per-line segments [generatedColumn, sourceIndex | -1]. */
export function decodeMappings(mappings) {
  const lines = [];
  let line = [];
  let source = 0;
  let i = 0;
  const values = [];
  let column = 0;
  while (i <= mappings.length) {
    const c = i < mappings.length ? mappings.charCodeAt(i) : 59;
    if (c === 59 /* ; */ || c === 44 /* , */) {
      if (values.length > 0) {
        column += values[0];
        if (values.length >= 4) {
          source += values[1];
          line.push([column, source]);
        } else {
          line.push([column, -1]);
        }
        values.length = 0;
      }
      if (c === 59) {
        lines.push(line);
        line = [];
        column = 0;
      }
      i++;
      continue;
    }
    let value = 0;
    let shift = 0;
    for (;;) {
      const digit = DIGIT[mappings.charCodeAt(i++)];
      if (digit === undefined || digit < 0) throw new Error('bad mappings');
      value += (digit & 31) << shift;
      shift += 5;
      if ((digit & 32) === 0) break;
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1);
  }
  return lines;
}

/** Package and top-level module of a source path from a Turbopack map. */
export function classifySource(source) {
  const path = source.replace(/^turbopack:\/\/\/?/, '').replace(/^\[project\]\//, '');
  const nm = path.lastIndexOf('node_modules/');
  if (nm !== -1) {
    const rest = path.slice(nm + 'node_modules/'.length).split('/');
    const name = rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1]}` : (rest[0] ?? '?');
    const after = rest.slice(name.split('/').length);
    const topModule = `${name}/${after.slice(0, Math.min(2, Math.max(1, after.length - 1))).join('/')}`;
    return { pkg: name, module: topModule };
  }
  const ws = /^(packages|apps)\/([^/]+)\/(.*)$/.exec(path);
  if (ws !== null) {
    const pkg = ws[1] === 'packages' ? `@ekza-studio/${ws[2]}` : `apps/${ws[2]}`;
    const parts = ws[3].split('/');
    const topModule = `${pkg}/${parts.slice(0, parts[0] === 'src' && parts.length > 2 ? 2 : 1).join('/')}`;
    return { pkg, module: topModule };
  }
  if (path.startsWith('[turbopack]') || path.includes('turbopack')) return { pkg: '(turbopack runtime)', module: path };
  return { pkg: '(other)', module: path };
}

function attributeChunk(code, map) {
  const lines = decodeMappings(map.mappings);
  const classes = (map.sources ?? []).map(classifySource);
  const parts = new Map(); // key → { pkg, module, text: string[] }
  const add = (key, pkg, module, text) => {
    if (text.length === 0) return;
    let entry = parts.get(key);
    if (entry === undefined) {
      entry = { pkg, module, text: [] };
      parts.set(key, entry);
    }
    entry.text.push(text);
  };
  const codeLines = code.split('\n');
  codeLines.forEach((text, index) => {
    const segments = lines[index] ?? [];
    let cursor = 0;
    const own = (to, source) => {
      if (to <= cursor) return;
      const slice = text.slice(cursor, to);
      if (source === -1) add('(unmapped)', '(unmapped)', '(unmapped)', slice);
      else {
        const cls = classes[source] ?? { pkg: '(other)', module: '(other)' };
        add(cls.module, cls.pkg, cls.module, slice);
      }
      cursor = to;
    };
    let current = -1;
    for (const [column, source] of segments) {
      own(column, current);
      current = source;
    }
    own(text.length, current);
    if (index < codeLines.length - 1) add('(unmapped)', '(unmapped)', '(unmapped)', '\n');
  });
  return parts;
}

/**
 * Attributes the gzip -9 bytes of `files` (paths under `nextDir`, sources from `route`) to packages and top-level
 * modules through their source maps. Chunks without a map count as "(no map)".
 */
export function attributeFiles(nextDir, route, files) {
  const modules = new Map();
  const packages = new Map();
  let total = 0;
  let totalRaw = 0;
  let unmappedChunks = 0;
  for (const file of files) {
    const code = route.sources.get(file);
    if (code === undefined) continue;
    const chunkGzip = gzip9(code);
    total += chunkGzip;
    totalRaw += Buffer.byteLength(code);
    const mapRef = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(code);
    const mapPath = mapRef === null ? null : join(nextDir, dirname(file), mapRef[1]);
    if (mapPath === null || !existsSync(mapPath)) {
      unmappedChunks++;
      const entry = modules.get(`(no map) ${file}`) ?? { pkg: '(no map)', module: file, raw: 0, gzip: 0 };
      entry.raw += Buffer.byteLength(code);
      entry.gzip += chunkGzip;
      modules.set(`(no map) ${file}`, entry);
      continue;
    }
    const parts = attributeChunk(code, JSON.parse(readFileSync(mapPath, 'utf8')));
    const standalone = new Map();
    let standaloneSum = 0;
    for (const [key, part] of parts) {
      const text = part.text.join('');
      const g = gzip9(text);
      standalone.set(key, { raw: Buffer.byteLength(text), g });
      standaloneSum += g;
    }
    for (const [key, part] of parts) {
      const { raw, g } = standalone.get(key);
      const share = standaloneSum === 0 ? 0 : (g / standaloneSum) * chunkGzip;
      const entry = modules.get(key) ?? { pkg: part.pkg, module: part.module, raw: 0, gzip: 0 };
      entry.raw += raw;
      entry.gzip += share;
      modules.set(key, entry);
    }
  }
  for (const entry of modules.values()) {
    const pkg = packages.get(entry.pkg) ?? { pkg: entry.pkg, raw: 0, gzip: 0, modules: 0 };
    pkg.raw += entry.raw;
    pkg.gzip += entry.gzip;
    pkg.modules++;
    packages.set(entry.pkg, pkg);
  }
  const byGzip = (a, b) => b.gzip - a.gzip;
  return {
    files,
    total,
    totalRaw,
    unmappedChunks,
    packages: [...packages.values()].sort(byGzip),
    modules: [...modules.values()].sort(byGzip),
  };
}

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const top = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 40;
  const withLazy = args.includes('--lazy');
  if (!existsSync(nextDir)) throw new Error('no .next: build with STUDIO_SOURCE_MAPS=1 first');
  const route = readRouteScripts(nextDir);
  const files = withLazy ? [...route.initial, ...route.lazy.flatMap((group) => group.files)] : route.initial;
  const report = attributeFiles(nextDir, route, files);
  const { total, totalRaw, unmappedChunks } = report;
  const pct = (v) => `${((v / total) * 100).toFixed(1)} %`;
  process.stdout.write(
    `Chunk attribution of /editor${withLazy ? ' (initial + lazy)' : ' (initial scripts)'}: ${files.length} scripts, ` +
      `${kB(totalRaw)} raw, ${kB(total)} gzip -9${route.e2eBuild ? ' (e2e build)' : ''}` +
      `${unmappedChunks > 0 ? `; ${unmappedChunks} chunks without a source map` : ''}\n\n`,
  );
  process.stdout.write('| Package | gzip -9 | share | raw |\n|---|---:|---:|---:|\n');
  for (const p of report.packages) {
    process.stdout.write(`| ${p.pkg} | ${kB(p.gzip)} | ${pct(p.gzip)} | ${kB(p.raw)} |\n`);
  }
  process.stdout.write(`\n| Top-level module (top ${top}) | gzip -9 | share | raw |\n|---|---:|---:|---:|\n`);
  for (const m of report.modules.slice(0, top)) {
    process.stdout.write(`| ${m.module} | ${kB(m.gzip)} | ${pct(m.gzip)} | ${kB(m.raw)} |\n`);
  }
  if (jsonOut !== null) {
    writeFileSync(
      jsonOut,
      `${JSON.stringify(
        {
          files,
          totalGzip: total,
          totalRaw,
          packages: report.packages,
          modules: report.modules,
        },
        null,
        2,
      )}\n`,
    );
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
