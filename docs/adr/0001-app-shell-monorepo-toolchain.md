# ADR 0001 — App shell, monorepo and toolchain

- Status: Accepted (2026-10-17); amended 2026-10-17 after the design review (rev. 2: tsconfig matrix, lockfile ownership, check-deps for devDependencies)
- Inputs: research [04](../research/04-web-stack.md) §2–3, §10–11, §14; [03](../research/03-ekza-reuse-audit.md) §3; owner brief (three.js + R3F + React + Next.js).

## Context

The editor is a heavy client-only application (WebGL, Canvas2D, workers) with headless cores that must
also run in Node (tests, CLI bakes) and later inside Ekza Hub. The owner asked for Next.js. Research 04
recommended Next 16 + pnpm 11 + TypeScript 7.0.2 + Vitest 5 + dependency-cruiser. The local development
machine has Node 25.6 and pnpm 10.32 installed; corepack is not shipped with Node 25. Several of those picks
were re-verified against the npm registry on 2026-10-17:

| Pick in research | Finding | Consequence |
|---|---|---|
| `typescript@7.0.2` | Its package `exports["."]` is `./lib/version.cjs`: the native compiler ships **no JS API** (only `unstable/*` subpaths) | Next.js (`verifyTypeScriptSetup` loads `typescript`), dependency-cruiser and knip need the API. Too risky for the MVP. |
| `pnpm@11` | Not installed; pnpm 10 auto-switches versions via `packageManager` but needs network and has different defaults | Pin what is installed and proven. |
| `vitest@5.0.3` | `engines.node: ^22.12 \|\| ^24 \|\| >=26` excludes the local Node 25 | Use 4.1.11 (`^20 \|\| ^22 \|\| >=24`), same browser-mode feature set we need. |
| `dependency-cruiser@18.5.0` | `engines ^22\|\|^24\|\|>=26`; parses TS through the `typescript` API | Replace with an in-repo dependency checker plus oxlint `no-restricted-imports`. |
| `next@16.4.2`, `@react-three/fiber@9.8.2`, `react@19.3.1`, `dockview@8.6.0`, `vitest@5.0.5`, `@playwright/test@1.64.1` | Released after the 14-day cut-off (2026-10-03) | Pin the previous release. |

## Decision

1. **Shell: Next.js 16 App Router** (`apps/web`). The editor is a client island (`'use client'` +
   `next/dynamic(..., { ssr: false })`). No `three`, R3F or editor import in any Server Component. The editor
   never *requires* a Next server: `STUDIO_STATIC_EXPORT=1` (the pre-rename `ANIMATOR_STATIC_EXPORT=1` still
   works) produces a static build. A Vite playground host is deferred to M2.
2. **Monorepo: pnpm 10.32.1 workspaces** (`packageManager: "pnpm@10.32.1"`), `catalog:` for shared versions,
   `minimumReleaseAge: 20160` (14 days) in `pnpm-workspace.yaml`, **Turborepo 2.11.7** for cached tasks.
   Internal packages are **just-in-time TypeScript** (`exports` → `./src/index.ts`), private, scope
   `@ekza-studio/*`, never built until publishing (M2+).
3. **Language: TypeScript 6.0.3** with a TS-7-clean `tsconfig` (no `baseUrl`, `moduleResolution: "bundler"`,
   `module: "esnext"`, `verbatimModuleSyntax`, `strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`). TS 6 defaults `types` to `[]`, so the configuration is a **matrix**: a base
   with `lib: ["ES2023"]`; headless packages add `types: ["node"]` (only to type the global WebCrypto, with lint
   rules banning Node globals at runtime); browser packages add `DOM`/`DOM.Iterable`; worker entries add
   `WebWorker`; test configs add Vitest types (verified with tsc 6.0.3; MVP-SPEC §2). `EkzaError` lives in
   `anim-core` so every package can throw it. Moving to TS 7 later is a version bump plus a check that Next and
   tooling accept it.
