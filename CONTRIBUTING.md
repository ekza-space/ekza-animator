# Contributing to Ekza Animator

Thanks for helping. This guide covers setup, how the repository is organized, how to add operators, panels and
tools, and the legal rules every contribution follows. The design is in [ARCHITECTURE.md](ARCHITECTURE.md) and
[docs/MVP-SPEC.md](docs/MVP-SPEC.md); read the relevant sections before larger changes.

## Setup

Requirements: Node.js 24 LTS (`.nvmrc`; Node 25 works with engine warnings), pnpm 10.32.1 (`packageManager`; no
corepack needed) and Google Chrome for end-to-end tests.

```bash
pnpm install
pnpm dev              # http://localhost:3000/editor
pnpm test             # unit, headless and browser-mode tests (Turborepo, cached)
pnpm test:e2e         # Playwright against a production build (real Chrome locally)
pnpm run ci           # every gate CI runs, in order
```

`pnpm ci` is a reserved pnpm command, so the gate script is run as `pnpm run ci`. It chains `format:check`, `lint`
(oxlint, type-aware), `typecheck` (`tsc -b` over the whole workspace), `check:deps`, `check:fixtures`,
`check:licenses`, `test`, `build` and `test:e2e`. `pnpm format` rewrites files with Biome.

CI runs end-to-end and browser-mode tests on bundled Chromium with SwiftShader WebGL. To reproduce that locally, run
`pnpm exec playwright install chromium` once and `pnpm test:e2e --project=chromium-swiftshader`.

## Repository map

| Path | What lives there |
| --- | --- |
| `packages/anim-core` | Math, rotate orders, Euler filter, AnimX curve engine, key reduction, control shapes. Zero runtime dependencies. |
| `packages/doc` | Records, partitions, the `DocumentStore`, transactions, preview sessions, undo, snapshots, the conformance suite (`/testing`). |
| `packages/doc-yjs` | Private, test-only Yjs store that runs the full conformance suite. Nothing may depend on it. |
| `packages/rig` | Auto-rig, rig compiler and stateless kernel, clip sampling and import, mirror, pose clipboard, two-bone IK. |
| `packages/io` | GLB/VRM/VRMA readers, budgets, bake, surgeon, writers, lints, `.ekzanim` (`/three` browser loader, `/testing` Node harness). |
| `packages/editor-core` | Headless editor kernel: session, operators and runner, edit kernel, history, registries, keymaps, playback, evaluation. |
| `packages/viewport` | One-canvas multi-pane three.js viewport. |
| `packages/curve-editor` | Canvas2D Graph Editor and time slider. |
| `packages/ui` | Design tokens, Tailwind setup, primitives, icons. |
| `packages/editor` | React shell, panels, dialogs, R3F host, test API. |
| `packages/headless-tests` | Private cross-package Node tests on the licensed fixtures. |
| `apps/web` | Next.js app: landing page, `/editor`, e2e specs, asset scripts. |
| `tooling` | tsconfig matrix and the `check-*` gates. |

