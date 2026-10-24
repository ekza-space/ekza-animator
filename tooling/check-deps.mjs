#!/usr/bin/env node
// Layering gate (ARCHITECTURE §3, ADR 0001): every workspace package.json may list only the dependencies and
// devDependencies allowed below (separate allow-lists), internal packages use `workspace:*`, shared packages use the
// pnpm `catalog:`, external versions are exact, nothing depends on doc-yjs, and the internal graph is acyclic.
// Import-level rules (deep imports, DOM/Node globals) are enforced by oxlint (.oxlintrc.json).
//
// Usage: node tooling/check-deps.mjs [workspaceRoot]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scope = (name) => `@ekza-studio/${name}`;
const ANIM_CORE = scope('anim-core');
const DOC = scope('doc');
const DOC_YJS = scope('doc-yjs');
const RIG = scope('rig');
const IO = scope('io');
const EDITOR_CORE = scope('editor-core');
const VIEWPORT = scope('viewport');
const CURVE_EDITOR = scope('curve-editor');
const UI = scope('ui');
const EDITOR = scope('editor');
const MESH_CORE = scope('mesh-core');
const MESH_VIEW = scope('mesh-view');
const AUTORIG = scope('autorig');
// M-AI (MCP-SPEC §2): the agent bridge packages.
const MOTION_ANALYSIS = scope('motion-analysis');
const SCHEMATIC_RENDER = scope('schematic-render');
const AGENT_TOOLS = scope('agent-tools');
const AGENT_EVALS = scope('agent-evals');
const MCP_SERVER = 'ekza-studio-mcp';
const MCP_CLIENT = '@modelcontextprotocol/client';

const VITEST = ['@types/node', 'vitest'];
const BROWSER_TESTS = [...VITEST, '@vitest/browser-playwright', 'playwright'];
const REACT = ['react', 'react-dom'];
const REACT_TYPES = ['@types/react', '@types/react-dom'];
const VRM = ['@pixiv/three-vrm', '@pixiv/three-vrm-animation'];

/**
 * Allowed dependency names per workspace package (MVP-SPEC §2 table, ARCHITECTURE §3). Changing this table is an
 * integration-agent decision (MVP-SPEC §3 convention 3).
 */