4. **Lint/format: oxlint 1.86.0 + oxlint-tsgolint 7.0.2003** (type-aware rules; tsgolint embeds its own
   compiler, so it is independent of the project's TS version) and **Biome 2.5.15** as formatter and import
   sorter only.
5. **Layering is enforced twice**: oxlint `no-restricted-imports` / `no-restricted-globals` overrides per
   package, and `tooling/check-deps.mjs`, a zero-dependency script that compares every `package.json`
   dependency **and devDependency** list (separate allow-lists) with the allowed graph in
   [ARCHITECTURE.md §3](../../ARCHITECTURE.md#3-packages-and-dependency-rules). Cross-package fixture tests live in
   the private `packages/headless-tests`, so no devDependency points up the graph.
   **One owner for `package.json` files and the lockfile**: the scaffold writes every package's final dependency
   set and commits `pnpm-lock.yaml`; afterwards only the integration agent changes them (dependency requests),
   so parallel branches never conflict on the lockfile.
6. **Tests: Vitest 4.1.11** (Node environment for headless packages, `@vitest/browser-playwright` 4.1.11
   for Canvas2D/WebGL units), **Playwright 1.63.0** end-to-end against the production Next build in real
   Chrome (`channel: 'chrome'` locally; bundled Chromium with SwiftShader flags on GPU-less CI),
   **fast-check 4.10.2** for property tests, **gltf-validator 2.0.0-dev.3.10** on every exported file.
7. **Runtime: Node 24 LTS** in CI (`.nvmrc` = `24`, `engines.node: ">=24.11.0"`). Node 25 works locally
   with engine warnings only (pnpm `engine-strict=false`); no tool in the pinned set refuses to start on 25.
8. Exact versions are pinned in [MVP-SPEC §2](../MVP-SPEC.md#2-pinned-dependencies-and-toolchain).

## Alternatives

| Alternative | Why not now |
|---|---|
| Vite 8 SPA only | Loses the owner's requested stack, landing/docs/embed routes and server routes (upload proxy, auth callback) for M4. Kept as the M2 embedding playground. |
| TypeScript 7.0.2 | No JS API (verified). Revisit when TS 7.1 ships the API and Next declares support. Optional fast `tsc -b` with TS 7 in CI is allowed once the code base compiles cleanly on 6.0. |
| TypeScript 5.9.3 | Older; 6.0 is the last JS-API release and the bridge to 7. |
| pnpm 11.x | Not installed locally, no corepack on Node 25; nothing in the MVP needs pnpm 11. |
| ESLint + typescript-eslint | Slower; peer range `<6.1` would block a TS 7 move. Oxlint covers React hooks/compiler rules and type-aware rules. |
| dependency-cruiser | Engine range excludes Node 25 and it needs the TS API; an 80-line checker over `package.json` + lint rules is enough for a 10-package graph. |

## Consequences

- One `three`, one `react`, one `@pixiv/three-vrm` copy across the workspace via `catalog:`; CI fails if
  `pnpm why three` resolves more than one version.
- pnpm 10 blocks dependency build scripts by default; `onlyBuiltDependencies` in `pnpm-workspace.yaml`
  starts empty and grows only by reviewed additions. `ignoredOptionalDependencies: ["sharp"]` keeps Next's LGPL
  image binaries out (ADR 0009).
- Tailwind 4 does not scan workspace packages under `node_modules`; `packages/ui/styles.css` declares `@source`
  for `packages/editor/src` and `packages/ui/src`, checked by a smoke test.
- Renovate groups `react`/`react-dom`/`@types/react*`/`@react-three/*` (R3F caps React minors at `<19.4`)
  and `three`/`@types/three`/`@pixiv/three-vrm*`.
- When the research-preferred newer versions pass their 14-day soak they are adopted by ordinary
  dependency PRs; none of them changes an API this design relies on.