The dependency direction is fixed ([ARCHITECTURE §3](ARCHITECTURE.md#3-packages-and-dependency-rules)) and enforced
twice: `tooling/check-deps.mjs` checks every `package.json` (separate allow-lists for dependencies and
devDependencies) and oxlint's `no-restricted-imports` / `no-restricted-globals` check every import. Headless packages
(`anim-core`, `doc`, `rig`, `io`, `editor-core`) never touch the DOM, React, WebGL or Node APIs outside `src/testing/`
and `test/`. Import other packages only through their entry point or a declared subpath (`/testing`, `/three`,
`/worker`); deep imports are lint errors.

## Contracts

The shared types in MVP-SPEC §4 live verbatim in the files the spec names (they are excluded from formatting so they
stay diffable), and every *Public API* block of MVP-SPEC §7 is exported with its final signature. **Changing a
contract means updating `docs/MVP-SPEC.md` first**, in the same pull request. Unimplemented functions throw
`EkzaError('not-implemented', '<package>.<symbol>')`; registration functions are no-ops until their package lands.

## Adding things

**An operator** (an undoable, named action every UI surface calls; ADR 0008):

1. Add its arguments and result to `OperatorMap` in `packages/editor-core/src/operators/args.ts` (a contract change)
   or, from a plugin, by declaration merging on `OperatorMap`.
2. Write an `OperatorDef`: `poll` for availability, an optional async `prepare` for I/O and parsing (never writes the
   document), and a synchronous `apply`. With `flags.undo`, the runner wraps `apply` in one transaction and records
   one history step. Compose through the edit kernel (`applyChannelEdits`, `moveKeys`, …), never by calling
   `app.run` inside `apply`.
3. Register it through `app.contribute({ kind: 'operator', def })` (built-ins: `registerBuiltinOperators`), add a
   keymap binding and a menu item if it has one, and test poll, apply, undo and redo headlessly.

**A panel**: create `packages/editor/src/panels/<name>/` exporting `register<Name>Panel(registry: PanelRegistry)`
that registers a `PanelDef` (id, kind, title, component, key scope). The integration agent adds the call to
`registerBuiltinPanels` in `packages/editor/src/panels/index.ts`. Panel owners edit only their directory; the shell
never edits panel directories. Develop the panel in the `/dev/panels?panel=<id>` harness against the fake app.

**A tool** (a per-panel interaction mode): write a `ToolDef` whose `create(app, host)` returns a `ToolInstance` with
pointer, wheel and key handlers plus `cancel()`. Register it with `app.contribute({ kind: 'tool', def })` from the
owning package's `register*Contributions` function. Drags go through `store.beginPreview` and the edit kernel so one
gesture is one undo step.

## Shared test kit

Test against the kit until the real package lands (MVP-SPEC §3 convention 12); do not write private fakes of another
package's interface.

- **Fake app** (`@ekza-animator/editor-core/testing`): `createFakeEditorApp({ snapshot, skeleton })` is a full
  `EditorApp` over a naive document store (real transaction, preview and undo semantics), naive curves and naive FK.
  It records every `app.run` in `app.calls`; operators you register run through the real runner rules. It never
  imports Node APIs, so Vitest browser-mode tests use it too. `createFakeServices()` records downloads and toasts.
- **Fixtures** (`@ekza-animator/doc/testing`, Node): `readFixture('seed-san.vrm')` for licensed binaries,
  `readSyntheticFixture('wave-doc.json')` (a `DocSnapshot`), `'humanoid-skeleton.json'` (a `SkeletonDesc`) and
  `'rest-pose.json'` (expected rest bone worlds). Browser-mode tests read the same files with
  `commands.readFile('../../fixtures/synthetic/<name>')` from `vitest/browser` (paths resolve from the package root).
  The synthetic files are generated: change `tooling/make-synthetic-fixtures.mjs` and run it, never edit the JSON.
- **three.js in Node** (`@ekza-animator/io/testing`): `loadGltfInNode(bytes)` returns the scene, the VRM,
  `nodeByIndex` in `SkeletonDesc` node order (`skeletonNodeOrder`: parents first, smallest glTF index first) and
  three's `animations`.
- **Panel harness**: `pnpm dev`, then open `/dev/panels?panel=<id>` to mount one registered panel full-page with the
  fake app over the wave document (`dev.state` shows what the fake app holds). E2E builds serve it too and expose the
  fake app as `window.__EKZA_DEV_PANELS__`. Other builds do not compile the route (`page.dev.tsx`) and answer 404.

## Dependencies

`package.json` files and `pnpm-lock.yaml` are owned by the integration agent (MVP-SPEC §3 convention 3). To add a
dependency, open a **dependency request** (an issue or PR comment with name, exact version, licence and reason).
Versions are exact and at least 14 days old (`minimumReleaseAge`); production licences must be in the allow-list of
`tooling/check-licenses.mjs` or carry a reviewed exception in `tooling/license-exceptions.json`. `sharp` (LGPL
libvips) is never installed.

## Commits and pull requests

- Feature branches merge into `dev`; releases go from `dev` to `main`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(rig): …`,
  `fix(io): …`, `docs: …`).
- **Sign off every commit** under the [Developer Certificate of Origin](https://developercertificate.org/) with
  `git commit -s`. The `dco` CI job rejects pull requests with unsigned commits. There is no CLA.
- Fill in the pull request template; keep each pull request focused on one change.

## Licensing rules

- The code is MIT; `packages/anim-core/src/curve/animx/**` is an Apache-2.0 port of Autodesk AnimX with per-file
  headers; fixtures keep their own licences ([fixtures/LICENSES.md](fixtures/LICENSES.md)).
- **Clean-room rule**: never copy code from GPL, AGPL, LGPL, SSPL, unlicensed or proprietary projects (for example
  copyleft web animators, Blender, `@theatre/studio`, `dockview-enterprise`). Re-implementing a *feature* from its
  documented behaviour is fine.
- Code copy-adapted from MIT sources starts with an attribution header:
  `// Adapted from <repo>/<path> @ <commit> (MIT, © <holder>). Changes: <summary>.`
- Every binary fixture needs a row in `fixtures/LICENSES.md` with source, licence and SHA-256 (`pnpm check:fixtures`).
  Mixamo clips and avatars whose VRM meta forbids redistribution never enter the repository.

## Code style

Biome formats (`pnpm format`); oxlint lints with type information. TypeScript is strict, including
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; no `any` in public APIs. Internally the code uses
frames, metres and radians (degrees only in UI formatting). Per-frame paths (`evaluate`, `sample`, scene sync,
painters) do not allocate. Domain functions throw `EkzaError` for invalid caller input and repair, rather than throw
on, document content.
