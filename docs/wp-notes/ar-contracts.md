# Auto-Rig D0 — contracts, autorig package, route-group-proof size tooling, AR-B1 and the layout spike: build notes

Branch `autorig/contracts` (from `autorig/mvp` at `04e2c54`, AUTORIG-SPEC v0.3). Scope:
[AUTORIG-SPEC §10 D0](../AUTORIG-SPEC.md#d0--contracts-auto-rig-integration-agent-first) with §4.3/§4.5 (the contract),
§7.0–§7.2 (sizes), §8.1/§8.4 (key and string tables), §9 (the CR-AR record below) and §10.0 (the split skeletons).
Decision IDs below are `AR-D0-<n>`. Decisions for the owner are in [DECISIONS-OPEN §M](../DECISIONS-OPEN.md#m-auto-rig-2026-10-22)
(AR-B1, AR-V1).

## Commits

| # | Commit | What |
|---|---|---|
| 1 | `fix(size): route-group-proof route scripts for check:size` | §7.2 rules 1–5 (below); regression test `apps/web/test/route-scripts-group.test.ts` + fixture tree `apps/web/test/fixtures/route-group.ts` |
| 2 | `chore(size): AR-B1 re-baseline of /editor before Auto-Rig` | measured 895,688 B; `size-baseline.json` re-baselined (+2,048 B, enforced); DECISIONS-OPEN §M with AR-B1 |
| 3 | `feat(autorig): D0 contracts, autorig package skeleton and stubs` | §4.3/§4.5 contract, stubs, split skeletons, deps |
| 4 | `feat(size): check:size measures /editor and /autorig per route` | the `--route` loop, per-route boundaries and gates, reachable lazy groups; E2E-AR-00 |
| 5 | `docs(autorig): D0 layout spike, AR-B1 and AR-V1 recorded, wp-notes` | spike numbers and decision, AR-V1, this file |

The spike itself is on `autorig/d0-layout-spike` (`83b37e0`, local, **not for merge**).

## Route-group-proof measurement (§7.2, commit 1)

`apps/web/scripts/lib/route-scripts.mjs`:

1. The segment comes from `server/app-paths-manifest.json` (`routeSegment`): the entry whose path without `(group)`
   segments is `/<route>/page` (exactly one, else it throws; a missing manifest throws). Never guessed.
2. `loadableManifests(nextDir, segment)`: the page's `…/<segment>/page/react-loadable-manifest.json` and every layout's
   `…/layout/react-loadable-manifest.json` above it; their files are unioned into the initial set. **Measured on a real
   Next 16.3.8 Turbopack build** (the spike): the `(studio)` layout's `next/dynamic` host is written **into the page
   entry's manifest** (`server/app/(studio)/editor/page/react-loadable-manifest.json` lists both the host entry and the
   editor island); no `server/app/(studio)/layout/` manifest exists. The code handles both shapes (the fixture tests
   both).
3. A missing page manifest throws with the path it expected (no `{}` fallback). Without the fix the spike build
   measured `/editor` at **139,961 B** (the ≈ 750 kB editor island silently gone) and passed both gates.
4. `ROUTE_INITIAL_MARKERS`: lazy groups whose files carry `ekza-studio-host` or the route's own shell marker
   (`ekza-studio-shell` for `/editor`, `ekza-autorig-shell` for `/autorig`) and whose loader sits in an initial chunk
   count as initial, repeatedly (the shell's `React.lazy` loader lives in the host's chunk). The other route's shell
   stays lazy. No marker is in the code yet (D1 adds `ekza-studio-shell` and the real host), so today's measures are
   unchanged.
5. `route-scripts-group.test.ts` builds the fixture tree three times from the same chunk files — flat `app/editor/page`,
   `(studio)` with the host in the page manifest, `(studio)` with a separate layout manifest — and asserts equal
   `/editor` totals, eager bytes, initial sets and lazy groups; deleting the page manifest throws (both shapes);
   deleting the app-paths manifest throws.

The four existing size-test fixtures gained the `app-paths-manifest.json` line (one line each; nothing weakened).

## AR-B1 (commit 2) and D0's own delta

`/editor` on `autorig/mvp` = **895,688 B** (888,834 eager + 6,854 First-run dialog), equal to the M6b total; recorded as
the new baseline with `allowance: 2048`, `enforce: true`, `packages: {d0: 64, d1: 1408, d2: 448, d3: 128}`, the M6b
record under `previous` (with the M2a record nested). The gate message is now labelled by the file
(`eagerDelta.label` = "Auto-Rig eager delta"; default "Eager delta").

D0's measured delta: **+44 B** (895,732 B) ≤ 64 B — the `autorig` alternative in `isRigWorkspaceOperator` **+5 B**, the
`applyPoseAsRest` loader line in `DialogHost.tsx` **+39 B** (a new `import()` loader in the eager chunk; measured by
rebuilding without it). Unused: 20 B.

Chunk attribution of `/editor`'s eager scripts (source-map build, `STUDIO_SOURCE_MAPS=1`; the map comments add 111 B):
three 175.6 kB, next 127.4, editor-core 101.7, editor 90.8, dockview-core 83.0, R3F 52.7, viewport 39.5, rig 37.2,
curve-editor 28.7, doc 23.3, anim-core 16.3, react-resizable-panels 13.3. `/autorig` (placeholder): next 127.4 kB,
turbopack runtime 3.7, autorig 1.2, the rest < 1 kB.

## Gates per route (commit 4)

`check-size.mjs` measures every route of the build (`ROUTES`: `/editor` required, `/autorig` when
`server/app/autorig.html` exists; `--route <name>` picks one; `--json` writes `{editor, autorig}`):

- `/editor`: gate 900,000 B, target 850,000 B, first visit `dialog-first-run`, the eager delta (AR-B1), the shipped
  BOUNDARIES **plus `autorig-shell`** (marker `ekza-autorig-shell`, referenced by `packages/autorig/src/types.ts`).
- `/autorig`: gate **660,000 B**, target 620,000 B, **reported, not enforced** until D1 records
  `size-baseline.json` › `routes.autorig` (`enforce: true`, `total`); no first-visit group (Auto-Rig never opens the
  First-run dialog); every shipped boundary **plus** `dockview` (`dv-dockview`), `curve-editor` (`Absolute, normalized
  or stacked curves`, `DopeSheetController: the canvas`) and `studio-shell` (`ekza-studio-shell`, D1's Studio shell
  entry). `model-operators`, `command-palette`, `marking-menu`, `dialog-first-run` and the four M6b chunks are shipped
  boundaries already.
- Lazy groups are the loaders a route **can reach** (defined in an initial chunk or in a reachable group's chunk): with
  two routes in one build, `/editor` no longer lists the `/autorig` page's chunk (that was the only difference, checked
  against the old reader on the same build).
- D0 measures: `/editor` 895,732 B; `/autorig` (placeholder, no EditorApp) **134,011 B** (recorded under
  `routes.autorig.placeholder`, not as the baseline).

## Layout spike (§7.0 rule 4, commit 5)

`autorig/d0-layout-spike`: `app/(studio)/layout.tsx` → client island `StudioHostIsland` → `next/dynamic` stub
`StudioHostStub` (marker `ekza-studio-host`, renders its children), with today's `editor/` page and D0's `autorig/` page
moved under `(studio)/`; no package code moved. Production build, route-group-proof `check:size`:

| Route | D0 HEAD | Spike | Delta |
|---|---:|---:|---:|
| `/editor` (eager + first visit) | 895,732 B | 896,358 B | **+626 B** |
| `/autorig` | 134,011 B | 134,630 B | +619 B |

The two new initial files are the layout island (0.5 kB) and the host group (0.3 kB). **626 B ≤ 1,024 B → the shared
`(studio)` layout stays the plan of record** (recorded in AR-B1); D1 builds it, re-measures at its merge and stays
bound by its 1,408 B (782 B left for the HostShell split itself, measured from the spike).

## Contract (commit 3)

| Item | Where |
|---|---|
| §4.3/§4.5 types shared with the operator contract | `editor-core/src/types.ts` (end: `AutoRigStep`, `AutoRigSubject`, `AutoRigPoseClass`, `IntakeReport`, `ClipParams`, `AutoRigSampleId`, `AutoRigFix`, `AutoRigExportTarget`, `AutoRigRigResult`, `AutoRigExportResult`, `ShellRoute`, `NavigationRequest`, `NavigationPort`, `HandoffInfo`); `AutosaveStore` optional `writeHandoff` / `takeHandoff` / `pruneHandoffs`. **No `NavProfile` change** |
| `OperatorMap` rows | `editor-core/src/operators/args.ts`: the nine `autorig.*` ids; `skel.pose.tStance {character?}`; `skel.pose.applyAsRest {character?, pose?: 'test' \| 'tStance'}`; `mesh.importStatic … dropSkin?`; `library.preview … params?, bytes?, label?`; `library.useClip … params?, replace?` |
| Chunk routing (the only intended eager change) | `editor-core/src/workspaces/rig.ts`: `isRigWorkspaceOperator` + `autorig` |
| Stubs (poll-fail "Arrives with Auto-Rig") | `operators/builtin/rig/wizard/{intake,rig,clip,export,navigate}.ts`, `wizard/index.ts` (`WIZARD_OPERATORS`), `rig/index.ts` (two imports + two spreads); `rig/restPose.ts` (the two `skel.pose.*` stubs moved from `skeleton.ts` unchanged) |
| Composition runner | `wizard/compose.ts` (AR-D0-1): `wizardStub`, `runComposition`, `ARRIVES_WITH_AUTORIG`, `COMPOSITION_INTERRUPTED`; tests `editor-core/test/autorig/composition.test.ts` |
| `@ekza-studio/autorig` | `packages/autorig/{package.json,tsconfig.json,vitest.config.ts}`, `src/types.ts` (session with every slice, `AutoRigProgress`, `AUTORIG_SHELL_MARKER`, `AUTORIG_SESSION_KEY`), stubs `src/{shell,session,progress,nav}/index.ts`, `src/steps/<step>/index.ts` (each slice's default), `src/i18n/**`, `src/keymap/**`, `test/contracts.test.ts` |
| editor | `package.json` exports `./host`, `./bodies`; `src/bodies.ts`; `src/host/index.ts` (stub: `STUDIO_HOST_MARKER`, `provideAutoRigTestState`); `panels/paintWeights/PaintWeightsControls.tsx` (stub, renders null); `dialogs/ApplyPoseAsRestDialog.tsx` (stub rendering `PendingRigDialog`) + its loader line in `DialogHost.tsx`; `test-api/autorig.ts`, its `types.ts` line and its spread in `createTestApi.ts` |
| web | `app/autorig/{page.tsx,AutoRigIsland.tsx}` (placeholder; `next/dynamic` of `@ekza-studio/autorig`), `package.json` dependency, `next.config.ts` `transpilePackages`, `tsconfig.json` reference |
| Dependencies | `tooling/check-deps.mjs`: the `@ekza-studio/autorig` row and `web → autorig`; no third-party dependency (the kit zip is io's `fflate`) |
| e2e | `apps/web/e2e/helpers/autorig.ts` (open, sample, `autorig()`, `history()`, script markers), `apps/web/e2e/ar-00-foundation.spec.ts` (E2E-AR-00) |

## Decisions and deviations

| ID | Decision | Why |
|---|---|---|
| AR-D0-1 | `wizard/compose.ts` is a D0-owned support file the owners import (`wizardStub`, `runComposition`). `runComposition(app, steps, {alive})` runs each step through `app.runUntyped`; before every step (after its optional awaited `before` hook) it stops with `interrupted` ("Rigging was interrupted by another change") when the history top is not the one the last inner run left, when an `edit.undo` / `edit.redo` ran since the start (the registry's `onBeforeDocumentRun` hook — catches an undo *during* a long inner run such as the bind), or when `alive()` is false; a cancelled or failed step stops it with `failed` (code, message). It never writes the store and records no step | the §4.5 runner rules need one implementation, and a constant used by every stub file cannot live in `wizard/index.ts` (import cycle at module evaluation) |
| AR-D0-2 | The shared contract types live in `editor-core/src/types.ts`; `packages/autorig/src/types.ts` re-exports them and holds only the shell's own types (session, slices, stages, progress) | `OperatorMap` rows return `IntakeReport` and take `ClipParams`, and editor-core must not import autorig (§4.1) |
| AR-D0-3 | The session type is `AutoRigSession extends AutoRigSlices` with named slice interfaces (`AutoRigModelSlice` …), the same fields as §4.3 | lets `session/` patch slices generically (`AutoRigSliceName`) |
| AR-D0-4 | `@ekza-studio/autorig` also depends on `anim-core` (Disposer, EkzaError) and React; Node unit tests | the shell needs them; listed in check-deps |
| AR-D0-5 | `autorig.navigate`'s args mirror `NavigationRequest` without `subject` (the in-memory hand-over is the port's, not a palette/MCP argument) | §4.4 "passes the Studio selection through the navigation port" |
| AR-D0-6 | `library.preview`'s byte source is `bytes?` with an optional `label?` beside `clip` (the id the preview reports) | the ROM clip has no manifest entry (§5.4.1) |
| AR-D0-7 | The test API's `autorig()` provider registry is a `WeakMap` keyed by the app in `test-api/autorig.ts` (marker-free), re-exported by the host stub | the shell registers it without loading the test-API chunk |
| AR-D0-8 | The placeholder `/autorig` mounts the shell stub through `next/dynamic` (client), not as server HTML | so the `autorig-shell` marker exists in a real build: E2E-AR-00 proves `/editor` never fetches it and `/autorig` does |

**Shared files touched outside the D0 Dirs list** (each one line or an additive row the D0 changes require; for D7's
approval): `.oxlintrc.json` (import rules for `packages/autorig/{src,test}` — the editor only through `./host` and
`./bodies`, never mesh-core/rig/io/mesh-view — and `@ekza-studio/autorig` for `apps/web/app/**`), `apps/web/tsconfig.json`
(reference), `apps/web/scripts/lib/route-scripts.d.mts` (types of the changed reader), `packages/editor/src/test-api/createTestApi.ts`
(one spread line, required by the `types.ts` line), `packages/editor-core/test/m6b/keys-hash.test.ts` (P-C6 table: the
nine `autorig.*` rows, pending per owner, `autorig.clip.add` a §3 rule 7 `keys` exception — the table test lists every
rig-chunk operator), `pnpm-lock.yaml`.

**For later packages**: D3 must add `@source "../autorig/src";` to `packages/ui/styles.css` (Tailwind scans only
`editor/src` and `ui/src`; D0's placeholder uses classes those already contain). The spec's work-package prompt named
these notes `autorig-contracts.md`; the spec's D0 Dirs name `ar-contracts.md`, which this file follows.

## §9 contract requests to M6b — starting record (copied from AUTORIG-SPEC §9)

| ID | Status | Remaining work (owner) |
|---|---|---|
| CR-AR-1 host-agnostic bodies | **partly** — `QuickRigPanelBody`, `ClipCardList`, `VrmMetaFields`, `CharacterChecks` + `useCharacterRows`, `ThumbnailPreview` exist; `PaintWeightsControls` missing | D4 extracts `PaintWeightsControls` (D0 stub in place); D0 published every body through `@ekza-studio/editor/bodies` |
| CR-AR-2 (a) params/replace, (b) bind progress + abort, (c) in-memory preview source | (a) not built, (b) partly (`session.busy` per mesh, skin service `cancel()` off the contract type), (c) not built | D5 (a)(c) by the §5.5.3 byte route — `args.ts` rows landed by D0; D4 (b) via `autorig.cancel` |
| CR-AR-3 pure start checks | **landed** (`quickRigStartChecks(bounds, bvh)`) | none (D3 calls it from `autorig.inspect`) |
| CR-AR-4 checklist export | **landed** (`rigChecklist`, `app.rig.validation.rows`) | none |
| CR-AR-5 tools in any pane, pane ids, plain-grid test | **partly** — pane ids exported; plain-grid browser test missing | D4 lands the test; D1 moves the constants to `editor/src/host/panes.ts` |
| CR-AR-6 `mesh.importStatic {dropSkin}` | **landed, untyped, untested** | typed by D0 (`args.ts`); D3 adds the test |

## Gates

Recorded in the final report of this package (format, lint, typecheck, check:deps, unit tests, build, check:size on
both routes, E2E-AR-00 and the full e2e suite on port 3160, local Chrome).