export const ALLOWED = {
  'ekza-studio': {
    dependencies: [],
    devDependencies: [
      '@biomejs/biome',
      '@gltf-transform/core',
      '@gltf-transform/extensions',
      '@gltf-transform/functions',
      '@playwright/test',
      '@types/node',
      'meshoptimizer',
      'oxlint',
      'oxlint-tsgolint',
      'playwright',
      'turbo',
      'typescript',
    ],
  },
  [ANIM_CORE]: {
    dependencies: [],
    devDependencies: [...VITEST, '@types/three', 'fast-check', 'three'],
  },
  [DOC]: {
    dependencies: [ANIM_CORE],
    devDependencies: [...VITEST, 'fast-check'],
  },
  [DOC_YJS]: {
    dependencies: [DOC, 'yjs'],
    devDependencies: [...VITEST, 'fast-check'],
  },
  // M6a (M6A-SPEC §2): the mesh kernel (headless, lazy chunk) and its viewport overlays (three.js, lazy chunk).
  [MESH_CORE]: {
    dependencies: [ANIM_CORE, 'earcut', 'robust-predicates'],
    // Browser tests (P1, P4, P5, P6 in Chromium, M6A-SPEC §9 B1) next to the Node run.
    devDependencies: [...BROWSER_TESTS, 'fast-check'],
  },
  [MESH_VIEW]: {
    dependencies: [ANIM_CORE, MESH_CORE, 'three', 'three-mesh-bvh'],
    devDependencies: [...BROWSER_TESTS, '@types/three'],
  },
  [RIG]: {
    // M6B-SPEC §2.1: rig → mesh-core for types only (TriangleBvh, MeshData, SkinWeights in the §4.3 signatures).
    dependencies: [ANIM_CORE, DOC, MESH_CORE],
    devDependencies: [...VITEST, '@types/three', 'fast-check', 'three'],
  },
  [IO]: {
    dependencies: [
      ANIM_CORE,
      DOC,
      RIG,
      MESH_CORE,
      '@gltf-transform/core',
      '@gltf-transform/extensions',
      '@gltf-transform/functions',
      '@pixiv/three-vrm',
      'fflate',
      'three',
    ],
    // M6B-SPEC §2.1: VRMC_vrm 1.0 writer types (types only) and the CI-only VRM validator.
    devDependencies: [
      ...VITEST,
      '@pixiv/three-vrm-animation',
      '@pixiv/types-vrmc-vrm-1.0',
      '@types/three',
      'gltf-validator',
      'vrm-validator',
    ],
  },
  [EDITOR_CORE]: {
    dependencies: [ANIM_CORE, DOC, RIG, IO, MESH_CORE, 'zustand'],
    devDependencies: [...VITEST, 'fast-check', 'gltf-validator'],
  },
  // M-AI (MCP-SPEC §2 layering table). `ekza-studio-mcp` is the only published package: every runtime dependency is
  // bundled into dist/ by rolldown, so its manifest lists them as devDependencies and publishes no `dependencies`;
  // gltf-validator stays an optional peer (`--validate`).
  [MOTION_ANALYSIS]: {
    dependencies: [ANIM_CORE],
    devDependencies: [...VITEST, 'fast-check'],
  },
  [SCHEMATIC_RENDER]: {
    dependencies: [ANIM_CORE, 'fflate'],
    devDependencies: VITEST,
  },
  [AGENT_TOOLS]: {
    dependencies: [ANIM_CORE, DOC, RIG, IO, EDITOR_CORE, MOTION_ANALYSIS, SCHEMATIC_RENDER, 'zod'],
    devDependencies: [...VITEST, 'ajv', 'fast-check'],
  },
  [MCP_SERVER]: {
    dependencies: [],
    devDependencies: [
      ...VITEST,
      AGENT_TOOLS,
      EDITOR_CORE,
      IO,
      DOC,
      RIG,
      ANIM_CORE,
      SCHEMATIC_RENDER,
      '@modelcontextprotocol/server',
      '@modelcontextprotocol/node',
      MCP_CLIENT,
      '@types/ws',
      'gltf-validator',
      'rolldown',
      'ws',
      'zod',
    ],
    peerDependencies: ['gltf-validator'],
  },
  [AGENT_EVALS]: {
    dependencies: [],
    devDependencies: [
      ...VITEST,
      AGENT_TOOLS,
      MCP_SERVER,
      MOTION_ANALYSIS,
      EDITOR_CORE,
      DOC,
      RIG,
      IO,
      ANIM_CORE,
      MCP_CLIENT,
      '@anthropic-ai/sdk',
      'ajv',
      'fast-check',
      'gltf-validator',
    ],
  },
  [scope('headless-tests')]: {
    dependencies: [],
    devDependencies: [
      ...VITEST,
      ANIM_CORE,
      DOC,
      RIG,
      IO,
      EDITOR_CORE,
      MESH_CORE,
      MESH_VIEW,
      ...VRM,
      '@types/three',
      'gltf-validator',
      'three',
      // M6B-SPEC §2.1: the CI-only VRM validator of the character writer's gates.
      'vrm-validator',
      // CHARACTER-CONTRACT-SPEC §4.1 (C2): the written package manifest against the pinned ekza.package.v1 schema.
      'ajv',
    ],
  },
  [VIEWPORT]: {
    dependencies: [ANIM_CORE, DOC, RIG, IO, EDITOR_CORE, MESH_CORE, MESH_VIEW, 'camera-controls', 'three'],
    devDependencies: [...BROWSER_TESTS, '@types/three'],
  },
  [CURVE_EDITOR]: {
    dependencies: [ANIM_CORE, DOC, RIG, EDITOR_CORE],
    devDependencies: BROWSER_TESTS,
  },
  [UI]: {
    dependencies: [
      ...REACT,
      '@fontsource-variable/inter',
      '@fontsource-variable/jetbrains-mono',
      '@tailwindcss/postcss',
      'lucide-react',
      'radix-ui',
      'tailwindcss',
    ],
    devDependencies: [...VITEST, ...REACT_TYPES],
  },
  [EDITOR]: {
    dependencies: [
      ANIM_CORE,
      DOC,
      RIG,
      IO,
      EDITOR_CORE,
      MESH_CORE,
      VIEWPORT,
      CURVE_EDITOR,
      UI,
      // M-AI: editor/src/agent/** (a React.lazy chunk; MCP-SPEC §2)
      AGENT_TOOLS,
      SCHEMATIC_RENDER,
      ...REACT,
      '@react-three/fiber',
      '@tanstack/react-virtual',
      'dockview-react',
      'gltf-validator',
      'react-resizable-panels',
      'three',
      'zustand',
    ],
    devDependencies: [...BROWSER_TESTS, ...REACT_TYPES, '@types/three'],
  },
  // AUTORIG-SPEC §4.1, §10.0 (D0): the Auto-Rig shell — editor-core, doc, ui, viewport (types only), anim-core, React and
  // the editor through its `./host` and `./bodies` subpaths only (oxlint enforces the subpaths); no third-party
  // dependency (the OMOBA kit zip is io's fflate, §5.6.4). Node unit tests; its browser tests are the app's e2e.
  [AUTORIG]: {
    dependencies: [ANIM_CORE, DOC, EDITOR_CORE, VIEWPORT, UI, EDITOR, 'react'],
    devDependencies: [...VITEST, '@types/react'],
  },
  web: {
    // AUTORIG-SPEC §3.1 (D0): `/autorig` mounts the Auto-Rig shell (the only importer of @ekza-studio/autorig).
    dependencies: [EDITOR, UI, AUTORIG, ...REACT, ...VRM, 'next', 'three'],
    // e2e specs may import io and doc (ARCHITECTURE §3).
    devDependencies: [
      ...VITEST,
      ...REACT_TYPES,
      DOC,
      IO,
      // M-AI e2e specs spawn the built server and connect an SDK client (MCP-SPEC §2, §9).
      MCP_SERVER,
      AGENT_EVALS,
      MCP_CLIENT,
      '@playwright/test',
      '@tailwindcss/postcss',
      '@types/three',
      'gltf-validator',
      'playwright',
      'tailwindcss',
      // E2E-MVP-01 (AS-MVP-1 step 11): the exported VRM 1.0 through vrm-validator (pinned as in io, headless-tests).
      'vrm-validator',
    ],
  },
};

/** Packages whose version comes from the pnpm catalog (one copy each across the workspace). */
export const CATALOG = new Set([
  'three',
  '@types/three',
  'react',
  'react-dom',
  '@types/react',
  '@types/react-dom',
  '@pixiv/three-vrm',
  '@pixiv/three-vrm-animation',
  'typescript',
  'vitest',
  '@types/node',
]);

/** Packages that must resolve to exactly one version in pnpm-lock.yaml (ARCHITECTURE §3 rule 4, ADR 0001). */
export const SINGLE_COPY = ['three', 'react', 'react-dom', '@pixiv/three-vrm', '@pixiv/three-vrm-animation'];

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Reads every workspace package.json (root, apps/*, packages/*) under `root`. */
export function readWorkspace(root) {
  const manifests = [{ dir: root, manifest: readJson(join(root, 'package.json')) }];
  for (const group of ['apps', 'packages']) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(groupDir, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(file))
        manifests.push({ dir: join(groupDir, entry.name), manifest: readJson(file) });
    }
  }
  return manifests;
}

/** Returns human-readable violations; an empty list means the workspace follows the layering rules. */
export function checkWorkspace(root, allowed = ALLOWED) {
  const violations = [];
  const packages = readWorkspace(root);
  const internalNames = new Set(packages.map((p) => p.manifest.name));
  const graph = new Map();

  for (const { manifest } of packages) {
    const name = manifest.name;
    const rules = allowed[name];
    if (rules === undefined) {
      violations.push(`${name}: unknown workspace package (add it to the allow-list in tooling/check-deps.mjs)`);
      continue;
    }
    const edges = [];
    for (const field of DEP_FIELDS) {
      const deps = manifest[field] ?? {};
      const permitted = rules[field] ?? [];
      for (const [dep, spec] of Object.entries(deps)) {
        if (!permitted.includes(dep)) {
          violations.push(`${name}: ${field} must not include '${dep}'`);
        }
        if (dep === DOC_YJS && name !== DOC_YJS) {
          violations.push(`${name}: nothing may depend on ${DOC_YJS} (private, test-only)`);
        }
        if (internalNames.has(dep)) {
          edges.push(dep);
          if (spec !== 'workspace:*')
            violations.push(`${name}: internal '${dep}' must use "workspace:*", found "${spec}"`);
        } else if (CATALOG.has(dep)) {
          if (spec !== 'catalog:') violations.push(`${name}: '${dep}' must use "catalog:", found "${spec}"`);
        } else if (!EXACT_VERSION.test(String(spec))) {
          violations.push(`${name}: '${dep}' must be pinned to an exact version, found "${spec}"`);
        }
      }
    }
    graph.set(name, edges);
  }

  for (const cycle of findCycles(graph)) violations.push(`dependency cycle: ${cycle.join(' -> ')}`);

  const lockfile = join(root, 'pnpm-lock.yaml');
  if (existsSync(lockfile)) {
    for (const [name, versions] of lockedVersions(readFileSync(lockfile, 'utf8'), SINGLE_COPY)) {
      if (versions.size > 1)
        violations.push(`pnpm-lock.yaml: '${name}' resolves to ${[...versions].join(', ')}; one copy only`);
    }
  }
  return violations;
}

/** Versions of the given packages listed under `packages:` in a pnpm v9 lockfile. */
export function lockedVersions(lockfile, names) {
  const result = new Map(names.map((name) => [name, new Set()]));
  const section = lockfile.split(/^packages:$/m)[1]?.split(/^snapshots:$/m)[0] ?? '';
  for (const match of section.matchAll(/^ {2}'?((?:@[^/@\s']+\/)?[^@\s']+)@([^(:'\s]+)/gm)) {
    result.get(match[1])?.add(match[2]);
  }
  return result;
}

function findCycles(graph) {
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (node) => {
    state.set(node, 'active');
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 'active') cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 'done');
  };
  for (const node of [...graph.keys()].sort((a, b) => a.localeCompare(b))) if (!state.has(node)) visit(node);
  return cycles;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const violations = checkWorkspace(root);
  if (violations.length > 0) {
    console.error(`check-deps: ${violations.length} violation(s)`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(`check-deps: ${readWorkspace(root).length} workspace packages follow the dependency rules`);
}
